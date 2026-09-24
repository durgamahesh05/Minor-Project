"""Interchangeable readers; format-specific libraries load only when used."""
from abc import ABC, abstractmethod


class DocumentReader(ABC):
    @abstractmethod
    def read(self, content: bytes) -> str:
        """Extract plain text without retaining the uploaded bytes."""


class TextReader(DocumentReader):
    def read(self, content: bytes) -> str:
        from .txt_reader import read_txt
        return read_txt(content)


class PDFReader(DocumentReader):
    def read(self, content: bytes) -> str:
        from .pdf_reader import read_pdf
        return read_pdf(content)


class WordReader(DocumentReader):
    def read(self, content: bytes) -> str:
        from .docx_reader import read_docx
        return read_docx(content)


class PowerPointReader(DocumentReader):
    def read(self, content: bytes) -> str:
        from .pptx_reader import read_pptx
        return read_pptx(content)
