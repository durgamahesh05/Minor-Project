def read_txt(content: bytes) -> str:
    """Decode a plain-text upload, tolerating a UTF-8 byte-order mark."""
    return content.decode("utf-8-sig", errors="replace").strip()
