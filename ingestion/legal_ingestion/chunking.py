from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import datetime
from typing import Literal, Sequence

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import LegalNode, ParseResult


class _FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True)


class ReviewedLowConfidencePage(_FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    document_sha256: str
    page_number: int = Field(ge=1)
    observed_confidence: float = Field(ge=0, le=100)
    reviewer: str = Field(min_length=1)
    reviewed_at: datetime
    note: str = Field(min_length=1)

    @field_validator("document_sha256")
    @classmethod
    def validate_document_sha256(cls, value: str) -> str:
        normalized = value.upper()
        if not re.fullmatch(r"[0-9A-F]{64}", normalized):
            raise ValueError(
                "document_sha256 must contain exactly 64 hexadecimal characters"
            )
        return normalized

    @field_validator("reviewer", "note")
    @classmethod
    def reject_blank_metadata(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("review metadata must not be blank")
        return normalized

    @field_validator("reviewed_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("reviewed_at must include a timezone offset")
        return value


class DocumentManifest(_FrozenModel):
    document_id: str
    document_number: str
    document_type: str
    title: str
    issued_date: str
    effective_date: str
    source_file: str
    corpus_version: str
    sha256: str
    reviewed_low_confidence_pages: tuple[ReviewedLowConfidencePage, ...] = ()

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str) -> str:
        normalized = value.upper()
        if not re.fullmatch(r"[0-9A-F]{64}", normalized):
            raise ValueError("sha256 must contain exactly 64 hexadecimal characters")
        return normalized

    @model_validator(mode="after")
    def reject_duplicate_review_pages(self) -> "DocumentManifest":
        page_numbers = [
            review.page_number for review in self.reviewed_low_confidence_pages
        ]
        if len(page_numbers) != len(set(page_numbers)):
            raise ValueError("reviewed_low_confidence_pages contains a duplicate page")
        return self


class LegalChunkRecord(_FrozenModel):
    chunk_id: str
    document_id: str
    chapter_number: str | None
    section_number: str | None
    article_number: str | None
    article_title: str | None
    clause_number: str | None
    point_from: str | None
    point_to: str | None
    context_header: str
    body_text: str
    search_text: str
    search_text_unaccented: str
    page_from: int = Field(ge=1)
    page_to: int = Field(ge=1)
    parent_id: str | None
    previous_sibling_id: str | None
    next_sibling_id: str | None
    token_count: int = Field(ge=1)
    embedding: tuple[float, ...] | None
    corpus_version: str
    status: Literal["staged", "active", "inactive"]
    # "normative" = Điều/Khoản/Điểm carrying legal rules (retrievable);
    # "appendix" = phụ lục/biểu mẫu form templates (excluded from retrieval).
    chunk_type: Literal["normative", "appendix"] = "normative"


def build_chunks(
    parsed: ParseResult,
    manifest: DocumentManifest,
    *,
    max_tokens: int = 800,
) -> list[LegalChunkRecord]:
    """Build deterministic chunks without crossing an Article boundary."""
    if max_tokens < 1:
        raise ValueError("max_tokens must be positive")

    nodes_by_id = {node.node_id: node for node in parsed.nodes}
    children: dict[str, list[LegalNode]] = defaultdict(list)
    for node in parsed.nodes:
        if node.parent_id is not None:
            children[node.parent_id].append(node)

    chunks: list[LegalChunkRecord] = []
    for appendix in (
        node
        for node in parsed.nodes
        if node.kind == "appendix"
    ):
        chunks.extend(
            _chunk_appendix_content(
                appendix, nodes_by_id, manifest, max_tokens=max_tokens
            )
        )

    for article in (node for node in parsed.nodes if node.kind == "article"):
        clauses = [
            node for node in children.get(article.node_id, ()) if node.kind == "clause"
        ]
        if not clauses:
            chunks.extend(
                _chunk_article_without_clauses(
                    article, nodes_by_id, manifest, max_tokens=max_tokens
                )
            )
            continue

        for clause in clauses:
            points = [
                node for node in children.get(clause.node_id, ()) if node.kind == "point"
            ]
            body = _normalize_whitespace(
                "\n".join([clause.text, *(point.text for point in points)])
            )
            if points and _estimate_tokens(body) > max_tokens:
                chunks.extend(
                    _chunk_clause_points(
                        article,
                        clause,
                        points,
                        nodes_by_id,
                        manifest,
                        max_tokens=max_tokens,
                    )
                )
            else:
                chunks.append(
                    _make_chunk(
                        article=article,
                        clause=clause,
                        points=points,
                        body_text=body,
                        nodes_by_id=nodes_by_id,
                        manifest=manifest,
                    )
                )

    return _add_sibling_links(chunks)


def _chunk_article_without_clauses(
    article: LegalNode,
    nodes_by_id: dict[str, LegalNode],
    manifest: DocumentManifest,
    *,
    max_tokens: int,
) -> list[LegalChunkRecord]:
    paragraphs = [
        _normalize_whitespace(line)
        for line in article.text.splitlines()
        if line.strip()
    ]
    if not paragraphs:
        return []

    groups: list[list[str]] = []
    current: list[str] = []
    current_tokens = 0
    for paragraph in paragraphs:
        paragraph_tokens = _estimate_tokens(paragraph)
        if current and current_tokens + paragraph_tokens > max_tokens:
            groups.append(current)
            current = []
            current_tokens = 0
        current.append(paragraph)
        current_tokens += paragraph_tokens
    if current:
        groups.append(current)

    return [
        _make_chunk(
            article=article,
            clause=None,
            points=(),
            body_text=_normalize_whitespace("\n".join(group)),
            nodes_by_id=nodes_by_id,
            manifest=manifest,
            segment=index if len(groups) > 1 else None,
        )
        for index, group in enumerate(groups, start=1)
    ]


def _chunk_clause_points(
    article: LegalNode,
    clause: LegalNode,
    points: Sequence[LegalNode],
    nodes_by_id: dict[str, LegalNode],
    manifest: DocumentManifest,
    *,
    max_tokens: int,
) -> list[LegalChunkRecord]:
    groups: list[list[LegalNode]] = []
    current: list[LegalNode] = []
    current_tokens = _estimate_tokens(_normalize_whitespace(clause.text))
    for point in points:
        point_tokens = _estimate_tokens(_normalize_whitespace(point.text))
        if current and current_tokens + point_tokens > max_tokens:
            groups.append(current)
            current = []
            current_tokens = 0
        current.append(point)
        current_tokens += point_tokens
    if current:
        groups.append(current)

    chunks: list[LegalChunkRecord] = []
    for index, group in enumerate(groups):
        body_parts = [point.text for point in group]
        if index == 0:
            body_parts.insert(0, clause.text)
        chunks.append(
            _make_chunk(
                article=article,
                clause=clause,
                points=group,
                body_text=_normalize_whitespace("\n".join(body_parts)),
                nodes_by_id=nodes_by_id,
                manifest=manifest,
            )
        )
    return chunks


def _chunk_appendix_content(
    appendix: LegalNode,
    nodes_by_id: dict[str, LegalNode],
    manifest: DocumentManifest,
    *,
    max_tokens: int,
) -> list[LegalChunkRecord]:
    """Chunk free-form appendix/form content without inventing Article parents."""
    lines = [line.strip() for line in appendix.text.splitlines() if line.strip()]
    if len(lines) <= 1:
        return []
    groups = _group_text_with_limit(lines[1:], max_tokens)
    return [
        _make_appendix_chunk(
            appendix=appendix,
            body_text=_normalize_whitespace("\n".join(group)),
            nodes_by_id=nodes_by_id,
            manifest=manifest,
            segment=index if len(groups) > 1 else None,
        )
        for index, group in enumerate(groups, start=1)
    ]


def _group_text_with_limit(lines: Sequence[str], max_tokens: int) -> list[list[str]]:
    pieces: list[str] = []
    for line in lines:
        words = line.split()
        if len(words) <= max_tokens:
            pieces.append(line)
        else:
            pieces.extend(
                " ".join(words[index : index + max_tokens])
                for index in range(0, len(words), max_tokens)
            )
    groups: list[list[str]] = []
    current: list[str] = []
    current_tokens = 0
    for piece in pieces:
        piece_tokens = _estimate_tokens(piece)
        if current and current_tokens + piece_tokens > max_tokens:
            groups.append(current)
            current = []
            current_tokens = 0
        current.append(piece)
        current_tokens += piece_tokens
    if current:
        groups.append(current)
    return groups


def _make_appendix_chunk(
    *,
    appendix: LegalNode,
    body_text: str,
    nodes_by_id: dict[str, LegalNode],
    manifest: DocumentManifest,
    segment: int | None,
) -> LegalChunkRecord:
    ancestry = _ancestry(appendix, nodes_by_id)
    appendix_path = _appendix_coordinate(ancestry)
    context_parts = [manifest.document_number, *[node.title or "Phụ lục" for node in ancestry]]
    context_header = " > ".join(context_parts)
    search_text = f"{context_header}\n{body_text}"
    coordinate = [_slug(manifest.document_id), *appendix_path, "noi-dung"]
    if segment is not None:
        coordinate.append(f"doan-{segment}")
    coordinate.append(_slug(manifest.corpus_version))
    parent_ancestry = ancestry[:-1]
    parent_id = (
        ":".join(
            [
                _slug(manifest.document_id),
                *_appendix_coordinate(parent_ancestry),
                _slug(manifest.corpus_version),
            ]
        )
        if parent_ancestry
        else None
    )
    return LegalChunkRecord(
        chunk_id=":".join(coordinate),
        document_id=manifest.document_id,
        chapter_number=None,
        section_number=None,
        article_number=None,
        article_title=appendix.title,
        clause_number=None,
        point_from=None,
        point_to=None,
        context_header=context_header,
        body_text=body_text,
        search_text=search_text,
        search_text_unaccented=_remove_accents(search_text),
        page_from=appendix.page_from,
        page_to=appendix.page_to,
        parent_id=parent_id,
        previous_sibling_id=None,
        next_sibling_id=None,
        token_count=_estimate_tokens(body_text),
        embedding=None,
        corpus_version=manifest.corpus_version,
        status="staged",
        chunk_type="appendix",
    )


def _make_chunk(
    *,
    article: LegalNode,
    clause: LegalNode | None,
    points: Sequence[LegalNode],
    body_text: str,
    nodes_by_id: dict[str, LegalNode],
    manifest: DocumentManifest,
    segment: int | None = None,
) -> LegalChunkRecord:
    ancestry = _ancestry(article, nodes_by_id)
    chapter = next((node for node in ancestry if node.kind == "chapter"), None)
    section = next((node for node in ancestry if node.kind == "section"), None)
    point_from = points[0].number if points else None
    point_to = points[-1].number if points else None
    source_nodes = [clause or article, *points]
    page_from = min(node.page_from for node in source_nodes)
    page_to = max(node.page_to for node in source_nodes)
    context_parts = [manifest.document_number]
    context_parts.extend(
        node.title or "Phụ lục" for node in ancestry if node.kind == "appendix"
    )
    if chapter is not None:
        context_parts.append(f"Chương {chapter.number}")
    if section is not None:
        context_parts.append(f"Mục {section.number}")
    context_parts.append(f"Điều {article.number}. {article.title or ''}".strip())
    if clause is not None:
        context_parts.append(f"Khoản {clause.number}")
        if points:
            context_parts.append(f"Điểm {point_from}-{point_to}")
    context_header = " > ".join(context_parts)
    search_text = f"{context_header}\n{body_text}"

    coordinate = [
        _slug(manifest.document_id),
        *_appendix_coordinate(ancestry),
        f"dieu-{_slug(article.number or 'khong-so')}",
    ]
    if clause is not None:
        coordinate.append(f"khoan-{_slug(clause.number or 'khong-so')}")
    if points:
        coordinate.append(f"diem-{_slug(point_from or '')}-{_slug(point_to or '')}")
    if segment is not None:
        coordinate.append(f"doan-{segment}")
    coordinate.append(_slug(manifest.corpus_version))
    chunk_id = ":".join(coordinate)

    parent_coordinate = ":".join(
        [
            _slug(manifest.document_id),
            *_appendix_coordinate(ancestry),
            f"dieu-{_slug(article.number or 'khong-so')}",
            _slug(manifest.corpus_version),
        ]
    )
    return LegalChunkRecord(
        chunk_id=chunk_id,
        document_id=manifest.document_id,
        chapter_number=chapter.number if chapter else None,
        section_number=section.number if section else None,
        article_number=article.number,
        article_title=article.title,
        clause_number=clause.number if clause else None,
        point_from=point_from,
        point_to=point_to,
        context_header=context_header,
        body_text=body_text,
        search_text=search_text,
        search_text_unaccented=_remove_accents(search_text),
        page_from=page_from,
        page_to=page_to,
        parent_id=parent_coordinate if clause is not None else None,
        previous_sibling_id=None,
        next_sibling_id=None,
        token_count=_estimate_tokens(body_text),
        embedding=None,
        corpus_version=manifest.corpus_version,
        status="staged",
    )


def _add_sibling_links(chunks: Sequence[LegalChunkRecord]) -> list[LegalChunkRecord]:
    grouped: dict[tuple[str, str], list[LegalChunkRecord]] = defaultdict(list)
    for chunk in chunks:
        group_id = chunk.parent_id or chunk.chunk_id.rsplit(":", 1)[0]
        grouped[(chunk.document_id, group_id)].append(chunk)
    result: list[LegalChunkRecord] = []
    for chunk in chunks:
        group_id = chunk.parent_id or chunk.chunk_id.rsplit(":", 1)[0]
        siblings = grouped[(chunk.document_id, group_id)]
        index = siblings.index(chunk)
        result.append(
            chunk.model_copy(
                update={
                    "previous_sibling_id": siblings[index - 1].chunk_id if index else None,
                    "next_sibling_id": (
                        siblings[index + 1].chunk_id
                        if index + 1 < len(siblings)
                        else None
                    ),
                }
            )
        )
    return result


def _ancestry(node: LegalNode, nodes_by_id: dict[str, LegalNode]) -> list[LegalNode]:
    result: list[LegalNode] = []
    current: LegalNode | None = node
    seen: set[str] = set()
    while current is not None and current.node_id not in seen:
        seen.add(current.node_id)
        result.append(current)
        current = nodes_by_id.get(current.parent_id) if current.parent_id else None
    result.reverse()
    return result


def _appendix_coordinate(ancestry: Sequence[LegalNode]) -> list[str]:
    return [
        _slug(node.number or "phu-luc-khong-so")
        for node in ancestry
        if node.kind == "appendix"
    ]


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value)).strip()


def _estimate_tokens(value: str) -> int:
    return max(1, len(value.split()))


def _remove_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    without_marks = "".join(
        char for char in decomposed if unicodedata.category(char) != "Mn"
    )
    return without_marks.replace("đ", "d").replace("Đ", "D").lower()


def _slug(value: str) -> str:
    unaccented = _remove_accents(value)
    return re.sub(r"[^a-z0-9]+", "-", unaccented).strip("-")
