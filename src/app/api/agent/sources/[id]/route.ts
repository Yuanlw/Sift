import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { authorizeAgentRequest } from "@/lib/agent-auth";
import { MissingEnvError } from "@/lib/env";
import { loadAgentSource } from "@/lib/sift-query";
import { getAgentUserContextFromRequest } from "@/lib/user-context";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const unauthorized = await authorizeAgentRequest(request);

    if (unauthorized) {
      return unauthorized;
    }

    const userContext = await getAgentUserContextFromRequest(request);
    const source = await loadAgentSource(userContext.userId, params.id);

    if (!source) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "agent.source.read",
        resourceType: "source",
        resourceId: params.id,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "Source not found." }, { status: 404 });
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: "agent.source.read",
      resourceType: "source",
      resourceId: params.id,
      status: "success",
      request,
    });

    return NextResponse.json({ source });
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
