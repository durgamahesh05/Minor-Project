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
from ingestion.file_router import FILE_TOO_LARGE, IMAGE_EXTENSIONS, MAX_FILE_SIZE, extract_text
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


# Spacer lines and bullet dots carry no content but would each cost a vision request and OCR.
MIN_EMBEDDED_IMAGE_SIDE = 8


class _DecorativeImage(ValueError):
    pass


def _normalized_image(content: bytes, skip_decorative: bool = False) -> tuple[str, str]:
    from PIL import Image, ImageOps

    with Image.open(BytesIO(content)) as image:
        if skip_decorative and min(image.size) < MIN_EMBEDDED_IMAGE_SIDE:
            raise _DecorativeImage("Decorative image")
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


def _local_ocr_elements(image_b64: str, page: int | None = None, cache: dict[str, str] | None = None) -> list[ContentElement]:
    # Repeated logos/figures are OCR'd once per upload; each copy still gets its own elements.
    if cache is not None and image_b64 in cache:
        text = cache[image_b64]
    else:
        try:
            text = extract_image_text(base64.b64decode(image_b64))
        except Exception as error:
            logger.warning("Local OCR failed (%s)", type(error).__name__)
            text = ""
        if cache is not None:
            cache[image_b64] = text
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
    ocr_cache: dict[str, str] = {}
    for element in elements:
        results.append(element)
        if element.kind == "image":
            results.extend(_local_ocr_elements(element.content, page=element.metadata.get("page"), cache=ocr_cache))
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
                        image_cache[key] = _normalized_image(data, skip_decorative=True)
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
    if len(content) > MAX_FILE_SIZE:
        raise ValueError(FILE_TOO_LARGE)
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

    if extension == ".docx":
        return _docx_elements(content)
    return [_element("text", chunk) for chunk in chunk_text(extract_text(filename, content))]


def _docx_elements(content: bytes) -> list[ContentElement]:
    from docx import Document
    from ingestion.docx_reader import docx_text

    # Parse the package once for both text and embedded images.
    document = Document(BytesIO(content))
    elements = [_element("text", chunk) for chunk in chunk_text(docx_text(document))]
    package = document.part.package
    if package is None:
        return elements
    seen: set[bytes] = set()
    for part in package.iter_parts():
        if not part.content_type.startswith("image/") or not str(part.partname).startswith("/word/media/"):
            continue
        key = sha256(part.blob).digest()
        if key in seen:
            continue
        seen.add(key)
        try:
            image_b64, mime_type = _normalized_image(part.blob, skip_decorative=True)
        except (OSError, ValueError):
            continue
        elements.append(_element("image", image_b64, mime_type=mime_type, source="embedded"))
        elements.extend(_local_ocr_elements(image_b64))
    return elements
