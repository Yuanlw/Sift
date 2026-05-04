import { NextResponse } from "next/server";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { getServerEnv, MissingEnvError } from "@/lib/env";
import { processCaptureById } from "@/lib/processing/process-capture";
import { isRemoteImageUrl, saveCaptureUploads, UploadValidationError } from "@/lib/upload-storage";
import { getUserContextFromRequest } from "@/lib/user-context";
import type { Capture, ProcessingJob, RawAttachment } from "@/types/database";

const textInput = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => value || null);

const attachmentSchema = z.object({
  kind: z.enum(["image", "audio", "file"]).default("file"),
  url: z.string().trim().min(1),
  name: z.string().trim().optional().nullable(),
  mime_type: z.string().trim().optional().nullable(),
  size_bytes: z.number().int().nonnegative().optional().nullable(),
  storage: z.enum(["local", "remote"]).optional().nullable(),
});

const createCaptureSchema = z
  .object({
    url: textInput,
    text: textInput,
    note: textInput,
    fileUrl: textInput,
    attachments: z.array(attachmentSchema).default([]),
  })
  .refine((data) => Boolean(data.url || data.text || data.fileUrl || data.attachments.length > 0), {
    message: "请提供链接、文本或附件。",
  });

export async function POST(request: Request) {
  try {
    const parsedRequest = await parseCaptureRequest(request);
    const body = createCaptureSchema.parse(parsedRequest.payload);
    const env = getServerEnv();
    const userContext = getUserContextFromRequest(request);
    const normalizedFileUrl = normalizeRemoteImageUrl(body.fileUrl);
    const attachments = normalizeAttachments(normalizedFileUrl, body.attachments, parsedRequest.source);
    const normalizedUrl = normalizeHttpUrl(body.url);
    const type = normalizedUrl ? "link" : attachments.length > 0 && !body.text ? "image" : "text";
    const rawText = normalizedUrl ? body.text : [body.text, body.url].filter(Boolean).join("\n\n") || null;

    if (!normalizedUrl && !rawText && attachments.length === 0) {
      return NextResponse.json({ error: "请提供有效链接、文本或图片附件。" }, { status: 400 });
    }

    const rawPayload = {
      url: body.url,
      normalizedUrl,
      text: body.text,
      note: body.note,
      fileUrl: body.fileUrl,
      normalizedFileUrl,
      attachments,
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
        userContext.userId,
        type,
        normalizedUrl,
        rawText,
        normalizedFileUrl || attachments[0]?.url || null,
        JSON.stringify(rawPayload),
        JSON.stringify(attachments),
        body.note,
      ],
    );
    const capture = captureResult.rows[0];

    const jobResult = await query<ProcessingJob>(
      `
        insert into processing_jobs (capture_id, user_id, job_type, status, current_step)
        values ($1, $2, 'process_capture', 'queued', 'queued')
        returning *
      `,
      [capture.id, userContext.userId],
    );
    const job = jobResult.rows[0];

    const dispatcher = env.JOB_DISPATCHER;
    const dispatch = await dispatchProcessingJob(capture.id, job.id, dispatcher, type);
    await writeAuditLog({
      userId: userContext.userId,
      action: "capture.create",
      resourceType: "capture",
      resourceId: capture.id,
      status: "success",
      request,
      metadata: {
        type,
        dispatcher,
        user_context_source: userContext.source,
        attachment_count: attachments.length,
      },
    });

    return NextResponse.json({
      capture,
      job: {
        dispatcher,
        id: job.id,
        status: dispatch.status,
        message: dispatch.message,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return NextResponse.json(
        {
          error: "Sift 还没有完成本地环境配置。",
          missingKeys: error.missingKeys,
        },
        { status: 503 },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid input" }, { status: 400 });
    }

    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function parseCaptureRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.includes("multipart/form-data")) {
    return {
      source: "json" as const,
      payload: await request.json(),
    };
  }

  const formData = await request.formData();
  const uploadedAttachments = await saveCaptureUploads(formData.getAll("files"));

  return {
    source: "multipart" as const,
    payload: {
      url: formData.get("url"),
      text: formData.get("text"),
      note: formData.get("note"),
      fileUrl: formData.get("fileUrl"),
      attachments: uploadedAttachments,
    },
  };
}

function normalizeAttachments(
  fileUrl: string | null,
  attachments: RawAttachment[],
  source: "json" | "multipart",
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

function normalizeAttachment(attachment: RawAttachment, source: "json" | "multipart") {
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

function normalizeHttpUrl(url: string | null) {
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

async function dispatchProcessingJob(
  captureId: string,
  jobId: string,
  dispatcher: "none" | "inngest" | "inline",
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
      return { status: "dispatched" };
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
        status: "queued",
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
      status: "scheduled",
      message: "已保存，后台处理已启动。",
    };
  }

  return {
    status: "queued",
    message:
      "已保存，等待后台处理。",
  };
}
