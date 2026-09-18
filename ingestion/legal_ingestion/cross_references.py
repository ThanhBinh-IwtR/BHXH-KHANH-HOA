from __future__ import annotations

import re
from typing import Sequence

from pydantic import BaseModel, ConfigDict

from .chunking import LegalChunkRecord


REFERENCE_PATTERNS = (
    re.compile(r"khoản\s+(?P<clause>\d+)\s+Điều\s+(?P<article>\d+[a-zA-Z]?)", re.I),
    re.compile(r"Điều\s+(?P<article>\d+[a-zA-Z]?)", re.I),
    re.compile(r"điểm\s+(?P<point>[a-zđ])\s+khoản\s+(?P<clause>\d+)", re.I),
)


class _FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True)


class CrossReference(_FrozenModel):
    source_chunk_id: str
    source_document_id: str
    corpus_version: str
    matched_text: str
    target_article: str | None
    target_clause: str | None
    target_point: str | None
    target_chunk_id: str | None


class CrossReferenceResolution(_FrozenModel):
    resolved: tuple[CrossReference, ...]
    unresolved: tuple[CrossReference, ...]


def resolve_cross_references(
    chunks: Sequence[LegalChunkRecord],
) -> CrossReferenceResolution:
    """Extract and resolve explicit references within the same document/corpus."""
    resolved: list[CrossReference] = []
    unresolved: list[CrossReference] = []
    for source in chunks:
        occupied: list[tuple[int, int]] = []
        for pattern in REFERENCE_PATTERNS:
            for match in pattern.finditer(source.body_text):
                if any(
                    match.start() < end and start < match.end()
                    for start, end in occupied
                ):
                    continue
                occupied.append(match.span())
                groups = match.groupdict()
                article = groups.get("article") or source.article_number
                clause = groups.get("clause")
                point = groups.get("point")
                target = None
                if not _looks_like_external_document_reference(source.body_text, match.end()):
                    target = _find_target(
                        chunks,
                        source=source,
                        article=article,
                        clause=clause,
                        point=point,
                    )
                reference = CrossReference(
                    source_chunk_id=source.chunk_id,
                    source_document_id=source.document_id,
                    corpus_version=source.corpus_version,
                    matched_text=match.group(0),
                    target_article=article,
                    target_clause=clause,
                    target_point=point.lower() if point else None,
                    target_chunk_id=target.chunk_id if target else None,
                )
                (resolved if target else unresolved).append(reference)
    return CrossReferenceResolution(
        resolved=tuple(resolved), unresolved=tuple(unresolved)
    )


def _looks_like_external_document_reference(text: str, match_end: int) -> bool:
    """Do not resolve a local chunk when the prose names another instrument."""
    suffix = text[match_end : match_end + 80]
    return bool(
        re.match(
            r"\s*(?:của|theo|tại|quy định tại)\s+(?:Luật|Nghị định|Thông tư)\b",
            suffix,
            re.I,
        )
    )


def _find_target(
    chunks: Sequence[LegalChunkRecord],
    *,
    source: LegalChunkRecord,
    article: str | None,
    clause: str | None,
    point: str | None,
) -> LegalChunkRecord | None:
    for candidate in chunks:
        if (
            candidate.document_id != source.document_id
            or candidate.corpus_version != source.corpus_version
            or (candidate.article_number or "").lower() != (article or "").lower()
        ):
            continue
        if clause is not None and candidate.clause_number != clause:
            continue
        if point is not None and not _contains_point(candidate, point.lower()):
            continue
        return candidate
    return None


def _contains_point(chunk: LegalChunkRecord, point: str) -> bool:
    if chunk.point_from is None or chunk.point_to is None:
        return False
    alphabet = "aăâbcdđeêghiklmnoôơpqrstuưvxy"
    try:
        return (
            alphabet.index(chunk.point_from)
            <= alphabet.index(point)
            <= alphabet.index(chunk.point_to)
        )
    except ValueError:
        return chunk.point_from == point or chunk.point_to == point
