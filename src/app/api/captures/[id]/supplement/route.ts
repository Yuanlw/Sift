import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { processCaptureById } from "@/lib/processing/process-capture";
import { MAX_CAPTURE_FILES, saveCaptureUploads, UploadValidationError } from "@/lib/upload-storage";
import { getUserContextFromRequest } from "@/lib/user-context";
import type { Capture, Json, RawAttachment } from "@/types/database";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid capture id." }, { status: 400 });
    }

    const userContext = getUserContextFromRequest(request);
    const formData = await request.formData();
    const text = getFormText(formData.get("text"));
    const uploadedAttachments = await saveCaptureUploads(formData.getAll("files"));

    if (!text && uploadedAttachments.length === 0) {
      return NextResponse.json({ error: "请补充正文、说明或截图。" }, { status: 400 });
    }

    const captureResult = await query<Capture>(
      "select * from captures where id = $1 and user_id = $2 limit 1",
      [params.id, userContext.userId],
    );
    const capture = captureResult.rows[0];

    if (!capture) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "capture.supplement",
        resourceType: "capture",
        resourceId: params.id,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "Capture not found." }, { status: 404 });
    }

    const rawAttachments = capture.raw_attachments || [];

    if (rawAttachments.length + uploadedAttachments.length > MAX_CAPTURE_FILES) {
      throw new UploadValidationError(`一条资料最多保留 ${MAX_CAPTURE_FILES} 张图片。`);
    }

    const nextAttachments = [...rawAttachments, ...uploadedAttachments];
    const nextRawText = appendSupplementText(capture.raw_text, text);
    const nextPayload = buildSupplementedPayload(capture.raw_payload, {
      text,
      attachments: uploadedAttachments,
    });

    await query(
      `
        update captures
        set
          raw_text = $2,
          file_url = coalesce(file_url, $3),
          raw_attachments = $4::jsonb,
          raw_payload = $5::jsonb,
          status = 'queued'
        where id = $1 and user_id = $6
      `,
      [
        capture.id,
        nextRawText,
        nextAttachments[0]?.url || null,
        JSON.stringify(nextAttachments),
        JSON.stringify(nextPayload),
        userContext.userId,
      ],
    );

    await query(
      `
        update processing_jobs
        set status = 'queued',
            current_step = 'queued',
            step_status = '{}'::jsonb,
            error_message = null,
            started_at = null,
            finished_at = null
        where capture_id = $1 and user_id = $2
      `,
      [capture.id, userContext.userId],
    );

    setTimeout(() => {
      void processCaptureById(capture.id).catch(async (error) => {
        const message = error instanceof Error ? error.message : "Unknown processing error";
        console.error(`Capture supplement processing failed for ${capture.id}:`, error);
        await query(
          `
            update processing_jobs
            set status = 'failed',
                error_message = coalesce(error_message, $2),
                finished_at = coalesce(finished_at, now())
            where capture_id = $1
          `,
          [capture.id, message],
        ).catch(() => undefined);
      });
    }, 0);

    await writeAuditLog({
      userId: userContext.userId,
      action: "capture.supplement",
      resourceType: "capture",
      resourceId: capture.id,
      status: "success",
      request,
      metadata: {
        added_text: Boolean(text),
        added_attachment_count: uploadedAttachments.length,
      },
    });

    return NextResponse.json({
      status: "scheduled",
      message: "已补充资料，后台会重新处理。",
    });
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

    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getFormText(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function appendSupplementText(rawText: string | null, supplementText: string | null) {
  if (!supplementText) {
    return rawText;
  }

  if (!rawText?.trim()) {
    return supplementText;
  }

  return [rawText.trim(), "补充资料：", supplementText].join("\n\n");
}

function buildSupplementedPayload(
  rawPayload: Json,
  supplement: { text: string | null; attachments: RawAttachment[] },
) {
  const payload = getJsonObject(rawPayload);
  const supplements = Array.isArray(payload.supplements) ? payload.supplements : [];
  const existingKinds = Array.isArray(payload.inputKinds) ? payload.inputKinds.filter(isInputKind) : [];
  const inputKinds = new Set(existingKinds);

  if (supplement.text) {
    inputKinds.add("text");
  }

  if (supplement.attachments.length > 0) {
    inputKinds.add("image");
  }

  return {
    ...payload,
    inputKinds: Array.from(inputKinds),
    isMixed: inputKinds.size > 1,
    supplements: [
      ...supplements,
      {
        text: supplement.text,
        attachments: supplement.attachments,
        supplementedAt: new Date().toISOString(),
      },
    ],
  };
}

function getJsonObject(value: Json) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isInputKind(value: unknown): value is "link" | "text" | "image" {
  return value === "link" || value === "text" || value === "image";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
