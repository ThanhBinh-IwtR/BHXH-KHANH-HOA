from __future__ import annotations

import pytest

from ingestion.legal_ingestion.models import PageText
from ingestion.legal_ingestion.quality import (
    LowOcrConfidenceError,
    OcrQualityConfigurationError,
    enforce_ocr_confidence,
    read_minimum_ocr_confidence,
)


@pytest.mark.parametrize("value", ["not-a-number", "-0.1", "100.1", "nan", "inf"])
def test_minimum_ocr_confidence_rejects_invalid_environment(
    monkeypatch: pytest.MonkeyPatch,
    value: str,
) -> None:
    monkeypatch.setenv("OCR_MIN_CONFIDENCE", value)

    with pytest.raises(OcrQualityConfigurationError, match="OCR_MIN_CONFIDENCE"):
        read_minimum_ocr_confidence()


def test_confidence_gate_defaults_to_75_and_reports_failing_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OCR_MIN_CONFIDENCE", raising=False)
    pages = [
        PageText(page_number=1, text="Điều 1", source="ocr", ocr_confidence=74.9),
        PageText(page_number=2, text="Điều 2", source="ocr", ocr_confidence=75.0),
        PageText(page_number=3, text="Điều 3", source="ocr", ocr_confidence=60.0),
    ]

    with pytest.raises(LowOcrConfidenceError) as captured:
        enforce_ocr_confidence(pages)

    assert captured.value.threshold == 75.0
    assert [failure.page_number for failure in captured.value.failures] == [1, 3]
    assert [failure.confidence for failure in captured.value.failures] == [74.9, 60.0]
    assert "page 1=74.90" in str(captured.value)
    assert "page 3=60.00" in str(captured.value)


def test_confidence_gate_accepts_pages_at_threshold() -> None:
    pages = [
        PageText(page_number=1, text="Điều 1", source="text", ocr_confidence=None),
        PageText(page_number=2, text="Điều 2", source="ocr", ocr_confidence=80.0),
    ]

    report = enforce_ocr_confidence(pages, minimum_confidence=80.0)

    assert report.threshold == 80.0
    assert report.failures == ()
