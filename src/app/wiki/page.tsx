import Link from "next/link";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { formatDateTime, getLocale, localeText } from "@/lib/i18n";
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

async function loadWikiPages() {
  const userContext = getUserContextFromHeaders();
  const result = await query<WikiListRow>(
    `
      select
        wp.id,
        wp.title,
        wp.slug,
        wp.status,
        wp.updated_at,
        s.title as source_title,
        left(regexp_replace(wp.content_markdown, '\\s+', ' ', 'g'), 180) as content_preview
      from wiki_pages wp
      left join source_wiki_pages swp on swp.wiki_page_id = wp.id
      left join sources s on s.id = swp.source_id
      where wp.user_id = $1
      order by wp.updated_at desc
      limit 50
    `,
    [userContext.userId],
  );

  return result.rows;
}

export default async function WikiPage() {
  const locale = getLocale();
  let pages: WikiListRow[] = [];
  let configError: MissingEnvError | null = null;
  let loadError: string | null = null;

  try {
    pages = await loadWikiPages();
  } catch (error) {
    if (error instanceof MissingEnvError) {
      configError = error;
    } else {
      loadError = error instanceof Error ? error.message : "无法读取知识页。";
    }
  }

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

      {configError ? (
        <EmptyState title="还不能读取本地数据" detail={`缺少环境变量：${configError.missingKeys.join(", ")}`} />
      ) : loadError ? (
        <EmptyState title="还不能连接本地数据库" detail={loadError} />
      ) : pages.length > 0 ? (
        <div className="list">
          {pages.map((page) => (
            <Link className="item item-link" href={`/wiki/${encodeURIComponent(page.slug)}`} key={page.id}>
              <div className="item-header">
                <span className={`status-dot status-${page.status}`}>{getWikiStatusLabel(page.status, locale)}</span>
                <strong>{page.title}</strong>
              </div>
              <p>{page.content_preview}</p>
              <span className="meta">
                {localeText(locale, "更新于", "Updated")} {formatDateTime(page.updated_at, locale)}
                {page.source_title ? ` · ${localeText(locale, "来源", "Source")}：${page.source_title}` : ""}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title={localeText(locale, "还没有知识页", "No wiki pages yet")}
          detail={localeText(locale, "处理完成后，整理出的知识页会出现在这里。", "Generated wiki pages will appear here after processing.")}
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
    draft: localeText(locale, "草稿", "Draft"),
    published: localeText(locale, "已发布", "Published"),
    archived: localeText(locale, "已归档", "Archived"),
  };

  return labels[status];
}
