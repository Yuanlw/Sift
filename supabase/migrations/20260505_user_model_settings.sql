create table if not exists user_model_settings (
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

