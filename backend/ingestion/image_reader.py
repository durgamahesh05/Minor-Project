from io import BytesIO
from threading import Lock

from PIL import Image, ImageOps

_ocr_engine = None
_ocr_lock = Lock()


def ocr_engine():
    """Create the OCR engine once; concurrent uploads must not load it twice."""
    global _ocr_engine
    if _ocr_engine is None:
        with _ocr_lock:
            if _ocr_engine is None:
                from rapidocr_onnxruntime import RapidOCR
                _ocr_engine = RapidOCR()
    return _ocr_engine


def validate_image(content: bytes) -> None:
    """Validate an image upload; content understanding is handled by Groq."""
    with Image.open(BytesIO(content)) as image:
        ImageOps.exif_transpose(image).verify()


def extract_image_text(content: bytes) -> str:
    engine = ocr_engine()
    with Image.open(BytesIO(content)) as image:
        normalized = ImageOps.exif_transpose(image).convert("RGB")
        import numpy as np
        result, _ = engine(np.asarray(normalized))
    return "\n".join(str(item[1]).strip() for item in result or [] if len(item) > 1 and str(item[1]).strip()).strip()
