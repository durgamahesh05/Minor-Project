from io import BytesIO

from pypdf import PdfReader


def read_pdf(content: bytes) -> str:
    reader = PdfReader(BytesIO(content))
    return "\n\n".join(text for page in reader.pages if (text := page.extract_text())).strip()
