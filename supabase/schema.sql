create extension if not exists vector;
create extension if not exists pgcrypto;

create type capture_type as enum ('link', 'text', 'image');
create type capture_status as enum ('queued', 'processing', 'completed', 'failed', 'ignored');
create type job_type as enum ('process_capture');
create type job_status as enum ('queued', 'running', 'completed', 'failed');
create type wiki_page_status as enum ('draft', 'published', 'archived');

create table captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type capture_type not null,
  raw_url text,
  raw_text text,
  file_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  raw_attachments jsonb not null default '[]'::jsonb,
  note text,
  status capture_status not null default 'queued',
  created_at timestamptz not null default now(),
  constraint capture_has_content check (
    raw_url is not null
    or raw_text is not null
    or file_url is not null
    or jsonb_array_length(raw_attachments) > 0
  )
);

create table processing_jobs (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references captures(id) on delete cascade,
  user_id uuid not null,
  job_type job_type not null,
  status job_status not null default 'queued',
  current_step text not null default 'queued',
  step_status jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table extracted_contents (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null unique references captures(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  content_text text not null,
  content_format text not null default 'plain_text',
  extraction_method text not null,
  status text not null check (status in ('extracted', 'fallback')),
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null unique references captures(id) on delete cascade,
  user_id uuid not null,
  title text not null,
  source_type capture_type not null,
  original_url text,
  extracted_text text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table wiki_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  slug text not null,
  content_markdown text not null,
  status wiki_page_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table source_wiki_pages (
  source_id uuid not null references sources(id) on delete cascade,
  wiki_page_id uuid not null references wiki_pages(id) on delete cascade,
  relation_type text not null,
  confidence real,
  created_at timestamptz not null default now(),
  primary key (source_id, wiki_page_id)
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  parent_type text not null check (parent_type in ('source', 'wiki_page')),
  parent_id uuid not null,
  content text not null,
  embedding vector(1024),
  token_count integer,
  created_at timestamptz not null default now()
);

create table audit_logs (
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

create table ask_histories (
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

create table knowledge_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  discovery_type text not null check (discovery_type in ('new_source', 'related_wiki', 'duplicate_source', 'suggested_question')),
  title text not null,
  body text not null,
  source_id uuid references sources(id) on delete cascade,
  wiki_page_id uuid references wiki_pages(id) on delete cascade,
  related_source_id uuid references sources(id) on delete set null,
  related_wiki_page_id uuid references wiki_pages(id) on delete set null,
  suggested_question text,
  status text not null default 'new' check (status in ('new', 'seen', 'ignored')),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table knowledge_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_id uuid not null references sources(id) on delete cascade,
  trigger_source_id uuid references sources(id) on delete set null,
  reason text not null,
  score real not null default 0,
  status text not null default 'active' check (status in ('active', 'dismissed')),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table model_call_logs (
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

create table user_model_settings (
  user_id uuid primary key,
  mode text not null default 'default' check (mode in ('default', 'custom')),
  text_base_url text,
  text_api_key text,
  text_model text,
  text_thinking text check (text_thinking in ('enabled', 'disabled') or text_thinking is null),
  text_reasoning_effort text check (text_reasoning_effort in ('low', 'medium', 'high') or text_reasoning_effort is null),
  embedding_base_url text,
  embedding_api_key text,
  embedding_model text,
  embedding_dimensions integer,
  vision_base_url text,
  vision_api_key text,
  vision_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table smart_quota_accounts (
  user_id uuid primary key,
  plan_code text not null default 'local',
  enforcement_mode text not null default 'unlimited' check (enforcement_mode in ('unlimited', 'soft_limit', 'hard_limit')),
  monthly_credit_limit integer,
  period_anchor_day integer not null default 1 check (period_anchor_day >= 1 and period_anchor_day <= 28),
  quota_source text not null default 'local' check (quota_source in ('local', 'stripe', 'manual')),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_subscription_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table smart_quota_ledger (
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

create index captures_user_created_idx on captures (user_id, created_at desc);
create index processing_jobs_capture_idx on processing_jobs (capture_id);
create index extracted_contents_capture_idx on extracted_contents (capture_id, created_at desc);
create index sources_user_created_idx on sources (user_id, created_at desc);
create index wiki_pages_user_updated_idx on wiki_pages (user_id, updated_at desc);
create index chunks_parent_idx on chunks (parent_type, parent_id);
create index chunks_embedding_idx on chunks using ivfflat (embedding vector_cosine_ops);
create index sources_user_original_url_idx on sources (user_id, original_url) where original_url is not null;
create index sources_management_fts_idx on sources using gin (to_tsvector('simple', title || ' ' || coalesce(summary, '') || ' ' || extracted_text));
create index wiki_pages_management_fts_idx on wiki_pages using gin (to_tsvector('simple', title || ' ' || content_markdown));
create index chunks_content_fts_idx on chunks using gin (to_tsvector('simple', content));
create index audit_logs_user_created_idx on audit_logs (user_id, created_at desc);
create index audit_logs_resource_idx on audit_logs (resource_type, resource_id, created_at desc);
create index ask_histories_scope_created_idx on ask_histories (user_id, scope_type, scope_id, created_at desc);
create index knowledge_discoveries_user_created_idx on knowledge_discoveries (user_id, status, created_at desc);
create index knowledge_discoveries_source_idx on knowledge_discoveries (source_id, created_at desc);
create index knowledge_recommendations_user_rank_idx on knowledge_recommendations (user_id, status, updated_at desc, score desc);
create index knowledge_recommendations_source_idx on knowledge_recommendations (source_id, updated_at desc);
create index model_call_logs_user_created_idx on model_call_logs (user_id, created_at desc);
create index model_call_logs_user_purpose_idx on model_call_logs (user_id, stage, role, purpose, created_at desc);
create index smart_quota_ledger_user_period_idx on smart_quota_ledger (user_id, period_start, period_end, created_at desc);
create index smart_quota_ledger_user_category_idx on smart_quota_ledger (user_id, category, created_at desc);
create index smart_quota_accounts_stripe_customer_idx on smart_quota_accounts (stripe_customer_id);
create index smart_quota_accounts_stripe_subscription_idx on smart_quota_accounts (stripe_subscription_id);
