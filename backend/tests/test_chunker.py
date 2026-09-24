from chunking.chunker import chunk_text


def test_empty_text_has_no_chunks():
    assert chunk_text("   ") == []


def test_chunks_respect_size_and_overlap():
    chunks = chunk_text("word " * 100, chunk_size=80, overlap=10)
    assert len(chunks) > 1
    assert all(len(chunk) <= 80 for chunk in chunks)
