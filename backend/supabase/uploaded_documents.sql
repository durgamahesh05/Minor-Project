-- Run in the SQL Editor of the Supabase project configured in backend/.env.
-- Metadata only: no original files, extracted text, or embeddings.
create table if not exists public.uploaded_documents (
  document_id text primary key,
  user_id text not null,
  file_name text not null
);
create index if not exists uploaded_documents_user_id_idx
  on public.uploaded_documents(user_id);
alter table public.uploaded_documents enable row level security;
revoke all on public.uploaded_documents from anon, authenticated;
grant select, insert, update, delete on public.uploaded_documents to service_role;
-- All access goes through the backend using SUPABASE_SERVICE_ROLE_KEY.
