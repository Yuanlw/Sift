import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { processCaptureById } from "@/lib/processing/process-capture";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid capture id." }, { status: 400 });
    }

    const userContext = await getUserContextFromRequest(request);
    const capture = await query<{ id: string }>(
      "select id from captures where id = $1 and user_id = $2 limit 1",
      [params.id, userContext.userId],
    );

    if (!capture.rows[0]) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "capture.retry",
        resourceType: "capture",
        resourceId: params.id,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "Capture not found." }, { status: 404 });
    }

    await query(
      `
        update captures
        set status = 'queued',
            raw_payload = coalesce(raw_payload, '{}'::jsonb)
              || jsonb_build_object('retryRequestedAt', now())
        where id = $1 and user_id = $2
      `,
      [params.id, userContext.userId],
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
      [params.id, userContext.userId],
    );

    setTimeout(() => {
      void processCaptureById(params.id).catch(async (error) => {
        const message = error instanceof Error ? error.message : "Unknown processing error";
        console.error(`Capture retry failed for ${params.id}:`, error);
        await query(
          `
            update processing_jobs
            set status = 'failed',
                error_message = coalesce(error_message, $2),
                finished_at = coalesce(finished_at, now())
            where capture_id = $1
          `,
          [params.id, message],
        ).catch(() => undefined);
      });
    }, 0);

    await writeAuditLog({
      userId: userContext.userId,
      action: "capture.retry",
      resourceType: "capture",
      resourceId: params.id,
      status: "success",
      request,
    });

    return NextResponse.json({
      status: "scheduled",
      message: "已重新触发后台处理。",
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

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
