import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { MissingEnvError } from "@/lib/env";
import { answerKnowledgeBaseQuestion } from "@/lib/models";
import { retrieveHybridContexts, toLabeledContexts, type RetrievedContext } from "@/lib/sift-query";
import { getUserContextFromRequest } from "@/lib/user-context";

const askSchema = z.object({
  question: z.string().trim().min(1).max(1200),
});

export async function POST(request: Request) {
  try {
    const body = askSchema.parse(await request.json());
    const userContext = getUserContextFromRequest(request);
    const contexts = await retrieveHybridContexts(userContext.userId, body.question);

    if (contexts.length === 0) {
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
      return NextResponse.json({
        answer: "没有检索到足够相关的资料。可以先保存更多相关内容，或换一个更具体的问题。",
        citations: [],
        retrieval: {
          contexts: [],
        },
      });
    }

    const labeledContexts = toLabeledContexts(contexts);

    const answer = await withTimeout(
      answerKnowledgeBaseQuestion({
        question: body.question,
        contexts: labeledContexts,
      }),
      12000,
      () => buildRetrievalOnlyAnswer(labeledContexts),
    );
    await writeAuditLog({
      userId: userContext.userId,
      action: "ask.global",
      resourceType: "knowledge_base",
      status: "success",
      request,
      metadata: {
        context_count: contexts.length,
        citation_count: answer.citations.length,
      },
    });

    return NextResponse.json({
      ...answer,
      retrieval: {
        contexts: labeledContexts.map((context, index) => ({
          label: context.label,
          title: context.title,
          parentType: context.parentType,
          sourceId: context.sourceId,
          wikiSlug: context.wikiSlug,
          originalUrl: context.originalUrl,
          preview: context.content.slice(0, 180),
          score: scoreContext(contexts[index]),
          matchReasons: contexts[index].matchReasons,
          scores: {
            vector: contexts[index].vectorScore,
            keyword: contexts[index].keywordScore,
            title: contexts[index].titleScore,
          },
        })),
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

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function scoreContext(context: RetrievedContext) {
  return context.rerankScore || context.vectorScore * 0.35 + context.keywordScore * 0.65;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: () => T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    promise.finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    }),
    new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(fallback()), timeoutMs);
    }),
  ]);
}

function buildRetrievalOnlyAnswer(
  contexts: Array<{
    label: string;
    title: string;
    parentType: "source" | "wiki_page";
    content: string;
    sourceId: string | null;
    wikiSlug: string | null;
    originalUrl: string | null;
  }>,
) {
  const citedContexts = contexts.slice(0, 5);
  const answer = [
    "**一句话结论**",
    "模型分析超过 12 秒，先返回已召回的相关资料，避免页面长时间等待。",
    "",
    "**重点判断**",
    ...citedContexts.map(
      (context, index) =>
        `${index + 1}. ${context.title}：${context.content.replace(/\s+/g, " ").slice(0, 90)} [${context.label}]`,
    ),
    "",
    "**资料盲区**",
    "- 这次没有等到模型完成综合分析，以上只是检索结果预览。",
    "- 可以稍后再问一次，或先打开引用资料查看原文。",
    "",
    "**建议追问**",
    "- 请基于这些召回片段重新总结核心结论。",
  ].join("\n");

  return {
    answer,
    citations: citedContexts.map((context) => ({
      label: context.label,
      title: context.title,
      sourceId: context.sourceId || undefined,
      wikiSlug: context.wikiSlug || undefined,
      originalUrl: context.originalUrl,
    })),
  };
}
