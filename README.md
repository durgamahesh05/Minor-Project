# Synapse AI

Synapse AI is a study assistant for asking questions about course materials and creating study resources. The web client is built with React, TypeScript, and Vite. A FastAPI service handles authentication, document processing, retrieval-augmented generation (RAG), and persistence.

## Features

- Register and sign in with email verification, session-based authentication, and password recovery.
- Upload and ask questions about PDF, DOCX, PPTX, XLSX, text, code, CSV, and common image files.
- Chat with up to five selected documents and generate study materials from them.
- Extract and index document content for retrieval, including OCR and image understanding.
- Store application data in MongoDB and vectors in Supabase pgvector by default. Chroma and Qdrant adapters are also available.

## Architecture

| Component | Technology | Responsibility |
| --- | --- | --- |
| Web client | React, TypeScript, Vite | User interface, document selection, and browser-side file retention |
| API | Python 3.11, FastAPI | Authentication, document ingestion, chat, and study-material endpoints |
| Application database | MongoDB / PyMongo | Accounts, document status and extracted content, conversations, and messages |
| Vector database | Supabase Postgres / pgvector (default) | Embedding storage and similarity search; Chroma and Qdrant adapters are also available |
| Embeddings | FastEmbed, BGE small English model | Local generation of document and query vectors |
| Language models | Groq | Chat responses, study material generation, and image descriptions |
| Original file storage | Browser OPFS and IndexedDB | Original uploaded file bytes and local document metadata |

Original uploaded files are retained in the browser's origin-private storage. MongoDB stores extracted content needed for RAG and conversation history. Vector records are filtered by user and may also be filtered by document. See [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md) for storage, provider switching, and vector reindexing details.

## Requirements

| Requirement | Version or configuration | Purpose |
| --- | --- | --- |
| Python | 3.11 | Runs the FastAPI backend and document/RAG pipeline |
| Node.js and npm | Node.js 20 or newer | Installs and runs the React/Vite frontend |
| MongoDB | Reachable database and connection URI | Persistent application data |
| Supabase PostgreSQL | Database connection URI with required pgvector/table privileges | Default vector store; can be replaced with Chroma or Qdrant |
| Groq | API key | AI responses and study-material generation |
| SMTP | Optional server credentials | Delivers registration and password-reset messages |

In development, the application can display the verification code when email is not configured. For production, configure SMTP to deliver account messages.

## Local development

### 1. Configure the backend

```powershell
cd backend
Copy-Item .env.example .env
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Edit `backend/.env` and provide at least:

```dotenv
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority
MONGODB_DATABASE=SynapseAI
SESSION_SECRET=<long-random-secret>
CLIENT_URL=http://localhost:5173
GROQ_API_KEY=<groq-api-key>
SUPABASE_DB_URL=<postgresql-connection-string>
SUPABASE_VECTOR_DIMENSIONS=384
VECTOR_STORE=supabase
```

The following table summarizes the backend settings. The checked-in [backend/.env.example](backend/.env.example) lists additional SMTP and Supabase metadata-mirror settings.

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection URI; URL-encode reserved characters in credentials. |
| `MONGODB_DATABASE` | No | Database name; defaults to `SynapseAI`. |
| `SESSION_SECRET` | Yes for deployment | Secret used to sign browser sessions. Set a unique, long random value. |
| `CLIENT_URL` | Yes for deployment | Comma-separated frontend origins allowed by the API CORS policy. Do not include paths or trailing slashes. |
| `VERCEL_PREVIEW_ORIGIN_REGEX` | Optional | Anchored regex for this project's Vercel preview origins. Scope it to your project and team. |
| `GROQ_API_KEY` | For AI features | Key for chat, study generation, and image understanding. |
| `VECTOR_STORE` | No | Vector adapter: `supabase` (default), `chroma`, or `qdrant`. |
| `SUPABASE_DB_URL` | When using Supabase | Backend PostgreSQL connection string; role needs extension, schema, table, index, and grant privileges. |
| `SUPABASE_VECTOR_DIMENSIONS` | No | Vector width; defaults to `384` for the configured default embedding model. |
| `SUPABASE_URL` and `SUPABASE_SECRET_KEY` | No | Enable the Supabase REST metadata mirror; the service-role key can be supplied as `SUPABASE_SERVICE_ROLE_KEY`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` | For email delivery | SMTP configuration for verification and password-reset messages. |
| `ENVIRONMENT` | No | Set to `production` in deployed environments to disable development OTP disclosure. |

The Supabase connection is used by the backend to create and access the pgvector extension and application tables. Keep database URLs, API keys, and session secrets out of frontend environment variables and version control.

To send account emails, also configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and optionally `SMTP_FROM`. `ENVIRONMENT=production` disables development OTP disclosure and enables secure cross-site session cookies. Set `CLIENT_URL` to the frontend origin(s), separated by commas, and use a strong unique `SESSION_SECRET`. If you use Vercel preview deployments, set `VERCEL_PREVIEW_ORIGIN_REGEX` to an anchored expression matching only preview URLs for your project and team. For example, `^https://minor-project-[a-z0-9]+-your-team-projects\.vercel\.app$`.

Run the API from the `backend` directory:

```powershell
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The API is available at `http://localhost:8000`; interactive OpenAPI docs are at `http://localhost:8000/docs`.

### 2. Configure and run the frontend

In a second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Vite serves the app at `http://localhost:5173`. The client defaults to the API at `http://localhost:8000`; set `VITE_API_URL` when using another API origin.

## Vector store providers

Supabase is the default and expects `SUPABASE_DB_URL`. To use another adapter, set `VECTOR_STORE=chroma` or `VECTOR_STORE=qdrant` and configure the provider-specific values described in [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md). Chroma supports local, server, and cloud modes; Qdrant supports local storage or a configured remote URL.

Changing providers does not move existing vectors. Stop the backend and run the reindex script from `backend` after configuring the target provider:

```powershell
python sync_document_stores.py
```

The script re-embeds saved MongoDB content. Rebuild the index if the embedding model or vector dimensions change.

## Tests and production build

Run backend tests from `backend`:

```powershell
python -m pytest
```

Build the frontend from `frontend`:

```powershell
npm run build
```

## API and project layout

The FastAPI entry point is `backend/main.py`. Routes and response shapes are consumed by `frontend/src/app/lib/api.ts`. The Postman collection is [`Synapse.postman_collection.json`](Synapse.postman_collection.json).

```text
backend/    FastAPI API, MongoDB persistence, ingestion, RAG, and vector adapters
frontend/   React, TypeScript, and Vite application
```

## Security and operations

- Never commit `.env` files or expose backend secrets through `VITE_*` variables.
- Use HTTPS, a strong session secret, restricted database access, and production SMTP settings when deploying.
- The API creates MongoDB indexes during startup. The Supabase vector adapter initializes its extension, tables, and indexes when first used; the backend database role must have the required privileges.
- Uploaded files are limited to 10 MB each and up to five attachments per message.

For MongoDB Atlas network-access guidance, see [backend/ATLAS_SETUP.md](backend/ATLAS_SETUP.md).
