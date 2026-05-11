import crypto from "crypto";
import { query } from "@/lib/db";
import { loadSmartQuotaSummary, type SmartQuotaCategory } from "@/lib/smart-quota";
import { calculateCostBasedCredits } from "@/lib/smart-quota-cost";
import type { ModelCallRole, ModelUsagePayload } from "@/lib/model-usage";

export type GatewayTokenStatus = "active" | "revoked";
export type GatewayUsageStatus = "failure" | "rejected" | "reserved" | "success";

const gatewayQuotaCategories = ["capture_processing", "image_ocr", "semantic_indexing", "ask", "retrieval"] as const;

export const gatewayQuotaCategoryValues = gatewayQuotaCategories satisfies readonly SmartQuotaCategory[];

export interface GatewayTokenSummary {
  createdAt: string;
  displayName: string;
  expiresAt: string | null;
  id: string;
  installId: string | null;
  lastUsedAt: string | null;
  planCode: string;
  revokedAt: string | null;
  revokedReason: string | null;
  status: GatewayTokenStatus;
  tokenPrefix: string;
}

interface GatewayTokenRow {
  created_at: string;
  display_name: string;
  expires_at: string | null;
  id: string;
  install_id: string | null;
  last_used_at: string | null;
  plan_code: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  status: GatewayTokenStatus;
  token_prefix: string;
  user_id: string;
}

interface GatewayUsageRow {
  category: SmartQuotaCategory;
  created_at: string;
  credits: number;
  error_code: string | null;
  id: string;
  metadata: Record<string, unknown>;
  model_role: string;
  period_end: string;
  period_start: string;
  purpose: string;
  request_count: number;
  status: GatewayUsageStatus;
  token_id: string | null;
  user_id: string;
}

interface GatewayUsageAggregateRow {
  credits: string | null;
}

interface GatewayRateAggregateRow {
  credits: string | null;
  hour_requests: string | null;
  requests: string | null;
}

interface GatewayPlanLimit {
  maxHourlyCredits: number;
  maxHourlyRequests: number;
  maxMinuteRequests: number;
  maxRequestCredits: number;
}

export async function listGatewayTokens(userId: string) {
  const result = await query<GatewayTokenRow>(
    `
      select
        id,
        user_id,
        token_prefix,
        display_name,
        install_id,
        status,
        plan_code,
        expires_at::text,
        last_used_at::text,
        revoked_at::text,
        revoked_reason,
        created_at::text
      from sift_gateway_tokens
      where user_id = $1
      order by created_at desc
    `,
    [userId],
  );

  return result.rows.map(toGatewayTokenSummary);
}

export async function issueGatewayToken(input: {
  displayName?: string | null;
  expiresAt?: string | null;
  installId?: string | null;
  userId: string;
}) {
  const rawToken = createRawGatewayToken();
  const tokenHash = hashGatewayToken(rawToken);
  const tokenPrefix = getTokenPrefix(rawToken);
  const quota = await loadSmartQuotaSummary(input.userId);
  const result = await query<GatewayTokenRow>(
    `
      insert into sift_gateway_tokens (
        user_id,
        token_hash,
        token_prefix,
        display_name,
        install_id,
        plan_code,
        expires_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::timestamptz)
      returning
        id,
        user_id,
        token_prefix,
        display_name,
        install_id,
        status,
        plan_code,
        expires_at::text,
        last_used_at::text,
        revoked_at::text,
        revoked_reason,
        created_at::text
    `,
    [
      input.userId,
      tokenHash,
      tokenPrefix,
      normalizeDisplayName(input.displayName),
      normalizeNullableText(input.installId),
      quota.account.planCode,
      input.expiresAt || null,
    ],
  );

  return {
    token: rawToken,
    tokenRecord: toGatewayTokenSummary(result.rows[0]),
  };
}

export async function revokeGatewayToken(input: {
  reason?: string | null;
  tokenId: string;
  userId: string;
}) {
  const token = await revokeGatewayTokenById({
    reason: input.reason,
    tokenId: input.tokenId,
    userId: input.userId,
  });
  return toGatewayTokenSummary(token);
}

export async function revokeGatewayTokenById(input: {
  reason?: string | null;
  tokenId: string;
  userId?: string | null;
}) {
  const result = await query<GatewayTokenRow>(
    `
      update sift_gateway_tokens
      set status = 'revoked',
          revoked_at = coalesce(revoked_at, now()),
          revoked_reason = coalesce($3, revoked_reason),
          updated_at = now()
      where id = $1
        ${input.userId ? "and user_id = $2" : ""}
      returning
        id,
        user_id,
        token_prefix,
        display_name,
        install_id,
        status,
        plan_code,
        expires_at::text,
        last_used_at::text,
        revoked_at::text,
        revoked_reason,
        created_at::text
    `,
    input.userId ? [input.tokenId, input.userId, normalizeNullableText(input.reason)] : [input.tokenId, normalizeNullableText(input.reason)],
  );

  if (!result.rows[0]) {
    throw new Error("Gateway token not found.");
  }

  return result.rows[0];
}

export async function validateGatewayToken(input: {
  category?: SmartQuotaCategory | null;
  estimatedCredits?: number | null;
  inputChars?: number | null;
  metadata?: Record<string, unknown>;
  modelRole?: string | null;
  outputChars?: number | null;
  purpose?: string | null;
  requestCount?: number | null;
  token: string;
  usage?: ModelUsagePayload | null;
}) {
  const tokenHash = hashGatewayToken(input.token);
  const result = await query<GatewayTokenRow>(
    `
      select
        id,
        user_id,
        token_prefix,
        display_name,
        install_id,
        status,
        plan_code,
        expires_at::text,
        last_used_at::text,
        revoked_at::text,
        revoked_reason,
        created_at::text
      from sift_gateway_tokens
      where token_hash = $1
      limit 1
    `,
    [tokenHash],
  );
  const tokenRow = result.rows[0];

  if (!tokenRow) {
    return {
      reason: "not_found",
      valid: false,
    };
  }

  if (tokenRow.status !== "active") {
    await recordGatewayRejection(tokenRow, "revoked", input);
    return {
      reason: "revoked",
      token: toGatewayTokenSummary(tokenRow),
      valid: false,
    };
  }

  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    await recordGatewayRejection(tokenRow, "expired", input);
    return {
      reason: "expired",
      token: toGatewayTokenSummary(tokenRow),
      valid: false,
    };
  }

  const quota = await loadSmartQuotaSummary(tokenRow.user_id);
  const modelRole = normalizeModelRole(input.modelRole);
  const category = input.category || getDefaultGatewayCategory(modelRole);
  const costEstimate = calculateCostBasedCredits({
    context: {
      role: modelRole,
      stage: getGatewayStage(category),
      purpose: normalizePurpose(input.purpose),
      metadata: normalizeGatewayMetadata(input.metadata),
    },
    inputChars: input.inputChars,
    outputChars: input.outputChars,
    requestCount: input.requestCount || 1,
    usage: input.usage,
  });
  const clientEstimate = Math.max(1, Math.ceil(input.estimatedCredits || 1));
  const estimatedCredits = Math.max(clientEstimate, costEstimate.credits);
  const planLimit = getGatewayPlanLimit(quota.account.planCode);
  const period = quota.period;
  const gatewayUsedCredits = await loadGatewayUsedCredits(tokenRow.user_id, period.start, period.end);
  const gatewayRemainingCredits = quota.remainingCredits;
  const rate = await loadGatewayRateWindow(tokenRow.id);

  if (isInactiveStripeSubscription(quota.account.stripeSubscriptionStatus, quota.account.quotaSource)) {
    await recordGatewayRejection(tokenRow, "subscription_inactive", input);
    return {
      quota: buildGatewayQuotaSnapshot(quota, gatewayUsedCredits, gatewayRemainingCredits),
      reason: "subscription_inactive",
      token: toGatewayTokenSummary(tokenRow),
      valid: false,
    };
  }

  if (estimatedCredits > planLimit.maxRequestCredits) {
    await recordGatewayRejection(tokenRow, "request_too_large", input);
    return {
      limit: planLimit,
      quota: buildGatewayQuotaSnapshot(quota, gatewayUsedCredits, gatewayRemainingCredits),
      reason: "request_too_large",
      token: toGatewayTokenSummary(tokenRow),
      valid: false,
    };
  }

  if (
    rate.minuteRequests >= planLimit.maxMinuteRequests ||
    rate.hourRequests >= planLimit.maxHourlyRequests ||
    rate.hourCredits + estimatedCredits > planLimit.maxHourlyCredits
  ) {
    await recordGatewayRejection(tokenRow, "rate_limited", input);
    return {
      limit: planLimit,
      quota: buildGatewayQuotaSnapshot(quota, gatewayUsedCredits, gatewayRemainingCredits),
      rate,
      reason: "rate_limited",
      token: toGatewayTokenSummary(tokenRow),
      valid: false,
    };
  }

  if (
    quota.account.enforcementMode === "hard_limit" &&
    gatewayRemainingCredits !== null &&
    gatewayRemainingCredits < estimatedCredits
  ) {
    await recordGatewayRejection(tokenRow, "over_quota", input);
    return {
      quota: buildGatewayQuotaSnapshot(quota, gatewayUsedCredits, gatewayRemainingCredits),
      reason: "over_quota",
      token: toGatewayTokenSummary(tokenRow),
      valid: false,
    };
  }

  const authorization = await reserveGatewayUsage({
    category,
    credits: estimatedCredits,
    metadata: {
      ...(input.metadata || {}),
      credit_calculation: costEstimate.calculation,
      client_estimated_credits: input.estimatedCredits || null,
    },
    modelRole,
    periodEnd: period.end,
    periodStart: period.start,
    purpose: normalizePurpose(input.purpose),
    requestCount: input.requestCount,
    tokenId: tokenRow.id,
    userId: tokenRow.user_id,
  });

  await query(
    `
      update sift_gateway_tokens
      set last_used_at = now(),
          updated_at = now()
      where id = $1
    `,
    [tokenRow.id],
  );

  return {
    authorizationId: authorization.id,
    limit: planLimit,
    quota: buildGatewayQuotaSnapshot(
      quota,
      gatewayUsedCredits + estimatedCredits,
      gatewayRemainingCredits === null ? null : Math.max(0, gatewayRemainingCredits - estimatedCredits),
    ),
    rate: {
      ...rate,
      hourCredits: rate.hourCredits + estimatedCredits,
      hourRequests: rate.hourRequests + 1,
      minuteRequests: rate.minuteRequests + 1,
    },
    token: toGatewayTokenSummary({
      ...tokenRow,
      last_used_at: new Date().toISOString(),
    }),
    userId: tokenRow.user_id,
    valid: true,
  };
}

export async function settleGatewayUsage(input: {
  authorizationId: string;
  credits?: number | null;
  errorCode?: string | null;
  inputChars?: number | null;
  metadata?: Record<string, unknown>;
  outputChars?: number | null;
  status: "failure" | "success";
  usage?: ModelUsagePayload | null;
}) {
  const finalCredits =
    input.status === "success"
      ? await calculateSettledGatewayCredits({
          authorizationId: input.authorizationId,
          credits: input.credits,
          inputChars: input.inputChars,
          outputChars: input.outputChars,
          usage: input.usage,
        })
      : input.credits;
  const result = await query<GatewayUsageRow>(
    `
      update sift_gateway_usage_ledger
      set status = $2,
          credits = coalesce($3::int, credits),
          error_code = $4,
          metadata = metadata || $5::jsonb
      where id = $1
        and status = 'reserved'
      returning
        id,
        token_id,
        user_id,
        period_start::text,
        period_end::text,
        category,
        credits,
        request_count,
        model_role,
        purpose,
        status,
        error_code,
        metadata,
        created_at::text
    `,
    [
      input.authorizationId,
      input.status,
      finalCredits === null || finalCredits === undefined ? null : Math.max(0, Math.ceil(finalCredits)),
      input.errorCode || null,
      JSON.stringify(input.metadata || {}),
    ],
  );

  if (!result.rows[0]) {
    throw new Error("Gateway authorization was not found or already settled.");
  }

  return toGatewayUsageSummary(result.rows[0]);
}

export async function recordGatewayUsage(input: {
  category: SmartQuotaCategory;
  credits: number;
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
  modelRole: string;
  periodEnd: string;
  periodStart: string;
  purpose: string;
  requestCount?: number;
  status?: GatewayUsageStatus;
  tokenId?: string | null;
  userId: string;
}) {
  await query(
    `
      insert into sift_gateway_usage_ledger (
        token_id,
        user_id,
        period_start,
        period_end,
        category,
        credits,
        request_count,
        model_role,
        purpose,
        status,
        error_code,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
    `,
    [
      input.tokenId || null,
      input.userId,
      input.periodStart,
      input.periodEnd,
      input.category,
      Math.max(0, Math.ceil(input.credits)),
      Math.max(1, Math.ceil(input.requestCount || 1)),
      input.modelRole,
      input.purpose,
      input.status || "success",
      input.errorCode || null,
      JSON.stringify(input.metadata || {}),
    ],
  );
}

async function reserveGatewayUsage(input: {
  category: SmartQuotaCategory;
  credits: number;
  metadata?: Record<string, unknown>;
  modelRole: string;
  periodEnd: string;
  periodStart: string;
  purpose: string;
  requestCount?: number | null;
  tokenId: string;
  userId: string;
}) {
  const result = await query<GatewayUsageRow>(
    `
      insert into sift_gateway_usage_ledger (
        token_id,
        user_id,
        period_start,
        period_end,
        category,
        credits,
        request_count,
        model_role,
        purpose,
        status,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reserved', $10::jsonb)
      returning
        id,
        token_id,
        user_id,
        period_start::text,
        period_end::text,
        category,
        credits,
        request_count,
        model_role,
        purpose,
        status,
        error_code,
        metadata,
        created_at::text
    `,
    [
      input.tokenId,
      input.userId,
      input.periodStart,
      input.periodEnd,
      input.category,
      Math.max(1, Math.ceil(input.credits)),
      Math.max(1, Math.ceil(input.requestCount || 1)),
      input.modelRole,
      input.purpose,
      JSON.stringify(input.metadata || {}),
    ],
  );

  return result.rows[0];
}

async function recordGatewayRejection(
  tokenRow: GatewayTokenRow,
  reason: string,
  input: {
    category?: SmartQuotaCategory | null;
    estimatedCredits?: number | null;
    metadata?: Record<string, unknown>;
    modelRole?: string | null;
    purpose?: string | null;
    requestCount?: number | null;
  },
) {
  const quota = await loadSmartQuotaSummary(tokenRow.user_id).catch(() => null);
  const period = quota?.period || getCurrentQuotaPeriod();

  await recordGatewayUsage({
    category: input.category || getDefaultGatewayCategory(input.modelRole),
    credits: 0,
    errorCode: reason,
    metadata: {
      ...(input.metadata || {}),
      estimated_credits: Math.max(1, Math.ceil(input.estimatedCredits || 1)),
    },
    modelRole: normalizeModelRole(input.modelRole),
    periodEnd: period.end,
    periodStart: period.start,
    purpose: normalizePurpose(input.purpose),
    requestCount: input.requestCount || 1,
    status: "rejected",
    tokenId: tokenRow.id,
    userId: tokenRow.user_id,
  });
}

async function calculateSettledGatewayCredits(input: {
  authorizationId: string;
  credits?: number | null;
  inputChars?: number | null;
  outputChars?: number | null;
  usage?: ModelUsagePayload | null;
}) {
  if (input.credits !== null && input.credits !== undefined) {
    return input.credits;
  }

  if (!input.usage && input.inputChars === undefined && input.outputChars === undefined) {
    return null;
  }

  const result = await query<GatewayUsageRow>(
    `
      select
        id,
        token_id,
        user_id,
        period_start::text,
        period_end::text,
        category,
        credits,
        request_count,
        model_role,
        purpose,
        status,
        error_code,
        metadata,
        created_at::text
      from sift_gateway_usage_ledger
      where id = $1
        and status = 'reserved'
      limit 1
    `,
    [input.authorizationId],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const estimate = calculateCostBasedCredits({
    context: {
      role: normalizeModelRole(row.model_role),
      stage: getGatewayStage(row.category),
      purpose: row.purpose,
      metadata: normalizeGatewayMetadata(row.metadata),
    },
    inputChars: input.inputChars,
    outputChars: input.outputChars,
    requestCount: row.request_count,
    usage: input.usage,
  });

  return Math.max(row.credits, estimate.credits);
}

async function loadGatewayUsedCredits(userId: string, periodStart: string, periodEnd: string) {
  const result = await query<GatewayUsageAggregateRow>(
    `
      select coalesce(sum(credits), 0)::text as credits
      from sift_gateway_usage_ledger
      where user_id = $1
        and period_start = $2
        and period_end = $3
        and status in ('reserved', 'success')
    `,
    [userId, periodStart, periodEnd],
  );

  return toNumber(result.rows[0]?.credits);
}

async function loadGatewayRateWindow(tokenId: string) {
  const result = await query<GatewayRateAggregateRow>(
    `
      select
        coalesce(count(*) filter (where created_at > now() - interval '1 minute'), 0)::text as requests,
        coalesce(sum(credits) filter (where created_at > now() - interval '1 hour'), 0)::text as credits,
        coalesce(count(*) filter (where created_at > now() - interval '1 hour'), 0)::text as hour_requests
      from sift_gateway_usage_ledger
      where token_id = $1
        and created_at > now() - interval '1 hour'
    `,
    [tokenId],
  );
  const row = result.rows[0];

  return {
    hourCredits: toNumber(row?.credits),
    hourRequests: toNumber(row?.hour_requests),
    minuteRequests: toNumber(row?.requests),
  };
}

function createRawGatewayToken() {
  const prefix = crypto.randomBytes(4).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  return `siftgw_${prefix}_${secret}`;
}

function getTokenPrefix(token: string) {
  const parts = token.split("_");
  return parts.length >= 3 ? `${parts[0]}_${parts[1]}` : token.slice(0, 15);
}

function hashGatewayToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeDisplayName(value: string | null | undefined) {
  const normalized = (value || "").trim();
  return normalized.length > 0 ? normalized.slice(0, 80) : "Local install";
}

function normalizeNullableText(value: string | null | undefined) {
  const normalized = (value || "").trim();
  return normalized.length > 0 ? normalized.slice(0, 200) : null;
}

function normalizeModelRole(value: string | null | undefined): ModelCallRole {
  const normalized = (value || "").trim();

  if (normalized === "embedding" || normalized === "vision") {
    return normalized;
  }

  return "text";
}

function normalizePurpose(value: string | null | undefined) {
  const normalized = (value || "").trim();
  return normalized.length > 0 ? normalized.slice(0, 120) : "gateway.model_call";
}

function getDefaultGatewayCategory(modelRole: string | null | undefined): SmartQuotaCategory {
  if (modelRole === "vision") {
    return "image_ocr";
  }

  if (modelRole === "embedding") {
    return "semantic_indexing";
  }

  return "ask";
}

function getGatewayStage(category: SmartQuotaCategory) {
  if (category === "ask") {
    return "ask";
  }

  if (category === "retrieval") {
    return "retrieval";
  }

  return "processing";
}

function normalizeGatewayMetadata(metadata: Record<string, unknown> | null | undefined) {
  const normalized: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(metadata || {})) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      normalized[key] = value;
    }
  }

  return normalized;
}

function getGatewayPlanLimit(planCode: string): GatewayPlanLimit {
  const limits: Record<string, GatewayPlanLimit> = {
    free: {
      maxHourlyCredits: 200,
      maxHourlyRequests: 50,
      maxMinuteRequests: 8,
      maxRequestCredits: 100,
    },
    local: {
      maxHourlyCredits: 500,
      maxHourlyRequests: 100,
      maxMinuteRequests: 10,
      maxRequestCredits: 200,
    },
    personal: {
      maxHourlyCredits: 3000,
      maxHourlyRequests: 600,
      maxMinuteRequests: 30,
      maxRequestCredits: 500,
    },
    pro: {
      maxHourlyCredits: 12000,
      maxHourlyRequests: 3000,
      maxMinuteRequests: 90,
      maxRequestCredits: 3000,
    },
    team: {
      maxHourlyCredits: 40000,
      maxHourlyRequests: 10000,
      maxMinuteRequests: 180,
      maxRequestCredits: 8000,
    },
  };

  return limits[planCode] || limits.free;
}

function buildGatewayQuotaSnapshot(
  quota: Awaited<ReturnType<typeof loadSmartQuotaSummary>>,
  gatewayUsedCredits: number,
  gatewayRemainingCredits: number | null,
) {
  return {
    account: quota.account,
    gatewayRemainingCredits,
    gatewayUsedCredits,
    period: quota.period,
  };
}

function isInactiveStripeSubscription(status: string | null, quotaSource: string) {
  if (quotaSource !== "stripe") {
    return false;
  }

  return !["active", "trialing"].includes(status || "");
}

function getCurrentQuotaPeriod(date = new Date(), anchorDay = 1) {
  const day = Math.min(28, Math.max(1, anchorDay));
  const startMonthOffset = date.getUTCDate() < day ? -1 : 0;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + startMonthOffset, day, 0, 0, 0, 0));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, day, 0, 0, 0, 0));

  return {
    end: end.toISOString(),
    start: start.toISOString(),
  };
}

function toGatewayTokenSummary(row: GatewayTokenRow): GatewayTokenSummary {
  return {
    createdAt: row.created_at,
    displayName: row.display_name,
    expiresAt: row.expires_at,
    id: row.id,
    installId: row.install_id,
    lastUsedAt: row.last_used_at,
    planCode: row.plan_code,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    status: row.status,
    tokenPrefix: row.token_prefix,
  };
}

function toGatewayUsageSummary(row: GatewayUsageRow) {
  return {
    category: row.category,
    createdAt: row.created_at,
    credits: row.credits,
    errorCode: row.error_code,
    id: row.id,
    metadata: row.metadata,
    modelRole: row.model_role,
    periodEnd: row.period_end,
    periodStart: row.period_start,
    purpose: row.purpose,
    requestCount: row.request_count,
    status: row.status,
    tokenId: row.token_id,
    userId: row.user_id,
  };
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
