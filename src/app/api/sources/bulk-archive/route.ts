import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query, transaction } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { deleteArchivedSources } from "@/lib/permanent-delete";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

interface SourceBulkRow {
  capture_id: string;
  capture_status: string;
  id: string;
}

type BulkSourceAction = "archive" | "restore" | "delete";

export async function POST(request: Request) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const userContext = await getUserContextFromRequest(request);
    const parsed = await parseBody(request);

    if (!parsed) {
      return NextResponse.json({ error: "Invalid bulk source archive request." }, { status: 400 });
    }

    const sources = await query<SourceBulkRow>(
      `
        select s.id, s.capture_id, c.status as capture_status
        from sources s
        join captures c on c.id = s.capture_id
        where s.user_id = $1
          and s.id = any($2::uuid[])
      `,
      [userContext.userId, parsed.ids],
    );

    if (sources.rows.length === 0) {
      await writeAuditLog({
        userId: userContext.userId,
        action: `source.bulk_${parsed.action}`,
        resourceType: "source",
        status: "denied",
        request,
        metadata: {
          requested_count: parsed.ids.length,
        },
      });
      return NextResponse.json({ error: "No sources found." }, { status: 404 });
    }

    const targetRows = parsed.action === "delete"
      ? sources.rows.filter((source) => source.capture_status === "ignored")
      : sources.rows;
    const sourceIds = targetRows.map((source) => source.id);
    const captureIds = targetRows.map((source) => source.capture_id);

    if (targetRows.length === 0) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "source.bulk_delete",
        resourceType: "source",
        status: "denied",
        request,
        metadata: {
          requested_count: parsed.ids.length,
        },
      });
      return NextResponse.json({ error: "只能永久删除已归档来源。" }, { status: 409 });
    }

    if (parsed.action === "archive") {
      await archiveSources(userContext.userId, sourceIds, captureIds);
    } else if (parsed.action === "restore") {
      await restoreSources(userContext.userId, captureIds);
    } else {
      await transaction((client) =>
        deleteArchivedSources(client, {
          captureIds,
          sourceIds,
          userId: userContext.userId,
        }),
      );
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: getAuditAction(parsed.action),
      resourceType: "source",
      status: "success",
      request,
      metadata: {
        count: targetRows.length,
        requested_count: parsed.ids.length,
      },
    });

    return NextResponse.json({
      count: targetRows.length,
      status: getResultStatus(parsed.action),
      message: getResultMessage(parsed.action),
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

async function parseBody(request: Request): Promise<{ action: BulkSourceAction; ids: string[] } | null> {
  const body = await readJsonBody(request);

  if (body?.action !== "archive" && body?.action !== "restore" && body?.action !== "delete") {
    return null;
  }

  if (!Array.isArray(body.ids)) {
    return null;
  }

  const ids = Array.from(
    new Set(
      body.ids
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ).slice(0, 100);

  if (ids.length === 0) {
    return null;
  }

  return {
    action: body.action,
    ids,
  };
}

async function readJsonBody(request: Request): Promise<{ action?: string; ids?: unknown } | null> {
  const text = await request.text().catch(() => "");

  if (!text) {
    return null;
  }

  return JSON.parse(text) as { action?: string; ids?: unknown };
}

async function archiveSources(userId: string, sourceIds: string[], captureIds: string[]) {
  await query(
    `
      update captures
      set status = 'ignored',
          raw_payload = coalesce(raw_payload, '{}'::jsonb)
            || jsonb_build_object('archivedAt', now(), 'archivedFrom', 'source_bulk')
      where user_id = $1
        and id = any($2::uuid[])
    `,
    [userId, captureIds],
  );

  await query(
    `
      update knowledge_discoveries
      set status = 'ignored',
          updated_at = now()
      where user_id = $1
        and (source_id = any($2::uuid[]) or related_source_id = any($2::uuid[]))
    `,
    [userId, sourceIds],
  );

  await query(
    `
      update knowledge_recommendations
      set status = 'dismissed',
          updated_at = now()
      where user_id = $1
        and source_id = any($2::uuid[])
        and status = 'active'
    `,
    [userId, sourceIds],
  );
}

async function restoreSources(userId: string, captureIds: string[]) {
  await query(
    `
      update captures
      set status = 'completed',
          raw_payload = coalesce(raw_payload, '{}'::jsonb)
            || jsonb_build_object('restoredAt', now(), 'restoredFrom', 'source_bulk_archive')
      where user_id = $1
        and id = any($2::uuid[])
        and status = 'ignored'
    `,
    [userId, captureIds],
  );
}

function getAuditAction(action: BulkSourceAction) {
  if (action === "archive") {
    return "source.bulk_archive";
  }

  if (action === "restore") {
    return "source.bulk_restore";
  }

  return "source.bulk_delete";
}

function getResultStatus(action: BulkSourceAction) {
  if (action === "archive") {
    return "archived";
  }

  if (action === "restore") {
    return "restored";
  }

  return "deleted";
}

function getResultMessage(action: BulkSourceAction) {
  if (action === "archive") {
    return "已归档所选来源。";
  }

  if (action === "restore") {
    return "已恢复所选来源。";
  }

  return "已永久删除所选来源，并清理相关检索片段。";
}
