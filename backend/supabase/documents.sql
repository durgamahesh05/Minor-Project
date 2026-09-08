-- Run once in the Supabase SQL Editor for the project used by Synapse.
-- MongoDB remains the application's source of truth for users, sessions,
-- chats, quizzes, flashcards and document references. This schema exists only
-- for Supabase Storage and its minimal file-tracking metadata.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20971520, null)
on conflict (id) do update
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = null;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  file_name text not null,
  file_path text not null unique,
  file_type text not null,
  file_size bigint not null check (file_size >= 0 and file_size <= 20971520),
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists documents_user_id_created_at_idx
  on public.documents (user_id, created_at desc);

alter table public.documents enable row level security;

-- The Express server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- No browser policies are created: clients must use the authenticated backend,
-- keeping both metadata and the private bucket inaccessible directly.
