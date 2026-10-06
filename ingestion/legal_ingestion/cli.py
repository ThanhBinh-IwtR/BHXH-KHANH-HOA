from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence

from .chunking import DocumentManifest, LegalChunkRecord, build_chunks
from .cross_references import attach_cross_reference_ids, resolve_cross_references
from .embeddings import (
    EmbeddingError,
    HuggingFaceEmbeddingProvider,
    current_embeddings,
    embed_chunks,
    embedding_cache_path,
)
from .env import load_env_file, require_env
from .extract_pdf import extract_pages
from .models import PageText, ParseResult
from .ocr import OcrEngine, TesseractOcrEngine
from .parse_structure import parse_pages
from .publish import (
    PostgrestGateway,
    PublishBlocked,
    PublishError,
    PublishOptions,
    link_references_in_place,
    load_artifact,
    publish_corpus,
)
from .quality import (
    LowOcrConfidenceError,
    OcrConfidenceFailure,
    enforce_ocr_confidence,
)
from .validation import (
    DocumentValidationInput,
    ValidationIssue,
    ValidationReport,
    validate_corpus,
)


APPROVED_MANIFEST_FILES = (
    "157-2025.json",
    "158-2025.json",
    "159-2025.json",
    "188-2025.json",
)

ExtractPages = Callable[[Path, OcrEngine], list[PageText]]


class CorpusValidationBlocked(RuntimeError):
    def __init__(self, report: ValidationReport, failed_path: Path) -> None:
        self.report = report
        self.failed_path = failed_path
        super().__init__(
            f"Corpus validation blocked by {len(report.blocking_errors)} error(s); "
            f"report: {failed_path / 'validation-report.json'}"
        )


def classify_low_confidence_reviews(
    manifest: DocumentManifest,
    failures: Sequence[OcrConfidenceFailure],
) -> tuple[tuple[ValidationIssue, ...], tuple[ValidationIssue, ...]]:
    """Downgrade only reviews bound to the exact document, page, and score."""
    reviews = {
        review.page_number: review
        for review in manifest.reviewed_low_confidence_pages
    }
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []
    for failure in failures:
        review = reviews.get(failure.page_number)
        mismatches: list[str] = []
        if review is None:
            mismatches.append("no review entry")
        else:
            if review.document_sha256 != manifest.sha256:
                mismatches.append("document SHA-256")
            if review.observed_confidence != failure.confidence:
                mismatches.append("observed confidence")

        if not mismatches and review is not None:
            warnings.append(
                ValidationIssue(
                    code="reviewed_low_ocr_confidence",
                    document_id=manifest.document_id,
                    message=(
                        f"Page {failure.page_number} confidence "
                        f"{failure.confidence:.2f} reviewed by {review.reviewer} "
                        f"at {review.reviewed_at.isoformat()}: {review.note}"
                    ),
                )
            )
            continue

        if review is not None:
            errors.append(
                ValidationIssue(
                    code="review_metadata_mismatch",
                    document_id=manifest.document_id,
                    message=(
                        f"Page {failure.page_number} review does not match "
                        + ", ".join(mismatches)
                    ),
                )
            )
        errors.append(
            ValidationIssue(
                code="low_ocr_confidence",
                document_id=manifest.document_id,
                message=(
                    f"Page {failure.page_number} OCR confidence "
                    f"{failure.confidence:.2f} is below the configured threshold"
                ),
            )
        )
    return tuple(errors), tuple(warnings)


def _normative_pages(parsed: ParseResult) -> set[int]:
    """Pages that carry retrievable Điều/Khoản/Điểm content."""
    pages: set[int] = set()
    for node in parsed.nodes:
        if node.kind in {"article", "clause", "point"}:
            pages.update(range(node.page_from, node.page_to + 1))
    return pages


def load_manifests(manifest_dir: Path) -> list[DocumentManifest]:
    actual_files = {path.name for path in manifest_dir.glob("*.json")}
    expected_files = set(APPROVED_MANIFEST_FILES)
    if actual_files != expected_files:
        missing = sorted(expected_files - actual_files)
        unexpected = sorted(actual_files - expected_files)
        raise ValueError(
            f"Manifest set must be exactly the approved four; missing={missing}, "
            f"unexpected={unexpected}"
        )
    return [
        DocumentManifest.model_validate_json(
            (manifest_dir / filename).read_text(encoding="utf-8")
        )
        for filename in APPROVED_MANIFEST_FILES
    ]


def validate_command(
    *,
    corpus_dir: Path,
    manifest_dir: Path,
    output_dir: Path,
    run_id: str | None = None,
    extract_pages_fn: ExtractPages = extract_pages,
    ocr_engine: OcrEngine | None = None,
) -> Path:
    """Validate all approved documents and atomically publish the run."""
    manifests = load_manifests(manifest_dir)
    resolved_run_id = run_id or datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%SZ"
    )
    if not resolved_run_id or any(char in resolved_run_id for char in "\\/:"):
        raise ValueError("run_id must be a non-empty file-name-safe value")

    output_dir.mkdir(parents=True, exist_ok=True)
    final_path = output_dir / resolved_run_id
    failed_path = output_dir / f"failed-{resolved_run_id}"
    if final_path.exists() or failed_path.exists():
        raise FileExistsError(f"Run output already exists: {resolved_run_id}")
    temporary_path = output_dir / f".tmp-{resolved_run_id}-{uuid.uuid4().hex}"
    temporary_path.mkdir()

    all_chunks: list[LegalChunkRecord] = []
    inputs: list[DocumentValidationInput] = []
    engine = ocr_engine or TesseractOcrEngine()
    try:
        for manifest in manifests:
            source_path = corpus_dir / manifest.source_file
            preexisting_errors: list[ValidationIssue] = []
            preexisting_warnings: list[ValidationIssue] = []
            if not _hash_matches(source_path, manifest.sha256):
                parsed = ParseResult(nodes=(), warnings=())
                pages: list[PageText] = []
                chunks: list[LegalChunkRecord] = []
            else:
                try:
                    pages = extract_pages_fn(source_path, engine)
                    parsed = parse_pages(pages)
                    chunks = build_chunks(parsed, manifest)
                    normative_pages = _normative_pages(parsed)
                    try:
                        enforce_ocr_confidence(pages)
                    except LowOcrConfidenceError as error:
                        # A low-confidence page only blocks publication when it
                        # carries normative (Điều/Khoản/Điểm) content. Appendix and
                        # form pages are excluded from retrieval, so their OCR noise
                        # cannot reach an answer — downgrade them to a warning.
                        normative_failures = [
                            failure
                            for failure in error.failures
                            if failure.page_number in normative_pages
                        ]
                        appendix_failures = [
                            failure
                            for failure in error.failures
                            if failure.page_number not in normative_pages
                        ]
                        review_errors, review_warnings = (
                            classify_low_confidence_reviews(
                                manifest,
                                normative_failures,
                            )
                        )
                        preexisting_errors.extend(review_errors)
                        preexisting_warnings.extend(review_warnings)
                        for failure in appendix_failures:
                            preexisting_warnings.append(
                                ValidationIssue(
                                    code="low_ocr_confidence_appendix",
                                    document_id=manifest.document_id,
                                    message=(
                                        f"Trang {failure.page_number} (phụ lục/biểu mẫu) "
                                        f"confidence {failure.confidence:.2f} dưới ngưỡng; "
                                        "trang này không được dùng cho truy hồi"
                                    ),
                                )
                            )
                except Exception as error:
                    pages = []
                    parsed = ParseResult(nodes=(), warnings=())
                    chunks = []
                    preexisting_errors.append(
                        ValidationIssue(
                            code="extraction_failed",
                            document_id=manifest.document_id,
                            message=f"{type(error).__name__}: {error}",
                        )
                    )
            references = resolve_cross_references(chunks)
            chunks = attach_cross_reference_ids(chunks, references)
            all_chunks.extend(chunks)
            inputs.append(
                DocumentValidationInput(
                    manifest=manifest,
                    parsed=parsed,
                    chunks=tuple(chunks),
                    references=references,
                    pages=tuple(pages),
                    preexisting_errors=tuple(preexisting_errors),
                    preexisting_warnings=tuple(preexisting_warnings),
                )
            )

        report = validate_corpus(inputs, corpus_dir=corpus_dir)
        _write_outputs(temporary_path, report, all_chunks)
        target_path = final_path if report.is_valid else failed_path
        temporary_path.replace(target_path)
        if not report.is_valid:
            raise CorpusValidationBlocked(report, target_path)
        return target_path
    except CorpusValidationBlocked:
        raise
    except BaseException:
        if temporary_path.exists():
            shutil.rmtree(temporary_path)
        raise


def _write_outputs(
    directory: Path,
    report: ValidationReport,
    chunks: Sequence[LegalChunkRecord],
) -> None:
    (directory / "validation-report.json").write_text(
        json.dumps(
            report.model_dump(mode="json"), ensure_ascii=False, indent=2
        )
        + "\n",
        encoding="utf-8",
    )
    with (directory / "chunks.jsonl").open(
        "w", encoding="utf-8", newline="\n"
    ) as target:
        for chunk in chunks:
            target.write(
                json.dumps(chunk.model_dump(mode="json"), ensure_ascii=False)
                + "\n"
            )


def _hash_matches(path: Path, expected: str) -> bool:
    if not path.is_file():
        return False
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper() == expected.upper()


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate and publish the approved legal corpus")
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate")
    validate.add_argument("--corpus-dir", type=Path, required=True)
    validate.add_argument("--manifest-dir", type=Path, required=True)
    validate.add_argument("--output-dir", type=Path, required=True)
    validate.add_argument("--run-id")

    link = subparsers.add_parser(
        "link-references",
        help="write resolved cross_reference_ids into an existing chunks.jsonl",
    )
    link.add_argument("--artifact-dir", type=Path, required=True)

    embed = subparsers.add_parser(
        "embed", help="embed normative chunks into a resumable cache next to the artifact"
    )
    embed.add_argument("--artifact-dir", type=Path, required=True)
    embed.add_argument("--manifest-dir", type=Path, required=True)
    embed.add_argument("--embeddings-cache", type=Path)
    embed.add_argument("--batch-size", type=int, default=16)
    embed.add_argument("--env-file", type=Path)

    publish = subparsers.add_parser(
        "publish", help="stage the artifact in Supabase and activate it atomically"
    )
    publish.add_argument("--artifact-dir", type=Path, required=True)
    publish.add_argument("--manifest-dir", type=Path, required=True)
    publish.add_argument("--embeddings-cache", type=Path)
    publish.add_argument("--batch-size", type=int, default=50)
    publish.add_argument("--env-file", type=Path)
    publish.add_argument("--run-id")
    publish.add_argument(
        "--allow-missing-embeddings",
        action="store_true",
        help="publish a keyword-only corpus (vector search stays empty)",
    )
    publish.add_argument(
        "--allow-in-place-update",
        action="store_true",
        help="rewrite an already active corpus version that has different content",
    )
    publish.add_argument(
        "--dry-run",
        action="store_true",
        help="run every local check and print the plan without contacting Supabase",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.command == "link-references":
        return _link_references(args)
    if args.command == "embed":
        return _embed(args)
    if args.command == "publish":
        return _publish(args)
    try:
        path = validate_command(
            corpus_dir=args.corpus_dir,
            manifest_dir=args.manifest_dir,
            output_dir=args.output_dir,
            run_id=args.run_id,
        )
    except CorpusValidationBlocked as error:
        print(f"BLOCKED: {len(error.report.blocking_errors)} error(s)")
        for issue in error.report.blocking_errors[:100]:
            print(f"- {issue.document_id} [{issue.code}] {issue.message}")
        print(f"Report: {error.failed_path / 'validation-report.json'}")
        return 2
    print(f"VALID: {path}")
    return 0


def _link_references(args: argparse.Namespace) -> int:
    total, linked = link_references_in_place(args.artifact_dir)
    print(f"LINKED: {linked}/{total} chunks have resolved cross_reference_ids")
    return 0


def _embed(args: argparse.Namespace) -> int:
    if args.env_file:
        load_env_file(args.env_file)
    try:
        provider = HuggingFaceEmbeddingProvider(
            base_url=require_env("EMBEDDING_BASE_URL"),
            api_key=require_env("EMBEDDING_API_KEY"),
            model=require_env("EMBEDDING_MODEL"),
        )
        artifact = load_artifact(args.artifact_dir, load_manifests(args.manifest_dir))
    except (KeyError, PublishBlocked) as error:
        print(f"BLOCKED: {error}")
        return 2
    cache_path = args.embeddings_cache or embedding_cache_path(args.artifact_dir, provider.model)
    try:
        summary = embed_chunks(
            artifact.chunks,
            provider,
            cache_path,
            batch_size=args.batch_size,
            on_batch=lambda done, total: print(f"embedded {done}/{total}", flush=True),
        )
    except EmbeddingError as error:
        print(f"FAILED: {error} (completed batches are cached; re-run to resume)")
        return 3
    print(
        f"EMBEDDED: model={summary.model} normative={summary.normative_chunks} "
        f"reused={summary.reused} new={summary.embedded} cache={summary.cache_path}"
    )
    return 0


def _publish(args: argparse.Namespace) -> int:
    if args.env_file:
        load_env_file(args.env_file)
    try:
        manifests = load_manifests(args.manifest_dir)
        artifact = load_artifact(args.artifact_dir, manifests)
    except PublishBlocked as error:
        print(f"BLOCKED: {error}")
        return 2
    model = os.environ.get("EMBEDDING_MODEL", "").strip()
    cache_path = args.embeddings_cache or (
        embedding_cache_path(args.artifact_dir, model) if model else None
    )
    embeddings = (
        current_embeddings(artifact.normative_chunks, cache_path, model=model)
        if cache_path is not None and model
        else {}
    )
    normative = len(artifact.normative_chunks)
    print(
        f"ARTIFACT: version={artifact.corpus_version} chunks={len(artifact.chunks)} "
        f"normative={normative} documents={len(artifact.document_ids)} "
        f"embedded={len(embeddings)}/{normative} fingerprint={artifact.fingerprint[:16]}"
    )
    if artifact.references_linked_at_load:
        print("NOTE: cross_reference_ids were resolved at load time (run link-references to persist them)")
    if args.dry_run:
        missing = normative - len(embeddings)
        if missing and not args.allow_missing_embeddings:
            print(f"DRY-RUN BLOCKED: {missing} normative chunks have no embedding")
            return 2
        print("DRY-RUN OK: no database call was made")
        return 0
    try:
        gateway = PostgrestGateway(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_KEY"))
        summary = publish_corpus(
            artifact,
            manifests,
            gateway,
            embeddings,
            PublishOptions(
                require_embeddings=not args.allow_missing_embeddings,
                allow_in_place_update=args.allow_in_place_update,
                batch_size=args.batch_size,
                run_id=args.run_id,
                embedding_model=model or None,
            ),
            log=lambda message: print(message, flush=True),
        )
    except (KeyError, PublishBlocked) as error:
        print(f"BLOCKED: {error}")
        return 2
    except PublishError as error:
        print(f"FAILED: {error} (the previously active corpus is unchanged)")
        return 3
    print(f"ACTIVE: run={summary.run_id} {json.dumps(dict(summary.activation), ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
