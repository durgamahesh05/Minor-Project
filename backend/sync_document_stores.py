"""Rebuild the configured vector index from MongoDB records.

Run with the backend stopped: python sync_document_stores.py
Does not delete source records or upload original files to Supabase.
"""
from pathlib import Path
import os

from dotenv import load_dotenv
from db import create_mongo_client, get_database

from document_storage import supabase_api_configured, sync_upload_metadata
from embeddings.embedder import Embedder
from vectorstore.chroma import ChromaVectorStore
from vectorstore.supabase import SupabaseVectorStore


def main():
    load_dotenv(Path(__file__).resolve().parent / ".env")
    provider = os.getenv("VECTOR_STORE", "supabase").lower()
    if provider not in {"chroma", "supabase"}:
        raise RuntimeError("Set VECTOR_STORE to chroma or supabase before rebuilding its index")
    embedder = Embedder()
    store = None
    try:
        with create_mongo_client(os.environ["MONGODB_URI"]) as client:
            db = get_database(client)
            documents = chunks = 0
            for document in db.documents.find({"status": "indexed"}):
                batch = []
                for element in db.rag_elements.find({"documentId": document["_id"], "userId": document["userId"]}):
                    batch.append(element)
                    if len(batch) == 64:
                        store = write_batch(store, embedder, batch, provider)
                        chunks += len(batch)
                        batch = []
                if batch:
                    store = write_batch(store, embedder, batch, provider)
                    chunks += len(batch)
                sync_upload_metadata(document)
                documents += 1
            print(f"Synchronized {documents} documents and {chunks} chunks to {provider}.")
            if provider == "supabase" and not supabase_api_configured():
                print("Supabase metadata skipped: backend credentials are missing.")
    finally:
        if store is not None:
            close = getattr(store, "close", None)
            if callable(close):
                close()
        embedder.clear_cache()


def write_batch(store, embedder, elements, provider):
    summaries = [e["summary"] for e in elements]
    vectors = embedder.embed(summaries)
    if len(vectors) != len(elements):
        raise RuntimeError("Embedding count mismatch")
    if store is None:
        store_type = ChromaVectorStore if provider == "chroma" else SupabaseVectorStore
        store = store_type(len(vectors[0]))
    store.upsert([{"id": e["_id"], "vector": v, "payload": {
        "element_id": e["_id"], "document_id": str(e["documentId"]),
        "user_id": str(e["userId"]), "kind": e["kind"], "summary": e["summary"]}}
        for e, v in zip(elements, vectors)])
    return store


if __name__ == "__main__":
    main()
