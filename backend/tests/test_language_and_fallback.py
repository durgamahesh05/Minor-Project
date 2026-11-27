import json
from unittest.mock import Mock

from bson import ObjectId

from rag import pipeline
from rag.response_policy import language_instruction, language_name, response_policy
from rag.study_materials import STUDY_MAX_TOKENS, StudyMaterialGenerator


def test_language_codes_map_to_answer_languages():
    assert language_name("hi") == "Hindi"
    assert language_name("te-IN") == "Telugu"
    assert language_name("auto") is None and language_name(None) is None
    assert "in French" in language_instruction("fr")
    assert "same language the user writes in" in language_instruction("auto")


def test_response_policy_carries_language():
    assert "in Spanish" in response_policy("Explain osmosis", "simple", "es").instruction


def test_not_found_message_is_localized():
    assert pipeline.not_found_message("es").startswith("No encontré")
    assert pipeline.not_found_message(None).startswith("I could not find")


def test_general_answer_uses_selected_language():
    rag = pipeline.MultimodalRAG.__new__(pipeline.MultimodalRAG)
    rag.text_model = Mock()
    rag.text_model.bind.return_value.invoke.return_value.content = "Hola"
    rag.general_answer("What is DNA?", language="es")
    system = rag.text_model.bind.return_value.invoke.call_args.args[0][0].content
    assert "in Spanish" in system


def test_text_model_falls_back_when_primary_is_rate_limited(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("GROQ_TEXT_MODEL", "primary-model")
    monkeypatch.setenv("GROQ_FALLBACK_MODELS", "openai/gpt-oss-120b, backup-model,primary-model")
    model = pipeline.build_text_model()
    import groq
    assert model.runnable.model_name == "primary-model"
    assert model.runnable.max_retries == 0
    assert [fallback.model_name for fallback in model.fallbacks] == ["openai/gpt-oss-120b", "backup-model"]
    assert model.fallbacks[0].reasoning_effort == "low"
    assert groq.RateLimitError in model.exceptions_to_handle


def test_fallbacks_can_be_disabled(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setenv("GROQ_FALLBACK_MODELS", "")
    from langchain_groq import ChatGroq
    assert isinstance(pipeline.build_text_model(), ChatGroq)


def test_study_materials_follow_language_and_output_budget():
    database = Mock()
    database.rag_elements.find.return_value.limit.return_value = [{"kind": "text", "content": "Cells divide by mitosis."}]
    model = Mock()
    model.bind.return_value.invoke.return_value.content = json.dumps({"cards": [{"front": "¿Qué es la mitosis?", "back": "División celular"}]})
    cards = StudyMaterialGenerator(database, model).generate(ObjectId(), [ObjectId()], "cards", language="es")
    assert cards[0]["back"] == "División celular"
    assert model.bind.call_args.kwargs["max_tokens"] == STUDY_MAX_TOKENS <= 2000
    system = model.bind.return_value.invoke.call_args.args[0][0].content
    assert "in Spanish" in system and "JSON keys in English" in system


def test_explicit_language_is_repeated_at_the_end_of_the_prompt():
    assert pipeline.with_language("Question?", "te").endswith("Write your entire answer in Telugu.")
    assert pipeline.with_language("Question?", "auto") == "Question?"
