from io import BytesIO

from PIL import Image
from pypdf import PdfWriter

from ingestion.multimodal import extract_elements


def test_text_file_becomes_linkable_elements():
    elements = extract_elements("notes.txt", b"A useful sentence. " * 100)

    assert len(elements) > 1
    assert all(element.id for element in elements)
    assert all(element.kind == "text" for element in elements)
    assert "useful sentence" in elements[0].content


def test_image_still_reaches_vision_when_cloud_ocr_is_not_configured(monkeypatch):
    image = BytesIO()
    Image.new("RGB", (80, 40), "white").save(image, "PNG")
    monkeypatch.setattr("ingestion.multimodal.cloud_ocr_configured", lambda: False)

    elements = extract_elements("scan.png", image.getvalue())

    assert [element.kind for element in elements] == ["image"]


def test_sparse_pdf_page_is_rendered_for_cloud_ocr_and_vision(monkeypatch):
    pdf = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.write(pdf)
    monkeypatch.setattr("ingestion.multimodal.cloud_ocr_configured", lambda: False)

    elements = extract_elements("scan.pdf", pdf.getvalue())

    assert any(element.kind == "image" and element.metadata["source"] == "rendered_page" for element in elements)
