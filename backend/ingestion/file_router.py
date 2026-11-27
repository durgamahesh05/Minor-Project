from pathlib import Path
import tempfile
from .readers import DocumentReader, TextReader, PDFReader, WordReader, PowerPointReader, SpreadsheetReader

_READERS: dict[str, DocumentReader] = {
    ".txt": TextReader(),
    ".pdf": PDFReader(),
    ".docx": WordReader(),
    ".pptx": PowerPointReader(),
    ".xlsx": SpreadsheetReader(),
}


class LegacySpreadsheetReader(DocumentReader):
    def read(self, content: bytes) -> str:
        path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".xls", delete=False) as temporary:
                path = Path(temporary.name)
                temporary.write(content)
            from markitdown import MarkItDown
            return MarkItDown().convert(str(path)).text_content.strip()
        finally:
            if path is not None:
                path.unlink(missing_ok=True)


_READERS[".xls"] = LegacySpreadsheetReader()

TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".log", ".py", ".js", ".ts", ".css", ".java", ".c", ".cpp", ".h", ".yaml", ".yml"}
_READERS.update({extension: TextReader() for extension in TEXT_EXTENSIONS})

IMAGE_EXTENSIONS = {".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
SUPPORTED_EXTENSIONS = {*_READERS, *IMAGE_EXTENSIONS}


class UnsupportedFileType(ValueError):
    pass


def extract_text(filename: str, content: bytes) -> str:
    if len(content) > 10 * 1024 * 1024:
        raise ValueError("File too large (10MB maximum)")
    extension = Path(filename).suffix.lower()
    reader = _READERS.get(extension)
    if reader is not None:
        return reader.read(content)
    if extension in IMAGE_EXTENSIONS:
        raise UnsupportedFileType("Images are processed by the multimodal vision pipeline")
    raise UnsupportedFileType(f"Unsupported file type: {extension or 'no extension'}")
