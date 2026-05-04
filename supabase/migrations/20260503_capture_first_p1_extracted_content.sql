create table if not exists extracted_contents (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null unique references captures(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  content_text text not null,
  content_format text not null default 'plain_text',
  extraction_method text not null,
  status text not null check (status in ('extracted', 'fallback')),
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists extracted_contents_capture_idx
  on extracted_contents (capture_id, created_at desc);

create unique index if not exists extracted_contents_capture_unique_idx
  on extracted_contents (capture_id);

create unique index if not exists sources_capture_unique_idx
  on sources (capture_id);
