import Link from "next/link";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { formatDateTime, getLocale, localeText } from "@/lib/i18n";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { CaptureType } from "@/types/database";

interface SourceListRow {
  id: string;
  title: string;
  source_type: CaptureType;
  original_url: string | null;
  summary: string | null;
  created_at: string;
  capture_status: string | null;
  wiki_title: string | null;
}

async function loadSources() {
  const userContext = getUserContextFromHeaders();
  const result = await query<SourceListRow>(
    `
      select
        s.id,
        s.title,
        s.source_type,
        s.original_url,
        s.summary,
        s.created_at,
        c.status as capture_status,
        wp.title as wiki_title
      from sources s
      left join captures c on c.id = s.capture_id
      left join source_wiki_pages swp on swp.source_id = s.id
      left join wiki_pages wp on wp.id = swp.wiki_page_id
      where s.user_id = $1
      order by s.created_at desc
      limit 50
    `,
    [userContext.userId],
  );

  return result.rows;
}

export default async function SourcesPage() {
  const locale = getLocale();
  let sources: SourceListRow[] = [];
  let configError: MissingEnvError | null = null;
  let loadError: string | null = null;

  try {
    sources = await loadSources();
  } catch (error) {
    if (error instanceof MissingEnvError) {
      configError = error;
    } else {
      loadError = error instanceof Error ? error.message : "无法读取来源资料。";
    }
  }

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

      {configError ? (
        <EmptyState title="还不能读取本地数据" detail={`缺少环境变量：${configError.missingKeys.join(", ")}`} />
      ) : loadError ? (
        <EmptyState title="还不能连接本地数据库" detail={loadError} />
      ) : sources.length > 0 ? (
        <div className="list">
          {sources.map((source) => (
            <Link className="item item-link" href={`/sources/${source.id}`} key={source.id}>
              <div className="item-header">
                <span className="type-pill">{getCaptureTypeLabel(source.source_type, locale)}</span>
                <strong>{source.title}</strong>
              </div>
              {source.summary ? <p>{source.summary}</p> : null}
              <span className="meta">
                {formatDateTime(source.created_at, locale)}
                {source.wiki_title ? ` · ${localeText(locale, "知识页", "Wiki")}：${source.wiki_title}` : ""}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title={localeText(locale, "还没有来源资料", "No sources yet")}
          detail={localeText(locale, "提交资料后，后台任务会在这里生成来源资料。", "After you capture material, background jobs will create sources here.")}
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
