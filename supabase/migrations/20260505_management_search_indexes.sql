create index if not exists sources_management_fts_idx
  on sources using gin (to_tsvector('simple', title || ' ' || coalesce(summary, '') || ' ' || extracted_text));

create index if not exists wiki_pages_management_fts_idx
  on wiki_pages using gin (to_tsvector('simple', title || ' ' || content_markdown));
