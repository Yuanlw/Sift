alter table smart_quota_accounts
  add column if not exists quota_source text not null default 'local' check (quota_source in ('local', 'stripe', 'manual')),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text;

create index if not exists smart_quota_accounts_stripe_customer_idx
  on smart_quota_accounts (stripe_customer_id);

create index if not exists smart_quota_accounts_stripe_subscription_idx
  on smart_quota_accounts (stripe_subscription_id);
