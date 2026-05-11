import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { revokeGatewayTokenById } from "@/lib/gateway-tokens";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getSupportAdminFromRequest } from "@/lib/admin-auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

const revokeSchema = z.object({
  reason: z.string().trim().max(120).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  let adminUserId: string | null = null;

  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const admin = await getSupportAdminFromRequest(request);

    if (!admin) {
      return NextResponse.json({ error: "Admin access required." }, { status: 401 });
    }

    adminUserId = admin.userId;
    const body = revokeSchema.parse(await readBody(request));
    const { id } = await params;
    const token = await revokeGatewayTokenById({
      reason: body.reason || "admin_support",
      tokenId: id,
    });
    const user = await loadUserIdByTokenId(id);

    await writeAuditLog({
      action: "admin.gateway_token.revoke",
      metadata: {
        reason: body.reason || "admin_support",
        token_prefix: token.token_prefix,
      },
      request,
      resourceId: id,
      resourceType: "sift_gateway_token",
      status: "success",
      userId: admin.userId,
    });

    const url = new URL("/admin/account-support", request.url);
    if (user?.email) {
      url.searchParams.set("email", user.email);
    }
    url.searchParams.set("status", "token_revoked");
    return NextResponse.redirect(url);
  } catch (error) {
    if (adminUserId) {
      await writeAuditLog({
        action: "admin.gateway_token.revoke",
        metadata: {
          error: error instanceof Error ? error.message : "Unknown gateway token revoke error",
        },
        request,
        resourceType: "sift_gateway_token",
        status: "failure",
        userId: adminUserId,
      });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid gateway token input." }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown gateway token revoke error.";
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

async function loadUserIdByTokenId(tokenId: string) {
  const { rows } = await query<{ email: string }>(
    `
      select users.email
      from sift_gateway_tokens tokens
      left join users on users.id = tokens.user_id
      where tokens.id = $1
      limit 1
    `,
    [tokenId],
  );

  return rows[0] || null;
}
