from pathlib import Path
from .readers import DocumentReader, TextReader, PDFReader, WordReader, PowerPointReader

_READERS: dict[str, DocumentReader] = {
    ".txt": TextReader(),
    ".pdf": PDFReader(),
    ".docx": WordReader(),
    ".pptx": PowerPointReader(),
}

IMAGE_EXTENSIONS = {".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
SUPPORTED_EXTENSIONS = {".txt", ".pdf", ".docx", ".pptx", *IMAGE_EXTENSIONS}


class UnsupportedFileType(ValueError):
    pass


def extract_text(filename: str, content: bytes) -> str:
    extension = Path(filename).suffix.lower()
    reader = _READERS.get(extension)
    if reader is not None:
        return reader.read(content)
    if extension in IMAGE_EXTENSIONS:
        raise UnsupportedFileType("Images are processed by the multimodal vision pipeline")
    raise UnsupportedFileType(f"Unsupported file type: {extension or 'no extension'}")
