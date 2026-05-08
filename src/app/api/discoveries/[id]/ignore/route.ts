import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

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
    const result = await query<{ id: string }>(
      `
        update knowledge_discoveries
        set status = 'ignored',
            updated_at = now()
        where id = $1
          and user_id = $2
        returning id
      `,
      [params.id, userContext.userId],
    );

    if (!result.rows[0]) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "discovery.ignore",
        resourceType: "knowledge_discovery",
        resourceId: params.id,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "Discovery not found." }, { status: 404 });
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: "discovery.ignore",
      resourceType: "knowledge_discovery",
      resourceId: params.id,
      status: "success",
      request,
    });

    return NextResponse.json({
      status: "ignored",
      message: "已忽略这条发现。",
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
