import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { normalizeEmail } from "@/lib/auth";
import { query } from "@/lib/db";
import { applyManualBillingPlan } from "@/lib/smart-quota";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getSupportAdminFromRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";

const activationSchema = z.object({
  monthlyCreditLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  planCode: z.string().trim().min(1).max(40),
  userEmail: z.string().trim().email(),
});

export async function POST(request: Request) {
  let adminUserId: string | null = null;

  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const body = activationSchema.parse(await readBody(request));
    const admin = await getSupportAdminFromRequest(request);

    if (!admin) {
      return NextResponse.json({ error: "Admin access required." }, { status: 401 });
    }

    adminUserId = admin.userId;
    const user = await loadUser(body.userEmail);

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    await applyManualBillingPlan({
      monthlyCreditLimit: body.monthlyCreditLimit ?? null,
      planCode: body.planCode,
      userId: user.id,
    });

    await writeAuditLog({
      action: "manual_activation.update",
      metadata: {
        monthly_credit_limit: body.monthlyCreditLimit ?? null,
        plan_code: body.planCode,
        user_email: user.email,
      },
      request,
      resourceId: user.id,
      resourceType: "user",
      status: "success",
      userId: admin.userId,
    });

    const url = new URL("/admin/account-support", request.url);
    url.searchParams.set("email", user.email);
    url.searchParams.set("status", "activated");
    return NextResponse.redirect(url);
  } catch (error) {
    if (adminUserId) {
      await writeAuditLog({
        action: "manual_activation.update",
        metadata: {
          error: error instanceof Error ? error.message : "Unknown manual activation error",
        },
        request,
        resourceType: "user",
        status: "failure",
        userId: adminUserId,
      });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid manual activation input." }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown manual activation error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function loadUser(email: string) {
  const { rows } = await query<{ email: string; id: string }>(
    `
      select id, email
      from users
      where email = $1
      limit 1
    `,
    [normalizeEmail(email)],
  );

  return rows[0] || null;
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  return Object.fromEntries((await request.formData()).entries());
}
