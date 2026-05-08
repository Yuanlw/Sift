create table if not exists auth_rate_limits (
  key text primary key,
  scope text not null,
  attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists auth_rate_limits_locked_until_idx on auth_rate_limits (locked_until);
