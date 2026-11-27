from io import BytesIO
import sys
from types import SimpleNamespace
from typing import Any

from PIL import Image

from ingestion import image_reader


def test_local_ocr_extracts_image_text(monkeypatch):
    class FakeRapidOCR:
        def __call__(self, image: Any):
            assert image.shape[2] == 3
            return [([0, 0, 1, 1], "Detected text", 0.99)], None

    monkeypatch.setitem(sys.modules, "rapidocr_onnxruntime", SimpleNamespace(RapidOCR=FakeRapidOCR))
    monkeypatch.setattr(image_reader, "_ocr_engine", None)
    source = BytesIO()
    Image.new("RGB", (40, 40), "white").save(source, "PNG")

    assert image_reader.extract_image_text(source.getvalue()) == "Detected text"
