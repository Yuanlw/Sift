import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupportAdminFromRequest } from "@/lib/admin-auth";
import { normalizeEmail } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { validateSameOriginRequest } from "@/lib/request-security";
import { AuthenticationRequiredError } from "@/lib/user-context";

export const runtime = "nodejs";

const createRefundSchema = z.object({
  action: z.literal("create"),
  amount: z.string().trim().min(1),
  currency: z.string().trim().min(3).max(8).default("CNY"),
  notes: z.string().trim().max(2000).optional(),
  paymentReference: z.string().trim().max(200).optional(),
  reason: z.string().trim().min(1).max(1000),
  userEmail: z.string().trim().email(),
});

const updateRefundSchema = z.object({
  action: z.enum(["cancel", "mark_paid"]),
  notes: z.string().trim().max(2000).optional(),
  offlineReference: z.string().trim().max(200).optional(),
  offlineTransferMethod: z.string().trim().max(120).optional(),
  refundId: z.string().uuid(),
});

const checklistRefundSchema = z.object({
  action: z.literal("checklist"),
  checklistItem: z.enum(["gateway_tokens_reviewed", "quota_reviewed", "subscription_cancelled", "user_contacted"]),
  notes: z.string().trim().max(2000).optional(),
  refundId: z.string().uuid(),
});

const refundSchema = z.discriminatedUnion("action", [createRefundSchema, updateRefundSchema, checklistRefundSchema]);

interface UserRow {
  email: string;
  id: string;
}

interface QuotaRow {
  plan_code: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

interface RefundRow {
  id: string;
  user_email: string;
}

export async function POST(request: Request) {
  let adminUserId: string | null = null;

  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const admin = await getSupportAdminFromRequest(request);

    if (!admin) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    adminUserId = admin.userId;
    const body = refundSchema.parse(await readBody(request));

    if (body.action === "create") {
      const refund = await createManualRefund({
        adminUserId: admin.userId,
        amountCents: parseAmountToCents(body.amount),
        currency: body.currency.toUpperCase(),
        notes: emptyToNull(body.notes),
        paymentReference: emptyToNull(body.paymentReference),
        reason: body.reason,
        userEmail: normalizeEmail(body.userEmail),
      });

      await writeAuditLog({
        action: "manual_refund.create",
        metadata: {
          amount_cents: parseAmountToCents(body.amount),
          currency: body.currency.toUpperCase(),
          user_email: refund.user_email,
        },
        request,
        resourceId: refund.id,
        resourceType: "manual_refund",
        status: "success",
        userId: admin.userId,
      });

      return redirectToRefunds(request, refund.user_email, "created");
    }

    if (body.action === "checklist") {
      const refund = await updateRefundChecklist({
        adminUserId: admin.userId,
        checklistItem: body.checklistItem,
        notes: emptyToNull(body.notes),
        refundId: body.refundId,
      });

      await writeAuditLog({
        action: "manual_refund.checklist",
        metadata: {
          checklist_item: body.checklistItem,
        },
        request,
        resourceId: refund.id,
        resourceType: "manual_refund",
        status: "success",
        userId: admin.userId,
      });

      return redirectToRefunds(request, refund.user_email, "checklist");
    }

    const refund = await updateManualRefund({
      action: body.action,
      adminUserId: admin.userId,
      notes: emptyToNull(body.notes),
      offlineReference: emptyToNull(body.offlineReference),
      offlineTransferMethod: emptyToNull(body.offlineTransferMethod),
      refundId: body.refundId,
    });

    await writeAuditLog({
      action: body.action === "mark_paid" ? "manual_refund.mark_paid" : "manual_refund.cancel",
      metadata: {
        offline_reference: emptyToNull(body.offlineReference),
        offline_transfer_method: emptyToNull(body.offlineTransferMethod),
      },
      request,
      resourceId: refund.id,
      resourceType: "manual_refund",
      status: "success",
      userId: admin.userId,
    });

    return redirectToRefunds(request, refund.user_email, body.action === "mark_paid" ? "paid" : "cancelled");
  } catch (error) {
    if (adminUserId) {
      await writeAuditLog({
        action: "manual_refund.error",
        metadata: {
          error: error instanceof Error ? error.message : "Unknown manual refund error",
        },
        request,
        resourceType: "manual_refund",
        status: "failure",
        userId: adminUserId,
      });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid refund input." }, { status: 400 });
    }

    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Unknown manual refund error.";
    return NextResponse.json({ error: message }, { status: message === "User not found." ? 404 : 500 });
  }
}

async function createManualRefund(input: {
  adminUserId: string;
  amountCents: number;
  currency: string;
  notes: string | null;
  paymentReference: string | null;
  reason: string;
  userEmail: string;
}) {
  const user = await findUserByEmail(input.userEmail);

  if (!user) {
    throw new Error("User not found.");
  }

  const quota = await loadQuotaSnapshot(user.id);
  const result = await query<RefundRow>(
    `
      insert into manual_refunds (
        user_id,
        requested_by_user_id,
        user_email,
        amount_cents,
        currency,
        reason,
        payment_reference,
        plan_code_snapshot,
        stripe_customer_id_snapshot,
        stripe_subscription_id_snapshot,
        notes
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      returning id, user_email
    `,
    [
      user.id,
      input.adminUserId,
      user.email,
      input.amountCents,
      input.currency,
      input.reason,
      input.paymentReference,
      quota?.plan_code || null,
      quota?.stripe_customer_id || null,
      quota?.stripe_subscription_id || null,
      input.notes,
    ],
  );

  return result.rows[0];
}

async function updateManualRefund(input: {
  action: "cancel" | "mark_paid";
  adminUserId: string;
  notes: string | null;
  offlineReference: string | null;
  offlineTransferMethod: string | null;
  refundId: string;
}) {
  const status = input.action === "mark_paid" ? "paid" : "cancelled";
  const result = await query<RefundRow>(
    `
      update manual_refunds
      set status = $2,
          processed_by_user_id = $3,
          offline_transfer_method = coalesce($4, offline_transfer_method),
          offline_reference = coalesce($5, offline_reference),
          notes = coalesce($6, notes),
          paid_at = case when $2 = 'paid' then coalesce(paid_at, now()) else paid_at end,
          updated_at = now()
      where id = $1
        and status = 'requested'
      returning id, user_email
    `,
    [input.refundId, status, input.adminUserId, input.offlineTransferMethod, input.offlineReference, input.notes],
  );

  if (!result.rows[0]) {
    throw new Error("Refund request was not found or is already closed.");
  }

  return result.rows[0];
}

async function updateRefundChecklist(input: {
  adminUserId: string;
  checklistItem: "gateway_tokens_reviewed" | "quota_reviewed" | "subscription_cancelled" | "user_contacted";
  notes: string | null;
  refundId: string;
}) {
  const column = getChecklistColumn(input.checklistItem);
  const result = await query<RefundRow>(
    `
      update manual_refunds
      set ${column} = coalesce(${column}, now()),
          processed_by_user_id = coalesce(processed_by_user_id, $2),
          notes = case
            when $3::text is null then notes
            when notes is null or notes = '' then $3::text
            else notes || E'\n' || $3::text
          end,
          updated_at = now()
      where id = $1
      returning id, user_email
    `,
    [input.refundId, input.adminUserId, input.notes],
  );

  if (!result.rows[0]) {
    throw new Error("Refund request was not found.");
  }

  return result.rows[0];
}

function getChecklistColumn(item: "gateway_tokens_reviewed" | "quota_reviewed" | "subscription_cancelled" | "user_contacted") {
  const columns = {
    gateway_tokens_reviewed: "gateway_tokens_reviewed_at",
    quota_reviewed: "quota_reviewed_at",
    subscription_cancelled: "subscription_cancelled_at",
    user_contacted: "user_contacted_at",
  } satisfies Record<typeof item, string>;

  return columns[item];
}

async function findUserByEmail(email: string) {
  const result = await query<UserRow>("select id, email from users where email = $1 limit 1", [email]);
  return result.rows[0] || null;
}

async function loadQuotaSnapshot(userId: string) {
  try {
    const result = await query<QuotaRow>(
      `
        select plan_code, stripe_customer_id, stripe_subscription_id
        from smart_quota_accounts
        where user_id = $1
        limit 1
      `,
      [userId],
    );

    return result.rows[0] || null;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return null;
    }

    throw error;
  }
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  return Object.fromEntries((await request.formData()).entries());
}

function parseAmountToCents(value: string) {
  const normalized = value.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Refund amount must be a positive number with at most two decimals.");
  }

  const [yuan, cents = ""] = normalized.split(".");
  const amountCents = Number(yuan) * 100 + Number(cents.padEnd(2, "0"));

  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("Refund amount must be greater than zero.");
  }

  return amountCents;
}

function redirectToRefunds(request: Request, email: string, status: string) {
  const url = new URL("/admin/refunds", request.url);
  url.searchParams.set("email", email);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, 303);
}

function emptyToNull(value: string | undefined) {
  return value && value.trim() ? value.trim() : null;
}

function isMissingRelationError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P01";
}
