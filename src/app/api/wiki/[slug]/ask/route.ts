import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { answerWikiQuestion } from "@/lib/models";
import { safeDecodeRouteParam } from "@/lib/route-params";
import { getUserContextFromRequest } from "@/lib/user-context";

const askSchema = z.object({
  question: z.string().trim().min(1).max(1200),
});

interface WikiContextRow {
  wiki_id: string;
  wiki_title: string;
  content_markdown: string;
  source_id: string | null;
  source_title: string | null;
  source_summary: string | null;
  original_url: string | null;
  extracted_text: string | null;
}

async function loadWikiContext(slug: string, userId: string) {
  const result = await query<WikiContextRow>(
    `
      select
        wp.id as wiki_id,
        wp.title as wiki_title,
        wp.content_markdown,
        s.id as source_id,
        s.title as source_title,
        s.summary as source_summary,
        s.original_url,
        s.extracted_text
      from wiki_pages wp
      left join source_wiki_pages swp on swp.wiki_page_id = wp.id
      left join sources s on s.id = swp.source_id
      where wp.slug = $1 and wp.user_id = $2
      order by s.created_at desc
      limit 8
    `,
    [slug, userId],
  );

  return result.rows;
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  try {
    const body = askSchema.parse(await request.json());
    const userContext = getUserContextFromRequest(request);
    const slug = safeDecodeRouteParam(params.slug);

    if (!slug) {
      return NextResponse.json({ error: "Invalid wiki slug." }, { status: 400 });
    }

    const rows = await loadWikiContext(slug, userContext.userId);
    const first = rows[0];

    if (!first) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "ask.wiki",
        resourceType: "wiki_page",
        resourceId: slug,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "WikiPage not found." }, { status: 404 });
    }

    const sources = rows
      .filter((row): row is WikiContextRow & { source_id: string; source_title: string; extracted_text: string } =>
        Boolean(row.source_id && row.source_title && row.extracted_text),
      )
      .map((row, index) => ({
        label: `S${index + 1}`,
        id: row.source_id,
        title: row.source_title,
        summary: row.source_summary,
        originalUrl: row.original_url,
        extractedText: row.extracted_text,
      }));

    const answer = await answerWikiQuestion({
      question: body.question,
      wikiTitle: first.wiki_title,
      wikiMarkdown: first.content_markdown,
      sources,
    });
    await writeAuditLog({
      userId: userContext.userId,
      action: "ask.wiki",
      resourceType: "wiki_page",
      resourceId: slug,
      status: "success",
      request,
      metadata: {
        source_count: sources.length,
        citation_count: answer.citations.length,
      },
    });

    return NextResponse.json(answer);
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

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid input" }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
