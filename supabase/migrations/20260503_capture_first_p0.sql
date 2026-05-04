alter table captures
  add column if not exists raw_payload jsonb not null default '{}'::jsonb,
  add column if not exists raw_attachments jsonb not null default '[]'::jsonb;

alter table captures
  drop constraint if exists capture_has_content;

alter table captures
  add constraint capture_has_content check (
    raw_url is not null
    or raw_text is not null
    or file_url is not null
    or jsonb_array_length(raw_attachments) > 0
  );

alter table processing_jobs
  add column if not exists current_step text not null default 'queued',
  add column if not exists step_status jsonb not null default '{}'::jsonb;
