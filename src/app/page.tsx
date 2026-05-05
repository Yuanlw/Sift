import Link from "next/link";
import { KnowledgeDiscoveryPanel } from "@/components/knowledge-discovery-panel";
import { KnowledgeAskForm } from "@/components/knowledge-ask-form";
import { query } from "@/lib/db";
import { getLocale, localeText } from "@/lib/i18n";
import { loadKnowledgeDiscoveries } from "@/lib/knowledge-discoveries";
import { loadKnowledgeRecommendations } from "@/lib/knowledge-recommendations";
import { getUserContextFromHeaders } from "@/lib/user-context";

interface HomeStats {
  captures: string;
  completed_captures: string;
  failed_captures: string;
  sources: string;
  wiki_pages: string;
}

interface AskHistoryRow {
  id: string;
  question: string;
  answer: string;
  created_at: string;
}

interface TodayReviewStats {
  today_captures: string;
  today_completed: string;
  today_processing: string;
  today_failed: string;
  today_sources: string;
}

async function loadHomeStats(userId: string) {
  try {
    const result = await query<HomeStats>(
      `
        select
          (select count(*) from captures where user_id = $1) as captures,
          (select count(*) from captures where user_id = $1 and status = 'completed') as completed_captures,
          (select count(*) from captures where user_id = $1 and status = 'failed') as failed_captures,
          (select count(*) from sources where user_id = $1) as sources,
          (select count(*) from wiki_pages where user_id = $1) as wiki_pages
      `,
      [userId],
    );

    return result.rows[0] || null;
  } catch {
    return null;
  }
}

async function loadTodayReview(userId: string) {
  try {
    const range = getTodayRange();
    const statsResult = await query<TodayReviewStats>(
      `
        select
          count(*)::text as today_captures,
          count(*) filter (where status = 'completed')::text as today_completed,
          count(*) filter (where status in ('queued', 'processing'))::text as today_processing,
          count(*) filter (where status = 'failed')::text as today_failed,
          (
            select count(*)::text
            from sources
            where user_id = $1
              and created_at >= $2
              and created_at < $3
          ) as today_sources
        from captures
        where user_id = $1
          and created_at >= $2
          and created_at < $3
      `,
      [userId, range.start, range.end],
    );

    return {
      stats: statsResult.rows[0] || null,
    };
  } catch {
    return {
      stats: null,
    };
  }
}

async function loadGlobalAskHistories(userId: string) {
  try {
    const result = await query<AskHistoryRow>(
      `
        select id, question, answer, created_at
        from ask_histories
        where user_id = $1
          and scope_type = 'global'
        order by created_at desc
        limit 8
      `,
      [userId],
    );

    return result.rows;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const locale = getLocale();
  const userContext = getUserContextFromHeaders();
  const stats = await loadHomeStats(userContext.userId);
  const todayReview = await loadTodayReview(userContext.userId);
  const askHistories = await loadGlobalAskHistories(userContext.userId);
  const discoveries = await loadKnowledgeDiscoveries({
    userId: userContext.userId,
    limit: 6,
  }).catch(() => []);
  const recommendations = await loadKnowledgeRecommendations({
    userId: userContext.userId,
    limit: 5,
  }).catch(() => []);

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

      <KnowledgeDiscoveryPanel
        discoveries={discoveries}
        emptyMessage={localeText(
          locale,
          "今天已经有资料进入知识库；如果后续发现重复、可更新或强关联内容，会在这里出现处理入口。",
          "Today's captures are already in the library. If Sift finds duplicates, updates, or strong links, they will appear here.",
        )}
        locale={locale}
        recommendations={recommendations}
        showEmpty
        summaryItems={[
          {
            href: "/inbox?view=today",
            label: localeText(locale, "今天收集", "Captured today"),
            value: todayReview.stats?.today_captures || "0",
          },
          {
            href: "/inbox",
            label: localeText(locale, "已处理", "Processed"),
            value: todayReview.stats?.today_completed || "0",
          },
          {
            href: "/sources",
            label: localeText(locale, "新增来源", "New sources"),
            value: todayReview.stats?.today_sources || "0",
          },
          {
            href: "/inbox?view=active",
            label: localeText(locale, "处理中", "Active"),
            value: todayReview.stats?.today_processing || "0",
          },
        ]}
      />

      <KnowledgeAskForm
        histories={askHistories.map((item) => ({
          id: item.id,
          question: item.question,
          answer: item.answer,
          createdAt: item.created_at,
        }))}
        locale={locale}
      />

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

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function StatCard({ href, label, value }: { href: string; label: string; value?: string }) {
  return (
    <Link className="stat-card" href={href}>
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </Link>
  );
}
