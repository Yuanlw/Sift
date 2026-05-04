create index if not exists sources_user_original_url_idx
  on sources (user_id, original_url)
  where original_url is not null;

create index if not exists chunks_content_fts_idx
  on chunks using gin (to_tsvector('simple', content));
