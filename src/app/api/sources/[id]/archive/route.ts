import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

interface SourceArchiveRow {
  capture_id: string;
  source_id: string;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid source id." }, { status: 400 });
    }

    const userContext = await getUserContextFromRequest(request);
    const action = await parseAction(request);

    if (!action) {
      return NextResponse.json({ error: "Invalid archive action." }, { status: 400 });
    }

    const source = await query<SourceArchiveRow>(
      `
        select id as source_id, capture_id
        from sources
        where id = $1
          and user_id = $2
        limit 1
      `,
      [params.id, userContext.userId],
    );
    const row = source.rows[0];

    if (!row) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "source.archive",
        resourceType: "source",
        resourceId: params.id,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "Source not found." }, { status: 404 });
    }

    if (action === "archive") {
      await archiveSource(row.capture_id, userContext.userId, params.id);
    } else {
      await restoreSource(row.capture_id, userContext.userId);
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: action === "archive" ? "source.archive" : "source.restore",
      resourceType: "source",
      resourceId: params.id,
      status: "success",
      request,
      metadata: {
        capture_id: row.capture_id,
      },
    });

    return NextResponse.json({
      status: action === "archive" ? "archived" : "restored",
      message: action === "archive" ? "已归档来源资料。" : "已恢复来源资料。",
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

async function parseAction(request: Request): Promise<"archive" | "restore" | null> {
  const body = (await request.json().catch(() => null)) as { action?: string } | null;

  if (body?.action === "archive" || body?.action === "restore") {
    return body.action;
  }

  return null;
}

async function archiveSource(captureId: string, userId: string, sourceId: string) {
  await query(
    `
      update captures
      set status = 'ignored',
          raw_payload = coalesce(raw_payload, '{}'::jsonb)
            || jsonb_build_object('archivedAt', now(), 'archivedFrom', 'source')
      where id = $1
        and user_id = $2
    `,
    [captureId, userId],
  );

  await query(
    `
      update knowledge_discoveries
      set status = 'ignored',
          updated_at = now()
      where user_id = $1
        and (source_id = $2 or related_source_id = $2)
    `,
    [userId, sourceId],
  );
}

async function restoreSource(captureId: string, userId: string) {
  await query(
    `
      update captures
      set status = 'completed',
          raw_payload = coalesce(raw_payload, '{}'::jsonb)
            || jsonb_build_object('restoredAt', now(), 'restoredFrom', 'source_archive')
      where id = $1
        and user_id = $2
        and status = 'ignored'
    `,
    [captureId, userId],
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
