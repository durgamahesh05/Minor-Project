from io import BytesIO

from pptx import Presentation


def read_pptx(content: bytes) -> str:
    presentation = Presentation(BytesIO(content))
    slides = []
    for slide in presentation.slides:
        text = [shape.text for shape in slide.shapes if hasattr(shape, "text") and shape.text.strip()]
        if text:
            slides.append("\n".join(text))
    return "\n\n".join(slides).strip()
