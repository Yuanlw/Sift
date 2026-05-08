create table if not exists wiki_merge_histories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  target_wiki_page_id uuid not null references wiki_pages(id) on delete cascade,
  merged_wiki_page_id uuid references wiki_pages(id) on delete set null,
  discovery_id uuid references knowledge_discoveries(id) on delete set null,
  before_title text not null,
  before_content_markdown text not null,
  after_title text not null,
  after_content_markdown text not null,
  merged_source_ids jsonb not null default '[]'::jsonb,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wiki_merge_histories_target_created_idx
  on wiki_merge_histories (user_id, target_wiki_page_id, created_at desc);
