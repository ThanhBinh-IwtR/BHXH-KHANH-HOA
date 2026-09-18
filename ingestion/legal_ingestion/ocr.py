from __future__ import annotations

import csv
import io
import os
import shutil
import subprocess
import tempfile
import unicodedata
from collections import OrderedDict
from pathlib import Path
from typing import Protocol

import pytesseract
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, field_validator


class OcrError(RuntimeError):
    """Base class for errors at the local OCR boundary."""


class OcrConfigurationError(OcrError):
    """The local OCR executable or configuration is unavailable."""


class OcrLanguageError(OcrConfigurationError):
    """One or more required OCR languages are not installed."""


class OcrTimeoutError(OcrError):
    """OCR exceeded its finite per-page time budget."""


class OcrExecutionError(OcrError):
    """Tesseract failed for a reason other than a timeout."""


class OcrResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    text: str
    mean_confidence: float = Field(ge=0, le=100)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return unicodedata.normalize("NFC", value)


class OcrEngine(Protocol):
    def recognize(self, image: Image.Image, *, page_number: int) -> OcrResult: ...


class TesseractOcrEngine:
    """Workspace-local Tesseract 5 adapter with a finite page timeout."""

    def __init__(
        self,
        *,
        command: str | None = None,
        tessdata_prefix: str | None = None,
        timeout_seconds: int | None = None,
        languages: str = "vie+eng",
    ) -> None:
        configured_command = command or os.getenv("TESSERACT_CMD") or "tesseract"
        resolved_command = shutil.which(configured_command)
        if resolved_command is None and Path(configured_command).is_file():
            resolved_command = str(Path(configured_command).resolve())
        if resolved_command is None:
            raise OcrConfigurationError(
                "Tesseract was not found; set TESSERACT_CMD to the local executable"
            )

        self._command = resolved_command
        self._languages = languages
        self._timeout_seconds = (
            timeout_seconds
            if timeout_seconds is not None
            else _positive_int_from_env("OCR_PAGE_TIMEOUT_SECONDS", default=60)
        )
        if self._timeout_seconds <= 0:
            raise OcrConfigurationError("OCR page timeout must be greater than zero")

        configured_tessdata = tessdata_prefix or os.getenv("TESSDATA_PREFIX")
        self._tessdata_directory = (
            Path(configured_tessdata).resolve() if configured_tessdata else None
        )
        if self._tessdata_directory and not self._tessdata_directory.is_dir():
            raise OcrConfigurationError(
                f"TESSDATA_PREFIX is not a directory: {self._tessdata_directory}"
            )
        pytesseract.pytesseract.tesseract_cmd = self._command
        try:
            if self._tessdata_directory:
                language_process = subprocess.run(
                    [
                        self._command,
                        "--tessdata-dir",
                        ".",
                        "--list-langs",
                    ],
                    cwd=self._tessdata_directory,
                    capture_output=True,
                    text=False,
                    timeout=self._timeout_seconds,
                    check=False,
                )
                if language_process.returncode != 0:
                    raise OcrConfigurationError(
                        "Unable to inspect Tesseract languages: "
                        + _decode_stderr(language_process.stderr)
                    )
                language_output = _decode_utf8(
                    language_process.stdout,
                    context="while listing Tesseract languages",
                )
                installed_languages = {
                    line.strip()
                    for line in language_output.splitlines()
                    if line.strip() in {"vie", "eng"}
                }
            else:
                installed_languages = set(pytesseract.get_languages(config=""))
        except UnicodeDecodeError as error:
            raise OcrExecutionError(
                "Tesseract emitted invalid UTF-8 while listing languages"
            ) from error
        except subprocess.TimeoutExpired as error:
            raise OcrConfigurationError(
                "Timed out while inspecting Tesseract languages"
            ) from error
        except pytesseract.TesseractNotFoundError as error:
            raise OcrConfigurationError(
                f"Tesseract executable is not runnable: {self._command}"
            ) from error
        except RuntimeError as error:
            raise OcrConfigurationError(
                f"Unable to inspect Tesseract languages: {error}"
            ) from error

        required_languages = set(self._languages.split("+"))
        missing = sorted(required_languages - installed_languages)
        if missing:
            raise OcrLanguageError(
                "Missing required Tesseract language data: " + ", ".join(missing)
            )

    def recognize(self, image: Image.Image, *, page_number: int) -> OcrResult:
        if self._tessdata_directory:
            return self._recognize_with_relative_tessdata(
                image,
                page_number=page_number,
            )

        config = "--oem 1 --psm 3"

        try:
            data = pytesseract.image_to_data(
                image,
                lang=self._languages,
                config=config,
                timeout=self._timeout_seconds,
                output_type=pytesseract.Output.DICT,
            )
        except RuntimeError as error:
            if "timeout" in str(error).casefold():
                raise OcrTimeoutError(
                    f"OCR timed out on page {page_number} after "
                    f"{self._timeout_seconds} seconds"
                ) from error
            raise OcrExecutionError(
                f"OCR failed on page {page_number}: {error}"
            ) from error

        text = validate_ocr_text(
            _text_from_tesseract_data(data),
            page_number=page_number,
        )
        confidence = _mean_word_confidence(data)
        return OcrResult(text=text, mean_confidence=confidence)

    def _recognize_with_relative_tessdata(
        self,
        image: Image.Image,
        *,
        page_number: int,
    ) -> OcrResult:
        assert self._tessdata_directory is not None
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                suffix=".png",
                dir=self._tessdata_directory,
                delete=False,
            ) as image_file:
                temporary_path = Path(image_file.name)
                image.save(image_file, format="PNG")

            process = subprocess.run(
                [
                    self._command,
                    temporary_path.name,
                    "stdout",
                    "-l",
                    self._languages,
                    "--oem",
                    "1",
                    "--psm",
                    "3",
                    "--tessdata-dir",
                    ".",
                    "-c",
                    "tessedit_create_tsv=1",
                    "-c",
                    "tessedit_create_txt=0",
                ],
                cwd=self._tessdata_directory,
                capture_output=True,
                text=False,
                timeout=self._timeout_seconds,
                check=False,
            )
        except UnicodeDecodeError as error:
            raise OcrExecutionError(
                f"Tesseract emitted invalid UTF-8 on page {page_number}"
            ) from error
        except subprocess.TimeoutExpired as error:
            raise OcrTimeoutError(
                f"OCR timed out on page {page_number} after "
                f"{self._timeout_seconds} seconds"
            ) from error
        except OSError as error:
            raise OcrExecutionError(f"OCR failed on page {page_number}: {error}") from error
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

        if process.returncode != 0:
            raise OcrExecutionError(
                f"OCR failed on page {page_number}: "
                f"{_decode_stderr(process.stderr)}"
            )
        output = _decode_utf8(
            process.stdout,
            context=f"on page {page_number}",
        )
        data = _data_from_tsv(output)
        return OcrResult(
            text=validate_ocr_text(
                _text_from_tesseract_data(data),
                page_number=page_number,
            ),
            mean_confidence=_mean_word_confidence(data),
        )


def validate_ocr_text(text: str, *, page_number: int) -> str:
    if "\ufffd" in text:
        raise OcrExecutionError(
            f"OCR text contains a Unicode replacement character on page {page_number}"
        )
    return text


def _positive_int_from_env(name: str, *, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as error:
        raise OcrConfigurationError(f"{name} must be an integer") from error


def _decode_utf8(value: bytes | str, *, context: str) -> str:
    if isinstance(value, str):
        return value
    try:
        return value.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise OcrExecutionError(
            f"Tesseract emitted invalid UTF-8 {context}"
        ) from error


def _decode_stderr(value: bytes | str) -> str:
    if isinstance(value, str):
        return value.strip()
    return value.decode("utf-8", errors="backslashreplace").strip()


def _data_from_tsv(tsv: str) -> dict[str, list[object]]:
    data: dict[str, list[object]] = {
        "text": [],
        "conf": [],
        "block_num": [],
        "par_num": [],
        "line_num": [],
    }
    for row in csv.DictReader(
        io.StringIO(tsv),
        delimiter="\t",
        quoting=csv.QUOTE_NONE,
    ):
        for field in data:
            data[field].append(row.get(field, ""))
    return data


def _text_from_tesseract_data(data: dict[str, list[object]]) -> str:
    lines: OrderedDict[tuple[object, object, object], list[str]] = OrderedDict()
    rows = zip(
        data.get("text", []),
        data.get("block_num", []),
        data.get("par_num", []),
        data.get("line_num", []),
    )
    for raw_text, block, paragraph, line in rows:
        word = str(raw_text).strip()
        if word:
            lines.setdefault((block, paragraph, line), []).append(word)
    return "\n".join(" ".join(words) for words in lines.values())


def _mean_word_confidence(data: dict[str, list[object]]) -> float:
    confidences: list[float] = []
    for raw_text, raw_confidence in zip(
        data.get("text", []), data.get("conf", [])
    ):
        token = str(raw_text).strip()
        if not token or not any(character.isalnum() for character in token):
            continue
        try:
            confidence = float(raw_confidence)
        except (TypeError, ValueError):
            continue
        if confidence >= 0:
            confidences.append(confidence)
    return sum(confidences) / len(confidences) if confidences else 0.0
