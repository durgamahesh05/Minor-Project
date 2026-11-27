"""Extract retrieval elements while preserving their original payloads."""
import base64
import logging
from contextlib import ExitStack
from hashlib import sha256
from io import BytesIO
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from chunking.chunker import chunk_text
from ingestion.file_router import IMAGE_EXTENSIONS, extract_text
from ingestion.image_reader import extract_image_text, validate_image

logger = logging.getLogger(__name__)


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
        # Groq requires at least 32 pixels on both axes. PDF decorations
        # can be tiny, and thumbnailing can also shrink narrow images below 32.
        if min(normalized.size) < 32:
            canvas = Image.new("RGB", (max(32, normalized.width), max(32, normalized.height)), "white")
            canvas.paste(normalized, ((canvas.width - normalized.width) // 2, (canvas.height - normalized.height) // 2))
            normalized = canvas
        output = BytesIO()
        normalized.save(output, format="JPEG", quality=82, optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii"), "image/jpeg"


def _local_ocr_elements(image_b64: str, page: int | None = None) -> list[ContentElement]:
    try:
        text = extract_image_text(base64.b64decode(image_b64))
    except Exception as error:
        logger.warning("Local OCR failed (%s)", type(error).__name__)
        return []
    return [_element("text", chunk, page=page, source="rapidocr") for chunk in chunk_text(text)] if text else []


def _render_pdf_page(content: bytes, page_index: int, document=None):
    import pypdfium2 as pdfium

    owns_document = document is None
    if document is None:
        document = pdfium.PdfDocument(content)
    page = document[page_index]
    try:
        bitmap = page.render(scale=2)
        try:
            # Detach from PDFium memory before releasing the bitmap/page.
            return bitmap.to_pil().copy()
        finally:
            bitmap.close()
    finally:
        page.close()
        if owns_document:
            document.close()


def _append_pdf_ocr(elements: list[ContentElement]) -> list[ContentElement]:
    results = []
    for element in elements:
        results.append(element)
        if element.kind == "image":
            results.extend(_local_ocr_elements(element.content, page=element.metadata.get("page")))
    return results


def _pdf_elements(content: bytes) -> list[ContentElement]:
    from pypdf import PdfReader

    results: list[ContentElement] = []
    image_cache: dict[bytes, tuple[str, str]] = {}
    with ExitStack() as cleanup:
        rendered_document = None
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
                    data = image.data
                    key = sha256(data).digest()
                    if key not in image_cache:
                        image_cache[key] = _normalized_image(data)
                    image_b64, mime_type = image_cache[key]
                except Exception:
                    continue
                results.append(_element("image", image_b64, page=page_number, mime_type=mime_type, source="embedded"))

            # Reuse the PDFium document for all sparse/scanned pages.
            if not text:
                try:
                    if rendered_document is None:
                        import pypdfium2 as pdfium
                        rendered_document = pdfium.PdfDocument(content)
                        cleanup.callback(rendered_document.close)
                    with _render_pdf_page(content, page_index, rendered_document) as rendered:
                        output = BytesIO()
                        rendered.convert("RGB").save(output, format="JPEG", quality=82, optimize=True)
                    image_b64, mime_type = _normalized_image(output.getvalue())
                    results.append(_element("image", image_b64, page=page_number, mime_type=mime_type, source="rendered_page"))
                except (OSError, RuntimeError, ValueError):
                    pass
    return _append_pdf_ocr(results)


def extract_elements(filename: str, content: bytes) -> list[ContentElement]:
    if len(content) > 10 * 1024 * 1024:
        raise ValueError("File too large (10MB maximum)")
    extension = Path(filename).suffix.lower()
    if extension == ".pdf":
        return _pdf_elements(content)

    if extension in IMAGE_EXTENSIONS:
        validate_image(content)
        image_b64, mime_type = _normalized_image(content)
        return [
            _element("image", image_b64, mime_type=mime_type, source="vision"),
            *_local_ocr_elements(image_b64),
        ]

    text = extract_text(filename, content)
    elements = [_element("text", chunk) for chunk in chunk_text(text)]
    if extension == ".docx":
        from docx import Document
        document = Document(BytesIO(content))
        package = document.part.package
        if package is not None:
            for part in package.iter_parts():
                if not part.content_type.startswith("image/") or not str(part.partname).startswith("/word/media/"):
                    continue
                try:
                    image_b64, mime_type = _normalized_image(part.blob)
                except (OSError, ValueError):
                    continue
                elements.append(_element("image", image_b64, mime_type=mime_type, source="embedded"))
                elements.extend(_local_ocr_elements(image_b64))
    return elements
