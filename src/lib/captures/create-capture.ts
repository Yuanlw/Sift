import { inngest } from "@/lib/inngest/client";
import { query } from "@/lib/db";
import { processCaptureById } from "@/lib/processing/process-capture";
import { isRemoteImageUrl } from "@/lib/upload-storage";
import type { Capture, CaptureType, Json, ProcessingJob, RawAttachment } from "@/types/database";

type InputKind = "link" | "text" | "image";
type AttachmentSource = "json" | "multipart";
type Dispatcher = "none" | "inngest" | "inline";

export interface CreateCaptureInput {
  url: string | null;
  text: string | null;
  note: string | null;
  fileUrl: string | null;
  attachments: RawAttachment[];
  sourceApp: string;
  attachmentSource: AttachmentSource;
  extraPayload?: Record<string, Json | undefined>;
}

export interface CreateCaptureOptions {
  dispatcher: Dispatcher;
  userId: string;
}

export interface CreateCaptureResult {
  capture: Capture;
  dispatch: {
    status: "dispatched" | "scheduled" | "queued";
    message?: string;
  };
  inputKinds: InputKind[];
  job: ProcessingJob;
  type: CaptureType;
}

export class CaptureValidationError extends Error {}

export async function createCapture(input: CreateCaptureInput, options: CreateCaptureOptions): Promise<CreateCaptureResult> {
  const normalizedFileUrl = normalizeRemoteImageUrl(input.fileUrl);
  const attachments = normalizeAttachments(normalizedFileUrl, input.attachments, input.attachmentSource);
  const normalizedUrl = normalizeHttpUrl(input.url);
  const inputKinds = getInputKinds({ normalizedUrl, text: input.text, attachments });
  const type = getPrimaryCaptureType(inputKinds);
  const rawText = normalizedUrl ? input.text : [input.text, input.url].filter(Boolean).join("\n\n") || null;

  if (!normalizedUrl && !rawText && attachments.length === 0) {
    throw new CaptureValidationError("请提供有效链接、文本或图片附件。");
  }

  const rawPayload = {
    url: input.url,
    normalizedUrl,
    text: input.text,
    note: input.note,
    fileUrl: input.fileUrl,
    normalizedFileUrl,
    attachments,
    inputKinds,
    isMixed: inputKinds.length > 1,
    sourcePlatform: normalizedUrl ? getSourcePlatform(normalizedUrl) : null,
    sourceApp: input.sourceApp,
    capturedAt: new Date().toISOString(),
    ...input.extraPayload,
  };

  const captureResult = await query<Capture>(
    `
      insert into captures (
        user_id, type, raw_url, raw_text, file_url, raw_payload, raw_attachments, note, status
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 'queued')
      returning *
    `,
    [
      options.userId,
      type,
      normalizedUrl,
      rawText,
      normalizedFileUrl || attachments[0]?.url || null,
      JSON.stringify(rawPayload),
      JSON.stringify(attachments),
      input.note,
    ],
  );
  const capture = captureResult.rows[0];

  const jobResult = await query<ProcessingJob>(
    `
      insert into processing_jobs (capture_id, user_id, job_type, status, current_step)
      values ($1, $2, 'process_capture', 'queued', 'queued')
      returning *
    `,
    [capture.id, options.userId],
  );
  const job = jobResult.rows[0];
  const dispatch = await dispatchProcessingJob(capture.id, job.id, options.dispatcher, type);

  return {
    capture,
    dispatch,
    inputKinds,
    job,
    type,
  };
}

export function normalizeHttpUrl(url: string | null) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function getSourcePlatform(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const knownPlatforms: Record<string, string> = {
      "mp.weixin.qq.com": "wechat",
      "xiaohongshu.com": "xiaohongshu",
      "x.com": "x",
      "twitter.com": "x",
      "medium.com": "medium",
      "github.com": "github",
      "youtube.com": "youtube",
      "youtu.be": "youtube",
    };

    return knownPlatforms[hostname] || hostname;
  } catch {
    return "unknown";
  }
}

function getInputKinds(input: { normalizedUrl: string | null; text: string | null; attachments: RawAttachment[] }) {
  const kinds: InputKind[] = [];

  if (input.normalizedUrl) {
    kinds.push("link");
  }

  if (input.text) {
    kinds.push("text");
  }

  if (input.attachments.length > 0) {
    kinds.push("image");
  }

  return kinds;
}

function getPrimaryCaptureType(inputKinds: InputKind[]): CaptureType {
  if (inputKinds.includes("link")) {
    return "link";
  }

  if (inputKinds.includes("image") && !inputKinds.includes("text")) {
    return "image";
  }

  return "text";
}

function normalizeAttachments(
  fileUrl: string | null,
  attachments: RawAttachment[],
  source: AttachmentSource,
) {
  const normalized = attachments
    .map((attachment) => normalizeAttachment(attachment, source))
    .filter((attachment): attachment is RawAttachment => Boolean(attachment));

  if (fileUrl && isRemoteImageUrl(fileUrl) && !normalized.some((attachment) => attachment.url === fileUrl)) {
    normalized.unshift({
      kind: "image",
      url: fileUrl,
      name: null,
      mime_type: null,
      size_bytes: null,
      storage: "remote",
    });
  }

  return normalized;
}

function normalizeRemoteImageUrl(url: string | null) {
  return url && isRemoteImageUrl(url) ? url : null;
}

function normalizeAttachment(attachment: RawAttachment, source: AttachmentSource) {
  if (source === "multipart" && attachment.storage === "local") {
    return attachment;
  }

  if (!isRemoteImageUrl(attachment.url)) {
    return null;
  }

  return {
    ...attachment,
    kind: "image" as const,
    storage: "remote" as const,
  };
}

async function dispatchProcessingJob(
  captureId: string,
  jobId: string,
  dispatcher: Dispatcher,
  captureType: "link" | "text" | "image",
) {
  if (dispatcher === "inngest") {
    try {
      await inngest.send({
        name: "capture/process.requested",
        data: {
          captureId,
        },
      });
      return { status: "dispatched" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown dispatch error";
      await query(
        `
          update processing_jobs
          set current_step = 'dispatch_failed', error_message = $2
          where id = $1
        `,
        [jobId, message],
      );
      return {
        status: "queued" as const,
        message: `资料已保存，但任务派发暂时失败：${message}`,
      };
    }
  }

  if (dispatcher === "inline") {
    setTimeout(() => {
      void processCaptureById(captureId).catch(async (error) => {
        const message = error instanceof Error ? error.message : "Unknown processing error";
        console.error(`Capture processing failed for ${captureId}:`, error);
        await query(
          `
            update processing_jobs
            set status = 'failed',
                current_step = case when current_step = 'queued' then 'failed' else current_step end,
                error_message = coalesce(error_message, $2),
                finished_at = coalesce(finished_at, now())
            where id = $1
          `,
          [jobId, message],
        ).catch(() => undefined);
      });
    }, 0);

    return {
      status: "scheduled" as const,
      message: "已保存，后台处理已启动。",
    };
  }

  return {
    status: "queued" as const,
    message: "已保存，等待后台处理。",
  };
}
