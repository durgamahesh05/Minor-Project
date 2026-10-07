from unittest.mock import Mock

import pytest
from rag.response_policy import response_policy
from rag.pipeline import MultimodalRAG


@pytest.mark.parametrize("message,selected,expected", [
    ("Explain simply", "deep", 500),
    ("Explain briefly", "detailed", 500),
    ("Explain in detail", "simple", 2000),
    ("Give me a full tutorial", "simple", 5000),
    ("Explain RAG in 3 lines", "deep", 300),
    ("Explain RAG in 100 words", "deep", 200),
    ("What is physics?", "auto", 500),
    ("Compare mass and weight", "auto", 1000),
    ("Derive this equation", "auto", 2000),
    ("Hello", "simple", 500),
    ("Explain in 100000 words", "simple", 5000),
])
def test_response_limits(message, selected, expected):
    assert response_policy(message, selected).max_tokens == expected


def test_line_instruction_is_included():
    assert "3 newline-separated lines" in response_policy("Explain in 3 lines").instruction


def test_general_answer_binds_budget_without_mutating_model():
    rag = MultimodalRAG.__new__(MultimodalRAG)
    rag.text_model = Mock()
    rag.text_model.bind.return_value.invoke.return_value.content = "An explanation"
    assert rag.general_answer("Explain in detail").answer == "An explanation"
    rag.text_model.bind.assert_called_once_with(max_tokens=2000)
    messages = rag.text_model.bind.return_value.invoke.call_args.args[0]
    assert "never pad" in messages[0].content


def test_document_answer_uses_same_policy():
    from bson import ObjectId
    rag = MultimodalRAG.__new__(MultimodalRAG)
    rag.retrieve = Mock(return_value=[{"documentId": ObjectId(), "kind": "text", "content": "Physics studies matter.", "metadata": {}}])
    rag.text_model = Mock()
    rag.text_model.bind.return_value.invoke.return_value.content = "Physics studies matter."
    rag.answer("Explain in 3 lines", ObjectId(), response_level="deep")
    rag.text_model.bind.assert_called_once_with(max_tokens=300)
