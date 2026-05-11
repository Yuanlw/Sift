import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { requireSupportAdmin } from "@/lib/admin-auth";
import { query } from "@/lib/db";
import { formatDateTime, getLocale, localeText, type Locale } from "@/lib/i18n";

interface RetentionSummaryRow {
  activated_10m: string;
  asked_users: string;
  capture_users: string;
  d1_eligible_users: string;
  d1_capture_users: string;
  d7_eligible_users: string;
  d7_capture_users: string;
  registered_users: string;
  source_users: string;
  wiki_users: string;
  weekly_capture_days_avg: string | null;
}

interface FunnelRow {
  capture_count: string;
  created_at: string;
  email: string;
  first_ask_at: string | null;
  first_capture_at: string | null;
  first_source_at: string | null;
  first_wiki_at: string | null;
}

interface EventRow {
  event_name: string;
  events: string;
  users: string;
}

export default async function RetentionPage() {
  noStore();

  await requireSupportAdmin("/admin/retention");

  const locale = getLocale();
  const data = await loadRetentionData();
  const summary = data.summary;

  return (
    <div className="admin-page">
      <section className="hero settings-hero">
        <div className="eyebrow">{localeText(locale, "运营后台", "Admin")}</div>
        <h1>{localeText(locale, "真实用户留存", "User Retention")}</h1>
        <p>
          {localeText(
            locale,
            "先看用户是否真的会保存、回来、生成知识并使用问答。这里服务于早期验证，不服务于增长包装。",
            "Focus on whether users actually capture, return, generate knowledge, and use Ask. This is for early validation, not growth theater.",
          )}
        </p>
      </section>

      {data.schemaReady ? null : (
        <p className="settings-message settings-message-error">
          {localeText(locale, "product_events 表未迁移；看板已回退到核心业务表，事件明细暂不可用。", "product_events is not migrated; the dashboard falls back to core product tables and event breakdown is unavailable.")}
        </p>
      )}

      <section className="settings-section">
        <div className="settings-kv-grid">
          <Metric label={localeText(locale, "30 天注册", "30d signups")} value={summary.registered_users} />
          <Metric label={localeText(locale, "10 分钟激活", "10m activation")} value={formatRate(summary.activated_10m, summary.registered_users, locale)} />
          <Metric label={localeText(locale, "D1+ 回访保存", "D1+ capture")} value={formatRate(summary.d1_capture_users, summary.d1_eligible_users, locale)} />
          <Metric label={localeText(locale, "D7+ 回访保存", "D7+ capture")} value={formatRate(summary.d7_capture_users, summary.d7_eligible_users, locale)} />
          <Metric label={localeText(locale, "周保存天数", "Weekly capture days")} value={summary.weekly_capture_days_avg || "0"} />
          <Metric label={localeText(locale, "保存用户", "Capture users")} value={summary.capture_users} />
          <Metric label={localeText(locale, "生成来源", "Source users")} value={summary.source_users} />
          <Metric label={localeText(locale, "生成知识页", "Wiki users")} value={summary.wiki_users} />
          <Metric label={localeText(locale, "问答用户", "Ask users")} value={summary.asked_users} />
        </div>
      </section>

      <div className="admin-case-grid">
        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h2>{localeText(locale, "事件分布", "Event Breakdown")}</h2>
              <p>{localeText(locale, "来自 product_events，用于确认埋点是否真实流动。", "From product_events, used to confirm that instrumentation is flowing.")}</p>
            </div>
          </div>
          <SimpleTable
            emptyText={localeText(locale, "还没有事件。", "No events yet.")}
            headers={[localeText(locale, "事件", "Event"), localeText(locale, "用户", "Users"), localeText(locale, "次数", "Events")]}
            rows={data.events.map((event) => [formatEventName(event.event_name, locale), event.users, event.events])}
          />
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h2>{localeText(locale, "下一步动作", "Next Actions")}</h2>
              <p>{localeText(locale, "留存数据不是装饰，低于预期就先修入口和习惯。", "Retention data is not decoration; if it is weak, fix entry and habit first.")}</p>
            </div>
          </div>
          <div className="settings-note-grid settings-note-grid-compact">
            <div className="settings-note">
              <strong>{localeText(locale, "激活", "Activation")}</strong>
              <p>{localeText(locale, "低于 60% 时，优先优化注册后的首次保存，而不是做增长。", "If below 60%, improve first capture after signup before growth.")}</p>
            </div>
            <div className="settings-note">
              <strong>{localeText(locale, "留存", "Retention")}</strong>
              <p>{localeText(locale, "D1/D7 低时，优先修手机入口、今日收集和保存后回访。", "If D1/D7 is weak, improve mobile entry, Today inbox, and return loops.")}</p>
            </div>
          </div>
          <Link className="button button-secondary" href="/capture">
            {localeText(locale, "检查快存入口", "Check Capture")}
          </Link>
          <Link className="button button-secondary" href="/admin/account-support">
            {localeText(locale, "查用户工单", "Account cases")}
          </Link>
        </section>
      </div>

      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>{localeText(locale, "最近注册漏斗", "Recent Signup Funnel")}</h2>
            <p>{localeText(locale, "看每个用户从注册到首次保存、生成来源、生成知识页和首次问答的路径。", "Inspect each user's path from signup to first capture, Source/Wiki, and Ask.")}</p>
          </div>
        </div>
        <SimpleTable
          emptyText={localeText(locale, "最近 30 天没有注册用户。", "No signups in the last 30 days.")}
          headers={[
            localeText(locale, "邮箱", "Email"),
            localeText(locale, "注册", "Signup"),
            localeText(locale, "首次保存", "First capture"),
            localeText(locale, "保存数", "Captures"),
            localeText(locale, "首次来源", "Source"),
            localeText(locale, "首次知识页", "Wiki"),
            localeText(locale, "首次问答", "Ask"),
          ]}
          rows={data.funnel.map((row) => [
            row.email,
            formatDateTime(row.created_at, locale, true),
            row.first_capture_at ? formatDateTime(row.first_capture_at, locale, true) : "-",
            row.capture_count,
            row.first_source_at ? formatDateTime(row.first_source_at, locale, true) : "-",
            row.first_wiki_at ? formatDateTime(row.first_wiki_at, locale, true) : "-",
            row.first_ask_at ? formatDateTime(row.first_ask_at, locale, true) : "-",
          ])}
        />
      </section>
    </div>
  );
}

async function loadRetentionData() {
  const [summary, funnel] = await Promise.all([loadSummary(), loadFunnel()]);
  const events = await loadEventBreakdown();

  return {
    events: events.rows,
    funnel: funnel.rows,
    schemaReady: events.schemaReady,
    summary: summary.rows[0] || createEmptySummary(),
  };
}

async function loadSummary() {
  return query<RetentionSummaryRow>(
    `
      with recent_users as (
        select id, email, created_at
        from users
        where created_at >= now() - interval '30 days'
      ),
      first_captures as (
        select user_id, min(created_at) as first_capture_at
        from captures
        where created_at >= now() - interval '30 days'
        group by user_id
      ),
      first_sources as (
        select user_id, min(created_at) as first_source_at
        from sources
        where created_at >= now() - interval '30 days'
        group by user_id
      ),
      first_wikis as (
        select user_id, min(created_at) as first_wiki_at
        from wiki_pages
        where created_at >= now() - interval '30 days'
        group by user_id
      ),
      first_asks as (
        select user_id, min(created_at) as first_ask_at
        from ask_histories
        where created_at >= now() - interval '30 days'
        group by user_id
      ),
      weekly_days as (
        select user_id, count(distinct date_trunc('day', created_at))::float as days
        from captures
        where created_at >= now() - interval '7 days'
        group by user_id
      )
      select
        count(*)::text as registered_users,
        count(*) filter (where first_capture_at is not null)::text as capture_users,
        count(*) filter (where first_capture_at <= recent_users.created_at + interval '10 minutes')::text as activated_10m,
        count(*) filter (where recent_users.created_at <= now() - interval '1 day')::text as d1_eligible_users,
        count(*) filter (
          where recent_users.created_at <= now() - interval '1 day'
            and exists (
              select 1
              from captures d1_captures
              where d1_captures.user_id = recent_users.id
                and d1_captures.created_at >= recent_users.created_at + interval '1 day'
            )
        )::text as d1_capture_users,
        count(*) filter (where recent_users.created_at <= now() - interval '7 days')::text as d7_eligible_users,
        count(*) filter (
          where recent_users.created_at <= now() - interval '7 days'
            and exists (
              select 1
              from captures d7_captures
              where d7_captures.user_id = recent_users.id
                and d7_captures.created_at >= recent_users.created_at + interval '7 days'
            )
        )::text as d7_capture_users,
        count(*) filter (where first_source_at is not null)::text as source_users,
        count(*) filter (where first_wiki_at is not null)::text as wiki_users,
        count(*) filter (where first_ask_at is not null)::text as asked_users,
        round(avg(coalesce(weekly_days.days, 0))::numeric, 1)::text as weekly_capture_days_avg
      from recent_users
      left join first_captures on first_captures.user_id = recent_users.id
      left join first_sources on first_sources.user_id = recent_users.id
      left join first_wikis on first_wikis.user_id = recent_users.id
      left join first_asks on first_asks.user_id = recent_users.id
      left join weekly_days on weekly_days.user_id = recent_users.id
    `,
  );
}

async function loadFunnel() {
  return query<FunnelRow>(
    `
      with recent_users as (
        select id, email, created_at
        from users
        where created_at >= now() - interval '30 days'
      ),
      capture_stats as (
        select user_id, min(created_at) as first_capture_at, count(*) as capture_count
        from captures
        where created_at >= now() - interval '30 days'
        group by user_id
      ),
      first_sources as (
        select user_id, min(created_at) as first_source_at
        from sources
        where created_at >= now() - interval '30 days'
        group by user_id
      ),
      first_wikis as (
        select user_id, min(created_at) as first_wiki_at
        from wiki_pages
        where created_at >= now() - interval '30 days'
        group by user_id
      ),
      first_asks as (
        select user_id, min(created_at) as first_ask_at
        from ask_histories
        where created_at >= now() - interval '30 days'
        group by user_id
      )
      select
        recent_users.email,
        recent_users.created_at::text,
        capture_stats.first_capture_at::text as first_capture_at,
        coalesce(capture_stats.capture_count, 0)::text as capture_count,
        first_sources.first_source_at::text as first_source_at,
        first_wikis.first_wiki_at::text as first_wiki_at,
        first_asks.first_ask_at::text as first_ask_at
      from recent_users
      left join capture_stats on capture_stats.user_id = recent_users.id
      left join first_sources on first_sources.user_id = recent_users.id
      left join first_wikis on first_wikis.user_id = recent_users.id
      left join first_asks on first_asks.user_id = recent_users.id
      order by recent_users.created_at desc
      limit 30
    `,
  );
}

async function loadEventBreakdown() {
  try {
    const result = await query<EventRow>(
      `
        select event_name, count(distinct user_id)::text as users, count(*)::text as events
        from product_events
        where occurred_at >= now() - interval '30 days'
        group by event_name
        order by count(*) desc, event_name
      `,
    );
    return { rows: result.rows, schemaReady: true };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return { rows: [] as EventRow[], schemaReady: false };
    }

    throw error;
  }
}

function SimpleTable({
  emptyText,
  headers,
  rows,
}: {
  emptyText: string;
  headers: string[];
  rows: string[][];
}) {
  if (rows.length === 0) {
    return (
      <div className="settings-empty">
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="settings-table-wrap">
      <table className="settings-table">
        <thead>
          <tr>
            {headers.map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${row.join("|")}`}>
              {row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatRate(value: string, total: string, locale: Locale) {
  const count = Number(value || 0);
  const denominator = Number(total || 0);

  if (!denominator) {
    return "0/0";
  }

  const formatter = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 0 });
  return `${formatter.format(count)}/${formatter.format(denominator)} (${formatter.format((count / denominator) * 100)}%)`;
}

function formatEventName(value: string, locale: Locale) {
  if (locale !== "zh") {
    return value;
  }

  const labels: Record<string, string> = {
    "ask.global": "全局问答",
    "ask.wiki": "知识页问答",
    "capture.created": "保存成功",
    "capture.entry.viewed": "进入快存",
    "source.created": "生成来源",
    "wiki.created": "生成知识页",
  };

  return labels[value] || value.replaceAll(".", " / ").replaceAll("_", " ");
}

function createEmptySummary(): RetentionSummaryRow {
  return {
    activated_10m: "0",
    asked_users: "0",
    capture_users: "0",
    d1_eligible_users: "0",
    d1_capture_users: "0",
    d7_eligible_users: "0",
    d7_capture_users: "0",
    registered_users: "0",
    source_users: "0",
    weekly_capture_days_avg: "0",
    wiki_users: "0",
  };
}

function isMissingRelationError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P01";
}
