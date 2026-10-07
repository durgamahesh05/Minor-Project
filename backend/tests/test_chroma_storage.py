import json
from unittest.mock import Mock

import pytest

from vectorstore.chroma import ChromaVectorStore
import document_storage


def test_chroma_persists_filters_and_deletes(tmp_path, monkeypatch):
    monkeypatch.setenv("CHROMA_MODE", "local")
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("CHROMA_PATH", str(tmp_path / "vectors"))
    store = ChromaVectorStore(2)
    records = [
        {"id": key, "vector": [1.0, 0.0], "payload": {
            "element_id": key, "document_id": doc, "user_id": user,
            "kind": "text", "summary": "Kubernetes manages containers"}}
        for key, doc, user in [("a", "doc-a", "user-a"),
                               ("b", "doc-b", "user-a"), ("c", "doc-c", "user-b")]
    ]
    store.upsert(records)
    reopened = ChromaVectorStore(2)
    assert reopened.collection.count() == 3
    assert reopened.collection.get(ids=["a"])["documents"] == ["Kubernetes manages containers"]
    results = reopened.search([1.0, 0.0], "user-a", document_id="doc-a")
    assert [r.payload["element_id"] for r in results] == ["a"]
    assert results[0].score == pytest.approx(1.0)
    assert reopened.search([1.0, 0.0], "user-b", document_id="doc-a") == []
    reopened.delete_document("doc-a")
    assert reopened.collection.count() == 2
    assert reopened.search([1.0, 0.0], "user-a", document_id="doc-a") == []


def test_metadata_contains_only_ids_and_name(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test")
    request = Mock()
    monkeypatch.setattr(document_storage, "_request", request)
    document_storage.sync_upload_metadata({"_id": "doc", "userId": "user",
                                           "originalName": "notes.pdf", "content": "secret"})
    assert json.loads(request.call_args.args[2]) == {
        "document_id": "doc", "user_id": "user", "file_name": "notes.pdf"}


@pytest.mark.parametrize("response", [None, [], {}, {"signedURL": 12}])
def test_signed_download_rejects_invalid_response(monkeypatch, response):
    monkeypatch.setattr(document_storage, "_settings", lambda: ("https://example.com", "key", "documents"))
    monkeypatch.setattr(document_storage, "_request", lambda *args: response)
    with pytest.raises(RuntimeError):
        document_storage.signed_download_url("path", "name.pdf")
