# Active document storage

- MongoDB Atlas: users, document ownership/status, conversations, and original
  extracted RAG elements (including image payloads needed by multimodal RAG).
- Chroma: vectors, text chunks/image summaries, and user/document/element IDs.
- Supabase `public.uploaded_documents`: document ID, MongoDB user ID, and filename
  only. Original files are not uploaded to Supabase by the active upload route.
- Original uploaded files remain in the browser's existing private storage.

The old `supabase/documents.sql` belongs to the legacy file-storage path.
For the active metadata-only path, run `supabase/uploaded_documents.sql` in
Supabase's SQL Editor, then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
in `backend/.env`. SQL files are not executed automatically. Without these
credentials the optional Supabase mirror is skipped; MongoDB still tracks files.
Do not put the service-role key in React environment variables.

## Chroma configuration

Select `VECTOR_STORE=chroma` and `CHROMA_MODE=cloud` to use the Cloud dashboard.
For local-only storage, use `CHROMA_MODE=local` and `CHROMA_PATH=chroma_db`.
The local path is relative to `backend`, regardless of where the process starts.
Install backend requirements in its virtual environment.
Use `.venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000` there.
`GET /health/chroma` reports the active Chroma mode, collections, and counts.
Local collections do not appear in the Chroma Cloud dashboard.

For production, set `CHROMA_MODE=cloud` with `CHROMA_API_KEY`, `CHROMA_TENANT`,
and `CHROMA_DATABASE`, or `CHROMA_MODE=server` with `CHROMA_HOST`, `CHROMA_PORT`,
and `CHROMA_SSL=true`. A self-hosted server needs persistent storage and a
private/restricted network. Production mode rejects local Chroma on an ephemeral
application filesystem. Keep MongoDB and embedding-model settings the same
across ingestion and retrieval. The existing BGE model remains unchanged.

Existing Qdrant vectors are not moved by changing configuration. With the backend
stopped, run `.venv/Scripts/python.exe sync_document_stores.py` to re-embed saved
MongoDB summaries into Chroma and mirror document names to Supabase. This is
idempotent and leaves Qdrant untouched. Configure the Supabase table first if
its credentials are present. Re-uploading documents is another option.
Changing the embedding model requires a new collection and rebuilding its index.

The extraction -> chunking -> embedding -> retrieval -> Groq flow is retained.
Chroma searches always filter by user ID and, when selected, document ID.
Qdrant remains available with `VECTOR_STORE=qdrant`; an unset provider retains
that legacy default for compatibility.

# Ingestion and RAG resources

Chat accepts up to five attachments, each up to 20 MB, with two concurrent
uploads and individual progress/errors. Supported formats include PDF, DOCX,
PPTX, XLSX, common images, and text/code formats including CSV, Markdown and JSON.
All selected IDs are checked for ownership and completed indexing before use.
Answers retrieve context from every selected file; study generation uses the
same selection. After a reply the composer clears its file cards while retaining
the selection for follow-up questions and preserving attachment cards in history.

MongoDB ownership and sorting indexes are checked in the background at startup.
Uploads complete after MongoDB and Chroma indexing; the optional Supabase metadata
mirror runs afterward. A failed mirror is recorded as `metadataSync=failed`
without deleting successfully indexed content. No data is automatically migrated
between local Chroma and Chroma Cloud. The first model load and image OCR/vision
still contribute to upload time; subsequent uploads reuse the model and clients.

The public API routes and document ownership filters are unchanged.

| Concept | Implementation |
| --- | --- |
| Abstraction and inheritance | `ingestion/readers.py` defines an abstract `DocumentReader` and text, PDF, Word, and PowerPoint implementations. |
| Polymorphism | `file_router.py` selects a reader by extension and calls the same `read()` method. Existing `extract_text()` callers remain compatible. |
| Encapsulation | `Embedder` owns model initialization, synchronization, and cache eviction. `IOResources` owns HTTP connections and worker threads. |
| Lazy loading | Format libraries load when their reader runs. The embedding model and selected vector store initialize on first document operation, not general chat. HTTP connections and worker threads are created on demand. |
| Caching | Each embedder holds up to 128 least-recently-used query embeddings. Keys are text hashes; returned vectors are copies. Answers, document payloads, and authorization results are not cached. |
| Pooling | MongoDB reuses up to 50 connections with a 10-second pool wait timeout. OCR shares an HTTP client with up to 10 connections and 5 keep-alive connections. |
| Threading | Up to three image summaries execute concurrently per process. Each ingestion submits worker-sized batches and preserves element order. Text chunks retain their existing direct embedding path. Model inference and initialization are protected by locks. |
| Cleanup | FastAPI lifespan shutdown drains workers, closes supported HTTP/vector/MongoDB clients, and clears embedding caches. |

Pools and caches are local to each backend process. Additional server processes
create their own resources; local Qdrant should continue to run in a single
backend process. A remote Qdrant service is needed before scaling that storage
across processes. Concurrent requests share the three image-summary workers.
Exceptions still propagate to the existing ingestion rollback path.

PDF ingestion normalizes repeated embedded images once per upload. OCR runs on
unique images through the shared three-worker pool; each repeated occurrence
keeps its own chunk ID and page metadata. Scanned-page rendering reuses one
PDFium document and releases page/bitmap memory after copying each image.
No page or image is omitted to make the upload look complete sooner.

`OCR_TIMEOUT_SECONDS` defaults to 12 (bounded to 1–45 seconds). When OCR fails,
the image is retained for the existing vision path. Vision retrieval summaries
have a 512-token output limit and a 30-second request timeout with one retry.
Backend logs report extraction/OCR, image-summary, embedding, and storage times
separately. The first embedding-model load and large scanned documents can
still take longer; the UI waits for indexing to succeed before enabling send.

Run checks from `backend` with `.venv/Scripts/python.exe -m pytest tests -q`.
The tests use fake models and mocked services; they do not measure live provider
throughput or consume paid model requests.
