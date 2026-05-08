create table if not exists knowledge_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  from_type text not null check (from_type in ('source', 'wiki_page')),
  from_id uuid not null,
  to_type text not null check (to_type in ('source', 'wiki_page')),
  to_id uuid not null,
  edge_type text not null check (edge_type in ('source_wiki', 'related_wiki', 'duplicate_source', 'supports', 'contradicts')),
  weight real not null default 0,
  confidence real,
  evidence jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists knowledge_edges_from_idx on knowledge_edges (user_id, from_type, from_id, weight desc);
create index if not exists knowledge_edges_to_idx on knowledge_edges (user_id, to_type, to_id, weight desc);
create index if not exists knowledge_edges_type_idx on knowledge_edges (user_id, edge_type, updated_at desc);

insert into knowledge_edges (
  user_id,
  from_type,
  from_id,
  to_type,
  to_id,
  edge_type,
  weight,
  confidence,
  evidence,
  dedupe_key
)
select
  s.user_id,
  'source',
  swp.source_id,
  'wiki_page',
  swp.wiki_page_id,
  'source_wiki',
  1,
  coalesce(swp.confidence, 0.95),
  jsonb_build_object('reason', 'existing_source_wiki_page'),
  'source:' || swp.source_id::text || ':wiki:' || swp.wiki_page_id::text
from source_wiki_pages swp
join sources s on s.id = swp.source_id
on conflict (user_id, dedupe_key) do nothing;
