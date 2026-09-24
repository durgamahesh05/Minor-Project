from io import BytesIO

from PIL import Image, ImageOps


def validate_image(content: bytes) -> None:
    """Validate an image upload; content understanding is handled by Groq."""
    with Image.open(BytesIO(content)) as image:
        ImageOps.exif_transpose(image).verify()
