import Link from "next/link";
import { notFound } from "next/navigation";
import { KnowledgeGraphPanel } from "@/components/knowledge-graph-panel";
import { WikiArchiveActions } from "@/components/wiki-archive-actions";
import { WikiAskForm } from "@/components/wiki-ask-form";
import { WikiMergeRestoreAction } from "@/components/wiki-merge-restore-action";
import { query } from "@/lib/db";
import { formatDateTime, getLocale, localeText } from "@/lib/i18n";
import { loadKnowledgeGraphNeighborhood } from "@/lib/knowledge-graph";
import { loadSimilarWikiPageSuggestions } from "@/lib/reuse-suggestions";
import { safeDecodeRouteParam } from "@/lib/route-params";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { Json, WikiPageStatus } from "@/types/database";

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

interface AskHistoryRow {
  id: string;
  question: string;
  answer: string;
  created_at: string;
}

interface WikiMergeHistoryRow {
  id: string;
  before_title: string;
  after_title: string;
  created_at: string;
  merged_source_ids: Json;
  merged_wiki_title: string | null;
  merged_wiki_slug: string | null;
  metadata: Json;
  summary: string | null;
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
        source_link.source_id,
        source_link.source_title,
        source_link.original_url
      from wiki_pages wp
      left join lateral (
        select s.id as source_id, s.title as source_title, s.original_url
        from source_wiki_pages swp
        join sources s on s.id = swp.source_id
        left join captures c on c.id = s.capture_id
        where swp.wiki_page_id = wp.id
          and s.user_id = wp.user_id
          and swp.relation_type <> 'restored_from_merge'
          and (c.status is null or c.status <> 'ignored')
        order by s.created_at desc
        limit 1
      ) source_link on true
      where wp.slug = $1 and wp.user_id = $2
      limit 1
    `,
    [slug, userId],
  );

  return result.rows[0] || null;
}

async function loadAskHistories(wikiPageId: string, userId: string) {
  const result = await query<AskHistoryRow>(
    `
      select id, question, answer, created_at
      from ask_histories
      where user_id = $1
        and scope_type = 'wiki_page'
        and scope_id = $2
      order by created_at desc
      limit 5
    `,
    [userId, wikiPageId],
  );

  return result.rows;
}

async function loadWikiMergeHistories(wikiPageId: string, userId: string) {
  const result = await query<WikiMergeHistoryRow>(
    `
      select
        h.id,
        h.before_title,
        h.after_title,
        h.created_at,
        h.merged_source_ids,
        h.metadata,
        h.summary,
        mwp.title as merged_wiki_title,
        mwp.slug as merged_wiki_slug
      from wiki_merge_histories h
      left join wiki_pages mwp on mwp.id = h.merged_wiki_page_id
        and mwp.user_id = h.user_id
      where h.target_wiki_page_id = $1
        and h.user_id = $2
      order by h.created_at desc
      limit 8
    `,
    [wikiPageId, userId],
  );

  return result.rows;
}

export default async function WikiDetailPage({ params }: { params: { slug: string } }) {
  const locale = getLocale();
  const userContext = await getUserContextFromHeaders();
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
  const graphNeighbors = await loadKnowledgeGraphNeighborhood({
    nodeId: page.id,
    nodeType: "wiki_page",
    userId: userContext.userId,
  });
  const askHistories = await loadAskHistories(page.id, userContext.userId);
  const mergeHistories = await loadWikiMergeHistories(page.id, userContext.userId);

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
            <WikiArchiveActions
              isArchived={page.status === "archived"}
              locale={locale}
              slug={page.slug}
            />
          </div>
          <div className="panel">
            <h3>{localeText(locale, "来源", "Source")}</h3>
            <p>{page.source_title || localeText(locale, "还没有关联来源。", "No linked source yet.")}</p>
          </div>
          <KnowledgeGraphPanel locale={locale} neighbors={graphNeighbors} />
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
          <div className="panel">
            <h3>{localeText(locale, "合并历史", "Merge history")}</h3>
            {mergeHistories.length > 0 ? (
              <div className="merge-history-list">
                {mergeHistories.map((history, index) => {
                  const lastRestoredAt = getLastRestoredAt(history.metadata);
                  const disabledReason = getRestoreDisabledReason(index, lastRestoredAt, locale);

                  return (
                    <details className="merge-history-item" key={history.id}>
                      <summary>
                        <strong>{history.after_title}</strong>
                        <span className="meta">{formatDateTime(history.created_at, locale)}</span>
                      </summary>
                      <p>{history.summary || localeText(locale, "这次合并没有填写改动摘要。", "No change summary was recorded.")}</p>
                      <p className="meta">
                        {localeText(locale, "合并前", "Before")}：{history.before_title}
                      </p>
                      {history.merged_wiki_slug ? (
                        <Link className="meta-link" href={`/wiki/${encodeURIComponent(history.merged_wiki_slug)}`}>
                          {localeText(locale, "并入页面", "Merged page")}：{history.merged_wiki_title}
                        </Link>
                      ) : history.merged_wiki_title ? (
                        <p className="meta">
                          {localeText(locale, "并入页面", "Merged page")}：{history.merged_wiki_title}
                        </p>
                      ) : null}
                      <p className="meta">
                        {localeText(locale, "涉及来源", "Sources")}：{getJsonArrayLength(history.merged_source_ids)}
                      </p>
                      {lastRestoredAt ? (
                        <p className="meta">
                          {localeText(locale, "上次恢复", "Last restored")}：{formatDateTime(lastRestoredAt, locale)}
                        </p>
                      ) : null}
                      <WikiMergeRestoreAction disabledReason={disabledReason} historyId={history.id} locale={locale} />
                    </details>
                  );
                })}
              </div>
            ) : (
              <p>{localeText(locale, "还没有确认过合并。", "No confirmed merges yet.")}</p>
            )}
          </div>
          <div className="panel">
            <h3>{localeText(locale, "历史问答", "Ask history")}</h3>
            {askHistories.length > 0 ? (
              <div className="ask-history-list">
                {askHistories.map((item) => (
                  <details className="ask-history-item" key={item.id}>
                    <summary>
                      <strong>{item.question}</strong>
                      <span className="meta">{formatDateTime(item.created_at, locale)}</span>
                    </summary>
                    <p>{toAnswerPreview(item.answer)}</p>
                  </details>
                ))}
              </div>
            ) : (
              <p>{localeText(locale, "还没有围绕这页提问。", "No questions about this page yet.")}</p>
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

function toAnswerPreview(answer: string) {
  return answer.replace(/\s+/g, " ").trim().slice(0, 360);
}

function getJsonArrayLength(value: Json) {
  return Array.isArray(value) ? value.length : 0;
}

function getLastRestoredAt(value: Json) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const restoredAt = value.last_restored_at;
  return typeof restoredAt === "string" ? restoredAt : null;
}

function getRestoreDisabledReason(index: number, lastRestoredAt: string | null, locale: ReturnType<typeof getLocale>) {
  if (lastRestoredAt) {
    return localeText(locale, "这条合并历史已经恢复过。", "This merge history was already restored.");
  }

  if (index > 0) {
    return localeText(locale, "只能从当前最新合并恢复，避免覆盖后续变更。", "Only the latest merge can be restored to avoid overwriting later changes.");
  }

  return null;
}

function getWikiStatusLabel(status: WikiPageStatus, locale: ReturnType<typeof getLocale>) {
  const labels: Record<WikiPageStatus, string> = {
    draft: localeText(locale, "自动整理", "Auto-organized"),
    published: localeText(locale, "已发布", "Published"),
    archived: localeText(locale, "已归档", "Archived"),
  };

  return labels[status];
}
