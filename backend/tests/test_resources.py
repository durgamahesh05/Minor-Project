from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from embeddings.embedder import Embedder
from ingestion.readers import DocumentReader, TextReader, WordReader
from rag.resources import IOResources


class FakeVector:
    def tolist(self):
        return [0.1, 0.2]


def test_embedding_model_is_lazy_and_loaded_once_across_threads(monkeypatch):
    import sys

    model = Mock()
    model.embed.side_effect = lambda texts: [FakeVector() for _ in texts]
    factory = Mock(return_value=model)
    monkeypatch.setitem(sys.modules, "fastembed", SimpleNamespace(TextEmbedding=factory))
    embedder = Embedder()
    factory.assert_not_called()
    with ThreadPoolExecutor(max_workers=4) as pool:
        vectors = list(pool.map(embedder.embed_query, ["same question"] * 8))
    factory.assert_called_once()
    model.embed.assert_called_once()
    vectors[0][0] = 999
    assert embedder.embed_query("same question") == [0.1, 0.2]


def test_query_cache_is_bounded_and_can_be_cleared():
    embedder = Embedder(cache_size=2)
    embedder._model = Mock()
    embedder._model.embed.side_effect = lambda texts: [FakeVector() for _ in texts]
    for text in ["a", "b", "a", "c", "b"]:
        embedder.embed_query(text)
    assert embedder._model.embed.call_count == 4
    embedder.clear_cache()
    embedder.embed_query("b")
    assert embedder._model.embed.call_count == 5


def test_worker_pool_runs_concurrently_preserves_order_and_closes():
    resources = IOResources(workers=2)
    barrier = Barrier(2)

    def work(number):
        barrier.wait(timeout=5)
        return number * 2

    try:
        assert resources._executor is None
        assert resources.map(work, [1, 2, 3, 4]) == [2, 4, 6, 8]
        executor = resources._executor
        assert resources.map(lambda item: item, [5]) == [5]
        assert resources._executor is executor
    finally:
        resources.close()
    with pytest.raises(RuntimeError):
        executor.submit(lambda: None)


def test_worker_errors_propagate():
    resources = IOResources()
    try:
        with pytest.raises(ZeroDivisionError):
            resources.map(lambda number: 1 / number, [0])
    finally:
        resources.close()


def test_http_connection_pool_is_lazy_reused_and_closed():
    resources = IOResources()
    assert resources._client is None
    client = resources.http
    assert resources.http is client
    resources.close()
    assert client.is_closed


def test_reader_abstraction_and_word_polymorphism():
    from io import BytesIO
    from docx import Document

    with pytest.raises(TypeError):
        DocumentReader()
    document = Document()
    document.add_paragraph("Study notes")
    content = BytesIO()
    document.save(content)
    for reader, data in [(TextReader(), b"Study notes"), (WordReader(), content.getvalue())]:
        assert isinstance(reader, DocumentReader)
        assert reader.read(data) == "Study notes"


def test_vector_store_initialization_is_lazy_and_thread_safe(monkeypatch):
    from rag import pipeline
    from threading import Lock

    rag = pipeline.MultimodalRAG.__new__(pipeline.MultimodalRAG)
    rag._vectorstore = None
    rag._vectorstore_lock = Lock()
    rag.embedder = Mock()
    rag.embedder.embed_query.return_value = [0.1, 0.2]
    factory = Mock()
    monkeypatch.setattr(pipeline, "QdrantVectorStore", factory)
    factory.assert_not_called()
    with ThreadPoolExecutor(max_workers=4) as pool:
        stores = list(pool.map(lambda _: rag.vectorstore, range(8)))
    factory.assert_called_once_with(2)
    assert all(store is stores[0] for store in stores)


def test_parallel_image_summaries_stay_linked_to_original_elements(monkeypatch):
    from bson import ObjectId
    from ingestion.multimodal import ContentElement
    from rag import pipeline

    rag = pipeline.MultimodalRAG.__new__(pipeline.MultimodalRAG)
    rag.database, rag.vectorstore, rag.embedder = Mock(), Mock(), Mock()
    elements = [ContentElement("image-a", "image", "a"), ContentElement("text", "text", "notes"), ContentElement("image-b", "image", "b")]
    monkeypatch.setattr(pipeline, "extract_elements", lambda *args: elements)
    rag._summary = lambda element: f"summary-{element.content}"
    rag.embedder.embed.return_value = [[1], [2], [3]]
    resources = IOResources(workers=2)
    monkeypatch.setattr(pipeline, "resources", resources)
    try:
        assert rag.ingest("notes.pdf", b"fake", ObjectId(), ObjectId()) == 3
    finally:
        resources.close()
    rag.embedder.embed.assert_called_once_with(["summary-a", "notes", "summary-b"])
    records = rag.vectorstore.upsert.call_args.args[0]
    assert [(record["id"], record["vector"]) for record in records] == [("image-a", [1]), ("text", [2]), ("image-b", [3])]
