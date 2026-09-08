# Synapse AI

An AI-powered study assistant — MERN foundation (MongoDB, Express, React, Node), with a Python/FastAPI + ChromaDB service scaffolded for the RAG features described in the project brief.

## Structure

```
frontend/     React + Vite + TypeScript + Tailwind + shadcn/ui
backend/      Node.js + Express + MongoDB (Mongoose), session-based auth
ai-service/   Python + FastAPI + ChromaDB (scaffold — not wired up yet)
```

## Current server layout

The FastAPI application that the frontend uses is `backend/main.py` and runs on
port 5000. The retained Chroma/RAG scaffold, including its existing `.env`, now
lives at `backend/ai-service/`; run it from that directory if you need it:

```
cd backend\ai-service
C:\Users\durga\AppData\Local\Programs\Python\Python310\python.exe -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Use Python 3.10 for the Chroma service. Python 3.13 has no compatible NumPy
wheel for its pinned dependency and otherwise attempts a local compiler build.

## Running locally

Each service runs independently, in its own terminal.

Python packages belong only in `ai-service/requirements.txt`. The frontend and
backend are Node.js applications: their separate dependency manifests are
`frontend/package.json` and `backend/package.json`, and they must be installed
with `npm install` from those folders. Do not run `pip install -r requirements.txt`
from the repository root or from `backend` because no such Python file exists there.

### 1. Backend (Express API)

```
cd backend
npm install
npm run dev
```

Runs on `http://localhost:5000`.

Set `AI_SERVICE_URL=http://localhost:8000` in `backend/.env` to enable the AI
service. If it is unavailable, chat continues to use the existing fallback reply.
Do not run `backend/main.py` on port 5000: it is an obsolete prototype and
does not provide the Express account-deletion implementation used by the UI.

### 2. Frontend

```
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173`.

### 3. AI service (optional, scaffold only)

```
cd ai-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Runs on `http://localhost:8000`. Not called by the backend yet — `POST /api/rag/query` returns a placeholder until RAG (embeddings + Gemini) is implemented.

### Supabase document storage

Supabase is used only for uploaded-file storage and the small file metadata
table. MongoDB remains the application-data store; ChromaDB remains reserved
for embeddings and vector search.

1. In the Supabase SQL Editor, run [`backend/supabase/documents.sql`](backend/supabase/documents.sql).
   It creates a private `documents` bucket, enforces a 20 MB object limit, and
   creates the minimal `public.documents` metadata table.
2. Copy `backend/.env.example` to `backend/.env` and set `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`. Keep the service-role key server-side only and
   never commit it or expose it through Vite.

Every upload is stored as `userId/random-file-name.ext` in the private bucket.
The backend authorizes ownership before issuing a 60-second download URL. Files
of any type are accepted up to 20 MB; downstream AI processing can selectively
handle the study formats it supports.

### AI service and the `chromadb` Pylance warning

The warning means the selected VS Code interpreter does not contain the package;
it is not a problem in `main.py`. Use Python 3.10, create the AI service's own
environment, install the existing requirements, then choose
`ai-service/.venv/Scripts/python.exe` with **Python: Select Interpreter**:

```
cd ai-service
py -3.10 -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
```

## What's implemented

- User registration with OTP email verification (two-step: `POST /api/auth/register` stashes the signup and returns a code, `POST /api/auth/verify-registration` checks it and only then creates the account/session — no account exists until verified), login, logout (bcrypt + server-side sessions stored in MongoDB)
- Forgot / reset password (token-based). Since no email service is configured, both this and the registration OTP are returned directly in the API response instead of being emailed — see the comments in `backend/src/routes/auth.routes.js`
- Chat conversations and messages persisted per-user in MongoDB
- Document upload (PDF/DOC/DOCX/PPT/PPTX) stored on local disk (`backend/uploads/`, gitignored), metadata in MongoDB
- Quiz and flashcard generation, saved per-user in MongoDB — content is currently stub placeholder text
- A Postman collection ([`Synapse.postman_collection.json`](Synapse.postman_collection.json)) covering all of the above, plus the AI service health checks

All "generated" content (chat replies, quiz questions, flashcards) is placeholder text for now — each has one clearly-marked function to swap for a real call to `ai-service`/an LLM once RAG is built:
- `backend/src/routes/chat.routes.js` → `generateAssistantReply`
- `backend/src/routes/quiz.routes.js` → `generateStubQuiz`
- `backend/src/routes/flashcard.routes.js` → `generateStubFlashcards`

## Original design

The frontend UI was originally exported from Figma Make ("Complete SaaS App Screens"); see [`frontend/ATTRIBUTIONS.md`](frontend/ATTRIBUTIONS.md) for third-party licenses (shadcn/ui, Unsplash).
