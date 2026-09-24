from io import BytesIO

from docx import Document


def read_docx(content: bytes) -> str:
    document = Document(BytesIO(content))
    blocks = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        blocks.extend("\t".join(cell.text for cell in row.cells) for row in table.rows)
    return "\n".join(blocks).strip()
