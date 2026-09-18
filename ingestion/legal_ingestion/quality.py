from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Sequence

from .models import PageText


class OcrQualityError(RuntimeError):
    """Base class for OCR publication quality failures."""


class OcrQualityConfigurationError(OcrQualityError):
    """The configured OCR confidence threshold is invalid."""


@dataclass(frozen=True)
class OcrConfidenceFailure:
    page_number: int
    confidence: float


@dataclass(frozen=True)
class OcrConfidenceReport:
    threshold: float
    failures: tuple[OcrConfidenceFailure, ...]


class LowOcrConfidenceError(OcrQualityError):
    def __init__(self, report: OcrConfidenceReport) -> None:
        self.threshold = report.threshold
        self.failures = report.failures
        details = ", ".join(
            f"page {failure.page_number}={failure.confidence:.2f}"
            for failure in self.failures
        )
        super().__init__(
            f"OCR confidence below threshold {self.threshold:.2f}: {details}"
        )


def read_minimum_ocr_confidence() -> float:
    raw_value = os.getenv("OCR_MIN_CONFIDENCE", "75.0")
    try:
        value = float(raw_value)
    except ValueError as error:
        raise OcrQualityConfigurationError(
            "OCR_MIN_CONFIDENCE must be a number from 0 to 100"
        ) from error
    return _validate_threshold(value)


def enforce_ocr_confidence(
    pages: Sequence[PageText],
    *,
    minimum_confidence: float | None = None,
) -> OcrConfidenceReport:
    threshold = (
        read_minimum_ocr_confidence()
        if minimum_confidence is None
        else _validate_threshold(minimum_confidence)
    )
    failures = tuple(
        OcrConfidenceFailure(
            page_number=page.page_number,
            confidence=page.ocr_confidence,
        )
        for page in pages
        if page.source == "ocr"
        and page.ocr_confidence is not None
        and page.ocr_confidence < threshold
    )
    report = OcrConfidenceReport(threshold=threshold, failures=failures)
    if failures:
        raise LowOcrConfidenceError(report)
    return report


def _validate_threshold(value: float) -> float:
    if not math.isfinite(value) or value < 0 or value > 100:
        raise OcrQualityConfigurationError(
            "OCR_MIN_CONFIDENCE must be a finite number from 0 to 100"
        )
    return value
