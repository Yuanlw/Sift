create table if not exists sift_gateway_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  token_prefix text not null,
  display_name text not null default 'Local install',
  install_id text,
  status text not null default 'active' check (status in ('active', 'revoked')),
  plan_code text not null default 'local',
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sift_gateway_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  token_id uuid references sift_gateway_tokens(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  category text not null check (category in ('capture_processing', 'image_ocr', 'semantic_indexing', 'ask', 'retrieval')),
  credits integer not null check (credits >= 0),
  request_count integer not null default 1 check (request_count > 0),
  model_role text not null,
  purpose text not null,
  status text not null default 'success' check (status in ('reserved', 'success', 'failure', 'rejected')),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table sift_gateway_usage_ledger
  drop constraint if exists sift_gateway_usage_ledger_status_check;

alter table sift_gateway_usage_ledger
  add constraint sift_gateway_usage_ledger_status_check
  check (status in ('reserved', 'success', 'failure', 'rejected'));

create index if not exists sift_gateway_tokens_user_status_idx
  on sift_gateway_tokens (user_id, status, created_at desc);

create index if not exists sift_gateway_tokens_prefix_idx
  on sift_gateway_tokens (token_prefix);

create index if not exists sift_gateway_usage_user_period_idx
  on sift_gateway_usage_ledger (user_id, period_start, period_end, created_at desc);

create index if not exists sift_gateway_usage_token_created_idx
  on sift_gateway_usage_ledger (token_id, created_at desc);
