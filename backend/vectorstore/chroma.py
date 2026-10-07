"""Chroma adapter using backend-generated embeddings and ownership filters."""
import os
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from chromadb.api.types import Where


def chroma_client():
    import chromadb

    mode = os.getenv("CHROMA_MODE", "local").lower()
    if mode == "cloud":
        return chromadb.CloudClient(api_key=os.environ["CHROMA_API_KEY"],
                                   tenant=os.environ["CHROMA_TENANT"],
                                   database=os.environ["CHROMA_DATABASE"])
    if mode == "server":
        return chromadb.HttpClient(host=os.environ["CHROMA_HOST"],
                                   port=int(os.getenv("CHROMA_PORT", "8000")),
                                   ssl=os.getenv("CHROMA_SSL", "false").lower() == "true")
    if mode != "local":
        raise ValueError("CHROMA_MODE must be local, server, or cloud")
    if os.getenv("ENVIRONMENT", "development").lower() == "production":
        raise RuntimeError("Use CHROMA_MODE=server or cloud in production")
    path = Path(os.getenv("CHROMA_PATH", "chroma_db"))
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[1] / path
    return chromadb.PersistentClient(path=str(path))


class ChromaVectorStore:
    def __init__(self, vector_size: int):
        self.client = chroma_client()
        self.collection = self.client.get_or_create_collection(
            name=os.getenv("CHROMA_COLLECTION", "synapse_documents"),
            embedding_function=None, metadata={"hnsw:space": "cosine"})

    def upsert(self, records):
        batch_size = min(100, self.client.get_max_batch_size())
        for offset in range(0, len(records), batch_size):
            batch = records[offset:offset + batch_size]
            self.collection.upsert(
                ids=[r["id"] for r in batch],
                embeddings=[r["vector"] for r in batch],
                documents=[r["payload"]["summary"] for r in batch],
                metadatas=[{k: v for k, v in r["payload"].items() if k != "summary"} for r in batch])

    def search(self, vector, user_id, limit=5, document_id=None):
        where: "Where" = {"user_id": user_id}
        if document_id:
            where = {"$and": [where, {"document_id": document_id}]}
        count = self.collection.count()
        if not count or limit <= 0:
            return []
        result = self.collection.query(query_embeddings=[vector], where=where,
                                       n_results=min(limit, count), include=["metadatas", "distances"])
        metadatas, distances = result["metadatas"], result["distances"]
        if not metadatas or not distances:
            return []
        return [SimpleNamespace(payload=metadata, score=1.0-distance)
                for metadata, distance in zip(metadatas[0], distances[0])]

    def delete_document(self, document_id):
        self.collection.delete(where={"document_id": document_id})
