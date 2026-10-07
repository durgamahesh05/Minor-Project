"""Rebuild Chroma and mirror metadata from existing MongoDB records.

Run with the backend stopped: python sync_document_stores.py
Does not delete existing Qdrant data or upload original files to Supabase.
"""
from pathlib import Path
import os

from dotenv import load_dotenv
from pymongo import MongoClient

from document_storage import sync_upload_metadata
from embeddings.embedder import Embedder
from vectorstore.chroma import ChromaVectorStore


def main():
    load_dotenv(Path(__file__).resolve().parent / ".env")
    if os.getenv("VECTOR_STORE") != "chroma":
        raise RuntimeError("Set VECTOR_STORE=chroma before rebuilding its index")
    embedder = Embedder()
    store = None
    with MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=10000) as client:
        db = client.get_database("SynapseAI")
        documents = chunks = 0
        for document in db.documents.find({"status": "indexed"}):
            batch = []
            for element in db.rag_elements.find({"documentId": document["_id"], "userId": document["userId"]}):
                batch.append(element)
                if len(batch) == 64:
                    store = write_batch(store, embedder, batch)
                    chunks += len(batch)
                    batch = []
            if batch:
                store = write_batch(store, embedder, batch)
                chunks += len(batch)
            sync_upload_metadata(document)
            documents += 1
        print(f"Synchronized {documents} documents and {chunks} chunks to Chroma.")
        if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
            print("Supabase metadata skipped: backend credentials are missing.")


def write_batch(store, embedder, elements):
    summaries = [e["summary"] for e in elements]
    vectors = embedder.embed(summaries)
    if len(vectors) != len(elements):
        raise RuntimeError("Embedding count mismatch")
    if store is None:
        store = ChromaVectorStore(len(vectors[0]))
    store.upsert([{"id": e["_id"], "vector": v, "payload": {
        "element_id": e["_id"], "document_id": str(e["documentId"]),
        "user_id": str(e["userId"]), "kind": e["kind"], "summary": e["summary"]}}
        for e, v in zip(elements, vectors)])
    return store


if __name__ == "__main__":
    main()
