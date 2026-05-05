create table if not exists knowledge_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  discovery_type text not null check (discovery_type in ('new_source', 'related_wiki', 'duplicate_source', 'suggested_question')),
  title text not null,
  body text not null,
  source_id uuid references sources(id) on delete cascade,
  wiki_page_id uuid references wiki_pages(id) on delete cascade,
  related_source_id uuid references sources(id) on delete set null,
  related_wiki_page_id uuid references wiki_pages(id) on delete set null,
  suggested_question text,
  status text not null default 'new' check (status in ('new', 'seen', 'ignored')),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists knowledge_discoveries_user_created_idx
  on knowledge_discoveries (user_id, status, created_at desc);

create index if not exists knowledge_discoveries_source_idx
  on knowledge_discoveries (source_id, created_at desc);
