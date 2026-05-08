import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { answerWikiQuestion } from "@/lib/models";
import { validateSameOriginRequest } from "@/lib/request-security";
import { safeDecodeRouteParam } from "@/lib/route-params";
import { SmartQuotaExceededError } from "@/lib/smart-quota";
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
  relation_kind: "direct" | "duplicate_source" | "related_wiki" | null;
  relation_score: number | null;
}

async function loadWikiContext(slug: string, userId: string) {
  const result = await query<WikiContextRow>(
    `
      with target_wiki as (
        select
          wp.id as wiki_id,
          wp.title as wiki_title,
          wp.content_markdown
        from wiki_pages wp
        where wp.slug = $1 and wp.user_id = $2
      ),
      direct_sources as (
        select
          s.id as source_id,
          s.title as source_title,
          s.summary as source_summary,
          s.original_url,
          s.extracted_text,
          s.created_at,
          'direct'::text as relation_kind,
          1::real as relation_score,
          0 as relation_rank
        from target_wiki tw
        join source_wiki_pages swp on swp.wiki_page_id = tw.wiki_id
        join sources s on s.id = swp.source_id and s.user_id = $2
      ),
      related_wikis as (
        select
          case
            when e.from_type = 'wiki_page' and e.from_id = tw.wiki_id then e.to_id
            else e.from_id
          end as wiki_id,
          max(e.weight * coalesce(e.confidence, 1)) as relation_score
        from target_wiki tw
        join knowledge_edges e on e.user_id = $2
          and e.edge_type = 'related_wiki'
          and (
            (e.from_type = 'wiki_page' and e.from_id = tw.wiki_id and e.to_type = 'wiki_page')
            or (e.to_type = 'wiki_page' and e.to_id = tw.wiki_id and e.from_type = 'wiki_page')
          )
        group by 1
      ),
      related_wiki_sources as (
        select
          s.id as source_id,
          s.title as source_title,
          s.summary as source_summary,
          s.original_url,
          s.extracted_text,
          s.created_at,
          'related_wiki'::text as relation_kind,
          rw.relation_score::real as relation_score,
          1 as relation_rank
        from related_wikis rw
        join source_wiki_pages swp on swp.wiki_page_id = rw.wiki_id
        join sources s on s.id = swp.source_id and s.user_id = $2
      ),
      duplicate_sources as (
        select
          s.id as source_id,
          s.title as source_title,
          s.summary as source_summary,
          s.original_url,
          s.extracted_text,
          s.created_at,
          'duplicate_source'::text as relation_kind,
          max(e.weight * coalesce(e.confidence, 1))::real as relation_score,
          2 as relation_rank
        from direct_sources ds
        join knowledge_edges e on e.user_id = $2
          and e.edge_type = 'duplicate_source'
          and (
            (e.from_type = 'source' and e.from_id = ds.source_id and e.to_type = 'source')
            or (e.to_type = 'source' and e.to_id = ds.source_id and e.from_type = 'source')
          )
        join sources s on s.user_id = $2
          and s.id = case when e.from_id = ds.source_id then e.to_id else e.from_id end
        group by s.id, s.title, s.summary, s.original_url, s.extracted_text, s.created_at
      ),
      candidate_sources as (
        select * from direct_sources
        union all
        select * from related_wiki_sources
        union all
        select * from duplicate_sources
      ),
      ranked_sources as (
        select distinct on (source_id)
          *
        from candidate_sources
        order by source_id, relation_rank asc, relation_score desc, created_at desc
      )
      select
        tw.wiki_id,
        tw.wiki_title,
        tw.content_markdown,
        rs.source_id,
        rs.source_title,
        rs.source_summary,
        rs.original_url,
        rs.extracted_text,
        rs.relation_kind,
        rs.relation_score
      from target_wiki tw
      left join ranked_sources rs on true
      order by rs.relation_rank asc nulls last, rs.relation_score desc nulls last, rs.created_at desc nulls last
      limit 10
    `,
    [slug, userId],
  );

  return result.rows;
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const body = askSchema.parse(await request.json());
    const userContext = await getUserContextFromRequest(request);
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
        summary: formatSourceSummary(row),
        originalUrl: row.original_url,
        extractedText: row.extracted_text,
      }));

    const answer = await answerWikiQuestion({
      modelContext: {
        userId: userContext.userId,
        stage: "ask",
        role: "text",
        purpose: "ask.wiki.answer",
        resourceType: "wiki_page",
        resourceId: first.wiki_id,
        metadata: {
          slug,
        },
      },
      question: body.question,
      wikiTitle: first.wiki_title,
      wikiMarkdown: first.content_markdown,
      sources,
    });
    await query(
      `
        insert into ask_histories (
          user_id,
          scope_type,
          scope_id,
          question,
          answer,
          citations,
          metadata
        )
        values ($1, 'wiki_page', $2, $3, $4, $5::jsonb, $6::jsonb)
      `,
      [
        userContext.userId,
        first.wiki_id,
        body.question,
        answer.answer,
        JSON.stringify(answer.citations),
        JSON.stringify({
          source_count: sources.length,
          graph_expanded_source_count: rows.filter((row) => row.relation_kind && row.relation_kind !== "direct").length,
          slug,
          title: first.wiki_title,
        }),
      ],
    );
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
        graph_expanded_source_count: rows.filter((row) => row.relation_kind && row.relation_kind !== "direct").length,
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

    if (error instanceof SmartQuotaExceededError) {
      return NextResponse.json({ code: "SMART_QUOTA_EXCEEDED", error: error.message }, { status: 402 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatSourceSummary(row: WikiContextRow & { source_id: string; source_title: string; extracted_text: string }) {
  const relationPrefix =
    row.relation_kind === "related_wiki"
      ? "关系扩展：来自相关知识页。"
      : row.relation_kind === "duplicate_source"
        ? "关系扩展：来自重复或近似来源。"
        : "";

  return [relationPrefix, row.source_summary].filter(Boolean).join("\n");
}
