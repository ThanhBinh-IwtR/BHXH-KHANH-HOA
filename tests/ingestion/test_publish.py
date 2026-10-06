from __future__ import annotations

import io
import json
import urllib.error
from pathlib import Path
from typing import Any, Mapping, Sequence

import pytest

from ingestion.legal_ingestion.chunking import DocumentManifest, LegalChunkRecord
from ingestion.legal_ingestion.cross_references import (
    attach_cross_reference_ids,
    resolve_cross_references,
)
from ingestion.legal_ingestion.embeddings import (
    EmbeddingError,
    HuggingFaceEmbeddingProvider,
    current_embeddings,
    embed_chunks,
    parse_embedding_payload,
)
from ingestion.legal_ingestion.env import load_env_file
from ingestion.legal_ingestion.publish import (
    PostgrestGateway,
    PublishBlocked,
    PublishError,
    PublishOptions,
    artifact_fingerprint,
    link_references_in_place,
    load_artifact,
    publish_corpus,
)


VERSION = "v1"
DIMENSIONS = 4
SHA = "A" * 64


def _manifest(document_id: str = "doc-a", version: str = VERSION) -> DocumentManifest:
    return DocumentManifest(
        document_id=document_id,
        document_number=f"{document_id}/2025/NĐ-CP",
        document_type="Nghị định",
        title=f"Nghị định {document_id}",
        issued_date="2025-06-25",
        effective_date="2025-07-01",
        source_file=f"{document_id}.pdf",
        corpus_version=version,
        sha256=SHA,
    )


def _chunk(
    chunk_id: str,
    *,
    document_id: str = "doc-a",
    body_text: str = "Nội dung.",
    article_number: str = "1",
    clause_number: str | None = "1",
    chunk_type: str = "normative",
    version: str = VERSION,
) -> LegalChunkRecord:
    return LegalChunkRecord(
        chunk_id=chunk_id,
        document_id=document_id,
        chapter_number=None,
        section_number=None,
        article_number=article_number,
        article_title="Điều kiểm thử",
        clause_number=clause_number,
        point_from=None,
        point_to=None,
        context_header=f"{document_id} > Điều {article_number}",
        body_text=body_text,
        search_text=f"{document_id} > Điều {article_number}\n{body_text}",
        search_text_unaccented=body_text.lower(),
        page_from=1,
        page_to=1,
        parent_id=None,
        previous_sibling_id=None,
        next_sibling_id=None,
        token_count=2,
        embedding=None,
        corpus_version=version,
        status="staged",
        chunk_type=chunk_type,  # type: ignore[arg-type]
    )


def _corpus() -> list[LegalChunkRecord]:
    return [
        _chunk("doc-a:d1:k1", body_text="Thực hiện theo khoản 2 Điều 2."),
        _chunk("doc-a:d2:k2", article_number="2", clause_number="2"),
        _chunk("doc-a:form", article_number="__form__", clause_number=None, chunk_type="appendix"),
    ]


def _write_artifact(
    directory: Path,
    chunks: Sequence[LegalChunkRecord],
    *,
    is_valid: bool = True,
    with_references: bool = False,
    counts: Mapping[str, int] | None = None,
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    per_document: dict[str, int] = {}
    for chunk in chunks:
        per_document[chunk.document_id] = per_document.get(chunk.document_id, 0) + 1
    report = {
        "is_valid": is_valid,
        "documents": [
            {"document_id": document_id, "chunk_count": count}
            for document_id, count in (counts or per_document).items()
        ],
    }
    (directory / "validation-report.json").write_text(json.dumps(report), encoding="utf-8")
    with (directory / "chunks.jsonl").open("w", encoding="utf-8") as target:
        for chunk in chunks:
            row = chunk.model_dump(mode="json")
            if not with_references:
                row.pop("cross_reference_ids")
            target.write(json.dumps(row, ensure_ascii=False) + "\n")
    return directory


class FakeProvider:
    def __init__(self, model: str = "fake/model", fail_on_call: int | None = None) -> None:
        self.model = model
        self.calls: list[list[str]] = []
        self._fail_on_call = fail_on_call

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        if self._fail_on_call is not None and len(self.calls) == self._fail_on_call:
            raise EmbeddingError("Embedding HTTP 503", status=503)
        return [[float(len(text)), 1.0, 0.0, 0.5] for text in texts]


class FakeGateway:
    """In-memory stand-in for PostgREST + the activate_legal_corpus function."""

    def __init__(self, fail_on_chunk_batch: int | None = None) -> None:
        self.documents: dict[str, dict[str, Any]] = {}
        self.chunks: dict[str, dict[str, Any]] = {}
        self.runs: dict[str, dict[str, Any]] = {}
        self.chunk_batches = 0
        self._fail_on_chunk_batch = fail_on_chunk_batch

    def select(self, table: str, params: Mapping[str, str]) -> list[dict[str, Any]]:
        version = params.get("corpus_version", "").removeprefix("eq.")
        if table == "legal_chunks":
            return [
                {"chunk_id": chunk_id}
                for chunk_id, row in self.chunks.items()
                if row["corpus_version"] == version and row["status"] == "active"
            ][:1]
        if table == "ingestion_runs":
            runs = [run for run in self.runs.values() if run["corpus_version"] == version]
            return runs[-1:]
        raise AssertionError(table)

    def upsert(self, table, rows, *, on_conflict, ignore_duplicates) -> None:
        keys = {tuple(sorted(row)) for row in rows}
        assert len(keys) == 1, "PostgREST bulk upserts need one column set per request"
        assert all("status" not in row for row in rows)
        if table == "legal_documents":
            for row in rows:
                if row["document_id"] not in self.documents:
                    self.documents[row["document_id"]] = {**row, "status": "staged"}
            return
        self.chunk_batches += 1
        if self._fail_on_chunk_batch == self.chunk_batches:
            raise PublishError("upsert legal_chunks: HTTP 500: simulated")
        for row in rows:
            existing = self.chunks.get(row["chunk_id"])
            if existing is None:
                self.chunks[row["chunk_id"]] = {"embedding": None, **row, "status": "staged"}
            else:
                existing.update(row)

    def rpc(self, function: str, payload: Mapping[str, Any]) -> Any:
        assert function == "activate_legal_corpus"
        version = payload["target_corpus_version"]
        expected = set(payload["expected_chunk_ids"])
        found = [
            chunk_id
            for chunk_id, row in self.chunks.items()
            if chunk_id in expected and row["corpus_version"] == version
        ]
        if len(found) != len(expected):
            raise PublishError("rpc activate_legal_corpus: HTTP 400: count mismatch")
        if payload["require_embeddings"] and any(
            self.chunks[chunk_id]["embedding"] is None
            and self.chunks[chunk_id]["chunk_type"] == "normative"
            for chunk_id in found
        ):
            raise PublishError("rpc activate_legal_corpus: HTTP 400: missing embeddings")
        document_ids = {document["document_id"] for document in payload["documents"]}
        for document in payload["documents"]:
            self.documents[document["document_id"]] = {**document, "status": "active"}
        for document_id, row in self.documents.items():
            if document_id not in document_ids and row["status"] == "active":
                row["status"] = "inactive"
        for chunk_id, row in self.chunks.items():
            if chunk_id in expected and row["corpus_version"] == version:
                row["status"] = "active"
            elif row["status"] == "active":
                row["status"] = "inactive"
        self.runs[payload["publish_run_id"]] = {
            "run_id": payload["publish_run_id"],
            "corpus_version": version,
            "report": payload["publish_report"],
        }
        return {"active_chunks": sum(row["status"] == "active" for row in self.chunks.values())}

    def active_ids(self) -> set[str]:
        return {chunk_id for chunk_id, row in self.chunks.items() if row["status"] == "active"}


def _embeddings(chunks: Sequence[LegalChunkRecord]) -> dict[str, list[float]]:
    return {chunk.chunk_id: [0.1, 0.2, 0.3, 0.4] for chunk in chunks if chunk.chunk_type == "normative"}


# ---------------------------------------------------------------------------
# Cross references
# ---------------------------------------------------------------------------


def test_attach_cross_reference_ids_records_resolved_targets_once() -> None:
    chunks = [
        _chunk("source", body_text="Theo khoản 2 Điều 2 và khoản 2 Điều 2, Điều 9."),
        _chunk("target", article_number="2", clause_number="2"),
    ]
    linked = attach_cross_reference_ids(chunks, resolve_cross_references(chunks))

    assert linked[0].cross_reference_ids == ("target",)
    assert linked[1].cross_reference_ids == ()


def test_link_references_in_place_is_atomic_and_idempotent(tmp_path: Path) -> None:
    directory = _write_artifact(tmp_path / "artifact", _corpus())

    first = link_references_in_place(directory)
    snapshot = (directory / "chunks.jsonl").read_bytes()
    second = link_references_in_place(directory)

    assert first == second == (3, 1)
    assert (directory / "chunks.jsonl").read_bytes() == snapshot
    assert not list(directory.glob(".*.tmp"))
    rows = [json.loads(line) for line in snapshot.decode("utf-8").splitlines()]
    assert rows[0]["cross_reference_ids"] == ["doc-a:d2:k2"]


# ---------------------------------------------------------------------------
# Artifact loading
# ---------------------------------------------------------------------------


def test_load_artifact_links_missing_references_without_changing_the_fingerprint(tmp_path: Path) -> None:
    raw = _write_artifact(tmp_path / "raw", _corpus())
    linked = _write_artifact(tmp_path / "linked", _corpus())
    link_references_in_place(linked)

    from_raw = load_artifact(raw, [_manifest()])
    from_linked = load_artifact(linked, [_manifest()])

    assert from_raw.references_linked_at_load is True
    assert from_linked.references_linked_at_load is False
    assert from_raw.fingerprint == from_linked.fingerprint
    assert from_raw.chunks[0].cross_reference_ids == ("doc-a:d2:k2",)
    assert len(from_raw.normative_chunks) == 2


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"is_valid": False}, "not valid"),
        ({"counts": {"doc-a": 99}}, "Chunk counts"),
    ],
)
def test_load_artifact_blocks_an_unpublishable_artifact(
    tmp_path: Path, kwargs: dict[str, Any], message: str
) -> None:
    directory = _write_artifact(tmp_path / "artifact", _corpus(), **kwargs)

    with pytest.raises(PublishBlocked, match=message):
        load_artifact(directory, [_manifest()])


def test_load_artifact_blocks_a_version_that_differs_from_the_manifests(tmp_path: Path) -> None:
    directory = _write_artifact(tmp_path / "artifact", _corpus())

    with pytest.raises(PublishBlocked, match="Corpus version mismatch"):
        load_artifact(directory, [_manifest(version="v2")])


def test_fingerprint_ignores_embeddings_and_status_but_not_content() -> None:
    base = _corpus()
    reembedded = [chunk.model_copy(update={"embedding": (1.0,), "status": "active"}) for chunk in base]
    edited = [base[0].model_copy(update={"body_text": "Khác."}), *base[1:]]

    assert artifact_fingerprint(base) == artifact_fingerprint(reembedded)
    assert artifact_fingerprint(base) != artifact_fingerprint(edited)


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------


def test_embed_chunks_embeds_only_normative_chunks_and_resumes_from_cache(tmp_path: Path) -> None:
    cache = tmp_path / "embeddings.jsonl"
    chunks = _corpus()
    provider = FakeProvider()

    first = embed_chunks(chunks, provider, cache, batch_size=1, dimensions=DIMENSIONS)
    second = embed_chunks(chunks, provider, cache, batch_size=1, dimensions=DIMENSIONS)

    assert (first.embedded, first.reused) == (2, 0)
    assert (second.embedded, second.reused) == (0, 2)
    assert len(provider.calls) == 2
    assert set(current_embeddings(chunks, cache, model="fake/model", dimensions=DIMENSIONS)) == {
        "doc-a:d1:k1",
        "doc-a:d2:k2",
    }


def test_embed_chunks_keeps_completed_batches_when_a_later_batch_fails(tmp_path: Path) -> None:
    cache = tmp_path / "embeddings.jsonl"
    chunks = _corpus()

    with pytest.raises(EmbeddingError):
        embed_chunks(chunks, FakeProvider(fail_on_call=2), cache, batch_size=1, dimensions=DIMENSIONS)
    resumed = FakeProvider()
    summary = embed_chunks(chunks, resumed, cache, batch_size=1, dimensions=DIMENSIONS)

    assert (summary.reused, summary.embedded) == (1, 1)
    assert len(resumed.calls) == 1


def test_embed_chunks_reembeds_a_chunk_whose_text_changed(tmp_path: Path) -> None:
    cache = tmp_path / "embeddings.jsonl"
    chunks = _corpus()
    embed_chunks(chunks, FakeProvider(), cache, batch_size=8, dimensions=DIMENSIONS)
    changed = [chunks[0].model_copy(update={"search_text": "Văn bản mới"}), *chunks[1:]]

    provider = FakeProvider()
    summary = embed_chunks(changed, provider, cache, batch_size=8, dimensions=DIMENSIONS)

    assert summary.embedded == 1
    assert provider.calls == [["Văn bản mới"]]


def test_embed_chunks_rejects_a_wrong_dimension(tmp_path: Path) -> None:
    with pytest.raises(EmbeddingError, match="dimensions"):
        embed_chunks(_corpus(), FakeProvider(), tmp_path / "cache.jsonl", dimensions=1024)


def test_parse_embedding_payload_pools_token_vectors() -> None:
    assert parse_embedding_payload([1.0, 2.0], 1) == [[1.0, 2.0]]
    assert parse_embedding_payload([[[1.0, 3.0], [3.0, 5.0]]], 1) == [[2.0, 4.0]]
    assert parse_embedding_payload([[1.0], [2.0]], 2) == [[1.0], [2.0]]
    assert parse_embedding_payload([[1.0]], 2) is None


class _Response(io.BytesIO):
    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


def test_huggingface_provider_does_not_retry_a_permission_error() -> None:
    calls: list[Any] = []

    def opener(request: Any, timeout: float) -> Any:
        calls.append(request)
        raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, io.BytesIO(b"{}"))  # type: ignore[arg-type]

    provider = HuggingFaceEmbeddingProvider(
        base_url="https://router.huggingface.co", api_key="secret-token", model="BAAI/bge-m3", opener=opener
    )
    with pytest.raises(EmbeddingError) as raised:
        provider.embed(["câu"])

    assert raised.value.status == 403
    assert "secret-token" not in str(raised.value)
    assert len(calls) == 1
    assert (
        calls[0].full_url
        == "https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction"
    )


def test_huggingface_provider_retries_a_loading_model_then_succeeds() -> None:
    attempts: list[int] = []
    sleeps: list[float] = []

    def opener(request: Any, timeout: float) -> Any:
        attempts.append(1)
        if len(attempts) == 1:
            raise urllib.error.HTTPError(request.full_url, 503, "Loading", {"retry-after": "1"}, io.BytesIO(b"{}"))  # type: ignore[arg-type]
        return _Response(json.dumps([[0.5, 0.5]]).encode("utf-8"))

    provider = HuggingFaceEmbeddingProvider(
        base_url="https://router.huggingface.co",
        api_key="k",
        model="m",
        opener=opener,
        sleep=sleeps.append,
    )

    assert provider.embed(["a"]) == [[0.5, 0.5]]
    assert sleeps == [1.0]


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------


def _artifact(tmp_path: Path, chunks: Sequence[LegalChunkRecord] | None = None, name: str = "artifact"):
    return load_artifact(_write_artifact(tmp_path / name, chunks or _corpus()), [_manifest()])


def test_publish_stages_then_activates_the_whole_artifact(tmp_path: Path) -> None:
    artifact = _artifact(tmp_path)
    gateway = FakeGateway()

    summary = publish_corpus(
        artifact, [_manifest()], gateway, _embeddings(artifact.chunks), PublishOptions(batch_size=1, run_id="run-1")
    )

    assert gateway.active_ids() == {chunk.chunk_id for chunk in artifact.chunks}
    assert gateway.documents["doc-a"]["status"] == "active"
    assert gateway.chunks["doc-a:d1:k1"]["cross_reference_ids"] == ["doc-a:d2:k2"]
    assert gateway.chunks["doc-a:form"]["embedding"] is None
    assert gateway.runs["run-1"]["report"]["artifact_sha256"] == artifact.fingerprint
    assert (summary.normative_count, summary.embedded_count) == (2, 2)


def test_publishing_the_same_artifact_twice_creates_no_duplicates_and_keeps_serving(tmp_path: Path) -> None:
    artifact = _artifact(tmp_path)
    gateway = FakeGateway()
    publish_corpus(artifact, [_manifest()], gateway, _embeddings(artifact.chunks), PublishOptions(run_id="run-1"))
    before = {chunk_id: dict(row) for chunk_id, row in gateway.chunks.items()}

    publish_corpus(artifact, [_manifest()], gateway, _embeddings(artifact.chunks), PublishOptions(run_id="run-2"))

    assert gateway.chunks == before
    assert len(gateway.chunks) == 3
    assert gateway.active_ids() == set(before)


def test_a_failure_while_staging_a_new_version_leaves_the_active_corpus_serving(tmp_path: Path) -> None:
    current = _artifact(tmp_path)
    gateway = FakeGateway()
    publish_corpus(current, [_manifest()], gateway, _embeddings(current.chunks), PublishOptions(run_id="run-1"))

    next_chunks = [
        _chunk(f"doc-a:d{index}:v2", article_number=str(index), version="v2") for index in range(1, 4)
    ]
    next_artifact = load_artifact(
        _write_artifact(tmp_path / "next", next_chunks), [_manifest(version="v2")]
    )
    failing = gateway
    failing._fail_on_chunk_batch = failing.chunk_batches + 2  # noqa: SLF001 - fault injection

    with pytest.raises(PublishError):
        publish_corpus(
            next_artifact,
            [_manifest(version="v2")],
            failing,
            _embeddings(next_chunks),
            PublishOptions(batch_size=1, run_id="run-2"),
        )

    assert gateway.active_ids() == {chunk.chunk_id for chunk in current.chunks}
    assert {row["status"] for chunk_id, row in gateway.chunks.items() if chunk_id.endswith(":v2")} == {"staged"}
    assert gateway.documents["doc-a"]["corpus_version"] == VERSION


def test_publish_refuses_to_rewrite_an_active_version_with_different_content(tmp_path: Path) -> None:
    artifact = _artifact(tmp_path)
    gateway = FakeGateway()
    publish_corpus(artifact, [_manifest()], gateway, _embeddings(artifact.chunks), PublishOptions(run_id="run-1"))
    edited = _artifact(
        tmp_path, [_corpus()[0].model_copy(update={"body_text": "Nội dung đã sửa."}), *_corpus()[1:]], "edited"
    )
    staged_batches = gateway.chunk_batches

    with pytest.raises(PublishBlocked, match="already active"):
        publish_corpus(edited, [_manifest()], gateway, _embeddings(edited.chunks))
    assert gateway.chunk_batches == staged_batches

    publish_corpus(
        edited,
        [_manifest()],
        gateway,
        _embeddings(edited.chunks),
        PublishOptions(allow_in_place_update=True, run_id="run-2"),
    )
    assert gateway.chunks["doc-a:d1:k1"]["body_text"] == "Nội dung đã sửa."


def test_publish_requires_embeddings_unless_keyword_only_is_explicit(tmp_path: Path) -> None:
    artifact = _artifact(tmp_path)
    gateway = FakeGateway()

    with pytest.raises(PublishBlocked, match="no embedding"):
        publish_corpus(artifact, [_manifest()], gateway, {})
    assert gateway.chunk_batches == 0

    publish_corpus(
        artifact, [_manifest()], gateway, {}, PublishOptions(require_embeddings=False, run_id="kw")
    )
    assert gateway.active_ids() == {chunk.chunk_id for chunk in artifact.chunks}
    assert all(row["embedding"] is None for row in gateway.chunks.values())


# ---------------------------------------------------------------------------
# PostgREST gateway
# ---------------------------------------------------------------------------


def test_postgrest_gateway_sends_service_auth_and_upsert_preferences() -> None:
    requests: list[Any] = []

    def opener(request: Any, timeout: float) -> Any:
        requests.append(request)
        return _Response(b"")

    gateway = PostgrestGateway("https://demo.supabase.co/", "service-key", opener=opener)
    gateway.upsert("legal_chunks", [{"chunk_id": "a"}], on_conflict="chunk_id", ignore_duplicates=False)
    gateway.upsert("legal_documents", [{"document_id": "d"}], on_conflict="document_id", ignore_duplicates=True)

    chunk_request, document_request = requests
    assert chunk_request.full_url == "https://demo.supabase.co/rest/v1/legal_chunks?on_conflict=chunk_id"
    assert chunk_request.get_header("Prefer") == "resolution=merge-duplicates,return=minimal"
    assert document_request.get_header("Prefer") == "resolution=ignore-duplicates,return=minimal"
    assert chunk_request.get_header("Apikey") == "service-key"
    assert chunk_request.get_header("Authorization") == "Bearer service-key"
    assert json.loads(chunk_request.data) == [{"chunk_id": "a"}]


def test_postgrest_gateway_reports_the_database_message_without_the_key() -> None:
    def opener(request: Any, timeout: float) -> Any:
        body = io.BytesIO(json.dumps({"message": "activate_legal_corpus: expected 3 staged chunks"}).encode())
        raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {}, body)  # type: ignore[arg-type]

    gateway = PostgrestGateway("https://demo.supabase.co", "service-key", opener=opener)
    with pytest.raises(PublishError) as raised:
        gateway.rpc("activate_legal_corpus", {})

    assert "expected 3 staged chunks" in str(raised.value)
    assert "service-key" not in str(raised.value)


def test_load_env_file_does_not_override_existing_values(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    path.write_text('# comment\nA=1\nexport B="two"\nC=\n', encoding="utf-8")
    environ = {"A": "kept"}

    load_env_file(path, environ)

    assert environ == {"A": "kept", "B": "two", "C": ""}
