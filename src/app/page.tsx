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
  const totalCaptures = Number(stats?.captures || 0);
  const reviewCount = discoveries.length + recommendations.length;

  return (
    <div className="home-page">
      <section className="home-hero" aria-label={localeText(locale, "Sift 工作台", "Sift workspace")}>
        <div className="home-hero-copy">
          <div className="eyebrow">{localeText(locale, "近期回顾", "Recent Review")}</div>
          <h1>{localeText(locale, "你的知识库，今天已经被重新看过一遍。", "Your library has already been reviewed today.")}</h1>
          <p>
            {localeText(
              locale,
              "保存只是入口。Sift 会把新资料放回整个知识库里，找出值得回看的内容、可能重复的来源，以及可以更新的知识页。",
              "Capture is only the entry point. Sift places new material back into the whole library and surfaces what is worth revisiting, duplicative, or ready to update.",
            )}
          </p>
          <div className="home-hero-actions">
            <Link className="button" href="/inbox">
              {localeText(locale, "投喂新资料", "Capture something")}
            </Link>
            <Link className="button button-secondary" href="#ask">
              {localeText(locale, "问整个知识库", "Ask the library")}
            </Link>
          </div>
        </div>
        <div className="home-hero-card" aria-label={localeText(locale, "知识状态摘要", "Knowledge summary")}>
          <span>{localeText(locale, "当前状态", "Current state")}</span>
          <strong>
            {reviewCount > 0
              ? localeText(locale, `${reviewCount} 个发现等待处理`, `${reviewCount} items need review`)
              : localeText(locale, "没有紧急待处理发现", "No urgent discoveries")}
          </strong>
          <p>
            {totalCaptures > 0
              ? localeText(locale, `已经收集 ${totalCaptures} 条资料，Sift 会在新内容进入后继续更新回顾。`, `${totalCaptures} captures saved. Sift updates this review when new material arrives.`)
              : localeText(locale, "先保存几条链接、文字或图片，近期回顾会从这里长出来。", "Save a few links, notes, or images first; the review will grow from here.")}
          </p>
        </div>
      </section>

      <section className="home-stat-strip" aria-label={localeText(locale, "知识库状态", "Knowledge base status")}>
        <StatCard label={localeText(locale, "收集", "Captures")} value={stats?.captures} href="/inbox" />
        <StatCard label={localeText(locale, "已处理", "Processed")} value={stats?.completed_captures} href="/inbox" />
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
            label: localeText(locale, "今日收集", "Captured today"),
            value: todayReview.stats?.today_captures || "0",
          },
          {
            href: "/inbox",
            label: localeText(locale, "整理完成", "Processed"),
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

      <section className="home-two-column" id="ask">
        <KnowledgeAskForm
          histories={askHistories.map((item) => ({
            id: item.id,
            question: item.question,
            answer: item.answer,
            createdAt: item.created_at,
          }))}
          locale={locale}
        />

        <aside className="home-workflow-panel" aria-label={localeText(locale, "Sift 工作流", "Sift workflow")}>
          <div className="eyebrow">{localeText(locale, "工作流", "Workflow")}</div>
          <h2>{localeText(locale, "从剪藏到回顾，不需要你主动整理。", "From capture to review, without manual filing.")}</h2>
          <div className="home-workflow-list">
            <Link href="/inbox">
              <span>01</span>
              <strong>{localeText(locale, "随手保存", "Capture")}</strong>
              <small>{localeText(locale, "链接、文字、图片先进收集箱", "Links, text, and images enter the inbox")}</small>
            </Link>
            <Link href="/sources">
              <span>02</span>
              <strong>{localeText(locale, "沉淀来源", "Clean sources")}</strong>
              <small>{localeText(locale, "保留原始上下文和可追溯摘要", "Keep traceable context and summaries")}</small>
            </Link>
            <Link href="/wiki">
              <span>03</span>
              <strong>{localeText(locale, "生成知识页", "Build wiki")}</strong>
              <small>{localeText(locale, "把零散资料变成可追问页面", "Turn fragments into askable pages")}</small>
            </Link>
            <Link href="/#discoveries">
              <span>04</span>
              <strong>{localeText(locale, "自动回顾", "Review")}</strong>
              <small>{localeText(locale, "发现重复、关联和需要重看的内容", "Surface duplicates, links, and useful revisits")}</small>
            </Link>
          </div>
        </aside>
      </section>
    </div>
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
