create table if not exists ask_histories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  scope_type text not null check (scope_type in ('wiki_page', 'source', 'global')),
  scope_id uuid,
  question text not null,
  answer text not null,
  citations jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ask_histories_scope_created_idx
  on ask_histories (user_id, scope_type, scope_id, created_at desc);
