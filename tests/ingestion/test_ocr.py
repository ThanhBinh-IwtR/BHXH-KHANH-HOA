from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image
from pydantic import ValidationError

from ingestion.legal_ingestion.models import PageText
from ingestion.legal_ingestion.ocr import (
    OcrConfigurationError,
    OcrExecutionError,
    OcrLanguageError,
    OcrResult,
    OcrTimeoutError,
    TesseractOcrEngine,
    _data_from_tsv,
    _mean_word_confidence,
)


def test_page_text_enforces_ocr_provenance() -> None:
    with pytest.raises(ValidationError, match="ocr_confidence"):
        PageText(page_number=1, text="Điều 1", source="ocr", ocr_confidence=None)

    with pytest.raises(ValidationError, match="ocr_confidence"):
        PageText(page_number=1, text="Điều 1", source="text", ocr_confidence=90.0)

    with pytest.raises(ValidationError, match="replacement character"):
        PageText(
            page_number=1,
            text="Điều \ufffd",
            source="ocr",
            ocr_confidence=90.0,
        )


def test_tesseract_engine_rejects_missing_command() -> None:
    with patch("shutil.which", return_value=None):
        with pytest.raises(OcrConfigurationError, match="TESSERACT_CMD"):
            TesseractOcrEngine(command=None)


def test_tesseract_engine_rejects_zero_timeout() -> None:
    with (
        patch("shutil.which", return_value="tesseract"),
        patch(
            "ingestion.legal_ingestion.ocr.pytesseract.get_languages",
            return_value=["vie", "eng"],
        ),
    ):
        with pytest.raises(OcrConfigurationError, match="greater than zero"):
            TesseractOcrEngine(command="tesseract", timeout_seconds=0)


def test_tesseract_engine_verifies_vietnamese_and_english_languages() -> None:
    with (
        patch("shutil.which", return_value="tesseract"),
        patch(
            "ingestion.legal_ingestion.ocr.pytesseract.get_languages",
            return_value=["eng"],
        ),
    ):
        with pytest.raises(OcrLanguageError, match="vie"):
            TesseractOcrEngine(command="tesseract")


def test_tesseract_engine_maps_process_timeout_to_typed_error() -> None:
    engine = _verified_engine()
    image = Image.new("RGB", (16, 16), "white")

    with patch(
        "ingestion.legal_ingestion.ocr.pytesseract.image_to_data",
        side_effect=RuntimeError("Tesseract process timeout"),
    ):
        with pytest.raises(OcrTimeoutError, match="page 7"):
            engine.recognize(image, page_number=7)


def test_tesseract_engine_returns_text_and_mean_word_confidence() -> None:
    engine = _verified_engine()
    image = Image.new("RGB", (16, 16), "white")
    data = {
        "text": ["Điều", "1", "", "Nội", "dung"],
        "conf": ["92.0", "88.0", "-1", "80.0", "bad"],
        "block_num": [1, 1, 1, 1, 1],
        "par_num": [1, 1, 1, 1, 1],
        "line_num": [1, 1, 1, 2, 2],
    }

    with patch(
        "ingestion.legal_ingestion.ocr.pytesseract.image_to_data",
        return_value=data,
    ) as recognize:
        result = engine.recognize(image, page_number=1)

    assert result == OcrResult(
        text="Điều 1\nNội dung",
        mean_confidence=86.66666666666667,
    )
    assert recognize.call_args.kwargs["lang"] == "vie+eng"
    assert recognize.call_args.kwargs["config"] == "--oem 1 --psm 3"
    assert recognize.call_args.kwargs["timeout"] == 60


def test_mean_confidence_excludes_blank_form_fillers_but_keeps_words() -> None:
    data = {
        "text": ["Người", "bệnh", "...............", "□", "__/__/____", "2025"],
        "conf": ["90", "80", "10", "0", "5", "70"],
    }

    assert _mean_word_confidence(data) == 80.0


def test_tsv_parser_treats_quote_as_literal_ocr_text() -> None:
    tsv = (
        "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\t"
        "left\ttop\twidth\theight\tconf\ttext\r\n"
        "5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t91.0\t\"quyền\r\n"
        "5\t1\t1\t1\t1\t2\t2\t0\t1\t1\t92.0\txác\r\n"
    )

    data = _data_from_tsv(tsv)

    assert data["text"] == ['"quyền', "xác"]
    assert data["conf"] == ["91.0", "92.0"]


def test_tesseract_engine_rejects_replacement_character() -> None:
    engine = _verified_engine()
    image = Image.new("RGB", (16, 16), "white")
    data = {
        "text": ["Điều", "\ufffd"],
        "conf": ["92.0", "88.0"],
        "block_num": [1, 1],
        "par_num": [1, 1],
        "line_num": [1, 1],
    }

    with patch(
        "ingestion.legal_ingestion.ocr.pytesseract.image_to_data",
        return_value=data,
    ):
        with pytest.raises(OcrExecutionError, match="replacement character"):
            engine.recognize(image, page_number=4)


def test_tesseract_engine_uses_relative_tessdata_path_in_subprocess(
    tmp_path: Path,
) -> None:
    language_result = subprocess.CompletedProcess(
        args=[],
        returncode=0,
        stdout="List of available languages in ./ (2):\neng\nvie\n",
        stderr="",
    )
    ocr_result = subprocess.CompletedProcess(
        args=[],
        returncode=0,
        stdout=(
            "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\t"
            "left\ttop\twidth\theight\tconf\ttext\n"
            "5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t91.0\tĐiều\n"
        ),
        stderr="",
    )

    with (
        patch("shutil.which", return_value="tesseract"),
        patch(
            "ingestion.legal_ingestion.ocr.pytesseract.get_languages",
            return_value=["eng", "vie"],
        ),
        patch(
            "ingestion.legal_ingestion.ocr.subprocess.run",
            side_effect=[language_result, ocr_result],
        ) as run,
    ):
        engine = TesseractOcrEngine(
            command="tesseract",
            tessdata_prefix=str(tmp_path),
        )
        result = engine.recognize(
            Image.new("RGB", (16, 16), "white"),
            page_number=1,
        )

    assert result == OcrResult(text="Điều", mean_confidence=91.0)
    language_call, ocr_call = run.call_args_list
    assert language_call.kwargs["cwd"] == tmp_path
    assert language_call.args[0][-3:] == ["--tessdata-dir", ".", "--list-langs"]
    assert ocr_call.kwargs["cwd"] == tmp_path
    assert ocr_call.kwargs["timeout"] == 60
    assert ocr_call.kwargs["text"] is False
    assert "encoding" not in ocr_call.kwargs
    assert ocr_call.args[0][-6:] == [
        "--tessdata-dir",
        ".",
        "-c",
        "tessedit_create_tsv=1",
        "-c",
        "tessedit_create_txt=0",
    ]
    assert Path(ocr_call.args[0][1]).name == ocr_call.args[0][1]


def test_relative_tessdata_timeout_is_typed_and_removes_temp_image(
    tmp_path: Path,
) -> None:
    language_result = subprocess.CompletedProcess(
        args=[], returncode=0, stdout="eng\nvie\n", stderr=""
    )

    with (
        patch("shutil.which", return_value="tesseract"),
        patch(
            "ingestion.legal_ingestion.ocr.subprocess.run",
            side_effect=[
                language_result,
                subprocess.TimeoutExpired(cmd="tesseract", timeout=60),
            ],
        ),
    ):
        engine = TesseractOcrEngine(
            command="tesseract",
            tessdata_prefix=str(tmp_path),
        )
        with pytest.raises(OcrTimeoutError, match="page 8"):
            engine.recognize(Image.new("RGB", (16, 16), "white"), page_number=8)

    assert list(tmp_path.glob("*.png")) == []


def test_relative_tessdata_invalid_utf8_is_typed_and_removes_temp_image(
    tmp_path: Path,
) -> None:
    language_result = subprocess.CompletedProcess(
        args=[], returncode=0, stdout="eng\nvie\n", stderr=""
    )
    decode_error = UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte")

    with (
        patch("shutil.which", return_value="tesseract"),
        patch(
            "ingestion.legal_ingestion.ocr.subprocess.run",
            side_effect=[language_result, decode_error],
        ),
    ):
        engine = TesseractOcrEngine(
            command="tesseract",
            tessdata_prefix=str(tmp_path),
        )
        with pytest.raises(OcrExecutionError, match="invalid UTF-8.*page 9"):
            engine.recognize(Image.new("RGB", (16, 16), "white"), page_number=9)

    assert list(tmp_path.glob("*.png")) == []


def test_relative_tessdata_decodes_invalid_stdout_in_main_thread(
    tmp_path: Path,
) -> None:
    language_result = subprocess.CompletedProcess(
        args=[], returncode=0, stdout="eng\nvie\n", stderr=""
    )
    invalid_result = subprocess.CompletedProcess(
        args=[], returncode=0, stdout=b"\xff", stderr=b""
    )

    with (
        patch("shutil.which", return_value="tesseract"),
        patch(
            "ingestion.legal_ingestion.ocr.subprocess.run",
            side_effect=[language_result, invalid_result],
        ),
    ):
        engine = TesseractOcrEngine(
            command="tesseract",
            tessdata_prefix=str(tmp_path),
        )
        with pytest.raises(OcrExecutionError, match="invalid UTF-8.*page 10"):
            engine.recognize(Image.new("RGB", (16, 16), "white"), page_number=10)

    assert list(tmp_path.glob("*.png")) == []


def _verified_engine() -> TesseractOcrEngine:
    with (
        patch("shutil.which", return_value="tesseract"),
        patch(
            "ingestion.legal_ingestion.ocr.pytesseract.get_languages",
            return_value=["vie", "eng"],
        ),
    ):
        return TesseractOcrEngine(command="tesseract", timeout_seconds=60)
