from __future__ import annotations

import re
from collections import defaultdict
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
    index = _ArticleIndex(chunks)
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
                        index,
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


def attach_cross_reference_ids(
    chunks: Sequence[LegalChunkRecord],
    resolution: CrossReferenceResolution,
) -> list[LegalChunkRecord]:
    """Record each chunk's resolved targets so context expansion can use them."""
    targets: dict[str, list[str]] = defaultdict(list)
    for reference in resolution.resolved:
        target = reference.target_chunk_id
        if (
            target is None
            or target == reference.source_chunk_id
            or target in targets[reference.source_chunk_id]
        ):
            continue
        targets[reference.source_chunk_id].append(target)
    return [
        chunk.model_copy(update={"cross_reference_ids": tuple(targets.get(chunk.chunk_id, ()))})
        for chunk in chunks
    ]


class _ArticleIndex:
    """Chunks grouped by (document, corpus version, article), in input order."""

    def __init__(self, chunks: Sequence[LegalChunkRecord]) -> None:
        self._groups: dict[tuple[str, str, str], list[LegalChunkRecord]] = defaultdict(list)
        for chunk in chunks:
            key = (chunk.document_id, chunk.corpus_version, (chunk.article_number or "").lower())
            self._groups[key].append(chunk)

    def candidates(
        self, source: LegalChunkRecord, article: str | None
    ) -> Sequence[LegalChunkRecord]:
        key = (source.document_id, source.corpus_version, (article or "").lower())
        return self._groups.get(key, ())


def _find_target(
    index: _ArticleIndex,
    *,
    source: LegalChunkRecord,
    article: str | None,
    clause: str | None,
    point: str | None,
) -> LegalChunkRecord | None:
    for candidate in index.candidates(source, article):
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
