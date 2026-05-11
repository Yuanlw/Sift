import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { revokeGatewayToken } from "@/lib/gateway-tokens";
import { validateSameOriginRequest } from "@/lib/request-security";
import { AuthenticationRequiredError, getUserContextFromRequest } from "@/lib/user-context";

export const runtime = "nodejs";

const revokeSchema = z.object({
  reason: z.string().trim().max(200).optional().nullable(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let userContext: Awaited<ReturnType<typeof getUserContextFromRequest>> | null = null;

  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid gateway token id." }, { status: 400 });
    }

    const body = revokeSchema.parse(await readBody(request));
    userContext = await getUserContextFromRequest(request);
    const tokenRecord = await revokeGatewayToken({
      reason: body.reason,
      tokenId: params.id,
      userId: userContext.userId,
    });

    await writeAuditLog({
      action: "gateway.token.revoke",
      metadata: {
        reason: body.reason || null,
        token_prefix: tokenRecord.tokenPrefix,
      },
      request,
      resourceId: tokenRecord.id,
      resourceType: "sift_gateway_token",
      status: "success",
      userId: userContext.userId,
    });

    return NextResponse.json({ tokenRecord });
  } catch (error) {
    if (userContext) {
      await writeAuditLog({
        action: "gateway.token.revoke",
        metadata: {
          error: error instanceof Error ? error.message : "Unknown gateway token revoke error",
        },
        request,
        resourceId: params.id,
        resourceType: "sift_gateway_token",
        status: "failure",
        userId: userContext.userId,
      });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid gateway token input" }, { status: 400 });
    }

    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Unknown gateway token revoke error";
    return NextResponse.json({ error: message }, { status: message === "Gateway token not found." ? 404 : 500 });
  }
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  return Object.fromEntries((await request.formData()).entries());
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
