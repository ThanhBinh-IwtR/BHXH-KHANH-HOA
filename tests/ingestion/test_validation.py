from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from ingestion.legal_ingestion.chunking import DocumentManifest, build_chunks
from ingestion.legal_ingestion.cross_references import resolve_cross_references
from ingestion.legal_ingestion.cli import (
    CorpusValidationBlocked,
    classify_low_confidence_reviews,
    load_manifests,
    validate_command,
)
from ingestion.legal_ingestion.models import LegalNode, PageText, ParseResult, ParseWarning
from ingestion.legal_ingestion.quality import OcrConfidenceFailure
from ingestion.legal_ingestion.validation import DocumentValidationInput, validate_corpus


def _manifest(*, sha256: str = "0" * 64) -> DocumentManifest:
    return DocumentManifest(
        document_id="nd-999-2025",
        document_number="999/2025/NĐ-CP",
        document_type="Nghị định",
        title="Văn bản kiểm thử",
        issued_date="2025-01-01",
        effective_date="2025-02-01",
        source_file="999.pdf",
        corpus_version="2025-demo-v1",
        sha256=sha256,
    )


def _parsed_with_unresolved_reference() -> ParseResult:
    article = LegalNode(
        node_id="article-0001",
        kind="article",
        number="1",
        title="Phạm vi",
        text="Điều 1. Phạm vi",
        page_from=1,
        page_to=1,
        parent_id=None,
    )
    clause = LegalNode(
        node_id="clause-0001",
        kind="clause",
        number="1",
        title="Thực hiện theo khoản 9 Điều 99.",
        text="1. Thực hiện theo khoản 9 Điều 99.",
        page_from=1,
        page_to=1,
        parent_id=article.node_id,
    )
    return ParseResult(nodes=(article, clause), warnings=())


def test_unresolved_cross_reference_is_retained_in_validation_report(tmp_path: Path) -> None:
    source = tmp_path / "999.pdf"
    source.write_bytes(b"fixture")
    manifest = _manifest()
    parsed = _parsed_with_unresolved_reference()
    chunks = build_chunks(parsed, manifest)
    references = resolve_cross_references(chunks)

    report = validate_corpus(
        [DocumentValidationInput(manifest=manifest, parsed=parsed, chunks=tuple(chunks), references=references)],
        corpus_dir=tmp_path,
    )

    assert len(report.unresolved_references) == 1
    assert report.unresolved_references[0].target_article == "99"
    assert report.unresolved_references[0].target_clause == "9"
    assert report.documents[0].resolved_cross_references == 0
    assert report.documents[0].unresolved_cross_references == 1


def test_invalid_manifest_hash_is_a_blocking_validation_error(tmp_path: Path) -> None:
    (tmp_path / "999.pdf").write_bytes(b"not-the-approved-file")
    manifest = _manifest(sha256="F" * 64)
    parsed = _parsed_with_unresolved_reference()
    chunks = build_chunks(parsed, manifest)

    report = validate_corpus(
        [
            DocumentValidationInput(
                manifest=manifest,
                parsed=parsed,
                chunks=tuple(chunks),
                references=resolve_cross_references(chunks),
            )
        ],
        corpus_dir=tmp_path,
    )

    assert not report.is_valid
    assert any(error.code == "sha256_mismatch" for error in report.blocking_errors)


def test_orphan_structure_warning_blocks_corpus_activation(tmp_path: Path) -> None:
    source = tmp_path / "999.pdf"
    source.write_bytes(b"fixture")
    import hashlib

    manifest = _manifest(sha256=hashlib.sha256(source.read_bytes()).hexdigest())
    parsed = _parsed_with_unresolved_reference().model_copy(
        update={
            "warnings": (
                ParseWarning(
                    code="orphan_clause",
                    message="Clause found outside an Article",
                    page_number=1,
                    line_number=1,
                    line="1. Mồ côi",
                ),
            )
        }
    )
    chunks = build_chunks(parsed, manifest)

    report = validate_corpus(
        [DocumentValidationInput(manifest=manifest, parsed=parsed, chunks=tuple(chunks), references=resolve_cross_references(chunks))],
        corpus_dir=tmp_path,
    )

    assert not report.is_valid
    assert any(error.code == "orphan_structure" for error in report.blocking_errors)


def test_approved_manifests_have_exact_identity_fields() -> None:
    manifests = load_manifests(Path("ingestion/manifests"))

    assert [manifest.document_id for manifest in manifests] == [
        "nd-157-2025",
        "nd-158-2025",
        "nd-159-2025",
        "nd-188-2025",
    ]
    assert [manifest.document_number for manifest in manifests] == [
        "157/2025/NĐ-CP",
        "158/2025/NĐ-CP",
        "159/2025/NĐ-CP",
        "188/2025/NĐ-CP",
    ]
    assert {manifest.corpus_version for manifest in manifests} == {"2025-demo-v1"}


def test_cli_atomically_publishes_only_a_valid_four_document_run(tmp_path: Path) -> None:
    calls: list[str] = []

    def fake_extract(path: Path, ocr_engine: object) -> list[PageText]:
        calls.append(path.name)
        return [
            PageText(
                page_number=1,
                text="Điều 1. Phạm vi\n1. Nội dung hợp lệ",
                source="text",
                ocr_confidence=None,
            )
        ]

    final_path = validate_command(
        corpus_dir=Path("LUATBHXHBHYT2024"),
        manifest_dir=Path("ingestion/manifests"),
        output_dir=tmp_path,
        run_id="valid-test-run",
        extract_pages_fn=fake_extract,
        ocr_engine=object(),
    )

    assert final_path == tmp_path / "valid-test-run"
    assert final_path.is_dir()
    assert (final_path / "validation-report.json").is_file()
    assert (final_path / "chunks.jsonl").is_file()
    assert sorted(calls) == sorted(
        manifest.source_file for manifest in load_manifests(Path("ingestion/manifests"))
    )
    assert not list(tmp_path.glob(".tmp-*"))


def test_cli_never_publishes_final_run_when_validation_blocks(tmp_path: Path) -> None:
    def orphan_extract(path: Path, ocr_engine: object) -> list[PageText]:
        return [
            PageText(
                page_number=1,
                text="1. Khoản mồ côi",
                source="text",
                ocr_confidence=None,
            )
        ]

    with pytest.raises(CorpusValidationBlocked) as caught:
        validate_command(
            corpus_dir=Path("LUATBHXHBHYT2024"),
            manifest_dir=Path("ingestion/manifests"),
            output_dir=tmp_path,
            run_id="blocked-test-run",
            extract_pages_fn=orphan_extract,
            ocr_engine=object(),
        )

    assert not (tmp_path / "blocked-test-run").exists()
    assert caught.value.failed_path == tmp_path / "failed-blocked-test-run"
    assert (caught.value.failed_path / "validation-report.json").is_file()
    assert not list(tmp_path.glob(".tmp-*"))


def test_cli_converts_extraction_failure_to_a_persisted_blocking_report(tmp_path: Path) -> None:
    def failed_extract(path: Path, ocr_engine: object) -> list[PageText]:
        raise RuntimeError("bounded OCR failure")

    with pytest.raises(CorpusValidationBlocked) as caught:
        validate_command(
            corpus_dir=Path("LUATBHXHBHYT2024"),
            manifest_dir=Path("ingestion/manifests"),
            output_dir=tmp_path,
            run_id="extraction-failed-run",
            extract_pages_fn=failed_extract,
            ocr_engine=object(),
        )

    assert not (tmp_path / "extraction-failed-run").exists()
    assert caught.value.failed_path.is_dir()
    assert any(
        issue.code == "extraction_failed"
        and "bounded OCR failure" in issue.message
        for issue in caught.value.report.blocking_errors
    )


def test_low_confidence_blocks_but_retains_parsed_structure(tmp_path: Path) -> None:
    def low_confidence_extract(path: Path, ocr_engine: object) -> list[PageText]:
        return [
            PageText(
                page_number=1,
                text="Điều 1. Phạm vi\n1. Nội dung vẫn phải được phân tích",
                source="ocr",
                ocr_confidence=70.0,
            )
        ]

    with pytest.raises(CorpusValidationBlocked) as caught:
        validate_command(
            corpus_dir=Path("LUATBHXHBHYT2024"),
            manifest_dir=Path("ingestion/manifests"),
            output_dir=tmp_path,
            run_id="low-confidence-run",
            extract_pages_fn=low_confidence_extract,
            ocr_engine=object(),
        )

    assert any(
        issue.code == "low_ocr_confidence"
        for issue in caught.value.report.blocking_errors
    )
    assert not any(
        issue.code == "no_articles"
        for issue in caught.value.report.blocking_errors
    )
    assert all(
        document.structural_counts["article"] == 1
        and document.structural_counts["top_level_article"] == 1
        and document.chunk_count == 1
        for document in caught.value.report.documents
    )


def test_manifest_review_turns_only_approved_low_confidence_page_into_warning(
    tmp_path: Path,
) -> None:
    manifest_dir = tmp_path / "manifests"
    manifest_dir.mkdir()
    for source in Path("ingestion/manifests").glob("*.json"):
        payload = json.loads(source.read_text(encoding="utf-8"))
        if source.name == "188-2025.json":
            payload["reviewed_low_confidence_pages"] = [
                {
                    "document_sha256": payload["sha256"],
                    "page_number": 1,
                    "observed_confidence": 70.0,
                    "reviewer": "Cán bộ pháp chế kiểm thử",
                    "reviewed_at": "2026-07-21T18:00:00+07:00",
                    "note": "Đã đối chiếu trực quan toàn bộ nội dung trang với PDF gốc.",
                }
            ]
        (manifest_dir / source.name).write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )

    def low_confidence_extract(path: Path, ocr_engine: object) -> list[PageText]:
        return [
            PageText(
                page_number=1,
                text="Điều 1. Phạm vi\n1. Nội dung hợp lệ",
                source="ocr",
                ocr_confidence=70.0,
            )
        ]

    with pytest.raises(CorpusValidationBlocked) as caught:
        validate_command(
            corpus_dir=Path("LUATBHXHBHYT2024"),
            manifest_dir=manifest_dir,
            output_dir=tmp_path / "output",
            run_id="reviewed-page-run",
            extract_pages_fn=low_confidence_extract,
            ocr_engine=object(),
        )

    report_188 = next(
        document
        for document in caught.value.report.documents
        if document.document_id == "nd-188-2025"
    )
    assert not any(issue.code == "low_ocr_confidence" for issue in report_188.errors)
    assert any(
        issue.code == "reviewed_low_ocr_confidence"
        and "Cán bộ pháp chế kiểm thử" in issue.message
        and "70.00" in issue.message
        for issue in report_188.warnings
    )


@pytest.mark.parametrize(
    ("sha256", "confidence", "reason"),
    [
        ("A" * 64, 70.0, "document SHA-256"),
        (None, 70.1, "observed confidence"),
    ],
)
def test_stale_review_metadata_remains_blocking(
    sha256: str | None,
    confidence: float,
    reason: str,
) -> None:
    manifest = _manifest()
    payload = manifest.model_dump(mode="json")
    payload["reviewed_low_confidence_pages"] = [
        {
            "document_sha256": sha256 or manifest.sha256,
            "page_number": 1,
            "observed_confidence": confidence,
            "reviewer": "Cán bộ pháp chế kiểm thử",
            "reviewed_at": "2026-07-21T18:00:00+07:00",
            "note": "Đã đối chiếu trực quan toàn bộ trang với PDF gốc.",
        }
    ]
    reviewed_manifest = DocumentManifest.model_validate(payload)

    errors, warnings = classify_low_confidence_reviews(
        reviewed_manifest,
        (OcrConfidenceFailure(page_number=1, confidence=70.0),),
    )

    assert not warnings
    assert any(
        issue.code == "review_metadata_mismatch" and reason in issue.message
        for issue in errors
    )
    assert any(issue.code == "low_ocr_confidence" for issue in errors)


def test_manual_review_requires_nonempty_note() -> None:
    payload = _manifest().model_dump(mode="json")
    payload["reviewed_low_confidence_pages"] = [
        {
            "document_sha256": payload["sha256"],
            "page_number": 1,
            "observed_confidence": 70.0,
            "reviewer": "Cán bộ pháp chế kiểm thử",
            "reviewed_at": "2026-07-21T18:00:00+07:00",
            "note": "",
        }
    ]

    with pytest.raises(ValidationError, match="note"):
        DocumentManifest.model_validate(payload)
