from __future__ import annotations

import hashlib
from collections import Counter
from pathlib import Path
from typing import Sequence

from pydantic import BaseModel, ConfigDict, Field, computed_field

from .chunking import DocumentManifest, LegalChunkRecord
from .cross_references import CrossReference, CrossReferenceResolution
from .models import PageText, ParseResult


class _FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True)


class ValidationIssue(_FrozenModel):
    code: str
    document_id: str
    message: str


class DocumentValidationInput(_FrozenModel):
    manifest: DocumentManifest
    parsed: ParseResult
    chunks: tuple[LegalChunkRecord, ...]
    references: CrossReferenceResolution
    pages: tuple[PageText, ...] = ()
    max_tokens: int = Field(default=800, ge=1)
    preexisting_errors: tuple[ValidationIssue, ...] = ()
    preexisting_warnings: tuple[ValidationIssue, ...] = ()


class DocumentValidationReport(_FrozenModel):
    document_id: str
    source_file: str
    expected_sha256: str
    actual_sha256: str | None
    page_count: int
    structural_counts: dict[str, int]
    chunk_count: int
    resolved_cross_references: int
    unresolved_cross_references: int
    warnings: tuple[ValidationIssue, ...]
    errors: tuple[ValidationIssue, ...]


class ValidationReport(_FrozenModel):
    documents: tuple[DocumentValidationReport, ...]
    warnings: tuple[ValidationIssue, ...]
    blocking_errors: tuple[ValidationIssue, ...]
    unresolved_references: tuple[CrossReference, ...]

    @computed_field
    @property
    def is_valid(self) -> bool:
        return not self.blocking_errors


def validate_corpus(
    documents: Sequence[DocumentValidationInput],
    *,
    corpus_dir: Path,
) -> ValidationReport:
    document_reports: list[DocumentValidationReport] = []
    all_warnings: list[ValidationIssue] = []
    all_errors: list[ValidationIssue] = []
    unresolved: list[CrossReference] = []

    seen_ids: set[str] = set()
    seen_chunks: set[str] = set()
    for document in documents:
        manifest = document.manifest
        errors: list[ValidationIssue] = list(document.preexisting_errors)
        warnings: list[ValidationIssue] = list(document.preexisting_warnings)
        source_path = corpus_dir / manifest.source_file
        actual_sha256 = _sha256(source_path) if source_path.is_file() else None
        if actual_sha256 is None:
            errors.append(
                _issue(
                    "source_file_missing",
                    manifest,
                    f"Missing source file: {manifest.source_file}",
                )
            )
        elif actual_sha256.upper() != manifest.sha256.upper():
            errors.append(
                _issue(
                    "sha256_mismatch",
                    manifest,
                    f"SHA-256 mismatch: expected {manifest.sha256}, got {actual_sha256}",
                )
            )
        if manifest.document_id in seen_ids:
            errors.append(
                _issue(
                    "duplicate_document_id",
                    manifest,
                    "Duplicate document_id in corpus",
                )
            )
        seen_ids.add(manifest.document_id)

        for warning in document.parsed.warnings:
            if warning.code in {"orphan_clause", "orphan_point"}:
                errors.append(
                    _issue(
                        "orphan_structure",
                        manifest,
                        f"{warning.code} at page {warning.page_number}, line {warning.line_number}",
                    )
                )
            else:
                warnings.append(_issue(warning.code, manifest, warning.message))

        article_count = sum(node.kind == "article" for node in document.parsed.nodes)
        if article_count == 0:
            errors.append(
                _issue(
                    "no_articles",
                    manifest,
                    "No Article headings were recognized",
                )
            )

        for chunk in document.chunks:
            if chunk.chunk_id in seen_chunks:
                errors.append(
                    _issue(
                        "duplicate_chunk_id",
                        manifest,
                        f"Duplicate chunk_id: {chunk.chunk_id}",
                    )
                )
            seen_chunks.add(chunk.chunk_id)
            if chunk.page_from < 1 or chunk.page_to < chunk.page_from:
                errors.append(
                    _issue(
                        "invalid_page_range",
                        manifest,
                        f"Invalid page range for {chunk.chunk_id}",
                    )
                )
            if chunk.token_count > document.max_tokens:
                errors.append(
                    _issue(
                        "oversized_chunk",
                        manifest,
                        f"Chunk {chunk.chunk_id} has {chunk.token_count} tokens; limit is {document.max_tokens}",
                    )
                )
            if "\ufffd" in chunk.body_text:
                errors.append(
                    _issue(
                        "invalid_unicode",
                        manifest,
                        f"Unicode replacement character in {chunk.chunk_id}",
                    )
                )

        page_count = len(document.pages) or max(
            (node.page_to for node in document.parsed.nodes), default=0
        )
        if document.pages:
            expected_pages = set(range(1, page_count + 1))
            actual_pages = {page.page_number for page in document.pages}
            if actual_pages != expected_pages:
                errors.append(
                    _issue(
                        "non_contiguous_pages",
                        manifest,
                        "Extracted page numbers are not contiguous",
                    )
                )
            for page in document.pages:
                if not page.text.strip():
                    errors.append(
                        _issue(
                            "empty_page",
                            manifest,
                            f"Page {page.page_number} has no extracted text",
                        )
                    )

        unresolved.extend(document.references.unresolved)
        for reference in document.references.unresolved:
            warnings.append(
                _issue(
                    "unresolved_cross_reference",
                    manifest,
                    f"Unresolved reference '{reference.matched_text}' from {reference.source_chunk_id}",
                )
            )

        counts = Counter(node.kind for node in document.parsed.nodes)
        counts["top_level_article"] = _count_main_body_articles(document.parsed)
        report = DocumentValidationReport(
            document_id=manifest.document_id,
            source_file=manifest.source_file,
            expected_sha256=manifest.sha256,
            actual_sha256=actual_sha256,
            page_count=page_count,
            structural_counts=dict(sorted(counts.items())),
            chunk_count=len(document.chunks),
            resolved_cross_references=len(document.references.resolved),
            unresolved_cross_references=len(document.references.unresolved),
            warnings=tuple(warnings),
            errors=tuple(errors),
        )
        document_reports.append(report)
        all_warnings.extend(warnings)
        all_errors.extend(errors)

    return ValidationReport(
        documents=tuple(document_reports),
        warnings=tuple(all_warnings),
        blocking_errors=tuple(all_errors),
        unresolved_references=tuple(unresolved),
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def _count_main_body_articles(parsed: ParseResult) -> int:
    nodes_by_id = {node.node_id: node for node in parsed.nodes}
    count = 0
    for article in (node for node in parsed.nodes if node.kind == "article"):
        parent_id = article.parent_id
        seen: set[str] = set()
        in_appendix = False
        while parent_id is not None and parent_id not in seen:
            seen.add(parent_id)
            parent = nodes_by_id.get(parent_id)
            if parent is None:
                break
            if parent.kind == "appendix":
                in_appendix = True
                break
            parent_id = parent.parent_id
        if not in_appendix:
            count += 1
    return count


def _issue(code: str, manifest: DocumentManifest, message: str) -> ValidationIssue:
    return ValidationIssue(code=code, document_id=manifest.document_id, message=message)
