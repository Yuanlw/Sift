import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { CaptureValidationError, createCapture } from "@/lib/captures/create-capture";
import { getServerEnv, MissingEnvError } from "@/lib/env";
import { saveCaptureUploads, UploadValidationError } from "@/lib/upload-storage";
import { getUserContextFromRequest } from "@/lib/user-context";

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
    const result = await createCapture({
      url: body.url,
      text: body.text,
      note: body.note,
      fileUrl: body.fileUrl,
      attachments: body.attachments,
      attachmentSource: parsedRequest.source,
      sourceApp: parsedRequest.source,
    }, {
      dispatcher: env.JOB_DISPATCHER,
      userId: userContext.userId,
    });
    await writeAuditLog({
      userId: userContext.userId,
      action: "capture.create",
      resourceType: "capture",
      resourceId: result.capture.id,
      status: "success",
      request,
      metadata: {
        type: result.type,
        dispatcher: env.JOB_DISPATCHER,
        input_kinds: result.inputKinds,
        user_context_source: userContext.source,
        attachment_count: body.attachments.length,
      },
    });

    return NextResponse.json({
      capture: result.capture,
      job: {
        dispatcher: env.JOB_DISPATCHER,
        id: result.job.id,
        status: result.dispatch.status,
        message: result.dispatch.message,
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

    if (error instanceof CaptureValidationError) {
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
