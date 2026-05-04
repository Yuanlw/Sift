import Link from "next/link";
import { KnowledgeAskForm } from "@/components/knowledge-ask-form";
import { query } from "@/lib/db";
import { getLocale, localeText } from "@/lib/i18n";
import { getUserContextFromHeaders } from "@/lib/user-context";

interface HomeStats {
  captures: string;
  completed_captures: string;
  failed_captures: string;
  sources: string;
  wiki_pages: string;
}

async function loadHomeStats() {
  try {
    const userContext = getUserContextFromHeaders();
    const result = await query<HomeStats>(
      `
        select
          (select count(*) from captures where user_id = $1) as captures,
          (select count(*) from captures where user_id = $1 and status = 'completed') as completed_captures,
          (select count(*) from captures where user_id = $1 and status = 'failed') as failed_captures,
          (select count(*) from sources where user_id = $1) as sources,
          (select count(*) from wiki_pages where user_id = $1) as wiki_pages
      `,
      [userContext.userId],
    );

    return result.rows[0] || null;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const locale = getLocale();
  const stats = await loadHomeStats();

  return (
    <>
      <section className="hero">
        <div className="eyebrow">{localeText(locale, "知识底座", "Knowledge Layer")}</div>
        <h1>{localeText(locale, "把散落的信息，沉淀成可复用知识。", "Turn scattered captures into reusable knowledge.")}</h1>
        <p>
          {localeText(
            locale,
            "Sift 先把保存体验做顺：链接、文本和图片进入收集箱，后台再逐步整理成来源资料和可追溯的知识页。",
            "Sift starts with capture: links, text, and images enter the inbox first, then background jobs turn them into traceable sources and wiki pages.",
          )}
        </p>
        <Link className="button" href="/inbox">
          {localeText(locale, "进入收集箱", "Open Inbox")}
        </Link>
      </section>

      <section className="stats-grid" aria-label={localeText(locale, "知识库状态", "Knowledge base status")}>
        <StatCard label={localeText(locale, "收集", "Captures")} value={stats?.captures} href="/inbox" />
        <StatCard label={localeText(locale, "已完成", "Completed")} value={stats?.completed_captures} href="/inbox" />
        <StatCard label={localeText(locale, "来源", "Sources")} value={stats?.sources} href="/sources" />
        <StatCard label={localeText(locale, "知识页", "Wiki Pages")} value={stats?.wiki_pages} href="/wiki" />
      </section>

      <KnowledgeAskForm locale={locale} />

      <section className="grid" aria-label={localeText(locale, "核心模块", "Core modules")}>
        <div className="panel">
          <h3>{localeText(locale, "收集箱", "Inbox")}</h3>
          <p>{localeText(locale, "接收链接、文本和本地图片，先快速保存原始资料。", "Capture links, text, and local images quickly.")}</p>
        </div>
        <div className="panel">
          <h3>{localeText(locale, "来源资料", "Sources")}</h3>
          <p>{localeText(locale, "保存清理后的单份资料，并保留可追溯上下文。", "Store cleaned individual sources with traceable context.")}</p>
        </div>
        <div className="panel">
          <h3>{localeText(locale, "知识页", "Wiki")}</h3>
          <p>{localeText(locale, "把来源资料沉淀成可阅读、可追问、可合并的知识页。", "Turn sources into readable, askable, mergeable wiki pages.")}</p>
        </div>
      </section>
    </>
  );
}

function StatCard({ href, label, value }: { href: string; label: string; value?: string }) {
  return (
    <Link className="stat-card" href={href}>
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </Link>
  );
}
