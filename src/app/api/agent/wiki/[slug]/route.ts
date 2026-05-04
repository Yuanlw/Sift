import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { authorizeAgentRequest } from "@/lib/agent-auth";
import { MissingEnvError } from "@/lib/env";
import { loadAgentWikiPage } from "@/lib/sift-query";
import { getUserContextFromRequest } from "@/lib/user-context";

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  try {
    const unauthorized = authorizeAgentRequest(request);

    if (unauthorized) {
      return unauthorized;
    }

    const userContext = getUserContextFromRequest(request);
    const wikiPage = await loadAgentWikiPage(userContext.userId, params.slug);

    if (!wikiPage) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "agent.wiki.read",
        resourceType: "wiki_page",
        resourceId: params.slug,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "WikiPage not found." }, { status: 404 });
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: "agent.wiki.read",
      resourceType: "wiki_page",
      resourceId: params.slug,
      status: "success",
      request,
    });

    return NextResponse.json({ wikiPage });
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
