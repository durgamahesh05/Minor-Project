import pytest

from ingestion.file_router import UnsupportedFileType, extract_text


def test_txt_extraction():
    assert extract_text("notes.txt", b"hello\nworld") == "hello\nworld"


def test_unsupported_extension():
    with pytest.raises(UnsupportedFileType):
        extract_text("archive.zip", b"data")
