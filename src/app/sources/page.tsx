import Link from "next/link";
import { SourceManagementList, type SourceManagementItem } from "@/components/source-management-list";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { formatDateTime, getLocale, localeText } from "@/lib/i18n";
import { retrieveHybridContexts } from "@/lib/sift-query";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { CaptureStatus, CaptureType } from "@/types/database";

interface SourceListRow {
  id: string;
  title: string;
  source_type: CaptureType;
  original_url: string | null;
  summary: string | null;
  extracted_preview: string;
  created_at: string;
  capture_status: CaptureStatus | null;
  wiki_title: string | null;
}

interface SourceListParams {
  limit: number;
  q: string;
  type: CaptureType | "";
  view: "active" | "archived";
}

const SOURCE_PAGE_SIZE = 24;
const SOURCE_MAX_LIMIT = 144;

async function loadSources(params: SourceListParams) {
  const userContext = await getUserContextFromHeaders();
  const semanticSourceIds = await loadSemanticSourceIds(userContext.userId, params.q);
  const result = await query<SourceListRow>(
    `
      select
        s.id,
        s.title,
        s.source_type,
        s.original_url,
        s.summary,
        left(regexp_replace(s.extracted_text, '\\s+', ' ', 'g'), 220) as extracted_preview,
        s.created_at,
        c.status as capture_status,
        wiki_link.wiki_title
      from sources s
      left join captures c on c.id = s.capture_id
      left join lateral (
        select wp.title as wiki_title
        from source_wiki_pages swp
        join wiki_pages wp on wp.id = swp.wiki_page_id
        where swp.source_id = s.id
          and wp.user_id = s.user_id
          and wp.status <> 'archived'
          and swp.relation_type <> 'restored_from_merge'
        order by swp.created_at desc
        limit 1
      ) wiki_link on true
      where s.user_id = $1
        and (
          (
            $4 = 'archived'
            and c.status = 'ignored'
          )
          or (
            $4 = 'active'
            and (c.status is null or c.status <> 'ignored')
          )
        )
        and (
          $2 = ''
          or to_tsvector('simple', s.title || ' ' || coalesce(s.summary, '') || ' ' || s.extracted_text)
            @@ websearch_to_tsquery('simple', $2)
          or s.id = any($6::uuid[])
          or s.title ilike '%' || $2 || '%'
          or coalesce(s.summary, '') ilike '%' || $2 || '%'
          or s.extracted_text ilike '%' || $2 || '%'
        )
        and ($3 = '' or s.source_type::text = $3)
      order by
        case
          when $2 <> '' then ts_rank_cd(
            to_tsvector('simple', s.title || ' ' || coalesce(s.summary, '') || ' ' || s.extracted_text),
            websearch_to_tsquery('simple', $2)
          )
          else 0
        end desc,
        case when s.id = any($6::uuid[]) then 1 else 0 end desc,
        s.created_at desc
      limit $5
    `,
    [userContext.userId, params.q, params.type, params.view, params.limit + 1, semanticSourceIds],
  );

  return result.rows;
}

async function loadSemanticSourceIds(userId: string, searchQuery: string) {
  if (!searchQuery) {
    return [];
  }

  const contexts = await withTimeout(
    retrieveHybridContexts(userId, searchQuery, 12, {
      stage: "management",
      purpose: "management.sources.embedding",
    }).catch(() => []),
    1200,
    [],
  );

  return Array.from(
    new Set(
      contexts
        .map((context) => context.sourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId)),
    ),
  );
}

export default async function SourcesPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  const locale = getLocale();
  const listParams = parseSourceListParams(searchParams);
  let sources: SourceListRow[] = [];
  let configError: MissingEnvError | null = null;
  let loadError: string | null = null;

  try {
    sources = await loadSources(listParams);
  } catch (error) {
    if (error instanceof MissingEnvError) {
      configError = error;
    } else {
      loadError = error instanceof Error ? error.message : "无法读取来源资料。";
    }
  }

  const hasMore = sources.length > listParams.limit;
  const visibleSources = sources.slice(0, listParams.limit);

  return (
    <>
      <section className="hero">
        <div className="eyebrow">{localeText(locale, "来源资料", "Sources")}</div>
        <h1>{localeText(locale, "来源资料", "Sources")}</h1>
        <p>
          {localeText(
            locale,
            "这里会显示经过提取和清理后的单份资料。每份来源都能追溯到原始收集记录。",
            "Cleaned individual sources appear here. Every source remains traceable to its original capture.",
          )}
        </p>
      </section>

      <ListToolbar locale={locale} params={listParams} />

      {configError ? (
        <EmptyState title="还不能读取本地数据" detail={`缺少环境变量：${configError.missingKeys.join(", ")}`} />
      ) : loadError ? (
        <EmptyState title="还不能连接本地数据库" detail={loadError} />
      ) : visibleSources.length > 0 ? (
        <>
          <SourceManagementList
            items={visibleSources.map((source): SourceManagementItem => ({
              href: `/sources/${source.id}`,
              id: source.id,
              meta: [
                formatDateTime(source.created_at, locale),
                source.wiki_title ? `${localeText(locale, "知识页", "Wiki")}：${source.wiki_title}` : "",
                source.capture_status === "ignored" ? localeText(locale, "已归档", "Archived") : "",
              ]
                .filter(Boolean)
                .join(" · "),
              summary: source.summary || source.extracted_preview,
              title: source.title,
              typeLabel: getCaptureTypeLabel(source.source_type, locale),
            }))}
            locale={locale}
            mode={listParams.view === "archived" ? "restore" : "archive"}
          />
          {hasMore ? (
            <div className="load-more-row">
              <Link className="button button-secondary" href={buildSourcesHref(listParams, listParams.limit + SOURCE_PAGE_SIZE)} scroll={false}>
                {localeText(locale, "加载更多", "Load more")}
              </Link>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={
            listParams.view === "archived"
              ? localeText(locale, "还没有已归档来源", "No archived sources")
              : localeText(locale, "还没有来源资料", "No sources yet")
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

function getCaptureTypeLabel(type: CaptureType, locale: ReturnType<typeof getLocale>) {
  const labels: Record<CaptureType, string> = {
    link: localeText(locale, "链接", "Link"),
    text: localeText(locale, "文本", "Text"),
    image: localeText(locale, "图片", "Image"),
  };

  return labels[type];
}

function ListToolbar({ locale, params }: { locale: ReturnType<typeof getLocale>; params: SourceListParams }) {
  return (
    <section className="management-toolbar" aria-label={localeText(locale, "来源筛选", "Source filters")}>
      <div className="segmented-links">
        <Link className={params.view === "active" ? "is-active" : ""} href={buildSourcesHref({ ...params, view: "active" }, SOURCE_PAGE_SIZE)} scroll={false}>
          {localeText(locale, "默认资料", "Active")}
        </Link>
        <Link className={params.view === "archived" ? "is-active" : ""} href={buildSourcesHref({ ...params, view: "archived" }, SOURCE_PAGE_SIZE)} scroll={false}>
          {localeText(locale, "已归档", "Archived")}
        </Link>
      </div>
      <form className="management-filter-form" method="get">
        <input name="view" type="hidden" value={params.view} />
        <input
          aria-label={localeText(locale, "搜索来源资料", "Search sources")}
          defaultValue={params.q}
          name="q"
          placeholder={localeText(locale, "搜索标题、摘要、正文", "Search title, summary, text")}
        />
        <select aria-label={localeText(locale, "来源类型", "Source type")} defaultValue={params.type} name="type">
          <option value="">{localeText(locale, "全部类型", "All types")}</option>
          <option value="link">{localeText(locale, "链接", "Links")}</option>
          <option value="text">{localeText(locale, "文本", "Text")}</option>
          <option value="image">{localeText(locale, "图片", "Images")}</option>
        </select>
        <button className="button button-secondary" type="submit">
          {localeText(locale, "筛选", "Filter")}
        </button>
      </form>
    </section>
  );
}

function parseSourceListParams(searchParams: Record<string, string | undefined> | undefined): SourceListParams {
  return {
    limit: parseLimit(searchParams?.limit),
    q: (searchParams?.q || "").trim().slice(0, 80),
    type: parseCaptureType(searchParams?.type),
    view: parseSourceView(searchParams?.view),
  };
}

function parseSourceView(value: string | undefined): SourceListParams["view"] {
  return value === "archived" ? value : "active";
}

function parseCaptureType(value: string | undefined): CaptureType | "" {
  return value === "link" || value === "text" || value === "image" ? value : "";
}

function parseLimit(value: string | undefined) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return SOURCE_PAGE_SIZE;
  }

  return Math.min(Math.max(SOURCE_PAGE_SIZE, Math.floor(parsed)), SOURCE_MAX_LIMIT);
}

function buildSourcesHref(params: SourceListParams, limit: number) {
  const searchParams = new URLSearchParams();

  if (params.view === "archived") {
    searchParams.set("view", params.view);
  }

  if (params.q) {
    searchParams.set("q", params.q);
  }

  if (params.type) {
    searchParams.set("type", params.type);
  }

  if (limit > SOURCE_PAGE_SIZE) {
    searchParams.set("limit", String(Math.min(limit, SOURCE_MAX_LIMIT)));
  }

  const queryString = searchParams.toString();
  return queryString ? `/sources?${queryString}` : "/sources";
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
