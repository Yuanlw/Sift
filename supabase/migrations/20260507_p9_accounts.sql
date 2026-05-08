create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text,
  password_hash text not null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_normalized check (email = lower(trim(email))),
  unique (email)
);

create table if not exists user_sessions (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip_address text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists users_email_idx on users (email);
create index if not exists user_sessions_user_created_idx on user_sessions (user_id, created_at desc);
create index if not exists user_sessions_expires_idx on user_sessions (expires_at);
