from __future__ import annotations

import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


NodeKind = Literal[
    "chapter",
    "section",
    "article",
    "clause",
    "point",
    "paragraph",
    "appendix",
]


class _FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True)


class PageText(_FrozenModel):
    page_number: int = Field(ge=1)
    text: str
    source: Literal["text", "ocr"]
    ocr_confidence: float | None = Field(default=None, ge=0, le=100)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        if "\ufffd" in value:
            raise ValueError("text contains a Unicode replacement character")
        return unicodedata.normalize("NFC", value)

    @model_validator(mode="after")
    def validate_provenance(self) -> "PageText":
        if self.source == "ocr" and self.ocr_confidence is None:
            raise ValueError("ocr_confidence is required when source is ocr")
        if self.source == "text" and self.ocr_confidence is not None:
            raise ValueError("ocr_confidence must be null when source is text")
        return self


class LegalNode(_FrozenModel):
    node_id: str
    kind: NodeKind
    number: str | None
    title: str | None
    text: str
    page_from: int = Field(ge=1)
    page_to: int = Field(ge=1)
    parent_id: str | None

    @field_validator("title", "text")
    @classmethod
    def normalize_vietnamese_text(cls, value: str | None) -> str | None:
        return unicodedata.normalize("NFC", value) if value is not None else None

    @model_validator(mode="after")
    def validate_page_range(self) -> "LegalNode":
        if self.page_to < self.page_from:
            raise ValueError("page_to must be greater than or equal to page_from")
        return self


class ParseWarning(_FrozenModel):
    code: Literal["orphan_clause", "orphan_point"]
    message: str
    page_number: int = Field(ge=1)
    line_number: int = Field(ge=1)
    line: str


class ParseResult(_FrozenModel):
    nodes: tuple[LegalNode, ...]
    warnings: tuple[ParseWarning, ...]
