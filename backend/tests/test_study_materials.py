import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from bson import ObjectId
from fastapi import HTTPException
from pydantic import ValidationError

with patch("pymongo.MongoClient"):
    import main
from rag.study_materials import StudyMaterialGenerator


QUESTION = {"question": "What does Kubernetes manage?", "options": ["Containers", "Invoices", "Passwords", "Spreadsheets"], "correctIndex": 0, "explanation": "The source describes container orchestration."}


@pytest.mark.parametrize("field,content", [("questions", [QUESTION]), ("cards", [{"front": "What is Kubernetes?", "back": "A container orchestration system."}])])
def test_generator_uses_owned_context_and_validates_output(field, content):
    db, model = Mock(), Mock()
    uid, did = ObjectId(), ObjectId()
    db.rag_elements.find.return_value.limit.return_value = [{"kind": "text", "content": "Kubernetes manages containers."}]
    model.bind.return_value.invoke.return_value.content = json.dumps({field: content})
    assert StudyMaterialGenerator(db, model).generate(uid, [did], field) == content
    assert db.rag_elements.find.call_args.args[0] == {"userId": uid, "documentId": did}
    messages = model.bind.return_value.invoke.call_args.args[0]
    assert "Kubernetes manages containers." in messages[1].content


@pytest.mark.parametrize("content", [{"questions": []}, {"questions": [{**QUESTION, "correctIndex": 4}]}, {"questions": [{**QUESTION, "options": ["Same"] * 4}]}, {"cards": [{"front": " ", "back": "answer"}]}])
def test_invalid_ai_output_is_rejected(content):
    db, model = Mock(), Mock()
    db.rag_elements.find.return_value.limit.return_value = [{"kind": "text", "content": "Some notes"}]
    model.bind.return_value.invoke.return_value.content = json.dumps(content)
    with pytest.raises(ValidationError):
        StudyMaterialGenerator(db, model).generate(ObjectId(), [ObjectId()], next(iter(content)))


def endpoint(path):
    return next(route.endpoint for route in main.app.routes if getattr(route, "path", None) == path and "POST" in route.methods)


@pytest.mark.parametrize("path,collection,field,single", [("/api/quizzes", "quizzes", "questions", "quiz"), ("/api/flashcards", "flashcardsets", "cards", "set")])
def test_creation_persists_generated_material_for_owner(monkeypatch, path, collection, field, single):
    uid, did, ident = ObjectId(), ObjectId(), ObjectId()
    db, table = Mock(), Mock()
    db.__getitem__ = Mock(return_value=table)
    table.insert_one.return_value.inserted_id = ident
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "owned", lambda *args: {"_id": did, "status": "indexed", "originalName": "notes.txt"})
    monkeypatch.setattr(main, "get_rag", lambda _: SimpleNamespace(text_model=Mock()))
    generator = Mock()
    generator.return_value.generate.return_value = [QUESTION] if field == "questions" else [{"front": "Q", "back": "A"}]
    monkeypatch.setattr(main, "StudyMaterialGenerator", generator)
    result = endpoint(path)(main.Data(documentId=str(did)), {"_id": uid})
    generator.return_value.generate.assert_called_once_with(uid, [did], field)
    record = table.insert_one.call_args.args[0]
    assert record["userId"] == uid and record["documentId"] == did
    assert result[single]["id"] == str(ident)


def test_unindexed_document_cannot_generate(monkeypatch):
    monkeypatch.setattr(main, "owned", lambda *args: {"_id": ObjectId(), "status": "processing"})
    generator = Mock()
    monkeypatch.setattr(main, "StudyMaterialGenerator", generator)
    with pytest.raises(HTTPException) as error:
        endpoint("/api/quizzes")(main.Data(documentId=str(ObjectId())), {"_id": ObjectId()})
    assert error.value.status_code == 409
    generator.assert_not_called()


def test_missing_documents_does_not_create_placeholder(monkeypatch):
    db = Mock()
    db.documents.find.return_value.sort.return_value.limit.return_value = []
    monkeypatch.setattr(main, "db", db)
    with pytest.raises(HTTPException) as error:
        endpoint("/api/flashcards")(main.Data(), {"_id": ObjectId()})
    assert error.value.status_code == 409


def test_generation_failure_does_not_persist(monkeypatch):
    uid, did = ObjectId(), ObjectId()
    db = Mock()
    db.__getitem__ = Mock()
    db.documents.find.return_value.sort.return_value.limit.return_value = [{"_id": did}]
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "get_rag", lambda _: SimpleNamespace(text_model=Mock()))
    generator = Mock()
    generator.return_value.generate.side_effect = ValueError("invalid output")
    monkeypatch.setattr(main, "StudyMaterialGenerator", generator)
    with pytest.raises(HTTPException) as error:
        endpoint("/api/quizzes")(main.Data(), {"_id": uid})
    assert error.value.status_code == 502
    db.__getitem__.assert_not_called()

@pytest.mark.parametrize("text,kinds", [
    ("Generate a quiz about chapter 2", ["quiz"]),
    ("Create flash cards on cells", ["flashcards"]),
    ("Make a quiz and flashcards from this document", ["quiz", "flashcards"]),
    ("What is a quiz?", []),
    ("Do not generate a quiz", []),
])
def test_chat_study_actions_keep_request_and_document(text, kinds):
    did = ObjectId()
    actions = main.study_actions(text, did)
    assert [action["kind"] for action in actions] == kinds
    assert all(action["prompt"] == text and action["documentId"] == str(did) for action in actions)


def test_topic_generation_without_documents():
    db, model = Mock(), Mock()
    model.bind.return_value.invoke.return_value.content = json.dumps({"questions": [QUESTION]})
    result = StudyMaterialGenerator(db, model).generate(ObjectId(), [], "questions", prompt="Quiz on Kubernetes", topic_only=True)
    assert result == [QUESTION]
    assert "Quiz on Kubernetes" in model.bind.return_value.invoke.call_args.args[0][1].content
    db.rag_elements.find.assert_not_called()


def test_section_prompt_prioritizes_relevant_content():
    db, model = Mock(), Mock()
    db.rag_elements.find.return_value.limit.return_value = [
        {"kind": "text", "content": "Introduction " * 2000},
        {"kind": "text", "content": "Chapter 2: Kubernetes manages containers."},
    ]
    model.bind.return_value.invoke.return_value.content = json.dumps({"questions": [QUESTION]})
    StudyMaterialGenerator(db, model).generate(ObjectId(), [ObjectId()], "questions", prompt="Chapter 2 Kubernetes")
    assert "Chapter 2: Kubernetes manages containers." in model.bind.return_value.invoke.call_args.args[0][1].content


@pytest.mark.parametrize("path", ["/api/quizzes/{ident}", "/api/flashcards/{ident}"])
def test_rename_owned_study_set(monkeypatch, path):
    uid, ident = ObjectId(), ObjectId()
    db, table = Mock(), Mock()
    db.__getitem__ = Mock(return_value=table)
    monkeypatch.setattr(main, "db", db)
    owned = Mock(return_value={"_id": ident, "userId": uid, "title": "Old title"})
    monkeypatch.setattr(main, "owned", owned)
    route = next(route.endpoint for route in main.app.routes if getattr(route, "path", None) == path and "PATCH" in route.methods)
    route(str(ident), main.Data(title="New name"), {"_id": uid})
    assert owned.call_args.args[2] == {"_id": uid}
    assert table.update_one.call_args.args[0] == {"_id": ident, "userId": uid}
    assert table.update_one.call_args.args[1]["$set"]["title"] == "New name"
    with pytest.raises(HTTPException):
        route(str(ident), main.Data(title="  "), {"_id": uid})


def test_chat_generates_both_materials_and_persists_result_links(monkeypatch):
    did, uid = ObjectId(), ObjectId()
    monkeypatch.setattr(main, "owned", lambda *args: {"_id": did, "status": "indexed", "originalName": "notes.docx"})
    db, table = Mock(), Mock()
    db.__getitem__ = Mock(return_value=table)
    table.insert_one.side_effect = [SimpleNamespace(inserted_id=ObjectId()), SimpleNamespace(inserted_id=ObjectId())]
    db.messages.insert_one.return_value.inserted_id = ObjectId()
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "get_rag", lambda _: SimpleNamespace(text_model=Mock()))
    generator = Mock()
    generator.return_value.generate.side_effect = [[QUESTION], [{"front": "Q", "back": "A"}]]
    monkeypatch.setattr(main, "StudyMaterialGenerator", generator)
    result = main.message("conversation", main.Data(text="Generate a quiz and flashcards about chapter 2", documentId=str(did)), {"_id": uid})
    saved = db.messages.insert_one.call_args.args[0]
    assert result["assistantMessage"]["studyActions"] == saved["studyActions"]
    assert [action["kind"] for action in saved["studyActions"]] == ["quiz", "flashcards"]
    assert all(action["id"] and action["documentId"] == str(did) for action in saved["studyActions"])
    assert table.insert_one.call_count == 2
    assert generator.return_value.generate.call_args.kwargs["prompt"] == "Generate a quiz and flashcards about chapter 2"


def test_chat_keeps_successful_result_when_second_generation_fails(monkeypatch):
    db = Mock()
    db.documents.find_one.return_value = None
    db.messages.insert_one.return_value.inserted_id = ObjectId()
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "owned", lambda *args: {"_id": ObjectId()})
    generate = Mock(side_effect=[{"id": str(ObjectId()), "title": "Quiz"}, HTTPException(502, "Try again")])
    monkeypatch.setattr(main, "generate_study_material", generate)
    result = main.message("conversation", main.Data(text="Create a quiz and flashcards about cells"), {"_id": ObjectId()})
    assert len(result["assistantMessage"]["studyActions"]) == 1
    assert "Could not generate flashcards" in result["assistantMessage"]["text"]
    assert generate.call_args.args[0].sourceMode == "topic"


def test_named_topic_quiz_persists_prompt(monkeypatch):
    uid = ObjectId()
    db, table = Mock(), Mock()
    db.__getitem__ = Mock(return_value=table)
    table.insert_one.return_value.inserted_id = ObjectId()
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "get_rag", lambda _: SimpleNamespace(text_model=Mock()))
    generator = Mock()
    generator.return_value.generate.return_value = [QUESTION]
    monkeypatch.setattr(main, "StudyMaterialGenerator", generator)
    result = endpoint("/api/quizzes")(main.Data(title="Containers revision", prompt="Quiz on Kubernetes", sourceMode="topic"), {"_id": uid})
    assert result["quiz"]["title"] == "Containers revision"
    assert result["quiz"]["prompt"] == "Quiz on Kubernetes"
    generator.return_value.generate.assert_called_once_with(uid, [], "questions", prompt="Quiz on Kubernetes", topic_only=True)
