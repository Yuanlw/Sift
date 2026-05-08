import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { validateSameOriginRequest } from "@/lib/request-security";
import { safeDecodeRouteParam } from "@/lib/route-params";
import { getUserContextFromRequest } from "@/lib/user-context";

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const slug = safeDecodeRouteParam(params.slug);

    if (!slug) {
      return NextResponse.json({ error: "Invalid wiki slug." }, { status: 400 });
    }

    const userContext = await getUserContextFromRequest(request);
    const action = await parseAction(request);

    if (!action) {
      return NextResponse.json({ error: "Invalid archive action." }, { status: 400 });
    }

    const result = await query<{ id: string }>(
      `
        update wiki_pages
        set status = $3,
            updated_at = now()
        where slug = $1
          and user_id = $2
        returning id
      `,
      [slug, userContext.userId, action === "archive" ? "archived" : "draft"],
    );
    const page = result.rows[0];

    if (!page) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "wiki.archive",
        resourceType: "wiki_page",
        resourceId: slug,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "Wiki page not found." }, { status: 404 });
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: action === "archive" ? "wiki.archive" : "wiki.restore",
      resourceType: "wiki_page",
      resourceId: page.id,
      status: "success",
      request,
      metadata: {
        slug,
      },
    });

    return NextResponse.json({
      status: action === "archive" ? "archived" : "restored",
      message: action === "archive" ? "已归档知识页。" : "已恢复知识页。",
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
