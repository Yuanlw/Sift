import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { MissingEnvError } from "@/lib/env";
import { deleteArchivedSources } from "@/lib/permanent-delete";
import { transaction } from "@/lib/db";
import { getUserContextFromRequest } from "@/lib/user-context";

interface SourceDeleteRow {
  capture_id: string;
  source_id: string;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid source id." }, { status: 400 });
    }

    const userContext = getUserContextFromRequest(request);
    const deleted = await transaction(async (client) => {
      const source = await client.query<SourceDeleteRow>(
        `
          select s.id as source_id, s.capture_id
          from sources s
          join captures c on c.id = s.capture_id
          where s.id = $1
            and s.user_id = $2
            and c.status = 'ignored'
          limit 1
        `,
        [params.id, userContext.userId],
      );
      const row = source.rows[0];

      if (!row) {
        return null;
      }

      await deleteArchivedSources(client, {
        captureIds: [row.capture_id],
        sourceIds: [row.source_id],
        userId: userContext.userId,
      });

      return row;
    });

    if (!deleted) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "source.delete",
        resourceType: "source",
        resourceId: params.id,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "只能永久删除已归档来源。" }, { status: 409 });
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: "source.delete",
      resourceType: "source",
      resourceId: params.id,
      status: "success",
      request,
      metadata: {
        capture_id: deleted.capture_id,
      },
    });

    return NextResponse.json({
      status: "deleted",
      message: "已永久删除来源资料，并清理相关检索片段。",
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
