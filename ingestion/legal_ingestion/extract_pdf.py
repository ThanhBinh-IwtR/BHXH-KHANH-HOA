from __future__ import annotations

import argparse
import unicodedata
from pathlib import Path
from typing import Sequence

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image

from .models import PageText
from .ocr import OcrEngine, TesseractOcrEngine, validate_ocr_text
from .quality import enforce_ocr_confidence


class PdfExtractionError(RuntimeError):
    """Base class for page-aware PDF extraction errors."""


class EmptyPdfError(PdfExtractionError):
    """The PDF contains no pages."""


class OcrRequiredError(PdfExtractionError):
    """An image-only page was found without an OCR engine."""


class EmptyPageExtractionError(PdfExtractionError):
    """Neither text extraction nor OCR produced page content."""


def extract_pages(
    path: Path,
    ocr_engine: OcrEngine | None = None,
) -> list[PageText]:
    """Extract NFC-normalized text while retaining every one-based PDF page."""
    with pdfplumber.open(path) as document:
        if not document.pages:
            raise EmptyPdfError(f"PDF has no pages: {path}")

        pages: list[PageText] = []
        for index, page in enumerate(document.pages, start=1):
            extracted_text = unicodedata.normalize("NFC", page.extract_text() or "")
            if extracted_text.strip():
                pages.append(
                    PageText(
                        page_number=index,
                        text=extracted_text,
                        source="text",
                        ocr_confidence=None,
                    )
                )
                continue

            if ocr_engine is None:
                raise OcrRequiredError(
                    f"Image-only page {index} requires a local OCR engine: {path}"
                )
            image = render_pdf_page(path, page_index=index - 1, dpi=300)
            ocr_result = ocr_engine.recognize(image, page_number=index)
            ocr_text = validate_ocr_text(ocr_result.text, page_number=index)
            if not ocr_text.strip():
                raise EmptyPageExtractionError(
                    f"OCR produced no text for page {index}: {path}"
                )
            pages.append(
                PageText(
                    page_number=index,
                    text=ocr_text,
                    source="ocr",
                    ocr_confidence=ocr_result.mean_confidence,
                )
            )

    return pages


def render_pdf_page(path: Path, *, page_index: int, dpi: int) -> Image.Image:
    """Render one PDF page to a detached PIL image for local OCR."""
    with pdfium.PdfDocument(path) as document:
        page = document[page_index]
        try:
            bitmap = page.render(scale=dpi / 72)
            try:
                return bitmap.to_pil().copy()
            finally:
                bitmap.close()
        finally:
            page.close()


def summarize_pages(pages: Sequence[PageText]) -> str:
    """Return concise extraction evidence without emitting legal source text."""
    ocr_confidences = [
        page.ocr_confidence
        for page in pages
        if page.source == "ocr" and page.ocr_confidence is not None
    ]
    text_page_count = sum(page.source == "text" for page in pages)
    character_count = sum(len(page.text) for page in pages)
    if ocr_confidences:
        minimum_confidence = f"{min(ocr_confidences):.2f}"
        mean_confidence = f"{sum(ocr_confidences) / len(ocr_confidences):.2f}"
    else:
        minimum_confidence = "n/a"
        mean_confidence = "n/a"
    return (
        f"pages={len(pages)} characters={character_count} "
        f"text_pages={text_page_count} ocr_pages={len(ocr_confidences)} "
        f"min_ocr_confidence={minimum_confidence} "
        f"mean_ocr_confidence={mean_confidence}"
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract text from a legal PDF")
    parser.add_argument("path", type=Path)
    parser.add_argument(
        "--summary",
        action="store_true",
        help="print page and character counts without writing files",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    pages = extract_pages(args.path, ocr_engine=TesseractOcrEngine())
    enforce_ocr_confidence(pages)
    if args.summary:
        print(summarize_pages(pages))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
