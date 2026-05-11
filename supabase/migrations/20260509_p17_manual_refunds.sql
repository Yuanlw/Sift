create table if not exists manual_refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  requested_by_user_id uuid references users(id) on delete set null,
  processed_by_user_id uuid references users(id) on delete set null,
  user_email text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'CNY',
  status text not null default 'requested' check (status in ('requested', 'paid', 'cancelled')),
  reason text not null,
  payment_reference text,
  offline_transfer_method text,
  offline_reference text,
  plan_code_snapshot text,
  stripe_customer_id_snapshot text,
  stripe_subscription_id_snapshot text,
  notes text,
  subscription_cancelled_at timestamptz,
  gateway_tokens_reviewed_at timestamptz,
  quota_reviewed_at timestamptz,
  user_contacted_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manual_refunds_user_created_idx on manual_refunds (user_id, created_at desc);
create index if not exists manual_refunds_status_created_idx on manual_refunds (status, created_at desc);

alter table manual_refunds add column if not exists subscription_cancelled_at timestamptz;
alter table manual_refunds add column if not exists gateway_tokens_reviewed_at timestamptz;
alter table manual_refunds add column if not exists quota_reviewed_at timestamptz;
alter table manual_refunds add column if not exists user_contacted_at timestamptz;

create table if not exists support_case_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  admin_user_id uuid references users(id) on delete set null,
  user_email text not null,
  issue_type text not null,
  contact_status text not null default 'not_contacted' check (contact_status in ('not_contacted', 'contacted', 'waiting_user', 'resolved')),
  note text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_case_notes_user_created_idx on support_case_notes (user_id, created_at desc);
create index if not exists support_case_notes_issue_created_idx on support_case_notes (issue_type, created_at desc);
