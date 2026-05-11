update wiki_pages wp
set content_markdown = trim(trailing from wp.content_markdown)
  || E'\n\n---\n\n## 图片 OCR 原文\n\n以下为图片解析得到的原始文本，保留用于核对、搜索和追溯。\n\n```text\n'
  || trim(s.extracted_text)
  || E'\n```',
    updated_at = now()
from source_wiki_pages swp
join sources s on s.id = swp.source_id
join captures c on c.id = s.capture_id
where swp.wiki_page_id = wp.id
  and (s.source_type = 'image' or jsonb_array_length(coalesce(c.raw_attachments, '[]'::jsonb)) > 0)
  and btrim(s.extracted_text) <> ''
  and wp.content_markdown not ilike '%## 图片 OCR 原文%'
  and not (
    replace(wp.content_markdown, E'\n', '') ilike '%' || left(replace(s.extracted_text, E'\n', ''), least(80, length(replace(s.extracted_text, E'\n', '')))) || '%'
  );
