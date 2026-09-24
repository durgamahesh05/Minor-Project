# Ingestion and RAG resources

The public API routes and document ownership filters are unchanged.

| Concept | Implementation |
| --- | --- |
| Abstraction and inheritance | `ingestion/readers.py` defines an abstract `DocumentReader` and text, PDF, Word, and PowerPoint implementations. |
| Polymorphism | `file_router.py` selects a reader by extension and calls the same `read()` method. Existing `extract_text()` callers remain compatible. |
| Encapsulation | `Embedder` owns model initialization, synchronization, and cache eviction. `IOResources` owns HTTP connections and worker threads. |
| Lazy loading | Format libraries load when their reader runs. The embedding model and Qdrant store initialize on first document operation, not general chat. HTTP connections and worker threads are created on demand. |
| Caching | Each embedder holds up to 128 least-recently-used query embeddings. Keys are text hashes; returned vectors are copies. Answers, document payloads, and authorization results are not cached. |
| Pooling | MongoDB reuses up to 50 connections with a 10-second pool wait timeout. OCR shares an HTTP client with up to 10 connections and 5 keep-alive connections. |
| Threading | Up to three image summaries execute concurrently per process. Each ingestion submits worker-sized batches and preserves element order. Text chunks retain their existing direct embedding path. Model inference and initialization are protected by locks. |
| Cleanup | FastAPI lifespan shutdown drains workers, closes HTTP/Qdrant/MongoDB clients, and clears embedding caches. |

Pools and caches are local to each backend process. Additional server processes
create their own resources; local Qdrant should continue to run in a single
backend process. A remote Qdrant service is needed before scaling that storage
across processes. Concurrent requests share the three image-summary workers.
Exceptions still propagate to the existing ingestion rollback path.

Run checks from `backend` with `.venv/Scripts/python.exe -m pytest tests -q`.
The tests use fake models and mocked services; they do not measure live provider
throughput or consume paid model requests.
