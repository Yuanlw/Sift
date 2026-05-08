import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { authorizeAgentRequest } from "@/lib/agent-auth";
import { MissingEnvError } from "@/lib/env";
import { safeDecodeRouteParam } from "@/lib/route-params";
import { loadAgentWikiPage } from "@/lib/sift-query";
import { getAgentUserContextFromRequest } from "@/lib/user-context";

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  try {
    const unauthorized = await authorizeAgentRequest(request);

    if (unauthorized) {
      return unauthorized;
    }

    const userContext = await getAgentUserContextFromRequest(request);
    const slug = safeDecodeRouteParam(params.slug);

    if (!slug) {
      return NextResponse.json({ error: "Invalid wiki slug." }, { status: 400 });
    }

    const wikiPage = await loadAgentWikiPage(userContext.userId, slug);

    if (!wikiPage) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "agent.wiki.read",
        resourceType: "wiki_page",
        resourceId: slug,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "WikiPage not found." }, { status: 404 });
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: "agent.wiki.read",
      resourceType: "wiki_page",
      resourceId: slug,
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
