"""Text extraction for legacy Word (.doc) and RTF files.

Word 97-2003 files are OLE compound documents. The text is located through
the piece table (CLX) stored in the table stream, as described in [MS-DOC].
Files that are really DOCX or RTF with a .doc name are handled as well,
because many tools save those with a .doc extension.
"""
import re
import struct
from io import BytesIO

_OLE_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_WORD_IDENT = 0xA5EC
_FIELD_BEGIN, _FIELD_SEPARATOR, _FIELD_END = "\x13", "\x14", "\x15"
_REPLACEMENTS = str.maketrans({
    "\r": "\n",      # paragraph end
    "\x0b": "\n",    # manual line break
    "\x0c": "\n",    # page/section break
    "\x07": "\t",    # table cell end
    "\x1e": "-",     # non-breaking hyphen
    "\xa0": " ",
})
_CONTROL = re.compile(r"[\x00-\x08\x0e-\x1f]")


def _u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def _strip_fields(text: str) -> str:
    """Keep a field's displayed result and drop its instruction code."""
    output = []
    # Each open field records whether we are still inside its instruction.
    stack: list[bool] = []
    for char in text:
        if char == _FIELD_BEGIN:
            stack.append(True)
        elif char == _FIELD_SEPARATOR:
            if stack:
                stack[-1] = False
        elif char == _FIELD_END:
            if stack:
                stack.pop()
        elif not any(stack):
            output.append(char)
    return "".join(output)


def _clean(text: str) -> str:
    # A table row ends with the last cell mark followed by a row mark.
    text = _strip_fields(text).replace("\x07\x07", "\n")
    text = _CONTROL.sub("", text.translate(_REPLACEMENTS))
    lines = [line.rstrip(" \t") for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _piece_table_text(word: bytes, table: bytes) -> str:
    fc_clx, lcb_clx = _u32(word, 0x01A2), _u32(word, 0x01A6)
    clx = table[fc_clx:fc_clx + lcb_clx]
    position = 0
    plc = b""
    while position < len(clx):
        kind = clx[position]
        if kind == 0x01:  # Prc: property modifiers, not needed for text
            position += 3 + _u16(clx, position + 1)
        elif kind == 0x02:  # Pcdt: the piece table
            size = _u32(clx, position + 1)
            plc = clx[position + 5:position + 5 + size]
            break
        else:
            raise ValueError("The Word document's text table is damaged")
    if len(plc) < 16:
        raise ValueError("The Word document's text table is damaged")

    count = (len(plc) - 4) // 12
    cps = [_u32(plc, 4 * index) for index in range(count + 1)]
    descriptors = 4 * (count + 1)
    pieces = []
    for index in range(count):
        characters = max(0, cps[index + 1] - cps[index])
        fc = _u32(plc, descriptors + 8 * index + 2)
        if fc & 0x40000000:  # 8-bit "compressed" text
            start = (fc & 0x3FFFFFFF) // 2
            pieces.append(word[start:start + characters].decode("cp1252", errors="replace"))
        else:
            pieces.append(word[fc:fc + 2 * characters].decode("utf-16-le", errors="replace"))
    text = "".join(pieces)
    main_text_length = _u32(word, 0x004C)  # ccpText: the body, without headers/notes
    return text[:main_text_length] if 0 < main_text_length <= len(text) else text


def _read_binary_doc(content: bytes) -> str:
    import olefile

    with olefile.OleFileIO(BytesIO(content)) as ole:
        if not ole.exists("WordDocument"):
            raise ValueError("This .doc file does not contain a Word document")
        word = ole.openstream("WordDocument").read()
        if len(word) < 0x01AA or _u16(word, 0) != _WORD_IDENT:
            raise ValueError("This .doc file is not a supported Word document")
        flags = _u16(word, 0x000A)
        if flags & 0x0100:
            raise ValueError("Password-protected Word documents cannot be read")
        if _u16(word, 0x0002) < 101:
            # Word 6/95: text is stored contiguously between fcMin and fcMac.
            return word[_u32(word, 0x0018):_u32(word, 0x001C)].decode("cp1252", errors="replace")
        table_name = "1Table" if flags & 0x0200 else "0Table"
        if not ole.exists(table_name):
            raise ValueError("The Word document's text table is missing")
        return _piece_table_text(word, ole.openstream(table_name).read())


_RTF_SKIP_DESTINATIONS = {
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer",
    "headerl", "headerr", "headerf", "footerl", "footerr", "footerf", "listtable",
    "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping",
    "latentstyles", "datastore", "filetbl", "revtbl",
}
_RTF_SYMBOLS = {
    "par": "\n", "line": "\n", "row": "\n", "sect": "\n", "page": "\n",
    "tab": "\t", "cell": "\t", "emdash": "\u2014", "endash": "\u2013", "bullet": "\u2022",
    "lquote": "\u2018", "rquote": "\u2019", "ldblquote": "\u201c", "rdblquote": "\u201d",
    "emspace": " ", "enspace": " ", "qmspace": " ",
}
# Windows code pages for RTF \fcharset values.
_RTF_CHARSETS = {
    0: "cp1252", 128: "cp932", 129: "cp949", 134: "gbk", 136: "big5", 161: "cp1253",
    162: "cp1254", 163: "cp1258", 177: "cp1255", 178: "cp1256", 186: "cp1257",
    204: "cp1251", 222: "cp874", 238: "cp1250",
}
_RTF_TOKEN = re.compile(r"\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\(.)|([{}])|([^\\{}]+)", re.S)
_RTF_FONT = re.compile(r"\\f(\d+)[^;{}]*?\\fcharset(\d+)")


def _read_rtf(content: bytes) -> str:
    text = content.decode("latin-1")
    default_page = re.search(r"\\ansicpg(\d+)", text)
    default_codec = f"cp{default_page.group(1)}" if default_page else "cp1252"
    font_codecs = {font: _RTF_CHARSETS.get(int(charset), default_codec) for font, charset in _RTF_FONT.findall(text)}
    output: list[str] = []
    pending = bytearray()  # consecutive \'hh bytes, decoded together (multi-byte code pages)
    stack: list[tuple[bool, str]] = []
    skipping = False
    codec = default_codec
    skip_next = 0

    def flush() -> None:
        if pending:
            try:
                output.append(pending.decode(codec, errors="replace"))
            except LookupError:
                output.append(pending.decode("cp1252", errors="replace"))
            pending.clear()

    for word, argument, hex_value, symbol, brace, plain in (match.groups() for match in _RTF_TOKEN.finditer(text)):
        if hex_value is not None:
            if skipping:
                continue
            if skip_next:
                skip_next -= 1
            else:
                pending.append(int(hex_value, 16))
            continue
        flush()
        if brace == "{":
            stack.append((skipping, codec))
        elif brace == "}":
            skipping, codec = stack.pop() if stack else (False, default_codec)
        elif skipping:
            continue
        elif symbol is not None:
            if symbol == "*":
                skipping = True
            elif symbol in "\\{}":
                output.append(symbol)
            elif symbol == "~":
                output.append(" ")
            elif symbol in "\r\n":
                output.append("\n")
        elif word is not None:
            if word in _RTF_SKIP_DESTINATIONS:
                skipping = True
            elif word in _RTF_SYMBOLS:
                output.append(_RTF_SYMBOLS[word])
            elif word == "f" and argument:
                codec = font_codecs.get(argument, default_codec)
            elif word == "u" and argument:
                output.append(chr(int(argument) % 65536))
                skip_next = 1  # the ANSI fallback character that follows
        elif plain is not None:
            plain = plain.replace("\r", "").replace("\n", "")
            if skip_next and plain:
                plain, skip_next = plain[1:], 0
            output.append(plain)
    flush()
    return "".join(output)


def read_doc(content: bytes) -> str:
    if content.startswith(_OLE_SIGNATURE):
        return _clean(_read_binary_doc(content))
    if content.startswith(b"PK"):
        from .docx_reader import read_docx
        return read_docx(content)
    if content.lstrip().startswith(b"{\\rtf"):
        return _clean(_read_rtf(content))
    raise ValueError("This file is not a valid Word document")
