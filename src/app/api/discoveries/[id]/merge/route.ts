import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { MissingEnvError } from "@/lib/env";
import { commitWikiMerge, createWikiMergePreview } from "@/lib/knowledge-merge";
import { validateSameOriginRequest } from "@/lib/request-security";
import { SmartQuotaExceededError } from "@/lib/smart-quota";
import { getUserContextFromRequest } from "@/lib/user-context";

const mergeSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("preview"),
  }),
  z.object({
    mode: z.literal("commit"),
    summaryOfChanges: z.string().trim().max(1200).optional().nullable(),
    title: z.string().trim().min(1).max(180),
    wikiMarkdown: z.string().trim().min(20).max(120000),
  }),
]);

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
    const parsed = mergeSchema.parse(await request.json());

    if (parsed.mode === "preview") {
      const preview = await createWikiMergePreview({
        discoveryId: params.id,
        userId: userContext.userId,
      });

      await writeAuditLog({
        userId: userContext.userId,
        action: "wiki.merge.preview",
        resourceType: "knowledge_discovery",
        resourceId: params.id,
        status: "success",
        request,
        metadata: {
          target_wiki_page_id: preview.candidate.targetWiki.id,
          incoming_wiki_page_id: preview.candidate.incomingWiki.id,
          source_count: preview.candidate.sources.length,
        },
      });

      return NextResponse.json({
        preview,
      });
    }

    const result = await commitWikiMerge({
      discoveryId: params.id,
      summaryOfChanges: parsed.summaryOfChanges,
      title: parsed.title,
      userId: userContext.userId,
      wikiMarkdown: parsed.wikiMarkdown,
    });

    await writeAuditLog({
      userId: userContext.userId,
      action: "wiki.merge.commit",
      resourceType: "knowledge_discovery",
      resourceId: params.id,
      status: "success",
      request,
      metadata: {
        target_wiki_page_id: result.targetWikiId,
        title: result.title,
      },
    });

    return NextResponse.json({
      href: `/wiki/${encodeURIComponent(result.slug)}`,
      message: "已合并到知识页。",
      status: "merged",
      targetWikiId: result.targetWikiId,
      title: result.title,
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

    if (error instanceof SmartQuotaExceededError) {
      return NextResponse.json({ code: "SMART_QUOTA_EXCEEDED", error: error.message }, { status: 402 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid merge request." }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown merge error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
