import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { authorizeAgentRequest } from "@/lib/agent-auth";
import { MissingEnvError } from "@/lib/env";
import { queryAgentContext } from "@/lib/sift-query";
import { getAgentUserContextFromRequest } from "@/lib/user-context";

const agentQuerySchema = z.object({
  query: z.string().trim().min(1).max(1200),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

export async function POST(request: Request) {
  try {
    const unauthorized = await authorizeAgentRequest(request);

    if (unauthorized) {
      return unauthorized;
    }

    const body = agentQuerySchema.parse(await request.json());
    const userContext = await getAgentUserContextFromRequest(request);
    const result = await queryAgentContext({
      userId: userContext.userId,
      query: body.query,
      limit: body.limit,
    });
    await writeAuditLog({
      userId: userContext.userId,
      action: "agent.query",
      resourceType: "knowledge_base",
      status: "success",
      request,
      metadata: {
        context_count: result.contexts.length,
        citation_count: result.citations.length,
        graph_expanded_count: result.contexts.filter((context) => context.scores.graph > 0).length,
        user_context_source: userContext.source,
      },
    });

    return NextResponse.json(result);
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
