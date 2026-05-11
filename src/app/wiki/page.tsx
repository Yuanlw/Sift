import Link from "next/link";
import { WikiManagementList, type WikiManagementItem } from "@/components/wiki-management-list";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { formatDateTime, getLocale, localeText } from "@/lib/i18n";
import { retrieveHybridContexts } from "@/lib/sift-query";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { WikiPageStatus } from "@/types/database";

interface WikiListRow {
  id: string;
  title: string;
  slug: string;
  status: WikiPageStatus;
  updated_at: string;
  source_title: string | null;
  content_preview: string;
}

interface WikiListParams {
  limit: number;
  q: string;
  view: "active" | "archived";
}

const WIKI_PAGE_SIZE = 24;
const WIKI_MAX_LIMIT = 144;

async function loadWikiPages(params: WikiListParams) {
  const userContext = await getUserContextFromHeaders();
  const semanticWikiSlugs = await loadSemanticWikiSlugs(userContext.userId, params.q);
  const result = await query<WikiListRow>(
    `
      select
        wp.id,
        wp.title,
        wp.slug,
        wp.status,
        wp.updated_at,
        source_link.source_title,
        left(regexp_replace(wp.content_markdown, '\\s+', ' ', 'g'), 180) as content_preview
      from wiki_pages wp
      left join lateral (
        select s.title as source_title
        from source_wiki_pages swp
        join sources s on s.id = swp.source_id
        left join captures c on c.id = s.capture_id
        where swp.wiki_page_id = wp.id
          and swp.relation_type <> 'restored_from_merge'
          and (c.status is null or c.status <> 'ignored')
        order by s.created_at desc
        limit 1
      ) source_link on true
      where wp.user_id = $1
        and (
          (
            $3 = 'archived'
            and wp.status = 'archived'
          )
          or (
            $3 = 'active'
            and wp.status <> 'archived'
          )
        )
        and (
          $2 = ''
          or to_tsvector('simple', wp.title || ' ' || wp.content_markdown)
            @@ websearch_to_tsquery('simple', $2)
          or wp.slug = any($5::text[])
          or wp.title ilike '%' || $2 || '%'
          or wp.content_markdown ilike '%' || $2 || '%'
        )
      order by
        case
          when $2 <> '' then ts_rank_cd(
            to_tsvector('simple', wp.title || ' ' || wp.content_markdown),
            websearch_to_tsquery('simple', $2)
          )
          else 0
        end desc,
        case when wp.slug = any($5::text[]) then 1 else 0 end desc,
        wp.updated_at desc
      limit $4
    `,
    [userContext.userId, params.q, params.view, params.limit + 1, semanticWikiSlugs],
  );

  return result.rows;
}

async function loadSemanticWikiSlugs(userId: string, searchQuery: string) {
  if (!searchQuery) {
    return [];
  }

  const contexts = await withTimeout(
    retrieveHybridContexts(userId, searchQuery, 12, {
      stage: "management",
      purpose: "management.wiki.embedding",
    }).catch(() => []),
    1200,
    [],
  );

  return Array.from(
    new Set(
      contexts
        .map((context) => context.wikiSlug)
        .filter((slug): slug is string => Boolean(slug)),
    ),
  );
}

export default async function WikiPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  const locale = getLocale();
  const listParams = parseWikiListParams(searchParams);
  let pages: WikiListRow[] = [];
  let configError: MissingEnvError | null = null;
  let loadError: string | null = null;

  try {
    pages = await loadWikiPages(listParams);
  } catch (error) {
    if (error instanceof MissingEnvError) {
      configError = error;
    } else {
      loadError = error instanceof Error ? error.message : "无法读取知识页。";
    }
  }

  const hasMore = pages.length > listParams.limit;
  const visiblePages = pages.slice(0, listParams.limit);

  return (
    <>
      <section className="hero">
        <div className="eyebrow">{localeText(locale, "知识页", "Wiki")}</div>
        <h1>{localeText(locale, "知识页", "Wiki Pages")}</h1>
        <p>
          {localeText(
            locale,
            "每个知识页都保留来源追溯，并在详情页提示相似页面，方便逐步沉淀和合并长期主题。",
            "Every wiki page keeps source traceability and suggests similar pages for future merging.",
          )}
        </p>
      </section>

      <ListToolbar locale={locale} params={listParams} />

      {configError ? (
        <EmptyState title="还不能读取本地数据" detail={`缺少环境变量：${configError.missingKeys.join(", ")}`} />
      ) : loadError ? (
        <EmptyState title="还不能连接本地数据库" detail={loadError} />
      ) : visiblePages.length > 0 ? (
        <>
          <WikiManagementList
            items={visiblePages.map((page): WikiManagementItem => ({
              href: `/wiki/${encodeURIComponent(page.slug)}`,
              id: page.id,
              meta: [
                `${localeText(locale, "更新于", "Updated")} ${formatDateTime(page.updated_at, locale)}`,
                page.source_title ? `${localeText(locale, "来源", "Source")}：${page.source_title}` : "",
              ]
                .filter(Boolean)
                .join(" · "),
              preview: page.content_preview,
              slug: page.slug,
              statusClass: `status-dot status-${page.status}`,
              statusLabel: getWikiStatusLabel(page.status, locale),
              title: page.title,
            }))}
            locale={locale}
            mode={listParams.view === "archived" ? "restore" : "archive"}
          />
          {hasMore ? (
            <div className="load-more-row">
              <Link className="button button-secondary" href={buildWikiHref(listParams, listParams.limit + WIKI_PAGE_SIZE)} scroll={false}>
                {localeText(locale, "加载更多", "Load more")}
              </Link>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={
            listParams.view === "archived"
              ? localeText(locale, "还没有已归档知识页", "No archived wiki pages")
              : localeText(locale, "还没有知识页", "No wiki pages yet")
          }
          detail={localeText(locale, "可以换个筛选条件，或继续收集新的资料。", "Try another filter or keep capturing new material.")}
        />
      )}
    </>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span className="meta">{detail}</span>
    </div>
  );
}

function getWikiStatusLabel(status: WikiPageStatus, locale: ReturnType<typeof getLocale>) {
  const labels: Record<WikiPageStatus, string> = {
    draft: localeText(locale, "自动整理", "Auto-organized"),
    published: localeText(locale, "已发布", "Published"),
    archived: localeText(locale, "已归档", "Archived"),
  };

  return labels[status];
}

function ListToolbar({ locale, params }: { locale: ReturnType<typeof getLocale>; params: WikiListParams }) {
  return (
    <section className="management-toolbar" aria-label={localeText(locale, "知识页筛选", "Wiki filters")}>
      <div className="segmented-links">
        <Link className={params.view === "active" ? "is-active" : ""} href={buildWikiHref({ ...params, view: "active" }, WIKI_PAGE_SIZE)} scroll={false}>
          {localeText(locale, "默认知识页", "Active")}
        </Link>
        <Link className={params.view === "archived" ? "is-active" : ""} href={buildWikiHref({ ...params, view: "archived" }, WIKI_PAGE_SIZE)} scroll={false}>
          {localeText(locale, "已归档", "Archived")}
        </Link>
      </div>
      <form className="management-filter-form" method="get">
        <input name="view" type="hidden" value={params.view} />
        <input
          aria-label={localeText(locale, "搜索知识页", "Search wiki pages")}
          defaultValue={params.q}
          name="q"
          placeholder={localeText(locale, "搜索标题和正文", "Search title and content")}
        />
        <button className="button button-secondary" type="submit">
          {localeText(locale, "筛选", "Filter")}
        </button>
      </form>
    </section>
  );
}

function parseWikiListParams(searchParams: Record<string, string | undefined> | undefined): WikiListParams {
  return {
    limit: parseLimit(searchParams?.limit),
    q: (searchParams?.q || "").trim().slice(0, 80),
    view: parseWikiView(searchParams?.view),
  };
}

function parseWikiView(value: string | undefined): WikiListParams["view"] {
  return value === "archived" ? value : "active";
}

function parseLimit(value: string | undefined) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return WIKI_PAGE_SIZE;
  }

  return Math.min(Math.max(WIKI_PAGE_SIZE, Math.floor(parsed)), WIKI_MAX_LIMIT);
}

function buildWikiHref(params: WikiListParams, limit: number) {
  const searchParams = new URLSearchParams();

  if (params.view === "archived") {
    searchParams.set("view", params.view);
  }

  if (params.q) {
    searchParams.set("q", params.q);
  }

  if (limit > WIKI_PAGE_SIZE) {
    searchParams.set("limit", String(Math.min(limit, WIKI_MAX_LIMIT)));
  }

  const queryString = searchParams.toString();
  return queryString ? `/wiki?${queryString}` : "/wiki";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
