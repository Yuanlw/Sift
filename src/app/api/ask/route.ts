import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { answerKnowledgeBaseQuestion } from "@/lib/models";
import { recordProductEvent } from "@/lib/product-events";
import { validateSameOriginRequest } from "@/lib/request-security";
import { retrieveHybridContexts, toLabeledContexts, type RetrievedContext } from "@/lib/sift-query";
import { SmartQuotaExceededError } from "@/lib/smart-quota";
import { getUserContextFromRequest } from "@/lib/user-context";

const askSchema = z.object({
  question: z.string().trim().min(1).max(1200),
});

export async function POST(request: Request) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const body = askSchema.parse(await request.json());
    const userContext = await getUserContextFromRequest(request);
    const contexts = await retrieveHybridContexts(userContext.userId, body.question, 8, {
      stage: "ask",
      purpose: "ask.global.embedding",
    });

    if (contexts.length === 0) {
      const emptyAnswer = {
        answer: "没有检索到足够相关的资料。可以先保存更多相关内容，或换一个更具体的问题。",
        citations: [],
      };

      await saveGlobalAskHistory({
        userId: userContext.userId,
        question: body.question,
        answer: emptyAnswer.answer,
        citations: emptyAnswer.citations,
        metadata: {
          context_count: 0,
        },
      });
      await writeAuditLog({
        userId: userContext.userId,
        action: "ask.global",
        resourceType: "knowledge_base",
        status: "success",
        request,
        metadata: {
          context_count: 0,
        },
      });
      await recordProductEvent({
        eventName: "ask.global",
        metadata: {
          citation_count: 0,
          context_count: 0,
        },
        resourceType: "knowledge_base",
        source: "ask",
        userId: userContext.userId,
      });
      return NextResponse.json({
        ...emptyAnswer,
        retrieval: {
          contexts: [],
        },
      });
    }

    const labeledContexts = toLabeledContexts(contexts);

    const answer = await answerKnowledgeBaseQuestion({
      modelContext: {
        userId: userContext.userId,
        stage: "ask",
        role: "text",
        purpose: "ask.global.answer",
        resourceType: "knowledge_base",
      },
      question: body.question,
      contexts: labeledContexts,
    });
    const retrievalContexts = labeledContexts.map((context, index) => ({
      label: context.label,
      title: context.title,
      parentType: context.parentType,
      sourceId: context.sourceId,
      wikiSlug: context.wikiSlug,
      originalUrl: context.originalUrl,
      preview: context.content.slice(0, 180),
      score: scoreContext(contexts[index]),
      graphExpanded: contexts[index].graphScore > 0,
      graph: contexts[index].graphScore > 0
        ? {
            depth: contexts[index].graphDepth,
            relationType: contexts[index].graphEdgeType,
            path: contexts[index].graphPath,
          }
        : null,
      matchReasons: contexts[index].matchReasons,
      scores: {
        graph: contexts[index].graphScore,
        vector: contexts[index].vectorScore,
        keyword: contexts[index].keywordScore,
        title: contexts[index].titleScore,
      },
    }));

    await saveGlobalAskHistory({
      userId: userContext.userId,
      question: body.question,
      answer: answer.answer,
      citations: answer.citations,
      metadata: {
        context_count: contexts.length,
        citation_count: answer.citations.length,
        retrieved_contexts: retrievalContexts.map((context) => ({
          label: context.label,
          title: context.title,
          parent_type: context.parentType,
          source_id: context.sourceId,
          wiki_slug: context.wikiSlug,
          score: context.score,
          graph_score: context.scores.graph,
          graph_expanded: context.graphExpanded,
          graph: context.graph,
          match_reasons: context.matchReasons,
        })),
      },
    });
    await writeAuditLog({
      userId: userContext.userId,
      action: "ask.global",
      resourceType: "knowledge_base",
      status: "success",
      request,
      metadata: {
        context_count: contexts.length,
        citation_count: answer.citations.length,
        graph_expanded_count: contexts.filter((context) => context.graphScore > 0).length,
      },
    });
    await recordProductEvent({
      eventName: "ask.global",
      metadata: {
        citation_count: answer.citations.length,
        context_count: contexts.length,
      },
      resourceType: "knowledge_base",
      source: "ask",
      userId: userContext.userId,
    });

    return NextResponse.json({
      ...answer,
      retrieval: {
        contexts: retrievalContexts,
      },
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

function scoreContext(context: RetrievedContext) {
  return context.rerankScore || context.vectorScore * 0.35 + context.keywordScore * 0.65 + context.graphScore * 1.1;
}

async function saveGlobalAskHistory(input: {
  userId: string;
  question: string;
  answer: string;
  citations: unknown[];
  metadata: Record<string, unknown>;
}) {
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
      values ($1, 'global', null, $2, $3, $4::jsonb, $5::jsonb)
    `,
    [
      input.userId,
      input.question,
      input.answer,
      JSON.stringify(input.citations),
      JSON.stringify(input.metadata),
    ],
  );
}
