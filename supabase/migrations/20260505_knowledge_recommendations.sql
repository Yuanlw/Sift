create table if not exists knowledge_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_id uuid not null references sources(id) on delete cascade,
  trigger_source_id uuid references sources(id) on delete set null,
  reason text not null,
  score real not null default 0,
  status text not null default 'active' check (status in ('active', 'dismissed')),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists knowledge_recommendations_user_rank_idx
  on knowledge_recommendations (user_id, status, updated_at desc, score desc);

create index if not exists knowledge_recommendations_source_idx
  on knowledge_recommendations (source_id, updated_at desc);
