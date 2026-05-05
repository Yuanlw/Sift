import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { getUserContextFromRequest } from "@/lib/user-context";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid capture id." }, { status: 400 });
    }

    const userContext = getUserContextFromRequest(request);
    const capture = await query<{ id: string }>(
      "select id from captures where id = $1 and user_id = $2 limit 1",
      [params.id, userContext.userId],
    );

    if (!capture.rows[0]) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "capture.ignore",
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
        set status = 'ignored',
            raw_payload = coalesce(raw_payload, '{}'::jsonb)
              || jsonb_build_object('ignoredAt', now())
        where id = $1 and user_id = $2
      `,
      [params.id, userContext.userId],
    );

    await query(
      `
        update processing_jobs
        set status = 'completed',
            current_step = 'ignored',
            step_status = jsonb_build_object(
              'ignored',
              jsonb_build_object('status', 'completed', 'finished_at', now())
            ),
            error_message = null,
            started_at = null,
            finished_at = now()
        where capture_id = $1 and user_id = $2
      `,
      [params.id, userContext.userId],
    );

    await writeAuditLog({
      userId: userContext.userId,
      action: "capture.ignore",
      resourceType: "capture",
      resourceId: params.id,
      status: "success",
      request,
    });

    return NextResponse.json({
      status: "ignored",
      message: "已忽略这条资料，原始输入仍会保留。",
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
