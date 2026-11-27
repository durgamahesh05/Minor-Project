import os
from pathlib import Path
import tempfile
from .readers import DocumentReader, TextReader, PDFReader, WordReader, LegacyWordReader, PowerPointReader, SpreadsheetReader

_READERS: dict[str, DocumentReader] = {
    ".txt": TextReader(),
    ".pdf": PDFReader(),
    ".docx": WordReader(),
    ".doc": LegacyWordReader(),
    ".rtf": LegacyWordReader(),
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


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


# Upload limits are configurable and shared with the frontend via /api/documents/config.
MAX_UPLOAD_MB = _positive_int("MAX_UPLOAD_MB", 10)
MAX_FILE_SIZE = MAX_UPLOAD_MB * 1024 * 1024
MAX_ATTACHMENTS = _positive_int("MAX_ATTACHMENTS", 5)
UPLOAD_CONCURRENCY = _positive_int("UPLOAD_CONCURRENCY", 3)
FILE_TOO_LARGE = f"File too large ({MAX_UPLOAD_MB}MB maximum)"

# Human-readable groups for upload hints; any supported extension not listed is still accepted.
_FORMAT_GROUPS = [
    ("PDF", {".pdf"}),
    ("Word", {".docx", ".doc", ".rtf"}),
    ("PowerPoint", {".pptx"}),
    ("Excel", {".xlsx", ".xls"}),
    ("Text & code", TEXT_EXTENSIONS),
    ("Images", IMAGE_EXTENSIONS),
]


def upload_config() -> dict:
    extensions = sorted(SUPPORTED_EXTENSIONS)
    return {
        "maxFileSizeBytes": MAX_FILE_SIZE,
        "maxFileSizeMb": MAX_UPLOAD_MB,
        "maxAttachments": MAX_ATTACHMENTS,
        "uploadConcurrency": UPLOAD_CONCURRENCY,
        "extensions": extensions,
        "accept": ",".join(extensions),
        "formats": [label for label, group in _FORMAT_GROUPS if group & SUPPORTED_EXTENSIONS],
    }


def supported_formats_message() -> str:
    return "Supported files: " + ", ".join(upload_config()["formats"])


class UnsupportedFileType(ValueError):
    pass


def extract_text(filename: str, content: bytes) -> str:
    if len(content) > MAX_FILE_SIZE:
        raise ValueError(FILE_TOO_LARGE)
    extension = Path(filename).suffix.lower()
    reader = _READERS.get(extension)
    if reader is not None:
        return reader.read(content)
    if extension in IMAGE_EXTENSIONS:
        raise UnsupportedFileType("Images are processed by the multimodal vision pipeline")
    raise UnsupportedFileType(f"Unsupported file type: {extension or 'no extension'}")
