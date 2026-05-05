import { CaptureForm } from "@/components/capture-form";
import { CaptureImportPanel } from "@/components/capture-import-panel";
import { AutoRefresh } from "@/components/auto-refresh";
import { CaptureTriageActions } from "@/components/capture-triage-actions";
import Link from "next/link";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { formatDateTime, getLocale, localeText, type Locale } from "@/lib/i18n";
import { loadKnowledgeDiscoveries, type KnowledgeDiscoveryView } from "@/lib/knowledge-discoveries";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { CaptureStatus, CaptureType, JobStatus, Json, RawAttachment } from "@/types/database";

type InputKind = "link" | "text" | "image";
type InboxView = "all" | "today" | "active" | "failed" | "needs-note" | "ignored" | "low-signal";

interface CaptureResultRow {
  id: string;
  type: CaptureType;
  raw_url: string | null;
  raw_text: string | null;
  raw_payload: Json;
  raw_attachments: RawAttachment[];
  note: string | null;
  status: CaptureStatus;
  created_at: string;
  job_status: JobStatus | null;
  current_step: string | null;
  error_message: string | null;
  job_created_at: string | null;
  source_id: string | null;
  source_title: string | null;
  wiki_page_id: string | null;
  wiki_title: string | null;
  wiki_slug: string | null;
}

interface InboxStats {
  activeTodayCount: number;
  allCount: number;
  defaultCount: number;
  failedCount: number;
  ignoredCount: number;
  lowSignalCount: number;
  missingNoteCount: number;
  todayCount: number;
}

const CAPTURE_LIST_LIMIT = 36;
const CAPTURE_LIST_MAX_LIMIT = 180;
const LOW_SIGNAL_CAPTURE_SQL = `
  (
    coalesce(c.raw_text, '') ~* '(P[0-9]+|SMOKE|TEST|REVIEW|REGRESSION)'
    or coalesce(c.raw_url, '') ~* '(P[0-9]+|SMOKE|TEST|REVIEW|REGRESSION)'
    or coalesce(s.title, '') ~* '(P[0-9]+|SMOKE|TEST|REVIEW|REGRESSION)'
    or coalesce(wp.title, '') ~* '(P[0-9]+|SMOKE|TEST|REVIEW|REGRESSION)'
  )
`;

async function loadCaptureResults(userId: string, view: InboxView, limit = CAPTURE_LIST_LIMIT) {
  const todayRange = getTodayRange();
  const filters = getCaptureViewSqlFilter(view);
  const result = await query<CaptureResultRow>(
    `
      select
        c.id,
        c.type,
        c.raw_url,
        c.raw_text,
        coalesce(c.raw_payload, '{}'::jsonb) as raw_payload,
        coalesce(c.raw_attachments, '[]'::jsonb) as raw_attachments,
        c.note,
        c.status,
        c.created_at,
        pj.status as job_status,
        pj.current_step,
        pj.error_message,
        pj.created_at as job_created_at,
        s.id as source_id,
        s.title as source_title,
        wp.id as wiki_page_id,
        wp.title as wiki_title,
        wp.slug as wiki_slug
      from captures c
      left join lateral (
        select status, current_step, error_message, created_at
        from processing_jobs
        where capture_id = c.id
        order by created_at desc
        limit 1
      ) pj on true
      left join sources s on s.capture_id = c.id
      left join source_wiki_pages swp on swp.source_id = s.id
      left join wiki_pages wp on wp.id = swp.wiki_page_id
      where c.user_id = $1
        and ${filters.sql}
      order by c.created_at desc
      limit $${filters.params.length + 2}
    `,
    [userId, ...filters.params.map((param) => param === "$todayStart" ? todayRange.start : todayRange.end), limit],
  );

  return result.rows;
}

async function loadInboxStats(userId: string) {
  const todayRange = getTodayRange();
  const result = await query<Record<keyof InboxStats, string>>(
    `
      select
        count(*)::text as "allCount",
        count(*) filter (
          where c.status <> 'ignored'
            and not ${LOW_SIGNAL_CAPTURE_SQL}
        )::text as "defaultCount",
        count(*) filter (
          where c.status <> 'ignored'
            and c.created_at >= $2
            and c.created_at < $3
            and not ${LOW_SIGNAL_CAPTURE_SQL}
        )::text as "todayCount",
        count(*) filter (
          where c.status <> 'ignored'
            and c.created_at >= $2
            and c.created_at < $3
            and not ${LOW_SIGNAL_CAPTURE_SQL}
            and (
              c.status in ('queued', 'processing')
              or pj.status in ('queued', 'running')
            )
        )::text as "activeTodayCount",
        count(*) filter (
          where c.status <> 'ignored'
            and not ${LOW_SIGNAL_CAPTURE_SQL}
            and (
              c.status = 'failed'
              or pj.status = 'failed'
            )
        )::text as "failedCount",
        count(*) filter (
          where c.status <> 'ignored'
            and not ${LOW_SIGNAL_CAPTURE_SQL}
            and (c.note is null or btrim(c.note) = '')
        )::text as "missingNoteCount",
        count(*) filter (
          where c.status <> 'ignored'
            and ${LOW_SIGNAL_CAPTURE_SQL}
        )::text as "lowSignalCount",
        count(*) filter (where c.status = 'ignored')::text as "ignoredCount"
      from captures c
      left join lateral (
        select status
        from processing_jobs
        where capture_id = c.id
        order by created_at desc
        limit 1
      ) pj on true
      left join sources s on s.capture_id = c.id
      left join source_wiki_pages swp on swp.source_id = s.id
      left join wiki_pages wp on wp.id = swp.wiki_page_id
      where c.user_id = $1
    `,
    [userId, todayRange.start, todayRange.end],
  );
  const row = result.rows[0];

  return {
    activeTodayCount: Number(row?.activeTodayCount || 0),
    allCount: Number(row?.allCount || 0),
    defaultCount: Number(row?.defaultCount || 0),
    failedCount: Number(row?.failedCount || 0),
    ignoredCount: Number(row?.ignoredCount || 0),
    lowSignalCount: Number(row?.lowSignalCount || 0),
    missingNoteCount: Number(row?.missingNoteCount || 0),
    todayCount: Number(row?.todayCount || 0),
  } satisfies InboxStats;
}

export default async function InboxPage({ searchParams }: { searchParams?: { limit?: string; view?: string } }) {
  const locale = getLocale();
  const activeView = parseInboxView(searchParams?.view);
  const listLimit = parseCaptureListLimit(searchParams?.limit);
  let captures: CaptureResultRow[] = [];
  let failedPreview: CaptureResultRow[] = [];
  let discoveries: KnowledgeDiscoveryView[] = [];
  let stats: InboxStats = createEmptyInboxStats();
  let configError: MissingEnvError | null = null;
  let loadError: string | null = null;

  try {
    const userContext = getUserContextFromHeaders();
    [captures, failedPreview, stats, discoveries] = await Promise.all([
      loadCaptureResults(userContext.userId, activeView, listLimit),
      loadCaptureResults(userContext.userId, "failed", 3),
      loadInboxStats(userContext.userId),
      loadKnowledgeDiscoveries({
        userId: userContext.userId,
        limit: 4,
      }).catch(() => []),
    ]);
  } catch (error) {
    if (error instanceof MissingEnvError) {
      configError = error;
    } else {
      loadError = error instanceof Error ? error.message : "无法读取本地数据库。";
    }
  }

  const visibleCaptures = captures;
  const groupedCaptures = groupCapturesByDay(visibleCaptures, locale);
  const shouldAutoRefresh = stats.activeTodayCount > 0;
  const viewLabel = getInboxViewLabel(activeView, locale);
  const viewTotal = getInboxViewTotal(activeView, stats);

  return (
    <>
      <AutoRefresh enabled={shouldAutoRefresh} />
      <section className="inbox-header">
        <div>
          <div className="eyebrow">{localeText(locale, "收集箱", "Inbox")}</div>
          <h1>{localeText(locale, "喂给 Sift", "Feed Sift")}</h1>
        </div>
        <div className="inbox-header-actions">
          <p>
            {localeText(locale, "链接、正文、截图、想法都可以先丢进来。", "Drop in links, text, screenshots, and notes first.")}
          </p>
          <CaptureImportPanel locale={locale} />
        </div>
      </section>
      <CaptureForm locale={locale} />
      <DailyReviewPanel
        activeView={activeView}
        discoveryCount={discoveries.length}
        failedPreview={failedPreview}
        locale={locale}
        stats={stats}
      />
      <section className="results-section" aria-label={localeText(locale, "处理结果", "Processing results")}>
        <div className="section-heading">
          <div>
            <div className="eyebrow">{localeText(locale, "处理进度", "Processing")}</div>
            <h2>{viewLabel}</h2>
          </div>
          <span className="meta">
            {getResultCountLabel(visibleCaptures.length, viewTotal, locale)}
          </span>
        </div>

        {configError ? (
          <div className="empty-state">
            <strong>还不能读取本地数据</strong>
            <span className="meta">缺少环境变量：{configError.missingKeys.join(", ")}</span>
          </div>
        ) : loadError ? (
          <div className="empty-state">
            <strong>还不能连接本地数据库</strong>
            <span className="meta">{loadError}</span>
          </div>
        ) : visibleCaptures.length > 0 ? (
          <>
            <div className="capture-day-list">
              {groupedCaptures.map((group) => (
                <section className="capture-day-group" key={group.key}>
                  <div className="capture-day-heading">
                    <h3>{group.label}</h3>
                    <span className="meta">
                      {group.items.length} {localeText(locale, "条资料", "captures")}
                    </span>
                  </div>
                  <div className="capture-list">
                    {group.items.map((capture) => (
                      <CaptureRow capture={capture} key={capture.id} locale={locale} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {viewTotal > visibleCaptures.length ? (
              <div className="load-more-row">
                <Link
                  className="button button-secondary"
                  href={buildInboxHref(activeView, listLimit + CAPTURE_LIST_LIMIT)}
                  scroll={false}
                >
                  {localeText(locale, "加载更多", "Load more")}
                </Link>
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            <strong>{stats.allCount > 0 ? getEmptyViewText(activeView, locale) : localeText(locale, "还没有资料", "No captures yet")}</strong>
            <span className="meta">
              {stats.allCount > 0
                ? localeText(locale, "换个视图看看，或继续收集新的资料。", "Switch views or keep capturing new material.")
                : localeText(locale, "提交链接、文本或图片后，这里会显示处理状态和生成结果。", "Submit a link, text, or image to see processing status here.")}
            </span>
          </div>
        )}
      </section>
    </>
  );
}

function CaptureRow({ capture, locale }: { capture: CaptureResultRow; locale: Locale }) {
  const inputKinds = getCaptureInputKinds(capture);
  const isFailed = isFailedCapture(capture);
  const isIgnored = capture.status === "ignored";
  const needsNote = isCaptureMissingNote(capture);

  return (
    <article className="capture-row">
      <div className="capture-main">
        <div className="capture-title">
          <span className="type-pill">{getCaptureTypeLabel(capture, locale)}</span>
          <Link href={`/inbox/${capture.id}`}>
            <strong>{getCaptureTitle(capture)}</strong>
          </Link>
        </div>
        <div className="capture-kinds" aria-label={localeText(locale, "输入类型", "Input types")}>
          {inputKinds.map((kind) => (
            <span key={kind}>{getInputKindLabel(kind, locale)}</span>
          ))}
        </div>
        {capture.note ? <p>{capture.note}</p> : null}
        <span className="meta">
          {formatDateTime(capture.created_at, locale)} · {capture.id.slice(0, 8)}
        </span>
        {isFailed ? (
          <p className="failure-hint">
            {getFailureHint(capture, locale)}
          </p>
        ) : null}
        {needsNote ? (
          <Link className="note-shortcut" href={`/inbox/${capture.id}#note`}>
            {localeText(locale, "补一句为什么保存", "Add why this matters")}
          </Link>
        ) : null}
      </div>

      <div className="status-stack" aria-label={localeText(locale, "处理状态", "Processing status")}>
        <StatusBadge label={localeText(locale, "收集", "Capture")} locale={locale} status={capture.status} />
        <StatusBadge label={localeText(locale, "任务", "Job")} locale={locale} status={capture.job_status || "queued"} />
        <StepBadge locale={locale} step={capture.current_step} />
        {capture.error_message ? <span className="error-text">{capture.error_message}</span> : null}
        {isFailed || isIgnored ? (
          <CaptureTriageActions
            captureId={capture.id}
            isIgnored={isIgnored}
            locale={locale}
            showSupplement={isFailed}
          />
        ) : null}
      </div>

      <div className="artifact-stack" aria-label={localeText(locale, "生成结果", "Generated artifacts")}>
        <ArtifactState
          href={capture.source_id ? `/sources/${capture.source_id}` : null}
          label={localeText(locale, "来源", "Source")}
          locale={locale}
          title={capture.source_title}
        />
        <ArtifactState
          href={capture.wiki_slug ? `/wiki/${encodeURIComponent(capture.wiki_slug)}` : null}
          label={localeText(locale, "知识页", "Wiki")}
          locale={locale}
          title={capture.wiki_title}
        />
      </div>
    </article>
  );
}

function DailyReviewPanel({
  activeView,
  discoveryCount,
  failedPreview,
  locale,
  stats,
}: {
  activeView: InboxView;
  discoveryCount: number;
  failedPreview: CaptureResultRow[];
  locale: Locale;
  stats: InboxStats;
}) {
  return (
    <section className="daily-review" aria-label={localeText(locale, "今日收集", "Today")}>
      <div className="daily-review-heading">
        <div>
          <div className="eyebrow">{localeText(locale, "今日收集", "Today")}</div>
          <h2>{localeText(locale, "先收好，晚点清理", "Capture first, triage later")}</h2>
        </div>
        <span className="meta">
          {discoveryCount > 0 ? (
            <Link href="/#discoveries">
              {localeText(locale, "待处理发现", "Discoveries")} {discoveryCount}
            </Link>
          ) : (
            <>
              {localeText(locale, "待处理发现", "Discoveries")} {discoveryCount}
            </>
          )}{" "}
          ·{" "}
          {localeText(locale, "自动刷新处理中资料", "Auto-refreshes active captures")}
        </span>
      </div>
      <div className="daily-review-grid">
        <TriageCard
          activeView={activeView}
          count={stats.todayCount}
          label={localeText(locale, "今天已收", "Today")}
          view="today"
        />
        <TriageCard
          activeView={activeView}
          count={stats.activeTodayCount}
          label={localeText(locale, "今日处理中", "Active today")}
          view="active"
        />
        <TriageCard
          activeView={activeView}
          count={stats.failedCount}
          isWarning={stats.failedCount > 0}
          label={localeText(locale, "失败待处理", "Failed")}
          view="failed"
        />
        <TriageCard
          activeView={activeView}
          count={stats.missingNoteCount}
          label={localeText(locale, "待补备注", "Needs note")}
          view="needs-note"
        />
        <TriageCard
          activeView={activeView}
          count={stats.ignoredCount}
          label={localeText(locale, "已忽略", "Ignored")}
          view="ignored"
        />
        <TriageCard
          activeView={activeView}
          count={stats.lowSignalCount}
          label={localeText(locale, "测试资料", "Tests")}
          view="low-signal"
        />
        <Link className={activeView === "all" ? "triage-card is-active" : "triage-card"} href="/inbox" scroll={false}>
          <span>{localeText(locale, "全部最近", "All recent")}</span>
          <strong>{stats.defaultCount}</strong>
        </Link>
      </div>
      {failedPreview.length > 0 ? (
        <div className="daily-failure-list">
          <strong>{localeText(locale, "需要处理的失败资料", "Failed captures to review")}</strong>
          {failedPreview.map((capture) => (
            <Link href={`/inbox/${capture.id}`} key={capture.id}>
              <span>{getCaptureTitle(capture)}</span>
              <small>{getFailureHint(capture, locale)}</small>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TriageCard({
  activeView,
  count,
  isWarning = false,
  label,
  view,
}: {
  activeView: InboxView;
  count: number;
  isWarning?: boolean;
  label: string;
  view: InboxView;
}) {
  const className = [
    "triage-card",
    activeView === view ? "is-active" : "",
    isWarning ? "triage-card-warning" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link className={className} href={view === "all" ? "/inbox" : `/inbox?view=${view}`} scroll={false}>
      <span>{label}</span>
      <strong>{count}</strong>
    </Link>
  );
}

function StatusBadge({ label, locale, status }: { label: string; locale: Locale; status: CaptureStatus | JobStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span>{label}</span>
      <strong>{getStatusLabel(status, locale)}</strong>
    </span>
  );
}

function StepBadge({ locale, step }: { locale: Locale; step: string | null }) {
  return (
    <span className="step-badge">
      <span>{localeText(locale, "步骤", "Step")}</span>
      <strong>{getStepLabel(step, locale)}</strong>
    </span>
  );
}

function ArtifactState({
  href,
  label,
  locale,
  title,
}: {
  href: string | null;
  label: string;
  locale: Locale;
  title: string | null;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{title || localeText(locale, "等待生成", "Pending")}</strong>
    </>
  );

  if (href) {
    return (
      <Link className="artifact is-ready artifact-link" href={href}>
        {content}
      </Link>
    );
  }

  return (
    <div className={title ? "artifact is-ready" : "artifact"}>
      {content}
    </div>
  );
}

function getCaptureTitle(capture: CaptureResultRow) {
  if (capture.raw_url) {
    return capture.raw_url;
  }

  if (capture.raw_text) {
    return capture.raw_text.replace(/\s+/g, " ").slice(0, 84);
  }

  return "未命名资料";
}

function getCaptureTypeLabel(capture: CaptureResultRow, locale: Locale) {
  if (getCaptureInputKinds(capture).length > 1) {
    return localeText(locale, "混合", "Mixed");
  }

  const labels: Record<CaptureType, string> = {
    link: localeText(locale, "链接", "Link"),
    text: localeText(locale, "文本", "Text"),
    image: localeText(locale, "图片", "Image"),
  };

  return labels[capture.type];
}

function getInputKindLabel(kind: InputKind, locale: Locale) {
  const labels: Record<InputKind, string> = {
    link: localeText(locale, "链接", "Link"),
    text: localeText(locale, "文本", "Text"),
    image: localeText(locale, "图片", "Image"),
  };

  return labels[kind];
}

function getCaptureInputKinds(capture: CaptureResultRow): InputKind[] {
  const payload = getJsonObject(capture.raw_payload);
  const payloadKinds = payload.inputKinds;

  if (Array.isArray(payloadKinds)) {
    const kinds = payloadKinds.filter((kind): kind is InputKind => kind === "link" || kind === "text" || kind === "image");

    if (kinds.length > 0) {
      return kinds;
    }
  }

  const kinds: InputKind[] = [];

  if (capture.raw_url) {
    kinds.push("link");
  }

  if (capture.raw_text) {
    kinds.push("text");
  }

  if (capture.raw_attachments.length > 0) {
    kinds.push("image");
  }

  const fallbackKind: InputKind = capture.type === "image" ? "image" : capture.type === "link" ? "link" : "text";
  return kinds.length > 0 ? kinds : [fallbackKind];
}

function groupCapturesByDay(captures: CaptureResultRow[], locale: Locale) {
  const now = new Date();
  const todayKey = getDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = getDateKey(yesterday);
  const groups = new Map<string, { key: string; label: string; items: CaptureResultRow[] }>();

  for (const capture of captures) {
    const createdAt = new Date(capture.created_at);
    const dateKey = getDateKey(createdAt);
    const groupKey = getDateGroupKey(createdAt, todayKey, yesterdayKey);
    const label = getDateGroupLabel(groupKey, createdAt, locale);
    const existing = groups.get(groupKey);

    if (existing) {
      existing.items.push(capture);
    } else {
      groups.set(groupKey, { key: `${groupKey}-${dateKey}`, label, items: [capture] });
    }
  }

  return Array.from(groups.values());
}

function parseInboxView(value: string | undefined): InboxView {
  if (
    value === "today" ||
    value === "active" ||
    value === "failed" ||
    value === "needs-note" ||
    value === "ignored" ||
    value === "low-signal"
  ) {
    return value;
  }

  return "all";
}

function parseCaptureListLimit(value: string | undefined) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return CAPTURE_LIST_LIMIT;
  }

  return Math.min(Math.max(CAPTURE_LIST_LIMIT, Math.floor(parsed)), CAPTURE_LIST_MAX_LIMIT);
}

function buildInboxHref(view: InboxView, limit: number) {
  const searchParams = new URLSearchParams();

  if (view !== "all") {
    searchParams.set("view", view);
  }

  if (limit > CAPTURE_LIST_LIMIT) {
    searchParams.set("limit", String(Math.min(limit, CAPTURE_LIST_MAX_LIMIT)));
  }

  const queryString = searchParams.toString();
  return queryString ? `/inbox?${queryString}` : "/inbox";
}

function createEmptyInboxStats(): InboxStats {
  return {
    activeTodayCount: 0,
    allCount: 0,
    defaultCount: 0,
    failedCount: 0,
    ignoredCount: 0,
    lowSignalCount: 0,
    missingNoteCount: 0,
    todayCount: 0,
  };
}

function getCaptureViewSqlFilter(view: InboxView) {
  if (view === "today") {
    return {
      params: ["$todayStart", "$todayEnd"],
      sql: `c.status <> 'ignored' and c.created_at >= $2 and c.created_at < $3 and not ${LOW_SIGNAL_CAPTURE_SQL}`,
    };
  }

  if (view === "active") {
    return {
      params: ["$todayStart", "$todayEnd"],
      sql: `
        c.status <> 'ignored'
        and c.created_at >= $2
        and c.created_at < $3
        and not ${LOW_SIGNAL_CAPTURE_SQL}
        and (
          c.status in ('queued', 'processing')
          or pj.status in ('queued', 'running')
        )
      `,
    };
  }

  if (view === "failed") {
    return {
      params: [],
      sql: `c.status <> 'ignored' and not ${LOW_SIGNAL_CAPTURE_SQL} and (c.status = 'failed' or pj.status = 'failed')`,
    };
  }

  if (view === "needs-note") {
    return {
      params: [],
      sql: `c.status <> 'ignored' and not ${LOW_SIGNAL_CAPTURE_SQL} and (c.note is null or btrim(c.note) = '')`,
    };
  }

  if (view === "ignored") {
    return {
      params: [],
      sql: "c.status = 'ignored'",
    };
  }

  if (view === "low-signal") {
    return {
      params: [],
      sql: `c.status <> 'ignored' and ${LOW_SIGNAL_CAPTURE_SQL}`,
    };
  }

  return {
    params: [],
    sql: `c.status <> 'ignored' and not ${LOW_SIGNAL_CAPTURE_SQL}`,
  };
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);

  return {
    end: end.toISOString(),
    start: start.toISOString(),
  };
}

function getInboxViewTotal(view: InboxView, stats: InboxStats) {
  const totals: Record<InboxView, number> = {
    active: stats.activeTodayCount,
    all: stats.defaultCount,
    failed: stats.failedCount,
    ignored: stats.ignoredCount,
    "low-signal": stats.lowSignalCount,
    "needs-note": stats.missingNoteCount,
    today: stats.todayCount,
  };

  return totals[view];
}

function getResultCountLabel(visibleCount: number, totalCount: number, locale: Locale) {
  if (totalCount > visibleCount) {
    return localeText(
      locale,
      `显示 ${visibleCount} / 共 ${totalCount} 条资料`,
      `Showing ${visibleCount} / ${totalCount} captures`,
    );
  }

  return `${totalCount} ${localeText(locale, "条资料", "captures")}`;
}

function filterCapturesByView(captures: CaptureResultRow[], view: InboxView) {
  if (view === "today") {
    const todayKey = getDateKey(new Date());
    return captures.filter(
      (capture) => isDefaultInboxCapture(capture) && getDateKey(new Date(capture.created_at)) === todayKey,
    );
  }

  if (view === "active") {
    const todayKey = getDateKey(new Date());
    return captures.filter(
      (capture) =>
        isDefaultInboxCapture(capture) && isActiveCapture(capture) && getDateKey(new Date(capture.created_at)) === todayKey,
    );
  }

  if (view === "failed") {
    return captures.filter((capture) => isDefaultInboxCapture(capture) && isFailedCapture(capture));
  }

  if (view === "needs-note") {
    return captures.filter((capture) => isDefaultInboxCapture(capture) && isCaptureMissingNote(capture));
  }

  if (view === "ignored") {
    return captures.filter((capture) => capture.status === "ignored");
  }

  if (view === "low-signal") {
    return captures.filter((capture) => isDefaultInboxCapture(capture) && isLowSignalCapture(capture));
  }

  return captures.filter((capture) => isDefaultInboxCapture(capture) && !isLowSignalCapture(capture));
}

function isDefaultInboxCapture(capture: CaptureResultRow) {
  return capture.status !== "ignored";
}

function isLowSignalCapture(capture: CaptureResultRow) {
  return [capture.raw_text, capture.raw_url, capture.source_title, capture.wiki_title].some((value) =>
    /\b(P\d+|SMOKE|TEST|REVIEW|REGRESSION)\b/i.test(value || ""),
  );
}

function getInboxViewLabel(view: InboxView, locale: Locale) {
  const labels: Record<InboxView, string> = {
    all: localeText(locale, "处理结果", "Results"),
    today: localeText(locale, "今日收集", "Today"),
    active: localeText(locale, "今日处理中", "Active today"),
    failed: localeText(locale, "失败待处理", "Failed captures"),
    "needs-note": localeText(locale, "待补备注", "Needs note"),
    ignored: localeText(locale, "已忽略", "Ignored"),
    "low-signal": localeText(locale, "测试资料", "Test captures"),
  };

  return labels[view];
}

function getEmptyViewText(view: InboxView, locale: Locale) {
  const labels: Record<InboxView, string> = {
    all: localeText(locale, "还没有资料", "No captures yet"),
    today: localeText(locale, "今天还没有收集资料", "No captures today"),
    active: localeText(locale, "今天没有处理中资料", "No active captures today"),
    failed: localeText(locale, "没有失败资料", "No failed captures"),
    "needs-note": localeText(locale, "没有待补备注", "No missing notes"),
    ignored: localeText(locale, "没有已忽略资料", "No ignored captures"),
    "low-signal": localeText(locale, "没有测试资料", "No test captures"),
  };

  return labels[view];
}

function getDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDateGroupKey(date: Date, todayKey: string, yesterdayKey: string) {
  const dateKey = getDateKey(date);

  if (dateKey === todayKey) {
    return "today";
  }

  if (dateKey === yesterdayKey) {
    return "yesterday";
  }

  const ageMs = Date.now() - date.getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  return ageMs < sevenDaysMs ? "this-week" : dateKey;
}

function getDateGroupLabel(groupKey: string, date: Date, locale: Locale) {
  if (groupKey === "today") {
    return localeText(locale, "今天", "Today");
  }

  if (groupKey === "yesterday") {
    return localeText(locale, "昨天", "Yesterday");
  }

  if (groupKey === "this-week") {
    return localeText(locale, "本周更早", "Earlier this week");
  }

  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getJsonObject(value: Json) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isActiveCapture(capture: CaptureResultRow) {
  return (
    capture.status !== "ignored" &&
    (capture.status === "queued" ||
      capture.status === "processing" ||
      capture.job_status === "queued" ||
      capture.job_status === "running")
  );
}

function isFailedCapture(capture: CaptureResultRow) {
  return capture.status === "failed" || capture.job_status === "failed";
}

function isCaptureMissingNote(capture: CaptureResultRow) {
  return capture.status !== "ignored" && !capture.note?.trim() && getCaptureInputKinds(capture).length > 0;
}

function getFailureHint(capture: CaptureResultRow, locale: Locale) {
  const payload = getJsonObject(capture.raw_payload);

  if (payload.sourcePlatform === "x") {
    return localeText(locale, "X 链接已保存，建议补充截图或复制正文后重试。", "X link is saved; add screenshots or copied text, then retry.");
  }

  if (capture.raw_attachments.length > 0 && !capture.raw_text) {
    return localeText(locale, "图片已保存，建议补充一句说明或重新尝试 OCR。", "Images are saved; add a short note or retry OCR.");
  }

  return localeText(locale, "原始资料已保留，可以补充资料、重试或忽略。", "Original input is kept; supplement, retry, or ignore it.");
}

function getStepLabel(step: string | null, locale: Locale) {
  const labels: Record<string, string> = {
    queued: localeText(locale, "等待处理", "Queued"),
    starting: localeText(locale, "启动任务", "Starting"),
    dispatch_failed: localeText(locale, "派发失败", "Dispatch failed"),
    ignored: localeText(locale, "已忽略", "Ignored"),
    fetch_link: localeText(locale, "抓取链接", "Fetching link"),
    extracting: localeText(locale, "提取内容", "Extracting"),
    structuring: localeText(locale, "整理结构", "Structuring"),
    create_source: localeText(locale, "生成来源", "Creating source"),
    create_wiki_page: localeText(locale, "生成知识页", "Creating wiki page"),
    create_embeddings: localeText(locale, "写入向量", "Creating embeddings"),
    create_chunks: localeText(locale, "切分片段", "Creating chunks"),
    completed: localeText(locale, "已完成", "Completed"),
  };

  return labels[step || "queued"] || step || localeText(locale, "等待处理", "Queued");
}

function getStatusLabel(status: CaptureStatus | JobStatus, locale: Locale) {
  const labels: Record<string, string> = {
    queued: localeText(locale, "等待中", "Queued"),
    processing: localeText(locale, "处理中", "Processing"),
    running: localeText(locale, "运行中", "Running"),
    completed: localeText(locale, "已完成", "Completed"),
    failed: localeText(locale, "失败", "Failed"),
    ignored: localeText(locale, "已忽略", "Ignored"),
  };

  return labels[status] || status;
}
