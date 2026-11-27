from rag.pipeline import MultimodalRAG


class Response:
    def __init__(self, content):
        self.content = content


class Model:
    def __init__(self, content):
        self.content = content

    def invoke(self, _prompt):
        return Response(self.content)


def test_router_sends_casual_chat_to_general(monkeypatch):
    rag = MultimodalRAG.__new__(MultimodalRAG)
    monkeypatch.setattr(rag, "text_model", Model("GENERAL"), raising=False)

    assert rag.route("How are you?") == "GENERAL"


def test_router_sends_document_requests_to_rag(monkeypatch):
    rag = MultimodalRAG.__new__(MultimodalRAG)
    monkeypatch.setattr(rag, "text_model", Model("DOCUMENT"), raising=False)

    assert rag.route("What does my uploaded PDF say?") == "DOCUMENT"
