create table if not exists model_call_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  stage text not null check (stage in ('processing', 'ask', 'retrieval', 'management', 'agent')),
  role text not null check (role in ('text', 'embedding', 'vision')),
  purpose text not null,
  provider text not null,
  model text not null,
  endpoint_host text,
  status text not null check (status in ('success', 'failed')),
  duration_ms integer,
  request_count integer not null default 1,
  input_chars integer,
  output_chars integer,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  resource_type text,
  resource_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists model_call_logs_user_created_idx
  on model_call_logs (user_id, created_at desc);

create index if not exists model_call_logs_user_purpose_idx
  on model_call_logs (user_id, stage, role, purpose, created_at desc);
