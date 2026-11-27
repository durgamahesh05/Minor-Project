from io import BytesIO

from PIL import Image, ImageOps

_ocr_engine = None


def validate_image(content: bytes) -> None:
    """Validate an image upload; content understanding is handled by Groq."""
    with Image.open(BytesIO(content)) as image:
        ImageOps.exif_transpose(image).verify()


def extract_image_text(content: bytes) -> str:
    global _ocr_engine
    from rapidocr_onnxruntime import RapidOCR

    if _ocr_engine is None:
        _ocr_engine = RapidOCR()
    with Image.open(BytesIO(content)) as image:
        normalized = ImageOps.exif_transpose(image).convert("RGB")
        import numpy as np
        result, _ = _ocr_engine(np.asarray(normalized))
    return "\n".join(str(item[1]).strip() for item in result or [] if len(item) > 1 and str(item[1]).strip()).strip()
