create table if not exists smart_quota_accounts (
  user_id uuid primary key,
  plan_code text not null default 'local',
  enforcement_mode text not null default 'unlimited' check (enforcement_mode in ('unlimited', 'soft_limit', 'hard_limit')),
  monthly_credit_limit integer,
  period_anchor_day integer not null default 1 check (period_anchor_day >= 1 and period_anchor_day <= 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists smart_quota_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  category text not null check (category in ('capture_processing', 'image_ocr', 'semantic_indexing', 'ask', 'retrieval')),
  credits integer not null check (credits > 0),
  stage text not null,
  role text not null,
  purpose text not null,
  model_call_log_id uuid references model_call_logs(id) on delete set null,
  resource_type text,
  resource_id text,
  calculation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists smart_quota_ledger_user_period_idx
  on smart_quota_ledger (user_id, period_start, period_end, created_at desc);

create index if not exists smart_quota_ledger_user_category_idx
  on smart_quota_ledger (user_id, category, created_at desc);
