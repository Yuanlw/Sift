import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { getUserContextFromRequest } from "@/lib/user-context";

interface RecommendationRow {
  id: string;
  source_id: string;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid recommendation id." }, { status: 400 });
    }

    const userContext = getUserContextFromRequest(request);
    const recommendation = await query<RecommendationRow>(
      `
        select id, source_id
        from knowledge_recommendations
        where id = $1
          and user_id = $2
        limit 1
      `,
      [params.id, userContext.userId],
    );
    const row = recommendation.rows[0];

    if (!row) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "recommendation.dismiss",
        resourceType: "knowledge_recommendation",
        resourceId: params.id,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
    }

    await query(
      `
        update knowledge_recommendations
        set status = 'dismissed',
            updated_at = now()
        where user_id = $1
          and source_id = $2
          and status = 'active'
      `,
      [userContext.userId, row.source_id],
    );

    await writeAuditLog({
      userId: userContext.userId,
      action: "recommendation.dismiss",
      resourceType: "knowledge_recommendation",
      resourceId: params.id,
      status: "success",
      request,
      metadata: {
        source_id: row.source_id,
      },
    });

    return NextResponse.json({
      status: "dismissed",
      message: "已从近期回顾隐藏。",
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
