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
    monkeypatch.delenv("GROQ_API_KEYS", raising=False)
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
    monkeypatch.delenv("GROQ_API_KEYS", raising=False)
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


def test_each_model_is_tried_on_every_key_before_the_next_model(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "key-1")
    monkeypatch.setenv("GROQ_API_KEYS", " key-2,key-3 ,key-1,")
    monkeypatch.setenv("GROQ_TEXT_MODEL", "model-a")
    monkeypatch.setenv("GROQ_FALLBACK_MODELS", "model-b,model-c")
    assert pipeline.groq_api_keys() == ["key-1", "key-2", "key-3"]
    model = pipeline.build_text_model()
    chain = [model.runnable, *model.fallbacks]
    assert [(m.model_name, m.groq_api_key.get_secret_value()) for m in chain] == [
        (name, key) for name in ("model-a", "model-b", "model-c") for key in ("key-1", "key-2", "key-3")]
    # Only the very last option retries; everything else hands off immediately.
    assert [m.max_retries for m in chain] == [0] * 8 + [2]
    import groq
    assert groq.AuthenticationError in model.exceptions_to_handle


def test_vision_model_rotates_keys(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "key-1")
    monkeypatch.setenv("GROQ_API_KEYS", "key-2")
    model = pipeline.build_vision_model()
    assert [m.groq_api_key.get_secret_value() for m in (model.runnable, *model.fallbacks)] == ["key-1", "key-2"]
    assert model.fallbacks[-1].max_retries == 1 and model.runnable.request_timeout == 30


def test_rate_limited_key_hands_off_to_the_next_key(monkeypatch):
    import httpx, groq
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_groq import ChatGroq
    monkeypatch.setenv("GROQ_API_KEY", "key-1")
    monkeypatch.setenv("GROQ_API_KEYS", "key-2")
    monkeypatch.setenv("GROQ_FALLBACK_MODELS", "")
    used = []

    def fake_generate(self, messages, stop=None, run_manager=None, **kwargs):
        key = self.groq_api_key.get_secret_value()
        used.append(key)
        if key == "key-1":
            response = httpx.Response(429, request=httpx.Request("POST", "https://api.groq.com"))
            raise groq.RateLimitError("rate limited", response=response, body=None)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="answer"))])

    monkeypatch.setattr(ChatGroq, "_generate", fake_generate)
    assert pipeline.build_text_model().invoke("hi").content == "answer"
    assert used == ["key-1", "key-2"]
