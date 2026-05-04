create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  status text not null check (status in ('success', 'failure', 'denied')),
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_user_created_idx
  on audit_logs (user_id, created_at desc);

create index if not exists audit_logs_resource_idx
  on audit_logs (resource_type, resource_id, created_at desc);
