import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { issueGatewayToken, listGatewayTokens } from "@/lib/gateway-tokens";
import { validateSameOriginRequest } from "@/lib/request-security";
import { AuthenticationRequiredError, getUserContextFromRequest } from "@/lib/user-context";

export const runtime = "nodejs";

const issueTokenSchema = z.object({
  displayName: z.string().trim().max(80).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  installId: z.string().trim().max(120).optional().nullable(),
});

export async function GET(request: Request) {
  try {
    const userContext = await getUserContextFromRequest(request);
    const tokens = await listGatewayTokens(userContext.userId);

    return NextResponse.json({ tokens });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Unknown gateway token list error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let userContext: Awaited<ReturnType<typeof getUserContextFromRequest>> | null = null;

  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const body = issueTokenSchema.parse(await readBody(request));
    userContext = await getUserContextFromRequest(request);
    const result = await issueGatewayToken({
      displayName: body.displayName,
      expiresAt: body.expiresAt,
      installId: body.installId,
      userId: userContext.userId,
    });

    await writeAuditLog({
      action: "gateway.token.issue",
      metadata: {
        install_id: result.tokenRecord.installId,
        token_prefix: result.tokenRecord.tokenPrefix,
      },
      request,
      resourceId: result.tokenRecord.id,
      resourceType: "sift_gateway_token",
      status: "success",
      userId: userContext.userId,
    });

    return NextResponse.json({
      token: result.token,
      tokenRecord: result.tokenRecord,
    });
  } catch (error) {
    if (userContext) {
      await writeAuditLog({
        action: "gateway.token.issue",
        metadata: {
          error: error instanceof Error ? error.message : "Unknown gateway token issue error",
        },
        request,
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

    const message = error instanceof Error ? error.message : "Unknown gateway token issue error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  return Object.fromEntries((await request.formData()).entries());
}
