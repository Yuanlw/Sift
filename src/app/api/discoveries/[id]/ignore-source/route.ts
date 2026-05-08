import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

interface DiscoverySourceRow {
  discovery_id: string;
  source_id: string;
  capture_id: string;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid discovery id." }, { status: 400 });
    }

    const userContext = await getUserContextFromRequest(request);
    const discovery = await query<DiscoverySourceRow>(
      `
        select
          kd.id as discovery_id,
          s.id as source_id,
          s.capture_id
        from knowledge_discoveries kd
        join sources s on s.id = kd.source_id
        where kd.id = $1
          and kd.user_id = $2
          and kd.discovery_type = 'duplicate_source'
        limit 1
      `,
      [params.id, userContext.userId],
    );
    const row = discovery.rows[0];

    if (!row) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "discovery.ignore_source",
        resourceType: "knowledge_discovery",
        resourceId: params.id,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "Duplicate discovery not found." }, { status: 404 });
    }

    await query(
      `
        update captures
        set status = 'ignored',
            raw_payload = coalesce(raw_payload, '{}'::jsonb)
              || jsonb_build_object('ignoredAt', now(), 'ignoredByDiscoveryId', $3::text)
        where id = $1
          and user_id = $2
      `,
      [row.capture_id, userContext.userId, row.discovery_id],
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
        where capture_id = $1
          and user_id = $2
      `,
      [row.capture_id, userContext.userId],
    );

    await query(
      `
        update knowledge_discoveries
        set status = 'ignored',
            updated_at = now()
        where user_id = $1
          and (
            id = $2
            or source_id = $3
          )
      `,
      [userContext.userId, row.discovery_id, row.source_id],
    );

    await writeAuditLog({
      userId: userContext.userId,
      action: "discovery.ignore_source",
      resourceType: "knowledge_discovery",
      resourceId: params.id,
      status: "success",
      request,
      metadata: {
        source_id: row.source_id,
        capture_id: row.capture_id,
      },
    });

    return NextResponse.json({
      status: "ignored",
      message: "已忽略新资料，原始输入仍会保留在已忽略视图。",
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
