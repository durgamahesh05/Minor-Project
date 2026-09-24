"""Extract retrieval elements while preserving their original payloads."""
import base64
from io import BytesIO
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from chunking.chunker import chunk_text
from ingestion.cloud_ocr import CloudOCRError, configured as cloud_ocr_configured, extract_text as cloud_ocr_text
from ingestion.file_router import IMAGE_EXTENSIONS, extract_text
from ingestion.image_reader import validate_image


@dataclass(frozen=True)
class ContentElement:
    id: str
    kind: str
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)


def _element(kind: str, content: str, **metadata: Any) -> ContentElement:
    return ContentElement(id=str(uuid.uuid4()), kind=kind, content=content, metadata=metadata)


def _normalized_image(content: bytes) -> tuple[str, str]:
    from PIL import Image, ImageOps

    with Image.open(BytesIO(content)) as image:
        normalized = ImageOps.exif_transpose(image).convert("RGB")
        normalized.thumbnail((1600, 1600))
        output = BytesIO()
        normalized.save(output, format="JPEG", quality=82, optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii"), "image/jpeg"


def _cloud_ocr_elements(image_b64: str, mime_type: str, page: int | None = None) -> list[ContentElement]:
    if not cloud_ocr_configured():
        return []
    try:
        text = cloud_ocr_text(base64.b64decode(image_b64), mime_type)
    except CloudOCRError:
        return []
    return [_element("text", chunk, page=page, source="cloud_ocr") for chunk in chunk_text(text)]


def _render_pdf_page(content: bytes, page_index: int):
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(content)
    try:
        return document[page_index].render(scale=2.0).to_pil()
    finally:
        document.close()


def _pdf_elements(content: bytes) -> list[ContentElement]:
    from pypdf import PdfReader

    results: list[ContentElement] = []
    for page_index, page in enumerate(PdfReader(BytesIO(content)).pages):
        page_number = page_index + 1
        text = (page.extract_text() or "").strip()
        results.extend(_element("text", chunk, page=page_number) for chunk in chunk_text(text))

        try:
            embedded_images = list(page.images)
        except Exception:
            embedded_images = []
        for image in embedded_images:
            try:
                image_b64, mime_type = _normalized_image(image.data)
            except Exception:
                continue
            results.append(_element("image", image_b64, page=page_number, mime_type=mime_type, source="embedded"))
            results.extend(_cloud_ocr_elements(image_b64, mime_type, page_number))

        # Sparse pages are usually scanned. Render only those pages and retain
        # the image so Groq vision can describe and retrieve its contents.
        if len(text) < 40:
            try:
                rendered = _render_pdf_page(content, page_index)
                output = BytesIO()
                rendered.convert("RGB").save(output, format="JPEG", quality=82, optimize=True)
                image_b64, mime_type = _normalized_image(output.getvalue())
                results.append(_element("image", image_b64, page=page_number, mime_type=mime_type, source="rendered_page"))
                results.extend(_cloud_ocr_elements(image_b64, mime_type, page_number))
            except (OSError, RuntimeError, ValueError):
                pass
    return results


def extract_elements(filename: str, content: bytes) -> list[ContentElement]:
    extension = Path(filename).suffix.lower()
    if extension == ".pdf":
        return _pdf_elements(content)

    if extension in IMAGE_EXTENSIONS:
        validate_image(content)
        image_b64, mime_type = _normalized_image(content)
        return [
            _element("image", image_b64, mime_type=mime_type, source="vision"),
            *_cloud_ocr_elements(image_b64, mime_type),
        ]

    text = extract_text(filename, content)
    return [_element("text", chunk) for chunk in chunk_text(text)]
