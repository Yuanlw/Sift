import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { formatDateTime, getLocale, localeText, type Locale } from "@/lib/i18n";
import { getUserContextFromHeaders } from "@/lib/user-context";
import type { CaptureStatus, CaptureType, ExtractionStatus, JobStatus, Json, RawAttachment } from "@/types/database";

interface CaptureDetailRow {
  id: string;
  type: CaptureType;
  raw_url: string | null;
  raw_text: string | null;
  file_url: string | null;
  raw_payload: Json;
  raw_attachments: RawAttachment[];
  note: string | null;
  status: CaptureStatus;
  created_at: string;
  job_id: string | null;
  job_status: JobStatus | null;
  current_step: string | null;
  step_status: Json | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  extracted_title: string | null;
  extracted_text: string | null;
  extraction_method: string | null;
  extraction_status: ExtractionStatus | null;
  extraction_error_message: string | null;
  extraction_metadata: Json | null;
  extracted_created_at: string | null;
  source_id: string | null;
  source_title: string | null;
  source_summary: string | null;
  wiki_slug: string | null;
  wiki_title: string | null;
}

async function loadCapture(id: string) {
  if (!isUuid(id)) {
    return null;
  }

  const userContext = getUserContextFromHeaders();
  const result = await query<CaptureDetailRow>(
    `
      select
        c.id,
        c.type,
        c.raw_url,
        c.raw_text,
        c.file_url,
        coalesce(c.raw_payload, '{}'::jsonb) as raw_payload,
        coalesce(c.raw_attachments, '[]'::jsonb) as raw_attachments,
        c.note,
        c.status,
        c.created_at,
        pj.id as job_id,
        pj.status as job_status,
        pj.current_step,
        pj.step_status,
        pj.error_message,
        pj.started_at,
        pj.finished_at,
        ec.title as extracted_title,
        ec.content_text as extracted_text,
        ec.extraction_method,
        ec.status as extraction_status,
        ec.error_message as extraction_error_message,
        ec.metadata as extraction_metadata,
        ec.created_at as extracted_created_at,
        s.id as source_id,
        s.title as source_title,
        s.summary as source_summary,
        wp.slug as wiki_slug,
        wp.title as wiki_title
      from captures c
      left join lateral (
        select id, status, current_step, step_status, error_message, started_at, finished_at
        from processing_jobs
        where capture_id = c.id
        order by created_at desc
        limit 1
      ) pj on true
      left join lateral (
        select title, content_text, extraction_method, status, error_message, metadata, created_at
        from extracted_contents
        where capture_id = c.id
        order by created_at desc
        limit 1
      ) ec on true
      left join sources s on s.capture_id = c.id
      left join source_wiki_pages swp on swp.source_id = s.id
      left join wiki_pages wp on wp.id = swp.wiki_page_id
      where c.id = $1 and c.user_id = $2
      limit 1
    `,
    [id, userContext.userId],
  );

  return result.rows[0] || null;
}

export default async function CaptureDetailPage({ params }: { params: { id: string } }) {
  const locale = getLocale();
  const capture = await loadCapture(params.id);

  if (!capture) {
    notFound();
  }

  return (
    <>
      <section className="detail-hero">
        <Link className="back-link" href="/inbox">
          {localeText(locale, "返回收集箱", "Back to Inbox")}
        </Link>
        <div className="item-header">
          <span className="type-pill">{getCaptureTypeLabel(capture.type, locale)}</span>
          <h1>{getCaptureTitle(capture)}</h1>
        </div>
        <div className="detail-meta">
          <span>{formatDateTime(capture.created_at, locale, true)}</span>
          <span>{localeText(locale, "收集记录", "Capture")} {capture.id.slice(0, 8)}</span>
          {capture.raw_url ? (
            <a href={capture.raw_url} rel="noreferrer" target="_blank">
              原始链接
            </a>
          ) : null}
        </div>
      </section>

      <div className="detail-layout">
        <aside className="detail-sidebar">
          <div className="panel">
            <h3>状态</h3>
            <div className="status-stack">
              <StatusBadge label={localeText(locale, "收集", "Capture")} locale={locale} status={capture.status} />
              <StatusBadge label={localeText(locale, "任务", "Job")} locale={locale} status={capture.job_status || "queued"} />
              <StepBadge locale={locale} step={capture.current_step} />
            </div>
            {capture.error_message ? <p className="error-text">{capture.error_message}</p> : null}
          </div>

          <div className="panel">
            <h3>时间</h3>
            <p>{localeText(locale, "创建", "Created")}：{formatDateTime(capture.created_at, locale, true)}</p>
            <p>{localeText(locale, "开始", "Started")}：{capture.started_at ? formatDateTime(capture.started_at, locale, true) : localeText(locale, "等待中", "Waiting")}</p>
            <p>{localeText(locale, "完成", "Finished")}：{capture.finished_at ? formatDateTime(capture.finished_at, locale, true) : localeText(locale, "等待中", "Waiting")}</p>
          </div>

          <div className="panel">
            <h3>处理步骤</h3>
            <div className="step-list">
              {PROCESSING_STEPS.map((step) => (
                <div className="step-item" key={step}>
                  <span>{getStepLabel(step, locale)}</span>
                  <strong>{getStepState(capture.step_status, step, locale)}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>{localeText(locale, "生成结果", "Artifacts")}</h3>
            <div className="artifact-stack">
              <ArtifactLink href={capture.source_id ? `/sources/${capture.source_id}` : null} label={localeText(locale, "来源", "Source")} locale={locale} title={capture.source_title} />
              <ArtifactLink href={capture.wiki_slug ? `/wiki/${capture.wiki_slug}` : null} label={localeText(locale, "知识页", "Wiki")} locale={locale} title={capture.wiki_title} />
            </div>
          </div>
        </aside>

        <article className="document-view">
          <h2>{localeText(locale, "原始输入", "Original input")}</h2>
          {capture.note ? <p className="note-block">备注：{capture.note}</p> : null}
          {capture.raw_url ? <p className="note-block">{capture.raw_url}</p> : null}
          <pre>{capture.raw_text || capture.file_url || localeText(locale, "这条资料没有可展示的原始文本。", "This capture has no displayable original text.")}</pre>

          {capture.raw_attachments.length > 0 ? (
            <div className="summary-block">
              <h2>{localeText(locale, "原始附件", "Original attachments")}</h2>
              <div className="attachment-list">
                {capture.raw_attachments.map((attachment) => (
                  <a className="attachment-card" href={attachment.url} key={attachment.url} rel="noreferrer" target="_blank">
                    {isImageAttachment(attachment) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt={attachment.name || localeText(locale, "上传图片", "Uploaded image")} src={attachment.url} />
                    ) : null}
                    <span>
                      <strong>{attachment.name || attachment.url}</strong>
                      <small>{attachment.mime_type || attachment.kind}</small>
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="summary-block">
            <h2>{localeText(locale, "原始数据", "Raw data")}</h2>
            <pre>{formatJson(capture.raw_payload)}</pre>
          </div>

          <div className="summary-block">
            <div className="block-heading">
              <h2>{localeText(locale, "提取结果", "Extraction result")}</h2>
              {capture.extraction_status ? (
                <span className={`status-dot status-${capture.extraction_status}`}>
                  {capture.extraction_status}
                </span>
              ) : null}
            </div>
            {capture.extracted_title ? <p className="note-block">{capture.extracted_title}</p> : null}
            {capture.extraction_method ? (
              <p className="meta">
                {capture.extraction_method}
                {capture.extracted_created_at ? ` · ${formatDateTime(capture.extracted_created_at, locale, true)}` : ""}
              </p>
            ) : null}
            {capture.extraction_error_message ? (
              <p className="error-text">{capture.extraction_error_message}</p>
            ) : null}
            <pre>{capture.extracted_text || localeText(locale, "还没有生成提取结果。", "No extraction result yet.")}</pre>
            {capture.extraction_metadata ? (
              <details className="retrieval-details">
                <summary>{localeText(locale, "提取元数据", "Extraction metadata")}</summary>
                <pre>{formatJson(capture.extraction_metadata)}</pre>
              </details>
            ) : null}
          </div>

          {capture.source_summary ? (
            <div className="summary-block">
              <h2>{localeText(locale, "来源摘要", "Source summary")}</h2>
              <p>{capture.source_summary}</p>
            </div>
          ) : null}
        </article>
      </div>
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

function ArtifactLink({ href, label, locale, title }: { href: string | null; label: string; locale: Locale; title: string | null }) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{title || localeText(locale, "等待生成", "Pending")}</strong>
    </>
  );

  if (!href) {
    return <div className="artifact">{content}</div>;
  }

  return (
    <Link className="artifact is-ready artifact-link" href={href}>
      {content}
    </Link>
  );
}

function getCaptureTitle(capture: CaptureDetailRow) {
  if (capture.raw_url) {
    return capture.raw_url;
  }

  if (capture.raw_text) {
    return capture.raw_text.replace(/\s+/g, " ").slice(0, 80);
  }

  return "未命名资料";
}

function formatJson(value: Json | null) {
  return JSON.stringify(value || {}, null, 2);
}

function isImageAttachment(attachment: RawAttachment) {
  return (
    attachment.kind === "image" ||
    Boolean(attachment.mime_type?.startsWith("image/")) ||
    /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(attachment.url)
  );
}

const PROCESSING_STEPS = [
  "fetch_link",
  "extracting",
  "structuring",
  "create_source",
  "create_wiki_page",
  "create_embeddings",
  "create_chunks",
];

function getStepState(stepStatus: Json | null, step: string, locale: Locale) {
  if (!stepStatus || typeof stepStatus !== "object" || Array.isArray(stepStatus)) {
    return localeText(locale, "等待中", "Pending");
  }

  const state = stepStatus[step];

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return localeText(locale, "等待中", "Pending");
  }

  const status = state.status;
  return typeof status === "string" ? getStatusLabel(status as CaptureStatus | JobStatus, locale) : localeText(locale, "等待中", "Pending");
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

function getCaptureTypeLabel(type: CaptureType, locale: Locale) {
  const labels: Record<CaptureType, string> = {
    link: localeText(locale, "链接", "Link"),
    text: localeText(locale, "文本", "Text"),
    image: localeText(locale, "图片", "Image"),
  };

  return labels[type];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
