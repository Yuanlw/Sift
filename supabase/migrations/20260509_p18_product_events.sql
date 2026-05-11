create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  event_name text not null,
  resource_type text,
  resource_id text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists product_events_user_event_idx on product_events (user_id, event_name, occurred_at desc);
create index if not exists product_events_event_time_idx on product_events (event_name, occurred_at desc);
