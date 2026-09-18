from __future__ import annotations

from ingestion.legal_ingestion.cross_references import resolve_cross_references
from ingestion.legal_ingestion.chunking import LegalChunkRecord


def _chunk(
    chunk_id: str,
    *,
    document_id: str = "doc-a",
    corpus_version: str = "v1",
    body_text: str = "Nội dung.",
    article_number: str = "1",
    clause_number: str | None = "1",
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
        context_header="Doc > Điều kiểm thử",
        body_text=body_text,
        search_text=body_text,
        search_text_unaccented=body_text.lower(),
        page_from=1,
        page_to=1,
        parent_id=None,
        previous_sibling_id=None,
        next_sibling_id=None,
        token_count=1,
        embedding=None,
        corpus_version=corpus_version,
        status="staged",
    )


def test_resolves_only_same_document_and_corpus_version_targets() -> None:
    source = _chunk(
        "source",
        body_text="Thực hiện theo khoản 1 Điều 2 và khoản 1 Điều 3.",
    )
    same_document = _chunk("same-document", article_number="2")
    other_document = _chunk("other-document", document_id="doc-b", article_number="3")
    other_version = _chunk("other-version", corpus_version="v2", article_number="3")

    result = resolve_cross_references([source, same_document, other_document, other_version])

    assert [reference.target_chunk_id for reference in result.resolved] == ["same-document"]
    assert {reference.target_article for reference in result.unresolved} == {"3"}
    assert len(result.unresolved) == 1


def test_does_not_resolve_a_reference_explicitly_naming_another_instrument() -> None:
    source = _chunk(
        "source",
        body_text="Thực hiện theo Điều 2 của Luật Bảo hiểm xã hội.",
    )
    same_document = _chunk("same-document", article_number="2")

    result = resolve_cross_references([source, same_document])

    assert result.resolved == ()
    assert result.unresolved[0].target_chunk_id is None
