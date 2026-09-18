from __future__ import annotations

from pathlib import Path

from ingestion.legal_ingestion.models import PageText
from ingestion.legal_ingestion.parse_structure import parse_pages


FIXTURE = Path(__file__).parent / "fixtures" / "legal_excerpt.txt"


def _fixture_pages() -> list[PageText]:
    first, second = FIXTURE.read_text(encoding="utf-8").split(
        "=== PAGE BREAK ===\n"
    )
    return [
        PageText(
            page_number=1,
            text=first.rstrip(),
            source="text",
            ocr_confidence=None,
        ),
        PageText(
            page_number=2,
            text=second.rstrip(),
            source="text",
            ocr_confidence=None,
        ),
    ]


def test_parser_preserves_article_clause_point_hierarchy() -> None:
    result = parse_pages(_fixture_pages())

    article = result.nodes[1]
    clauses = [node for node in result.nodes if node.kind == "clause"]
    points = [node for node in result.nodes if node.kind == "point"]

    assert article.kind == "article"
    assert article.number == "1"
    assert article.title == "Phạm vi điều chỉnh"
    assert [node.number for node in clauses] == ["1", "2"]
    assert [node.number for node in points] == ["a", "b", "đ"]
    assert all(clause.parent_id == article.node_id for clause in clauses)
    assert [point.parent_id for point in points] == [
        clauses[0].node_id,
        clauses[0].node_id,
        clauses[0].node_id,
    ]
    assert clauses[0].page_from == 1
    assert clauses[0].page_to == 2
    assert article.page_from == 1
    assert article.page_to == 2
    assert not result.warnings


def test_parser_recognizes_sections_case_insensitively() -> None:
    pages = [
        PageText(
            page_number=3,
            text="CHƯƠNG II\nMỤC 1\nĐiều 2. Đối tượng áp dụng",
            source="text",
            ocr_confidence=None,
        )
    ]

    result = parse_pages(pages)
    chapter, section, article = result.nodes

    assert (chapter.kind, chapter.number, chapter.parent_id) == (
        "chapter",
        "II",
        None,
    )
    assert (section.kind, section.number, section.parent_id) == (
        "section",
        "1",
        chapter.node_id,
    )
    assert article.parent_id == section.node_id


def test_parser_warns_for_orphan_clause_instead_of_guessing_parent() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=1,
                text="1. Khoản không có điều",
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    assert not [node for node in result.nodes if node.kind == "clause"]
    assert len(result.warnings) == 1
    assert result.warnings[0].code == "orphan_clause"
    assert result.warnings[0].page_number == 1
    assert result.warnings[0].line_number == 1


def test_parser_warns_for_orphan_point_instead_of_reusing_old_clause() -> None:
    pages = [
        PageText(
            page_number=1,
            text=(
                "Điều 1. Điều thứ nhất\n"
                "1. Khoản hợp lệ\n"
                "Điều 2. Điều thứ hai\n"
                "đ) Điểm không có khoản"
            ),
            source="text",
            ocr_confidence=None,
        )
    ]

    result = parse_pages(pages)

    assert [node.number for node in result.nodes if node.kind == "point"] == []
    assert [warning.code for warning in result.warnings] == ["orphan_point"]


def test_line_start_article_reference_is_not_a_new_article_heading() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=1,
                text=(
                    "Điều 3. Đối tượng tham gia\n"
                    "1. Người lao động thực hiện theo quy định tại khoản 1\n"
                    "Điều 2 của Luật Bảo hiểm xã hội.\n"
                    "2. Chủ hộ kinh doanh tham gia bảo hiểm xã hội."
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    articles = [node for node in result.nodes if node.kind == "article"]
    clauses = [node for node in result.nodes if node.kind == "clause"]

    assert [article.number for article in articles] == ["3"]
    assert [clause.number for clause in clauses] == ["1", "2"]
    assert "Điều 2 của Luật Bảo hiểm xã hội" in clauses[0].text


def test_strong_inline_article_heading_is_split_into_a_logical_line() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=8,
                text=(
                    "Điều 10. Chế độ\n"
                    "1. Nội dung kết thúc | Điêu 11. Mức hưởng\n"
                    "1. Nội dung của điều mới"
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    top_level_articles = [
        node
        for node in result.nodes
        if node.kind == "article" and node.parent_id is None
    ]
    assert [node.number for node in top_level_articles] == ["10", "11"]
    assert [node.title for node in top_level_articles] == ["Chế độ", "Mức hưởng"]


def test_second_strong_inline_article_does_not_merge_with_previous_clause() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=5,
                text=(
                    "Điều 6. Hồ sơ\n"
                    "2. Thành phần cuối | Điều 7. Trình tự giải quyết\n"
                    "1. Cơ quan bảo hiểm xã hội tiếp nhận hồ sơ"
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    articles = [node for node in result.nodes if node.kind == "article"]
    assert [(node.number, node.title) for node in articles] == [
        ("6", "Hồ sơ"),
        ("7", "Trình tự giải quyết"),
    ]
    assert "Điều 7" not in next(
        node.text
        for node in result.nodes
        if node.kind == "clause" and node.number == "2"
    )


def test_ocr_garbage_before_strong_inline_article_is_split() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=5,
                text=(
                    "Điều 6. Căn cứ đóng\n"
                    "3. Nội dung cuối của điều trước «A ~ A Điêu 7. Tiền lương làm căn cứ đóng\n"
                    "1. Mức tiền lương tháng"
                ),
                source="ocr",
                ocr_confidence=92.0,
            )
        ]
    )

    assert [node.number for node in result.nodes if node.kind == "article"] == [
        "6",
        "7",
    ]


def test_inline_article_references_with_punctuation_are_not_split() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=6,
                text=(
                    "Điều 8. Hồ sơ\n"
                    "1. Thực hiện theo Điều 7. Quy định nêu trên.\n"
                    "2. Căn cứ tại Điều 7. Tiền lương làm căn cứ đóng."
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    assert [node.number for node in result.nodes if node.kind == "article"] == ["8"]


def test_appendix_forms_keep_numbered_content_out_of_top_level_hierarchy() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=50,
                text=(
                    "Điều 45. Điều khoản thi hành\n"
                    "1. Nội dung chính\n"
                    "Phụ lục II\n"
                    "Mẫu số 01\n"
                    "1. Trường dữ liệu biểu mẫu\n"
                    "a) Không phải điểm của Điều chính\n"
                    "Điều 1. Nội dung viện dẫn trong mẫu\n"
                    "1. Khoản của nội dung viện dẫn\n"
                    "Mẫu số 02\n"
                    "Điều 1. Nội dung viện dẫn khác\n"
                    "1. Khoản khác"
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    nodes = {node.node_id: node for node in result.nodes}
    top_level_articles = [
        node
        for node in result.nodes
        if node.kind == "article" and node.parent_id is None
    ]
    embedded_articles = [
        node
        for node in result.nodes
        if node.kind == "article" and node.parent_id is not None
    ]

    assert [node.number for node in top_level_articles] == ["45"]
    assert [node.number for node in embedded_articles] == ["1", "1"]
    assert all(nodes[node.parent_id].kind == "appendix" for node in embedded_articles)
    assert not result.warnings


def test_appendix_numbered_list_is_content_not_orphan_legal_structure() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=102,
                text=(
                    "Phụ lục I\n"
                    "DANH MỤC NGHỀ, CÔNG VIỆC\n"
                    "1. Khai thác khoáng sản\n"
                    "24. Công việc có yếu tố nặng nhọc"
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    assert not result.warnings
    assert not [node for node in result.nodes if node.kind == "clause"]
    appendix = next(node for node in result.nodes if node.kind == "appendix")
    assert "1. Khai thác khoáng sản" in appendix.text
    assert "24. Công việc" in appendix.text


def test_point_continuation_on_next_page_keeps_existing_clause_parent() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=1,
                text="Điều 8. Mức hưởng\n1. Các trường hợp gồm:",
                source="text",
                ocr_confidence=None,
            ),
            PageText(
                page_number=2,
                text="a) Trường hợp thứ nhất\nb) Trường hợp thứ hai",
                source="text",
                ocr_confidence=None,
            ),
        ]
    )

    clause = next(node for node in result.nodes if node.kind == "clause")
    points = [node for node in result.nodes if node.kind == "point"]
    assert not result.warnings
    assert [node.parent_id for node in points] == [clause.node_id, clause.node_id]
    assert clause.page_to == 2


def test_inline_appendix_reference_does_not_enter_appendix_state() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=20,
                text=(
                    "Điều 44. Trách nhiệm thi hành\n"
                    "1. Danh mục thực hiện theo Phụ lục II ban hành kèm theo Nghị định này.\n"
                    "Điều 45. Điều khoản chuyển tiếp\n"
                    "1. Quy định chuyển tiếp"
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    assert [node.number for node in result.nodes if node.kind == "article"] == [
        "44",
        "45",
    ]
    assert not [node for node in result.nodes if node.kind == "appendix"]


def test_appendix_heading_after_signature_garbage_enters_appendix_state() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=46,
                text=(
                    "Điều 45. Điều khoản thi hành\n"
                    "1. Nghị định này có hiệu lực.\n"
                    "KT. BỘ TRƯỞNG % Phụ lục I VIỆC KHAI THÁC, SỬ DỤNG DỮ LIỆU\n"
                    "1. Danh mục dữ liệu"
                ),
                source="ocr",
                ocr_confidence=91.0,
            )
        ]
    )

    appendix = next(node for node in result.nodes if node.kind == "appendix")
    assert appendix.number == "phu-luc-i"
    assert "1. Danh mục dữ liệu" in appendix.text
    assert not result.warnings


def test_ocr_artifact_before_numbered_clause_preserves_points() -> None:
    for artifact in ("_. 1.", "_ 1."):
        result = parse_pages(
            [
                PageText(
                    page_number=27,
                    text=(
                        "Điều 28. Căn cứ xác nhận\n"
                        f"{artifact} Căn cứ xác định trường hợp:\n"
                        "a) Trường hợp thứ nhất\n"
                        "b) Trường hợp thứ hai"
                    ),
                    source="ocr",
                    ocr_confidence=95.0,
                )
            ]
        )

        clauses = [node for node in result.nodes if node.kind == "clause"]
        assert [node.number for node in clauses] == ["1"]
        assert [node.number for node in result.nodes if node.kind == "point"] == [
            "a",
            "b",
        ]
        assert not result.warnings


def test_double_l_ocr_clause_one_only_applies_immediately_after_article() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=11,
                text=(
                    "Điều 8. Xác định số tiền đóng\n"
                    "LL Đối với nhóm đối tượng:\n"
                    "a) Số tiền ngân sách đóng\n"
                    "2. Nhóm đối tượng khác"
                ),
                source="ocr",
                ocr_confidence=95.0,
            )
        ]
    )

    assert [node.number for node in result.nodes if node.kind == "clause"] == [
        "1",
        "2",
    ]
    assert not result.warnings


def test_line_start_appendix_reference_does_not_hide_final_article() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=48,
                text=(
                    "Điều 44. Trách nhiệm\n"
                    "1. Danh sách quy định tại:\n"
                    "Phụ lục III ban hành kèm theo Nghị định này.\n"
                    "Điều 45. Điều khoản thi hành\n"
                    "1. Nghị định này có hiệu lực"
                ),
                source="text",
                ocr_confidence=None,
            )
        ]
    )

    assert [node.number for node in result.nodes if node.kind == "article"] == [
        "44",
        "45",
    ]
    assert not [node for node in result.nodes if node.kind == "appendix"]


def test_standalone_ocr_appendix_it_is_normalized_to_roman_two() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=48,
                text="Phụ lục I\nDANH MỤC THỨ NHẤT",
                source="ocr",
                ocr_confidence=80.0,
            ),
            PageText(
                page_number=49,
                text="Phụ lục IT\nDANH MỤC THỨ HAI",
                source="ocr",
                ocr_confidence=80.0,
            ),
        ]
    )

    assert [node.number for node in result.nodes if node.kind == "appendix"] == [
        "phu-luc-i",
        "phu-luc-ii",
    ]


def test_form_index_guidance_and_inline_references_are_not_form_headers() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=78,
                text=(
                    "Phụ lục\n"
                    "Mẫu số 5 Hợp đồng khám bệnh, chữa bệnh bảo hiểm y tế\n"
                    "Mẫu số 10 Giấy đề nghị thanh toán trực tiếp\n"
                    "HƯỚNG DẪN LẬP MẪU SỐ 2\n"
                    "Căn cứ lập: Tờ khai (Mẫu số 2)"
                ),
                source="ocr",
                ocr_confidence=94.0,
            )
        ]
    )

    assert [node.number for node in result.nodes if node.kind == "appendix"] == [
        "phu-luc-1"
    ]


def test_repeated_standalone_form_page_header_reuses_current_form_node() -> None:
    result = parse_pages(
        [
            PageText(
                page_number=81,
                text="Phụ lục\nMẫu số 2\nĐiều 1. Nội dung biểu mẫu",
                source="ocr",
                ocr_confidence=94.0,
            ),
            PageText(
                page_number=82,
                text="Mẫu số 2\n1. Nội dung tiếp theo",
                source="ocr",
                ocr_confidence=94.0,
            ),
        ]
    )

    forms = [
        node
        for node in result.nodes
        if node.kind == "appendix" and node.number == "mau-2"
    ]
    article = next(node for node in result.nodes if node.kind == "article")
    clause = next(node for node in result.nodes if node.kind == "clause")
    assert len(forms) == 1
    assert article.parent_id == forms[0].node_id
    assert clause.parent_id == article.node_id


def _page(text: str, number: int = 1) -> PageText:
    return PageText(page_number=number, text=text, source="ocr", ocr_confidence=95.0)


def test_cross_reference_chapter_line_does_not_open_a_chapter() -> None:
    # "Chương V Luật ..." is a citation, not a heading; the Article must survive.
    pages = [
        _page(
            "Điều 30. Điều khoản chuyển tiếp\n"
            "13. Chế độ tử tuất thực hiện theo quy định tại Mục 4\n"
            "Chương V Luật Bảo hiểm xã hội số 41/2024/QH15.\n"
            "14. Trường hợp người lao động phục viên được bảo lưu."
        )
    ]
    result = parse_pages(pages)
    assert not any(node.kind == "chapter" for node in result.nodes)
    clauses = [node.number for node in result.nodes if node.kind == "clause"]
    assert clauses == ["13", "14"]
    assert not result.warnings


def test_ocr_comma_clause_with_stray_prefix_is_recognized() -> None:
    pages = [
        _page(
            "Điều 28. Căn cứ xác nhận thời gian đóng\n"
            "___1, Căn cứ xác định người sử dụng lao động không còn khả năng\n"
            "a) Quyết định tuyên bố phá sản của Tòa án."
        )
    ]
    result = parse_pages(pages)
    assert [node.number for node in result.nodes if node.kind == "clause"] == ["1"]
    assert [node.number for node in result.nodes if node.kind == "point"] == ["a"]
    assert not result.warnings


def test_bare_comma_enumeration_is_not_a_clause() -> None:
    pages = [
        _page(
            "Điều 5. Mức đóng\n"
            "1. Đối tượng quy định tại các khoản\n"
            "1, 2, 3, 4, 5 và 6 Điều 12 của Luật Bảo hiểm y tế được áp dụng."
        )
    ]
    result = parse_pages(pages)
    # Only the genuine clause 1 exists; the enumeration line is body text.
    assert [node.number for node in result.nodes if node.kind == "clause"] == ["1"]


def test_ocr_single_letter_clause_one_is_recovered() -> None:
    pages = [
        _page(
            "Điều 10. Mức hỗ trợ\n"
            "L Đối với nhóm đối tượng được ngân sách nhà nước hỗ trợ\n"
            "a) Số tiền ngân sách nhà nước đóng hằng tháng."
        )
    ]
    result = parse_pages(pages)
    assert [node.number for node in result.nodes if node.kind == "clause"] == ["1"]
    assert [node.number for node in result.nodes if node.kind == "point"] == ["a"]


def test_ocr_corrupted_article_number_is_recovered_by_sequence() -> None:
    pages = [
        _page(
            "Điều 52. Thu hồi chi phí\n"
            "1. Việc thu hồi chi phí thực hiện theo thẩm quyền.\n"
            "Điều Sở. Trách nhiệm của các bên liên quan\n"
            "1. Cơ quan, tổ chức, cá nhân bị từ chối thanh toán."
        )
    ]
    result = parse_pages(pages)
    articles = [node.number for node in result.nodes if node.kind == "article"]
    assert articles == ["52", "53"]
    assert not result.warnings


def test_wrapped_reference_does_not_reopen_a_lower_numbered_clause() -> None:
    pages = [
        _page(
            "Điều 54. Thanh toán trực tiếp\n"
            "7. Trường hợp người tham gia khám bệnh trong thời gian thẻ bị thu hồi\n"
            "5. Điều 12 của Nghị định này mà không do lỗi của người tham gia."
        )
    ]
    result = parse_pages(pages)
    clauses = [node.number for node in result.nodes if node.kind == "clause"]
    assert clauses == ["7"]
