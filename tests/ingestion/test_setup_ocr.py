from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).parents[2]


def test_setup_script_pins_and_verifies_tesseract_version() -> None:
    script = (ROOT / "ingestion" / "scripts" / "setup_ocr.ps1").read_text(
        encoding="utf-8"
    )

    assert '"tesseract=5.5.2"' in script
    assert "--override-channels" in script
    assert "--version" in script
    assert "tesseract 5.5.2" in script


def test_environment_example_does_not_advertise_fixed_ocr_settings() -> None:
    environment = (ROOT / ".env.example").read_text(encoding="utf-8")

    assert "OCR_LANG=" not in environment
    assert "OCR_DPI=" not in environment
