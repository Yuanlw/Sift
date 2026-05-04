import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { formatDateTime, getLocale, localeText } from "@/lib/i18n";
import { loadDuplicateSourceSuggestions } from "@/lib/reuse-suggestions";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { CaptureType } from "@/types/database";

interface SourceDetailRow {
  id: string;
  title: string;
  source_type: CaptureType;
  original_url: string | null;
  extracted_text: string;
  summary: string | null;
  created_at: string;
  capture_id: string;
  capture_note: string | null;
  wiki_title: string | null;
  wiki_slug: string | null;
}

async function loadSource(id: string, userId: string) {
  if (!isUuid(id)) {
    return null;
  }

  const result = await query<SourceDetailRow>(
    `
      select
        s.id,
        s.title,
        s.source_type,
        s.original_url,
        s.extracted_text,
        s.summary,
        s.created_at,
        s.capture_id,
        c.note as capture_note,
        wp.title as wiki_title,
        wp.slug as wiki_slug
      from sources s
      left join captures c on c.id = s.capture_id
      left join source_wiki_pages swp on swp.source_id = s.id
      left join wiki_pages wp on wp.id = swp.wiki_page_id
      where s.id = $1 and s.user_id = $2
      limit 1
    `,
    [id, userId],
  );

  return result.rows[0] || null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getCaptureTypeLabel(type: CaptureType, locale: ReturnType<typeof getLocale>) {
  const labels: Record<CaptureType, string> = {
    link: localeText(locale, "链接", "Link"),
    text: localeText(locale, "文本", "Text"),
    image: localeText(locale, "图片", "Image"),
  };

  return labels[type];
}

export default async function SourceDetailPage({ params }: { params: { id: string } }) {
  const locale = getLocale();
  const userContext = getUserContextFromHeaders();
  const source = await loadSource(params.id, userContext.userId);

  if (!source) {
    notFound();
  }

  const duplicateSuggestions = await loadDuplicateSourceSuggestions({
    userId: userContext.userId,
    sourceId: source.id,
  });

  return (
    <>
      <section className="detail-hero">
        <Link className="back-link" href="/sources">
          {localeText(locale, "返回来源资料", "Back to Sources")}
        </Link>
        <div className="item-header">
          <span className="type-pill">{getCaptureTypeLabel(source.source_type, locale)}</span>
          <h1>{source.title}</h1>
        </div>
        <div className="detail-meta">
          <span>{formatDateTime(source.created_at, locale, true)}</span>
          <span>{localeText(locale, "收集记录", "Capture")} {source.capture_id.slice(0, 8)}</span>
          {source.original_url ? (
            <a href={source.original_url} rel="noreferrer" target="_blank">
              {localeText(locale, "原始链接", "Original link")}
            </a>
          ) : null}
          {source.wiki_slug ? <Link href={`/wiki/${source.wiki_slug}`}>{localeText(locale, "查看知识页", "View Wiki")}</Link> : null}
        </div>
      </section>

      <div className="detail-layout">
        <aside className="detail-sidebar">
          <div className="panel">
            <h3>{localeText(locale, "摘要", "Summary")}</h3>
            <p>{source.summary || localeText(locale, "还没有摘要。", "No summary yet.")}</p>
          </div>
          <div className="panel">
            <h3>{localeText(locale, "关联", "Relations")}</h3>
            <p>{source.wiki_title ? `${localeText(locale, "已生成知识页", "Wiki page")}：${source.wiki_title}` : localeText(locale, "等待生成知识页。", "Waiting for wiki page.")}</p>
            {source.capture_note ? <p>{localeText(locale, "备注", "Note")}：{source.capture_note}</p> : null}
          </div>
          <div className="panel">
            <h3>{localeText(locale, "重复建议", "Duplicate suggestions")}</h3>
            {duplicateSuggestions.length > 0 ? (
              <div className="suggestion-list">
                {duplicateSuggestions.map((suggestion) => (
                  <Link className="suggestion-link" href={`/sources/${suggestion.sourceId}`} key={suggestion.sourceId}>
                    <strong>{suggestion.title}</strong>
                    <span className="meta">
                      {Math.round(suggestion.score * 100)}% · {suggestion.reasons.join(" / ")}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p>{localeText(locale, "暂时没有发现明显重复的来源资料。", "No obvious duplicate sources found yet.")}</p>
            )}
          </div>
        </aside>

        <article className="document-view">
          <h2>{localeText(locale, "提取正文", "Extracted text")}</h2>
          <pre>{source.extracted_text}</pre>
        </article>
      </div>
    </>
  );
}
