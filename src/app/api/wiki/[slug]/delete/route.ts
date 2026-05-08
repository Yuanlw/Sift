import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { transaction } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { deleteArchivedWikiPages } from "@/lib/permanent-delete";
import { validateSameOriginRequest } from "@/lib/request-security";
import { safeDecodeRouteParam } from "@/lib/route-params";
import { getUserContextFromRequest } from "@/lib/user-context";

interface WikiDeleteRow {
  id: string;
  slug: string;
}

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
    const deleted = await transaction(async (client) => {
      const page = await client.query<WikiDeleteRow>(
        `
          select id, slug
          from wiki_pages
          where slug = $1
            and user_id = $2
            and status = 'archived'
          limit 1
        `,
        [slug, userContext.userId],
      );
      const row = page.rows[0];

      if (!row) {
        return null;
      }

      await deleteArchivedWikiPages(client, {
        slugs: [row.slug],
        userId: userContext.userId,
        wikiPageIds: [row.id],
      });

      return row;
    });

    if (!deleted) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "wiki.delete",
        resourceType: "wiki_page",
        resourceId: slug,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "只能永久删除已归档知识页。" }, { status: 409 });
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: "wiki.delete",
      resourceType: "wiki_page",
      resourceId: deleted.id,
      status: "success",
      request,
      metadata: {
        slug: deleted.slug,
      },
    });

    return NextResponse.json({
      status: "deleted",
      message: "已永久删除知识页，并清理相关检索片段和历史问答。",
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
