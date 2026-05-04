import Link from "next/link";
import { notFound } from "next/navigation";
import { WikiAskForm } from "@/components/wiki-ask-form";
import { query } from "@/lib/db";
import { formatDateTime, getLocale, localeText } from "@/lib/i18n";
import { loadSimilarWikiPageSuggestions } from "@/lib/reuse-suggestions";
import { safeDecodeRouteParam } from "@/lib/route-params";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { WikiPageStatus } from "@/types/database";

interface WikiDetailRow {
  id: string;
  title: string;
  slug: string;
  content_markdown: string;
  status: WikiPageStatus;
  created_at: string;
  updated_at: string;
  source_id: string | null;
  source_title: string | null;
  original_url: string | null;
}

async function loadWikiPage(slug: string, userId: string) {
  const result = await query<WikiDetailRow>(
    `
      select
        wp.id,
        wp.title,
        wp.slug,
        wp.content_markdown,
        wp.status,
        wp.created_at,
        wp.updated_at,
        s.id as source_id,
        s.title as source_title,
        s.original_url
      from wiki_pages wp
      left join source_wiki_pages swp on swp.wiki_page_id = wp.id
      left join sources s on s.id = swp.source_id
      where wp.slug = $1 and wp.user_id = $2
      limit 1
    `,
    [slug, userId],
  );

  return result.rows[0] || null;
}

export default async function WikiDetailPage({ params }: { params: { slug: string } }) {
  const locale = getLocale();
  const userContext = getUserContextFromHeaders();
  const slug = safeDecodeRouteParam(params.slug);

  if (!slug) {
    notFound();
  }

  const page = await loadWikiPage(slug, userContext.userId);

  if (!page) {
    notFound();
  }

  const similarPages = await loadSimilarWikiPageSuggestions({
    userId: userContext.userId,
    wikiPageId: page.id,
  });

  return (
    <>
      <section className="detail-hero">
        <Link className="back-link" href="/wiki">
          {localeText(locale, "返回知识页", "Back to Wiki")}
        </Link>
        <div className="item-header">
          <span className={`status-dot status-${page.status}`}>{getWikiStatusLabel(page.status, locale)}</span>
          <h1>{page.title}</h1>
        </div>
        <div className="detail-meta">
          <span>{localeText(locale, "更新于", "Updated")} {formatDateTime(page.updated_at, locale, true)}</span>
          {page.source_id ? <Link href={`/sources/${page.source_id}`}>{localeText(locale, "查看来源", "View Source")}</Link> : null}
          {page.original_url ? (
            <a href={page.original_url} rel="noreferrer" target="_blank">
              {localeText(locale, "原始链接", "Original link")}
            </a>
          ) : null}
        </div>
      </section>

      <div className="detail-layout">
        <aside className="detail-sidebar">
          <div className="panel">
            <h3>{localeText(locale, "状态", "Status")}</h3>
            <p>{getWikiStatusLabel(page.status, locale)}</p>
          </div>
          <div className="panel">
            <h3>{localeText(locale, "来源", "Source")}</h3>
            <p>{page.source_title || localeText(locale, "还没有关联来源。", "No linked source yet.")}</p>
          </div>
          <div className="panel">
            <h3>{localeText(locale, "合并建议", "Merge suggestions")}</h3>
            {similarPages.length > 0 ? (
              <div className="suggestion-list">
                {similarPages.map((suggestion) => (
                  <Link className="suggestion-link" href={`/wiki/${encodeURIComponent(suggestion.slug)}`} key={suggestion.wikiPageId}>
                    <strong>{suggestion.title}</strong>
                    <span className="meta">
                      {Math.round(suggestion.score * 100)}% · {suggestion.reasons.join(" / ")}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p>{localeText(locale, "暂时没有发现明显相似的知识页。", "No obviously similar wiki pages found yet.")}</p>
            )}
          </div>
        </aside>

        <article className="document-view">
          <WikiAskForm locale={locale} slug={page.slug} />
          <h2>{localeText(locale, "正文", "Content")}</h2>
          <pre>{page.content_markdown}</pre>
        </article>
      </div>
    </>
  );
}

function getWikiStatusLabel(status: WikiPageStatus, locale: ReturnType<typeof getLocale>) {
  const labels: Record<WikiPageStatus, string> = {
    draft: localeText(locale, "草稿", "Draft"),
    published: localeText(locale, "已发布", "Published"),
    archived: localeText(locale, "已归档", "Archived"),
  };

  return labels[status];
}
