from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from docx import Document

from ingestion.doc_reader import read_doc
from ingestion.file_router import SUPPORTED_EXTENSIONS, extract_text, upload_config
from ingestion.multimodal import extract_elements

FIXTURE = Path(__file__).parent / "fixtures" / "sample.doc"


def test_legacy_word_doc_text_tables_unicode_and_fields():
    # sample.doc was saved by Microsoft Word in Word 97-2003 format.
    text = extract_text("notes.doc", FIXTURE.read_bytes())
    assert text.startswith("Photosynthesis converts light energy into chemical energy.")
    assert "café — “quotes” and Ελλ." in text
    assert "Term\tDefinition\nChlorophyll\tGreen pigment" in text
    # A field keeps its displayed result and drops the instruction code.
    assert "1 is the page number. Final paragraph here." in text
    assert "PAGE" not in text
    # Headers are not part of the main document text.
    assert "HEADER TEXT" not in text


def test_legacy_word_doc_is_indexed_as_text_elements():
    elements = extract_elements("notes.DOC", FIXTURE.read_bytes())
    assert elements and all(element.kind == "text" for element in elements)


def test_docx_saved_with_doc_extension():
    document = Document()
    document.add_paragraph("Renamed Word file")
    content = BytesIO()
    document.save(content)
    assert read_doc(content.getvalue()) == "Renamed Word file"


def test_rtf_text_symbols_and_code_pages():
    rtf = (rb"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Arial;}{\f1\fcharset161 Greek;}}"
           rb"{\info{\title Hidden}}Caf\'e9 \emdash  ok\par {\f1 \'c5\'eb}\par \u8364?5}")
    assert extract_text("notes.rtf", rtf) == "Café — ok\nΕλ\n€5"


def test_invalid_word_file_is_rejected():
    with pytest.raises(ValueError):
        extract_text("notes.doc", b"not a word document")


def test_upload_config_lists_word_formats():
    config = upload_config()
    assert {".doc", ".docx", ".rtf"} <= set(config["extensions"])
    assert set(config["extensions"]) == SUPPORTED_EXTENSIONS
    assert "Word" in config["formats"]
    assert config["maxFileSizeBytes"] == config["maxFileSizeMb"] * 1024 * 1024


def test_upload_config_endpoint_is_public():
    with patch("pymongo.MongoClient"):
        import main
    from fastapi.testclient import TestClient

    response = TestClient(main.app).get("/api/documents/config")
    assert response.status_code == 200
    assert ".doc" in response.json()["extensions"]
