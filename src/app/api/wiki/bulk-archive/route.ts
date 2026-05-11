import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { query, transaction } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { deleteWikiPagesCascade } from "@/lib/permanent-delete";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

interface WikiBulkRow {
  id: string;
  slug: string;
  status: string;
}

type BulkWikiAction = "archive" | "restore" | "delete";

export async function POST(request: Request) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const userContext = await getUserContextFromRequest(request);
    const parsed = await parseBody(request);

    if (!parsed) {
      return NextResponse.json({ error: "Invalid bulk wiki archive request." }, { status: 400 });
    }

    const pages = await query<WikiBulkRow>(
      `
        select id, slug, status
        from wiki_pages
        where user_id = $1
          and slug = any($2::text[])
      `,
      [userContext.userId, parsed.slugs],
    );

    if (pages.rows.length === 0) {
      await writeAuditLog({
        userId: userContext.userId,
        action: `wiki.bulk_${parsed.action}`,
        resourceType: "wiki_page",
        status: "denied",
        request,
        metadata: {
          requested_count: parsed.slugs.length,
        },
      });
      return NextResponse.json({ error: "No wiki pages found." }, { status: 404 });
    }

    const targetRows = pages.rows;
    const slugs = targetRows.map((page) => page.slug);
    const wikiPageIds = targetRows.map((page) => page.id);

    if (targetRows.length === 0) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "wiki.bulk_delete",
        resourceType: "wiki_page",
        status: "denied",
        request,
        metadata: {
          requested_count: parsed.slugs.length,
        },
      });
      return NextResponse.json({ error: "No wiki pages found." }, { status: 404 });
    }

    if (parsed.action === "delete") {
      await transaction((client) =>
        deleteWikiPagesCascade(client, {
          slugs,
          userId: userContext.userId,
          wikiPageIds,
        }),
      );
    } else {
      await query(
        `
          update wiki_pages
          set status = $3,
              updated_at = now()
          where user_id = $1
            and slug = any($2::text[])
        `,
        [userContext.userId, slugs, parsed.action === "archive" ? "archived" : "draft"],
      );
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: getAuditAction(parsed.action),
      resourceType: "wiki_page",
      status: "success",
      request,
      metadata: {
        count: targetRows.length,
        requested_count: parsed.slugs.length,
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

async function parseBody(request: Request): Promise<{ action: BulkWikiAction; slugs: string[] } | null> {
  const body = await readJsonBody(request);

  if (body?.action !== "archive" && body?.action !== "restore" && body?.action !== "delete") {
    return null;
  }

  if (!Array.isArray(body.slugs)) {
    return null;
  }

  const slugs = Array.from(
    new Set(body.slugs.filter((slug): slug is string => typeof slug === "string" && slug.trim().length > 0)),
  )
    .map((slug) => slug.slice(0, 220))
    .slice(0, 100);

  if (slugs.length === 0) {
    return null;
  }

  return {
    action: body.action,
    slugs,
  };
}

async function readJsonBody(request: Request): Promise<{ action?: string; slugs?: unknown } | null> {
  const text = await request.text().catch(() => "");

  if (!text) {
    return null;
  }

  return JSON.parse(text) as { action?: string; slugs?: unknown };
}

function getAuditAction(action: BulkWikiAction) {
  if (action === "archive") {
    return "wiki.bulk_archive";
  }

  if (action === "restore") {
    return "wiki.bulk_restore";
  }

  return "wiki.bulk_delete";
}

function getResultStatus(action: BulkWikiAction) {
  if (action === "archive") {
    return "archived";
  }

  if (action === "restore") {
    return "restored";
  }

  return "deleted";
}

function getResultMessage(action: BulkWikiAction) {
  if (action === "archive") {
    return "已归档所选知识页。";
  }

  if (action === "restore") {
    return "已恢复所选知识页。";
  }

  return "已永久删除所选知识页，并清理关联来源和检索片段。";
}
