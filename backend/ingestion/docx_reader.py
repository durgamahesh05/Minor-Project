from io import BytesIO

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph


def _blocks(container):
    for block in container.iter_inner_content():
        if isinstance(block, Paragraph):
            if block.text.strip():
                yield block.text
        elif isinstance(block, Table):
            for row in block.rows:
                cells = []
                seen = set()
                for cell in row.cells:
                    # Merged cells can appear more than once in a row.
                    if cell._tc in seen:
                        continue
                    seen.add(cell._tc)
                    cells.append("\n".join(_blocks(cell)))
                if any(value.strip() for value in cells):
                    yield "\t".join(cells)


def read_docx(content: bytes) -> str:
    document = Document(BytesIO(content))
    blocks = list(_blocks(document))
    seen_parts = set()
    for section in document.sections:
        for part in (section.header, section.footer, section.first_page_header,
                     section.first_page_footer, section.even_page_header, section.even_page_footer):
            if part.is_linked_to_previous or part.part.partname in seen_parts:
                continue
            seen_parts.add(part.part.partname)
            blocks.extend(_blocks(part))
    return "\n".join(blocks).strip()
