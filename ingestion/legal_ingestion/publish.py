from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence

from .chunking import DocumentManifest, LegalChunkRecord
from .cross_references import attach_cross_reference_ids, resolve_cross_references


CHUNKS_FILE = "chunks.jsonl"
REPORT_FILE = "validation-report.json"
# Fields that never belong in the published content fingerprint.
_UNFINGERPRINTED_FIELDS = {"embedding", "status"}


class PublishBlocked(RuntimeError):
    """A pre-publication check failed before anything was written."""


class PublishError(RuntimeError):
    """The database rejected a publish step; the active corpus was not switched."""


# ---------------------------------------------------------------------------
# Artifact
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CorpusArtifact:
    directory: Path
    corpus_version: str
    chunks: tuple[LegalChunkRecord, ...]
    fingerprint: str
    #: True when cross_reference_ids were absent on disk and resolved at load.
    references_linked_at_load: bool

    @property
    def normative_chunks(self) -> tuple[LegalChunkRecord, ...]:
        return tuple(chunk for chunk in self.chunks if chunk.chunk_type == "normative")

    @property
    def document_ids(self) -> tuple[str, ...]:
        return tuple(sorted({chunk.document_id for chunk in self.chunks}))


def load_artifact(directory: Path, manifests: Sequence[DocumentManifest]) -> CorpusArtifact:
    """Load a validated artifact and re-check what the database will rely on."""
    report_path = directory / REPORT_FILE
    if not report_path.is_file():
        raise PublishBlocked(f"Missing {REPORT_FILE} in {directory}")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("is_valid") is not True:
        raise PublishBlocked("Validation report is not valid; only a passing artifact can be published")

    rows, has_references = _read_chunk_rows(directory / CHUNKS_FILE)
    chunks = [LegalChunkRecord.model_validate(row) for row in rows]
    if not chunks:
        raise PublishBlocked("Artifact contains no chunks")

    duplicates = [chunk_id for chunk_id, count in Counter(c.chunk_id for c in chunks).items() if count > 1]
    if duplicates:
        raise PublishBlocked(f"Duplicate chunk ids in artifact: {duplicates[:5]}")

    versions = {chunk.corpus_version for chunk in chunks}
    manifest_versions = {manifest.corpus_version for manifest in manifests}
    if len(versions) != 1 or versions != manifest_versions:
        raise PublishBlocked(
            f"Corpus version mismatch: chunks={sorted(versions)}, manifests={sorted(manifest_versions)}"
        )

    manifest_ids = {manifest.document_id for manifest in manifests}
    chunk_documents = Counter(chunk.document_id for chunk in chunks)
    unknown = sorted(set(chunk_documents) - manifest_ids)
    if unknown:
        raise PublishBlocked(f"Chunks reference documents without a manifest: {unknown}")

    expected = {doc["document_id"]: doc["chunk_count"] for doc in report.get("documents", [])}
    if dict(chunk_documents) != expected:
        raise PublishBlocked(
            f"Chunk counts differ from the validation report: artifact={dict(chunk_documents)}, report={expected}"
        )

    if not has_references:
        chunks = link_cross_references(chunks)

    return CorpusArtifact(
        directory=directory,
        corpus_version=versions.pop(),
        chunks=tuple(chunks),
        fingerprint=artifact_fingerprint(chunks),
        references_linked_at_load=not has_references,
    )


def link_cross_references(chunks: Sequence[LegalChunkRecord]) -> list[LegalChunkRecord]:
    return attach_cross_reference_ids(chunks, resolve_cross_references(chunks))


def artifact_fingerprint(chunks: Sequence[LegalChunkRecord]) -> str:
    """Content hash of the published rows, independent of embeddings and status."""
    digest = hashlib.sha256()
    for chunk in sorted(chunks, key=lambda item: item.chunk_id):
        payload = chunk.model_dump(mode="json", exclude=_UNFINGERPRINTED_FIELDS)
        digest.update(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def link_references_in_place(directory: Path) -> tuple[int, int]:
    """Write resolved cross_reference_ids into chunks.jsonl, atomically.

    Returns (chunk_count, chunks_with_references). Re-running is a no-op.
    """
    path = directory / CHUNKS_FILE
    rows, _ = _read_chunk_rows(path)
    chunks = link_cross_references([LegalChunkRecord.model_validate(row) for row in rows])
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as target:
        for chunk in chunks:
            target.write(json.dumps(chunk.model_dump(mode="json"), ensure_ascii=False) + "\n")
    os.replace(temporary, path)
    return len(chunks), sum(1 for chunk in chunks if chunk.cross_reference_ids)


def _read_chunk_rows(path: Path) -> tuple[list[dict[str, Any]], bool]:
    if not path.is_file():
        raise PublishBlocked(f"Missing {path.name} in {path.parent}")
    rows = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    has_references = bool(rows) and all("cross_reference_ids" in row for row in rows)
    return rows, has_references


# ---------------------------------------------------------------------------
# Database gateway
# ---------------------------------------------------------------------------


class SupabaseGateway(Protocol):
    def select(self, table: str, params: Mapping[str, str]) -> list[dict[str, Any]]: ...

    def upsert(
        self,
        table: str,
        rows: Sequence[Mapping[str, Any]],
        *,
        on_conflict: str,
        ignore_duplicates: bool,
    ) -> None: ...

    def rpc(self, function: str, payload: Mapping[str, Any]) -> Any: ...


class PostgrestGateway:
    """Minimal PostgREST client over the Supabase REST endpoint (service role)."""

    def __init__(
        self,
        url: str,
        service_key: str,
        *,
        timeout_seconds: float = 60.0,
        opener: Callable[..., Any] = urllib.request.urlopen,
    ) -> None:
        self._base = f"{url.rstrip('/')}/rest/v1"
        self._key = service_key
        self._timeout = timeout_seconds
        self._opener = opener

    def select(self, table: str, params: Mapping[str, str]) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode(params)
        result = self._send("GET", f"{self._base}/{table}?{query}", None, {}, f"select {table}")
        return list(result or [])

    def upsert(
        self,
        table: str,
        rows: Sequence[Mapping[str, Any]],
        *,
        on_conflict: str,
        ignore_duplicates: bool,
    ) -> None:
        if not rows:
            return
        resolution = "ignore-duplicates" if ignore_duplicates else "merge-duplicates"
        url = f"{self._base}/{table}?{urllib.parse.urlencode({'on_conflict': on_conflict})}"
        self._send(
            "POST",
            url,
            list(rows),
            {"Prefer": f"resolution={resolution},return=minimal"},
            f"upsert {table}",
        )

    def rpc(self, function: str, payload: Mapping[str, Any]) -> Any:
        return self._send("POST", f"{self._base}/rpc/{function}", dict(payload), {}, f"rpc {function}")

    def _send(
        self,
        method: str,
        url: str,
        body: Any,
        extra_headers: Mapping[str, str],
        label: str,
    ) -> Any:
        headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json",
            **extra_headers,
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with self._opener(request, timeout=self._timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            raise PublishError(f"{label}: HTTP {error.code}: {_postgrest_message(error)}") from None
        except urllib.error.URLError as error:
            raise PublishError(f"{label}: network error ({type(error.reason).__name__})") from None
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))


def _postgrest_message(error: urllib.error.HTTPError) -> str:
    try:
        payload = json.loads(error.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - diagnostics only
        return "no response body"
    message = payload.get("message") if isinstance(payload, dict) else None
    return str(message or payload)[:300]


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PublishOptions:
    require_embeddings: bool = True
    allow_in_place_update: bool = False
    batch_size: int = 50
    run_id: str | None = None
    embedding_model: str | None = None


@dataclass(frozen=True)
class PublishSummary:
    run_id: str
    corpus_version: str
    chunk_count: int
    normative_count: int
    embedded_count: int
    document_count: int
    activation: Mapping[str, Any]


def document_rows(
    manifests: Sequence[DocumentManifest], document_ids: Sequence[str], corpus_version: str
) -> list[dict[str, Any]]:
    by_id = {manifest.document_id: manifest for manifest in manifests}
    return [
        {
            "document_id": document_id,
            "document_number": by_id[document_id].document_number,
            "document_type": by_id[document_id].document_type,
            "title": by_id[document_id].title,
            "issued_date": by_id[document_id].issued_date,
            "effective_date": by_id[document_id].effective_date,
            "source_file": by_id[document_id].source_file,
            "pdf_url": f"/corpus/{by_id[document_id].source_file}",
            "corpus_version": corpus_version,
        }
        for document_id in document_ids
    ]


def chunk_row(chunk: LegalChunkRecord, embedding: Sequence[float] | None) -> dict[str, Any]:
    """Row for legal_chunks. `status` is omitted on purpose: a new row starts as
    'staged' (column default) and an existing row keeps its status, so an upload
    never changes what is being served before activation."""
    row = chunk.model_dump(mode="json", exclude={"embedding", "status"})
    if embedding is not None:
        row["embedding"] = [float(value) for value in embedding]
    return row


def publish_corpus(
    artifact: CorpusArtifact,
    manifests: Sequence[DocumentManifest],
    gateway: SupabaseGateway,
    embeddings: Mapping[str, Sequence[float]],
    options: PublishOptions = PublishOptions(),
    *,
    log: Callable[[str], None] = lambda _message: None,
) -> PublishSummary:
    """Upload a validated artifact as staged rows, then activate it atomically.

    Order of operations:
      1. refuse early (nothing written) if embeddings are missing or the version
         is already active with different content;
      2. insert new document rows as staged (existing rows are left untouched);
      3. upsert chunk rows in batches without `status` (new rows stay staged);
      4. call `activate_legal_corpus`, which checks counts/embeddings and flips
         the corpus in one transaction.
    A failure in steps 2-3 leaves the active corpus serving as before; the
    activation step either fully succeeds or rolls back.
    """
    if options.batch_size < 1:
        raise ValueError("batch_size must be positive")
    normative = artifact.normative_chunks
    missing = [chunk.chunk_id for chunk in normative if chunk.chunk_id not in embeddings]
    if missing and options.require_embeddings:
        raise PublishBlocked(
            f"{len(missing)} of {len(normative)} normative chunks have no embedding; run the "
            "`embed` command first or pass --allow-missing-embeddings for a keyword-only corpus"
        )

    _guard_active_version(artifact, gateway, options)

    run_id = options.run_id or f"publish-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    documents = document_rows(manifests, artifact.document_ids, artifact.corpus_version)
    gateway.upsert("legal_documents", documents, on_conflict="document_id", ignore_duplicates=True)
    log(f"Documents ready: {len(documents)}")

    rows = [chunk_row(chunk, embeddings.get(chunk.chunk_id)) for chunk in artifact.chunks]
    # PostgREST bulk upserts need one column set per request; rows without an
    # embedding are sent separately so they never overwrite a stored vector.
    uploaded = 0
    for group in (
        [row for row in rows if "embedding" in row],
        [row for row in rows if "embedding" not in row],
    ):
        for start in range(0, len(group), options.batch_size):
            batch = group[start : start + options.batch_size]
            gateway.upsert("legal_chunks", batch, on_conflict="chunk_id", ignore_duplicates=False)
            uploaded += len(batch)
            log(f"Staged chunks: {uploaded}/{len(rows)}")

    embedded_count = sum(1 for chunk in normative if chunk.chunk_id in embeddings)
    activation = gateway.rpc(
        "activate_legal_corpus",
        {
            "target_corpus_version": artifact.corpus_version,
            "expected_chunk_ids": [chunk.chunk_id for chunk in artifact.chunks],
            "documents": documents,
            "publish_run_id": run_id,
            "publish_report": {
                "artifact_sha256": artifact.fingerprint,
                "chunk_count": len(artifact.chunks),
                "normative_chunk_count": len(normative),
                "embedded_chunk_count": embedded_count,
                "embedding_model": options.embedding_model,
                "source": "legal_ingestion publish",
            },
            "require_embeddings": options.require_embeddings,
        },
    )
    return PublishSummary(
        run_id=run_id,
        corpus_version=artifact.corpus_version,
        chunk_count=len(artifact.chunks),
        normative_count=len(normative),
        embedded_count=embedded_count,
        document_count=len(documents),
        activation=activation or {},
    )


def _guard_active_version(
    artifact: CorpusArtifact, gateway: SupabaseGateway, options: PublishOptions
) -> None:
    """Refuse to rewrite an active version in place unless it is the same content.

    Upserting chunk content under an active version would change what users see
    before activation. Re-publishing an identical artifact is safe (idempotent);
    anything else must use a new CORPUS_VERSION or an explicit override.
    """
    active = gateway.select(
        "legal_chunks",
        {
            "select": "chunk_id",
            "corpus_version": f"eq.{artifact.corpus_version}",
            "status": "eq.active",
            "limit": "1",
        },
    )
    if not active:
        return
    runs = gateway.select(
        "ingestion_runs",
        {
            "select": "run_id,report",
            "corpus_version": f"eq.{artifact.corpus_version}",
            "is_valid": "eq.true",
            "order": "finished_at.desc.nullslast",
            "limit": "1",
        },
    )
    previous = (runs[0].get("report") or {}).get("artifact_sha256") if runs else None
    if previous == artifact.fingerprint or options.allow_in_place_update:
        return
    raise PublishBlocked(
        f"Corpus version {artifact.corpus_version} is already active with different or unknown "
        "content. Publish under a new CORPUS_VERSION, or pass --allow-in-place-update to rewrite "
        "the active rows in place."
    )
