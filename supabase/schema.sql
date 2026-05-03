create extension if not exists vector;

create type capture_type as enum ('link', 'text', 'image');
create type capture_status as enum ('queued', 'processing', 'completed', 'failed');
create type job_type as enum ('process_capture');
create type job_status as enum ('queued', 'running', 'completed', 'failed');
create type wiki_page_status as enum ('draft', 'published', 'archived');

create table captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type capture_type not null,
  raw_url text,
  raw_text text,
  file_url text,
  note text,
  status capture_status not null default 'queued',
  created_at timestamptz not null default now(),
  constraint capture_has_content check (
    raw_url is not null or raw_text is not null or file_url is not null
  )
);

create table processing_jobs (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references captures(id) on delete cascade,
  user_id uuid not null,
  job_type job_type not null,
  status job_status not null default 'queued',
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references captures(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  source_type capture_type not null,
  original_url text,
  extracted_text text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table wiki_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  slug text not null,
  content_markdown text not null,
  status wiki_page_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table source_wiki_pages (
  source_id uuid not null references sources(id) on delete cascade,
  wiki_page_id uuid not null references wiki_pages(id) on delete cascade,
  relation_type text not null,
  confidence real,
  created_at timestamptz not null default now(),
  primary key (source_id, wiki_page_id)
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  parent_type text not null check (parent_type in ('source', 'wiki_page')),
  parent_id uuid not null,
  content text not null,
  embedding vector(1536),
  token_count integer,
  created_at timestamptz not null default now()
);

create index captures_user_created_idx on captures (user_id, created_at desc);
create index processing_jobs_capture_idx on processing_jobs (capture_id);
create index sources_user_created_idx on sources (user_id, created_at desc);
create index wiki_pages_user_updated_idx on wiki_pages (user_id, updated_at desc);
create index chunks_parent_idx on chunks (parent_type, parent_id);
create index chunks_embedding_idx on chunks using ivfflat (embedding vector_cosine_ops);
