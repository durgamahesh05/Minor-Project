# Storage and RAG architecture

- MongoDB stores users, document ownership and status, conversations, messages,
  and extracted RAG elements, including image payloads.
- Supabase Postgres stores vectors in `public.document_vectors` and document
  names/ownership in `public.uploaded_documents`.
- Original uploaded files are stored in the browser's origin-private storage
  (IndexedDB metadata and OPFS file bytes). Returning to a conversation on the
  same browser can restore its document selection while MongoDB supplies chat
  history and extracted RAG content.

## Supabase setup

Set `SUPABASE_DB_URL` to the project's PostgreSQL connection string. Keep it on
the backend and use a database role allowed to create the `vector` extension,
schemas, tables, indexes, and grants. Set `SUPABASE_VECTOR_DIMENSIONS` to match
the configured embedding model (384 for the default BGE model) and
`VECTOR_STORE=supabase`.

The Python `SupabaseVectorStore` creates the `extensions` schema when needed,
enables pgvector, and creates both application tables and indexes on its first
initialization. It enables row-level security and grants table access to the
backend's `service_role`. No SQL editor step or migration file is needed for
these tables. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are optional and
only enable the existing metadata mirror through Supabase's REST API. Never put
server credentials in frontend environment variables.

## Vector storage

Supabase is the default vector provider. Each search filters by user ID and can
also filter by document ID. The vector table uses cosine distance and an HNSW
index. Chroma and Qdrant adapters remain available by selecting
`VECTOR_STORE=chroma` or `VECTOR_STORE=qdrant`.

Existing vectors are not moved by changing providers. With the backend stopped,
run `.venv/Scripts/python.exe sync_document_stores.py` to re-embed saved MongoDB
elements into the configured provider. The operation is repeatable and leaves
the source MongoDB elements intact. Changing the embedding model requires
rebuilding the vector index.

## Ingestion and chat

Chat accepts up to five attachments, each up to 10 MB, with per-file progress
and errors. Selected IDs are checked for ownership and indexing status. Answers
retrieve context from every selected file; study generation uses the same
selection. Conversation history remains in MongoDB. On the same browser,
locally retained uploads can be reselected when returning to a conversation.

The API routes and JSON response shapes remain compatible with the frontend.
The extraction, chunking, embedding, retrieval, and Groq response flow remains
in the Python backend.
