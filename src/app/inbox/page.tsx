import { CaptureForm } from "@/components/capture-form";
import Link from "next/link";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { formatDateTime, getLocale, localeText, type Locale } from "@/lib/i18n";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { CaptureStatus, CaptureType, JobStatus } from "@/types/database";

interface CaptureResultRow {
  id: string;
  type: CaptureType;
  raw_url: string | null;
  raw_text: string | null;
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

async function loadCaptureResults() {
  const userContext = getUserContextFromHeaders();
  const result = await query<CaptureResultRow>(
    `
      select
        c.id,
        c.type,
        c.raw_url,
        c.raw_text,
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
      order by c.created_at desc
      limit 20
    `,
    [userContext.userId],
  );

  return result.rows;
}

export default async function InboxPage() {
  const locale = getLocale();
  let captures: CaptureResultRow[] = [];
  let configError: MissingEnvError | null = null;
  let loadError: string | null = null;

  try {
    captures = await loadCaptureResults();
  } catch (error) {
    if (error instanceof MissingEnvError) {
      configError = error;
    } else {
      loadError = error instanceof Error ? error.message : "无法读取本地数据库。";
    }
  }

  return (
    <>
      <section className="hero">
        <div className="eyebrow">{localeText(locale, "收集箱", "Inbox")}</div>
        <h1>{localeText(locale, "保存新的资料", "Save new material")}</h1>
        <p>
          {localeText(
            locale,
            "支持链接、文本和本地图片上传。保存动作会先快速完成，提取、整理和向量化放到后台处理。",
            "Save links, text, and local images. Capture returns quickly while extraction, structuring, and embeddings run in the background.",
          )}
        </p>
      </section>
      <CaptureForm locale={locale} />
      <section className="results-section" aria-label={localeText(locale, "处理结果", "Processing results")}>
        <div className="section-heading">
          <div>
            <div className="eyebrow">{localeText(locale, "处理进度", "Processing")}</div>
            <h2>{localeText(locale, "处理结果", "Results")}</h2>
          </div>
          <span className="meta">{localeText(locale, "最近 20 条", "Latest 20")}</span>
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
        ) : captures.length > 0 ? (
          <div className="capture-list">
            {captures.map((capture) => (
              <article className="capture-row" key={capture.id}>
                <div className="capture-main">
                  <div className="capture-title">
                    <span className="type-pill">{getCaptureTypeLabel(capture.type, locale)}</span>
                    <Link href={`/inbox/${capture.id}`}>
                      <strong>{getCaptureTitle(capture)}</strong>
                    </Link>
                  </div>
                  {capture.note ? <p>{capture.note}</p> : null}
                  <span className="meta">
                    {formatDateTime(capture.created_at, locale)} · {capture.id.slice(0, 8)}
                  </span>
                </div>

                <div className="status-stack" aria-label={localeText(locale, "处理状态", "Processing status")}>
                  <StatusBadge label={localeText(locale, "收集", "Capture")} locale={locale} status={capture.status} />
                  <StatusBadge label={localeText(locale, "任务", "Job")} locale={locale} status={capture.job_status || "queued"} />
                  <StepBadge locale={locale} step={capture.current_step} />
                  {capture.error_message ? <span className="error-text">{capture.error_message}</span> : null}
                </div>

                <div className="artifact-stack" aria-label={localeText(locale, "生成结果", "Generated artifacts")}>
                  <ArtifactState
                    href={capture.source_id ? `/sources/${capture.source_id}` : null}
                    label={localeText(locale, "来源", "Source")}
                    locale={locale}
                    title={capture.source_title}
                  />
                  <ArtifactState
                    href={capture.wiki_slug ? `/wiki/${capture.wiki_slug}` : null}
                    label={localeText(locale, "知识页", "Wiki")}
                    locale={locale}
                    title={capture.wiki_title}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>{localeText(locale, "还没有资料", "No captures yet")}</strong>
            <span className="meta">
              {localeText(locale, "提交链接、文本或图片后，这里会显示处理状态和生成结果。", "Submit a link, text, or image to see processing status here.")}
            </span>
          </div>
        )}
      </section>
    </>
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

function getCaptureTypeLabel(type: CaptureType, locale: Locale) {
  const labels: Record<CaptureType, string> = {
    link: localeText(locale, "链接", "Link"),
    text: localeText(locale, "文本", "Text"),
    image: localeText(locale, "图片", "Image"),
  };

  return labels[type];
}

function getStepLabel(step: string | null, locale: Locale) {
  const labels: Record<string, string> = {
    queued: localeText(locale, "等待处理", "Queued"),
    starting: localeText(locale, "启动任务", "Starting"),
    dispatch_failed: localeText(locale, "派发失败", "Dispatch failed"),
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
  };

  return labels[status] || status;
}
