from __future__ import annotations

import unicodedata
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image

from ingestion.legal_ingestion.extract_pdf import (
    EmptyPdfError,
    OcrRequiredError,
    extract_pages,
    main,
    summarize_pages,
)
from ingestion.legal_ingestion.models import PageText
from ingestion.legal_ingestion.ocr import OcrExecutionError, OcrResult
from ingestion.legal_ingestion.quality import LowOcrConfidenceError


class _FakePage:
    def __init__(self, text: str | None) -> None:
        self._text = text

    def extract_text(self) -> str | None:
        return self._text


class _FakePdf:
    def __init__(self, texts: list[str | None]) -> None:
        self.pages = [_FakePage(text) for text in texts]

    def __enter__(self) -> "_FakePdf":
        return self

    def __exit__(self, *_args: object) -> None:
        return None


class _FakeOcrEngine:
    def __init__(self, result: OcrResult) -> None:
        self.result = result
        self.page_numbers: list[int] = []

    def recognize(self, image: Image.Image, *, page_number: int) -> OcrResult:
        self.page_numbers.append(page_number)
        assert image.size == (32, 24)
        return self.result


def test_extract_pages_preserves_page_mapping_line_breaks_and_nfc() -> None:
    decomposed = "Đie\u0302̀u 1. Phạm vi\n1. Nội dung"

    with patch("pdfplumber.open", return_value=_FakePdf([decomposed, "Trang 2"])):
        pages = extract_pages(Path("signed.pdf"))

    assert [page.page_number for page in pages] == [1, 2]
    assert pages[0].text == unicodedata.normalize("NFC", decomposed)
    assert "\n" in pages[0].text
    assert [page.source for page in pages] == ["text", "text"]
    assert [page.ocr_confidence for page in pages] == [None, None]


def test_extract_pages_uses_ocr_for_an_image_only_page() -> None:
    decomposed = "Đie\u0302̀u 2. Che\u0301 độ"
    engine = _FakeOcrEngine(
        OcrResult(text=decomposed, mean_confidence=88.5),
    )

    with (
        patch("pdfplumber.open", return_value=_FakePdf(["Điều 1", None])),
        patch(
            "ingestion.legal_ingestion.extract_pdf.render_pdf_page",
            return_value=Image.new("RGB", (32, 24), "white"),
        ) as render,
    ):
        pages = extract_pages(Path("signed.pdf"), ocr_engine=engine)

    assert pages[1].page_number == 2
    assert pages[1].text == unicodedata.normalize("NFC", decomposed)
    assert pages[1].source == "ocr"
    assert pages[1].ocr_confidence == 88.5
    assert engine.page_numbers == [2]
    render.assert_called_once_with(Path("signed.pdf"), page_index=1, dpi=300)


def test_extract_pages_requires_ocr_for_an_image_only_page() -> None:
    with patch("pdfplumber.open", return_value=_FakePdf(["Điều 1", None])):
        with pytest.raises(OcrRequiredError, match="page 2"):
            extract_pages(Path("signed.pdf"))


def test_extract_pages_rejects_replacement_character_from_ocr() -> None:
    engine = _FakeOcrEngine(
        OcrResult(text="Điều 2 \ufffd", mean_confidence=88.5),
    )

    with (
        patch("pdfplumber.open", return_value=_FakePdf([None])),
        patch(
            "ingestion.legal_ingestion.extract_pdf.render_pdf_page",
            return_value=Image.new("RGB", (32, 24), "white"),
        ),
    ):
        with pytest.raises(OcrExecutionError, match="replacement character"):
            extract_pages(Path("signed.pdf"), ocr_engine=engine)


def test_extract_pages_renders_real_image_only_pdf_with_pdfium(
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "image-only.pdf"
    Image.new("RGB", (80, 60), "white").save(pdf_path, format="PDF", resolution=72)
    engine = _RecordingOcrEngine(
        OcrResult(text="Điều 1. Phạm vi", mean_confidence=91.0),
    )

    pages = extract_pages(pdf_path, ocr_engine=engine)

    assert len(pages) == 1
    assert pages[0].source == "ocr"
    assert pages[0].ocr_confidence == 91.0
    assert engine.image_sizes[0][0] >= 300
    assert engine.page_numbers == [1]


def test_cli_fails_closed_when_ocr_confidence_is_below_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OCR_MIN_CONFIDENCE", "80")
    low_confidence_pages = [
        PageText(
            page_number=4,
            text="Điều 4",
            source="ocr",
            ocr_confidence=79.9,
        )
    ]

    with (
        patch("ingestion.legal_ingestion.extract_pdf.TesseractOcrEngine"),
        patch(
            "ingestion.legal_ingestion.extract_pdf.extract_pages",
            return_value=low_confidence_pages,
        ),
    ):
        with pytest.raises(LowOcrConfidenceError, match="page 4=79.90"):
            main(["signed.pdf", "--summary"])


def test_summary_reports_page_provenance_and_ocr_confidence() -> None:
    pages = [
        PageText(
            page_number=1,
            text="Điều 1",
            source="text",
            ocr_confidence=None,
        ),
        PageText(
            page_number=2,
            text="Điều 2",
            source="ocr",
            ocr_confidence=80.0,
        ),
        PageText(
            page_number=3,
            text="Điều 3",
            source="ocr",
            ocr_confidence=90.0,
        ),
    ]

    assert summarize_pages(pages) == (
        "pages=3 characters=18 text_pages=1 ocr_pages=2 "
        "min_ocr_confidence=80.00 mean_ocr_confidence=85.00"
    )


@pytest.mark.parametrize("page_texts", [[]])
def test_extract_pages_rejects_documents_without_text(
    page_texts: list[str | None],
) -> None:
    with patch("pdfplumber.open", return_value=_FakePdf(page_texts)):
        with pytest.raises(EmptyPdfError, match="no pages"):
            extract_pages(Path("empty.pdf"))


class _RecordingOcrEngine:
    def __init__(self, result: OcrResult) -> None:
        self.result = result
        self.image_sizes: list[tuple[int, int]] = []
        self.page_numbers: list[int] = []

    def recognize(self, image: Image.Image, *, page_number: int) -> OcrResult:
        self.image_sizes.append(image.size)
        self.page_numbers.append(page_number)
        return self.result
