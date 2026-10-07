import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from bson import ObjectId
from fastapi import BackgroundTasks, HTTPException, UploadFile

with patch("pymongo.MongoClient"):
    import main
from rag.pipeline import MultimodalRAG
from ingestion.file_router import extract_text


def test_five_documents_are_passed_to_answer_and_saved(monkeypatch):
    ids, uid = [ObjectId() for _ in range(5)], ObjectId()
    db = Mock()
    db.messages.insert_one.return_value.inserted_id = ObjectId()
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "owned", lambda collection, ident, user: {"_id": ObjectId(ident), "status": "indexed", "originalName": "notes.txt"})
    rag = Mock()
    rag.answer.return_value.answer = "Combined explanation"
    monkeypatch.setattr(main, "get_rag", lambda _: rag)
    result = main.message(str(ObjectId()), main.Data(text="Compare all files", documentIds=list(map(str, ids))), {"_id": uid})
    rag.answer.assert_called_once_with("Compare all files", uid, document_ids=ids, response_level="simple")
    assert [item["id"] for item in result["userMessage"]["attachments"]] == list(map(str, ids))


def test_six_documents_rejected_before_lookup(monkeypatch):
    lookup = Mock()
    monkeypatch.setattr(main, "chat_document", lookup)
    with pytest.raises(HTTPException) as error:
        main.selected_documents(main.Data(documentIds=[str(ObjectId()) for _ in range(6)]), {"_id": ObjectId()})
    assert error.value.status_code == 400
    lookup.assert_not_called()


def test_selection_checks_each_owner_and_indexing_status(monkeypatch):
    uid, first, forbidden = ObjectId(), ObjectId(), ObjectId()
    def owned(collection, ident, user):
        assert user["_id"] == uid
        if ident == str(forbidden): raise HTTPException(404, "Not found")
        return {"_id": first, "status": "indexed"}
    monkeypatch.setattr(main, "owned", owned)
    with pytest.raises(HTTPException) as error:
        main.selected_documents(main.Data(documentIds=[str(first), str(forbidden)]), {"_id": uid})
    assert error.value.status_code == 404


def test_multifile_answer_includes_every_file():
    rag = MultimodalRAG.__new__(MultimodalRAG)
    ids = [ObjectId() for _ in range(5)]
    rag.retrieve = Mock(side_effect=lambda question, uid, limit, document_id: [{"documentId": document_id, "kind": "text", "content": f"Facts for {document_id}", "metadata": {"filename": str(document_id)}}])
    rag.text_model = Mock()
    rag.text_model.bind.return_value.invoke.return_value.content = "Answer"
    result = rag.answer("Compare", ObjectId(), document_ids=ids)
    prompt = rag.text_model.bind.return_value.invoke.call_args.args[0][1].content
    assert all(f"Facts for {ident}" in prompt for ident in ids)
    assert len(result.sources) == 5
    assert rag.retrieve.call_count == 5


def test_study_generation_uses_all_five_selected_documents(monkeypatch):
    ids, uid = [ObjectId() for _ in range(5)], ObjectId()
    monkeypatch.setattr(main, "selected_documents", lambda b, u: ids)
    monkeypatch.setattr(main, "get_rag", lambda _: SimpleNamespace(text_model=Mock()))
    db, table, generator = Mock(), Mock(), Mock()
    db.__getitem__ = Mock(return_value=table)
    table.insert_one.return_value.inserted_id = ObjectId()
    generator.return_value.generate.return_value = [{"front": "Q", "back": "A"}]
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "StudyMaterialGenerator", generator)
    result = main.generate_study_material(main.Data(documentIds=list(map(str, ids)), prompt="Create flashcards"), {"_id": uid}, "flashcardsets", "cards", "Flashcards")
    generator.return_value.generate.assert_called_once_with(uid, ids, "cards", prompt="Create flashcards", topic_only=False)
    assert result["documentIds"] == list(map(str, ids))


def test_upload_returns_before_metadata_mirror_and_keeps_index_on_failure(monkeypatch):
    db, rag, mirror = Mock(), Mock(), Mock(side_effect=RuntimeError("Offline"))
    db.documents.insert_one.return_value.inserted_id = ObjectId()
    rag.ingest.return_value = 1
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "get_rag", lambda _: rag)
    monkeypatch.setattr(main, "sync_upload_metadata", mirror)
    tasks = BackgroundTasks()
    result = main.upload(UploadFile(filename="notes.txt", file=BytesIO(b"Notes")), "12345678-1234-1234-1234-123456789012", {"_id": ObjectId()}, tasks)
    assert result["document"]["status"] == "indexed"
    mirror.assert_not_called()
    asyncio.run(tasks())
    mirror.assert_called_once()
    db.documents.delete_one.assert_not_called()
    assert db.documents.update_one.call_args.args[1]["$set"]["metadataSync"] == "failed"


@pytest.mark.parametrize("extension", ["csv", "md", "json", "py", "yaml"])
def test_text_formats_are_read(extension):
    assert "Study facts" in extract_text(f"notes.{extension}", b"Study facts")


def test_xlsx_reads_all_sheets():
    from openpyxl import Workbook
    workbook = Workbook()
    workbook.active.append(["Biology", "Cells"])
    workbook.create_sheet("Physics").append(["Force", 42])
    output = BytesIO()
    workbook.save(output)
    text = extract_text("notes.xlsx", output.getvalue())
    assert "Cells" in text and "Force" in text and "42" in text
