from io import BytesIO
import base64

import pytest

from PIL import Image
from pypdf import PdfWriter

from ingestion.multimodal import _normalized_image, extract_elements


@pytest.mark.parametrize("size, expected", [
    ((1, 1), (32, 32)),
    ((12, 80), (32, 80)),
    ((80, 12), (80, 32)),
    ((3200, 32), (1600, 32)),
    ((32, 3200), (32, 1600)),
    ((32, 32), (32, 32)),
    ((80, 40), (80, 40)),
])
def test_normalized_images_meet_vision_dimensions(size, expected):
    source = BytesIO()
    Image.new("RGB", size, "black").save(source, "PNG")

    encoded, mime_type = _normalized_image(source.getvalue())

    assert mime_type == "image/jpeg"
    with Image.open(BytesIO(base64.b64decode(encoded))) as image:
        assert image.size == expected
        assert image.format == "JPEG"
        pixel = image.getpixel(((image.width - 1) // 2, (image.height - 1) // 2))
        assert isinstance(pixel, tuple)
        assert max(pixel) < 30


def test_text_file_becomes_linkable_elements():
    elements = extract_elements("notes.txt", b"A useful sentence. " * 100)

    assert len(elements) > 1
    assert all(element.id for element in elements)
    assert all(element.kind == "text" for element in elements)
    assert "useful sentence" in elements[0].content


def test_image_is_retained_for_vision_when_local_ocr_is_empty(monkeypatch):
    image = BytesIO()
    Image.new("RGB", (80, 40), "white").save(image, "PNG")
    monkeypatch.setattr("ingestion.multimodal.extract_image_text", lambda content: "")

    elements = extract_elements("scan.png", image.getvalue())

    assert [element.kind for element in elements] == ["image"]


def test_sparse_pdf_page_is_rendered_for_ocr_and_vision(monkeypatch):
    pdf = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.write(pdf)
    monkeypatch.setattr("ingestion.multimodal.extract_image_text", lambda content: "")

    elements = extract_elements("scan.pdf", pdf.getvalue())

    assert any(element.kind == "image" and element.metadata["source"] == "rendered_page" for element in elements)


def test_pdf_ocr_preserves_image_fallback(monkeypatch):
    from ingestion import multimodal
    monkeypatch.setattr(multimodal, "extract_image_text", lambda content: "")
    image = multimodal._element("image", "YQ==", page=1, mime_type="image/jpeg")
    assert multimodal._append_pdf_ocr([image]) == [image]


def test_scanned_pdf_opens_renderer_once(monkeypatch):
    import pypdfium2
    from unittest.mock import Mock

    content = BytesIO()
    writer = PdfWriter()
    for _ in range(3):
        writer.add_blank_page(width=100, height=100)
    writer.write(content)
    constructor = Mock(wraps=pypdfium2.PdfDocument)
    monkeypatch.setattr(pypdfium2, "PdfDocument", constructor)
    monkeypatch.setattr("ingestion.multimodal.extract_image_text", lambda content: "")
    elements = extract_elements("scan.pdf", content.getvalue())
    assert len([element for element in elements if element.kind == "image"]) == 3
    constructor.assert_called_once()


def test_repeated_pdf_images_are_ocr_scanned_once(monkeypatch):
    from ingestion import multimodal
    calls = []
    monkeypatch.setattr(multimodal, "extract_image_text", lambda content: calls.append(content) or "Logo text")
    images = [multimodal._element("image", "YQ==", page=page, mime_type="image/jpeg") for page in (1, 2, 3)]
    results = multimodal._append_pdf_ocr(images)
    assert len(calls) == 1
    ocr = [element for element in results if element.kind == "text"]
    assert [element.metadata["page"] for element in ocr] == [1, 2, 3]
    assert len({element.id for element in ocr}) == 3


def test_decorative_images_are_skipped_but_regular_images_are_kept():
    from ingestion import multimodal
    line = BytesIO()
    Image.new("RGB", (400, 2), "black").save(line, "PNG")
    with pytest.raises(ValueError):
        multimodal._normalized_image(line.getvalue(), skip_decorative=True)
    # Standalone image uploads still accept any size.
    assert multimodal._normalized_image(line.getvalue())[1] == "image/jpeg"
