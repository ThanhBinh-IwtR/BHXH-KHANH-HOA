from __future__ import annotations

from ingestion.legal_ingestion.chunking import DocumentManifest, build_chunks
from ingestion.legal_ingestion.models import LegalNode, ParseResult
from ingestion.legal_ingestion.models import PageText
from ingestion.legal_ingestion.parse_structure import parse_pages


def _node(
    node_id: str,
    kind: str,
    number: str,
    text: str,
    *,
    parent_id: str | None,
    page: int = 1,
) -> LegalNode:
    return LegalNode(
        node_id=node_id,
        kind=kind,
        number=number,
        title=text.split("\n", 1)[0],
        text=text,
        page_from=page,
        page_to=page,
        parent_id=parent_id,
    )


def _manifest() -> DocumentManifest:
    return DocumentManifest(
        document_id="nd-999-2025",
        document_number="999/2025/NĐ-CP",
        document_type="Nghị định",
        title="Văn bản kiểm thử",
        issued_date="2025-01-01",
        effective_date="2025-02-01",
        source_file="999.pdf",
        corpus_version="2025-demo-v1",
        sha256="0" * 64,
    )


def test_chunks_never_cross_article_boundaries() -> None:
    parsed = ParseResult(
        nodes=(
            _node("article-0001", "article", "1", "Điều 1. Điều thứ nhất", parent_id=None),
            _node("clause-0001", "clause", "1", "1. Nội dung của Điều thứ nhất", parent_id="article-0001"),
            _node("article-0002", "article", "2", "Điều 2. Điều thứ hai", parent_id=None, page=2),
            _node("clause-0002", "clause", "1", "1. Nội dung của Điều thứ hai", parent_id="article-0002", page=2),
        ),
        warnings=(),
    )

    chunks = build_chunks(parsed, _manifest())

    assert [chunk.article_number for chunk in chunks] == ["1", "2"]
    assert all("Điều 1" not in chunk.body_text or chunk.article_number == "1" for chunk in chunks)


def test_long_clause_splits_only_at_point_boundaries() -> None:
    article = _node("article-0001", "article", "1", "Điều 1. Phạm vi", parent_id=None)
    clause = _node("clause-0001", "clause", "1", "1. Các trường hợp bao gồm:", parent_id=article.node_id)
    points = tuple(
        _node(
            f"point-{index:04d}",
            "point",
            letter,
            f"{letter}) " + " ".join([f"nội-dung-{letter}"] * 16),
            parent_id=clause.node_id,
        )
        for index, letter in enumerate(("a", "b", "c", "d"), start=1)
    )
    parsed = ParseResult(nodes=(article, clause, *points), warnings=())

    chunks = build_chunks(parsed, _manifest(), max_tokens=40)

    assert [chunk.point_from for chunk in chunks] == ["a", "c"]
    assert [chunk.point_to for chunk in chunks] == ["b", "d"]
    assert all(chunk.clause_number == "1" for chunk in chunks)
    assert not any("nội-dung-b nội-dung-c" in chunk.body_text for chunk in chunks)


def test_split_clause_preserves_its_leading_text_exactly_once() -> None:
    article = _node("article-0001", "article", "1", "Điều 1. Phạm vi", parent_id=None)
    clause = _node(
        "clause-0001",
        "clause",
        "1",
        "1. Phần dẫn nhập quyết định phạm vi áp dụng:",
        parent_id=article.node_id,
    )
    points = tuple(
        _node(
            f"point-{index:04d}",
            "point",
            letter,
            f"{letter}) " + " ".join([f"nội-dung-{letter}"] * 20),
            parent_id=clause.node_id,
        )
        for index, letter in enumerate(("a", "b", "c"), start=1)
    )

    chunks = build_chunks(
        ParseResult(nodes=(article, clause, *points), warnings=()),
        _manifest(),
        max_tokens=30,
    )

    assert len(chunks) == 3
    assert sum("Phần dẫn nhập quyết định" in chunk.body_text for chunk in chunks) == 1
    assert "Phần dẫn nhập quyết định" in chunks[0].body_text


def test_clause_lead_counts_toward_point_group_token_limit() -> None:
    article = _node("article-0001", "article", "19", "Điều 19. Quy định", parent_id=None)
    clause = _node(
        "clause-0001",
        "clause",
        "9",
        "9. " + " ".join(["phần-dẫn"] * 20),
        parent_id=article.node_id,
    )
    points = tuple(
        _node(
            f"point-{index:04d}",
            "point",
            letter,
            f"{letter}) " + " ".join([f"nội-dung-{letter}"] * 25),
            parent_id=clause.node_id,
        )
        for index, letter in enumerate(("a", "b", "c", "d"), start=1)
    )

    chunks = build_chunks(
        ParseResult(nodes=(article, clause, *points), warnings=()),
        _manifest(),
        max_tokens=80,
    )

    assert all(chunk.token_count <= 80 for chunk in chunks)
    assert [chunk.point_from for chunk in chunks] == ["a", "c"]


def test_appendix_form_ancestry_makes_repeated_article_coordinates_unique() -> None:
    parsed = parse_pages(
        [
            PageText(
                page_number=1,
                text=(
                    "Phụ lục II\n"
                    "Mẫu số 01\n"
                    "Điều 1. Nội dung mẫu một\n"
                    "1. Khoản mẫu một\n"
                    "Mẫu số 02\n"
                    "Điều 1. Nội dung mẫu hai\n"
                    "1. Khoản mẫu hai"
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    chunks = build_chunks(parsed, _manifest())

    assert len(chunks) == 2
    assert len({chunk.chunk_id for chunk in chunks}) == 2
    assert all("phu-luc-ii" in chunk.chunk_id for chunk in chunks)
    assert any("mau-01" in chunk.chunk_id for chunk in chunks)
    assert any("mau-02" in chunk.chunk_id for chunk in chunks)


def test_free_form_appendix_content_has_nullable_article_and_stable_coordinate() -> None:
    parsed = parse_pages(
        [
            PageText(
                page_number=80,
                text=(
                    "Phụ lục III\n"
                    "DANH MỤC HỒ SƠ\n"
                    "1. Tờ khai tham gia\n"
                    "2. Giấy tờ chứng minh"
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    chunks = build_chunks(parsed, _manifest())

    assert len(chunks) == 1
    assert chunks[0].article_number is None
    assert "phu-luc-iii:noi-dung" in chunks[0].chunk_id
    assert "1. Tờ khai tham gia" in chunks[0].body_text
    assert chunks[0].token_count <= 800
    # Appendix content is tagged so retrieval can exclude it.
    assert chunks[0].chunk_type == "appendix"


def test_normative_clause_chunks_are_tagged_normative() -> None:
    parsed = parse_pages(
        [
            PageText(
                page_number=1,
                text="Điều 5. Mức đóng\n1. Người lao động đóng 8%.",
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    chunks = build_chunks(parsed, _manifest())

    assert chunks
    assert all(chunk.chunk_type == "normative" for chunk in chunks)
