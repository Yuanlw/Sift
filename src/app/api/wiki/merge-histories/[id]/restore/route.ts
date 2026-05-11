import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { MissingEnvError } from "@/lib/env";
import { restoreWikiMergeHistory } from "@/lib/knowledge-merge";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let userContext: Awaited<ReturnType<typeof getUserContextFromRequest>> | null = null;

  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid merge history id." }, { status: 400 });
    }

    userContext = await getUserContextFromRequest(request);
    const result = await restoreWikiMergeHistory({
      historyId: params.id,
      userId: userContext.userId,
    });

    await writeAuditLog({
      userId: userContext.userId,
      action: "wiki.merge.restore",
      resourceType: "wiki_merge_history",
      resourceId: params.id,
      status: "success",
      request,
      metadata: {
        embedding_status: result.embeddingStatus,
        target_wiki_page_id: result.targetWikiId,
        title: result.title,
      },
    });

    const isDegraded = result.embeddingStatus !== "completed";

    return NextResponse.json({
      href: `/wiki/${encodeURIComponent(result.slug)}`,
      message: isDegraded
        ? "已恢复正文，语义检索向量暂未写入；修复模型配置后可通过恢复任务补齐。"
        : "已恢复到这次合并前的版本。",
      status: isDegraded ? "restored_degraded" : "restored",
      targetWikiId: result.targetWikiId,
      title: result.title,
    });
  } catch (error) {
    if (userContext) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "wiki.merge.restore",
        resourceType: "wiki_merge_history",
        resourceId: params.id,
        status: "failure",
        request,
        metadata: {
          error: error instanceof Error ? error.message : "Unknown merge restore error",
        },
      });
    }

    if (error instanceof MissingEnvError) {
      return NextResponse.json(
        {
          error: "Sift 还没有完成本地环境配置。",
          missingKeys: error.missingKeys,
        },
        { status: 503 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown merge restore error";
    return NextResponse.json({ error: getRestoreErrorMessage(message) }, { status: getRestoreErrorStatus(message) });
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getRestoreErrorStatus(message: string) {
  if (message === "Merge history not found.") {
    return 404;
  }

  if (
    message === "Merge history is not the current wiki version." ||
    message === "Merge history is not the latest merge history."
  ) {
    return 409;
  }

  return 500;
}

function getRestoreErrorMessage(message: string) {
  if (message === "Merge history is not the latest merge history.") {
    return "只能恢复最新一次合并，避免覆盖后续变更。";
  }

  if (message === "Merge history is not the current wiki version.") {
    return "当前知识页已有后续变更，不能直接恢复这条历史。";
  }

  if (message === "Merge history not found.") {
    return "找不到这条合并历史。";
  }

  return message;
}
