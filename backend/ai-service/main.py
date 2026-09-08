"""Synapse AI service (scaffold).

Not wired up to the Node/Express backend yet. Once RAG is implemented, the
Express backend's generateAssistantReply() (backend/src/routes/chat.routes.js)
should call this service's /api/rag/query instead of returning a stub reply.
"""

import os

import chromadb  # pyright: ignore[reportMissingImports]
from dotenv import load_dotenv
from fastapi import FastAPI
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="Synapse AI Service")

SCAFFOLD_ANSWERS = {
    "en": "RAG is not implemented yet — this is a scaffold endpoint.",
    "hi": "RAG अभी लागू नहीं किया गया है — यह एक प्रारंभिक एंडपॉइंट है।",
    "te": "RAG ఇంకా అమలు కాలేదు — ఇది ఒక ప్రాథమిక ఎండ్‌పాయింట్.",
    "es": "RAG aún no está implementado; este es un endpoint inicial.",
    "fr": "Le RAG n’est pas encore implémenté ; ceci est un endpoint de base.",
}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/chroma")
def health_chroma():
    """Confirms the ChromaDB Cloud credentials in .env are valid."""
    api_key = os.getenv("CHROMA_API_KEY")
    tenant = os.getenv("CHROMA_TENANT")
    database = os.getenv("CHROMA_DATABASE")
    if not (api_key and tenant and database):
        return {"status": "not configured"}

    client = chromadb.CloudClient(api_key=api_key, tenant=tenant, database=database)
    collections = client.list_collections()
    return {"status": "ok", "collections": [c.name for c in collections]}


class RagQueryRequest(BaseModel):
    question: str
    conversation_id: str | None = None
    language: str = "auto"


@app.post("/api/rag/query")
def rag_query(req: RagQueryRequest):
    # TODO: embed the question, retrieve relevant chunks from ChromaDB,
    # and call an LLM (e.g. Google Gemini) with the retrieved context.
    return {
        "answer": SCAFFOLD_ANSWERS.get(req.language, SCAFFOLD_ANSWERS["en"]),
        "sources": [],
    }
