import { query } from "@/lib/db";
import type { ModelCallContext, ModelUsagePayload } from "@/lib/model-usage";
import type { ModelSettingsMode } from "@/lib/model-settings";
import { calculateCostBasedCredits } from "@/lib/smart-quota-cost";
import type { Json } from "@/types/database";

export type SmartQuotaCategory = "capture_processing" | "image_ocr" | "semantic_indexing" | "ask" | "retrieval";
export type SmartQuotaEnforcementMode = "unlimited" | "soft_limit" | "hard_limit";

export interface SmartQuotaAccount {
  enforcementMode: SmartQuotaEnforcementMode;
  monthlyCreditLimit: number | null;
  periodAnchorDay: number;
  planCode: string;
  quotaSource: "local" | "stripe" | "manual";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
  userId: string;
}

interface SmartQuotaAccountRow {
  enforcement_mode: SmartQuotaEnforcementMode;
  monthly_credit_limit: number | null;
  period_anchor_day: number;
  plan_code: string;
  quota_source: "local" | "stripe" | "manual";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  user_id: string;
}

interface SmartQuotaUsageRow {
  category: SmartQuotaCategory;
  credits: string | null;
}

export class SmartQuotaExceededError extends Error {
  constructor() {
    super("默认模型智能额度已用完。原始资料仍可保存；请等待额度刷新、切换自定义模型，或调整额度策略后再处理。");
    this.name = "SmartQuotaExceededError";
  }
}

export async function assertSmartQuotaAvailable(userId: string, modelMode: ModelSettingsMode, estimatedCredits = 1) {
  if (modelMode !== "default") {
    return;
  }

  const summary = await loadSmartQuotaSummary(userId);

  if (
    summary.account.enforcementMode === "hard_limit" &&
    summary.account.monthlyCreditLimit !== null &&
    summary.remainingCredits !== null &&
    summary.remainingCredits < Math.max(1, estimatedCredits)
  ) {
    throw new SmartQuotaExceededError();
  }
}

export async function recordSmartQuotaDebit(input: {
  context: ModelCallContext;
  inputChars?: number | null;
  modelCallLogId: string;
  modelMode: ModelSettingsMode;
  outputChars?: number | null;
  requestCount: number;
  usage?: ModelUsagePayload | null;
}) {
  if (input.modelMode !== "default") {
    return;
  }

  try {
    const account = await ensureSmartQuotaAccount(input.context.userId!);
    const period = getCurrentQuotaPeriod(new Date(), account.periodAnchorDay);
    const debit = calculateSmartQuotaDebit(input);

    await query(
      `
        insert into smart_quota_ledger (
          user_id,
          period_start,
          period_end,
          category,
          credits,
          stage,
          role,
          purpose,
          model_call_log_id,
          resource_type,
          resource_id,
          calculation
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      `,
      [
        input.context.userId,
        period.start,
        period.end,
        debit.category,
        debit.credits,
        input.context.stage,
        input.context.role,
        input.context.purpose,
        input.modelCallLogId,
        input.context.resourceType || null,
        input.context.resourceId || null,
        JSON.stringify({
          ...debit.calculation,
          enforcement_mode: account.enforcementMode,
          plan_code: account.planCode,
        }),
      ],
    );
  } catch (error) {
    if (isMissingQuotaTableError(error)) {
      return;
    }

    throw error;
  }
}

export async function loadSmartQuotaSummary(userId: string) {
  try {
    const account = await ensureSmartQuotaAccount(userId);
    const period = getCurrentQuotaPeriod(new Date(), account.periodAnchorDay);
    const breakdown = (await loadUnifiedQuotaUsage(userId, period)).map((row) => ({
      category: row.category,
      credits: toNumber(row.credits),
    }));
    const usedCredits = breakdown.reduce((sum, row) => sum + row.credits, 0);
    const remainingCredits =
      account.monthlyCreditLimit === null ? null : Math.max(0, account.monthlyCreditLimit - usedCredits);

    return {
      account,
      breakdown,
      period,
      remainingCredits,
      schemaReady: true,
      usedCredits,
    };
  } catch (error) {
    if (!isMissingQuotaTableError(error)) {
      throw error;
    }

    return {
      account: createDefaultSmartQuotaAccount(userId),
      breakdown: [],
      period: getCurrentQuotaPeriod(),
      remainingCredits: 10000,
      schemaReady: false,
      usedCredits: 0,
    };
  }
}

async function loadUnifiedQuotaUsage(userId: string, period: { end: string; start: string }) {
  try {
    const result = await query<SmartQuotaUsageRow>(
      `
        with quota_usage as (
          select category, credits
          from smart_quota_ledger
          where user_id = $1
            and period_start = $2
            and period_end = $3
          union all
          select category, credits
          from sift_gateway_usage_ledger
          where user_id = $1
            and period_start = $2
            and period_end = $3
            and status in ('reserved', 'success')
        )
        select category, coalesce(sum(credits), 0)::text as credits
        from quota_usage
        group by category
        order by category
      `,
      [userId, period.start, period.end],
    );

    return result.rows;
  } catch (error) {
    if (!isMissingQuotaTableError(error)) {
      throw error;
    }

    const result = await query<SmartQuotaUsageRow>(
      `
        select category, coalesce(sum(credits), 0)::text as credits
        from smart_quota_ledger
        where user_id = $1
          and period_start = $2
          and period_end = $3
        group by category
        order by category
      `,
      [userId, period.start, period.end],
    );

    return result.rows;
  }
}

export async function applyStripeBillingPlan(input: {
  customerId?: string | null;
  monthlyCreditLimit: number;
  planCode: string;
  subscriptionId?: string | null;
  subscriptionStatus?: string | null;
  userId: string;
}) {
  await query(
    `
      insert into smart_quota_accounts (
        user_id,
        plan_code,
        enforcement_mode,
        monthly_credit_limit,
        quota_source,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_subscription_status,
        updated_at
      )
      values ($1, $2, 'hard_limit', $3, 'stripe', $4, $5, $6, now())
      on conflict (user_id)
      do update set
        plan_code = excluded.plan_code,
        enforcement_mode = excluded.enforcement_mode,
        monthly_credit_limit = excluded.monthly_credit_limit,
        quota_source = excluded.quota_source,
        stripe_customer_id = coalesce(excluded.stripe_customer_id, smart_quota_accounts.stripe_customer_id),
        stripe_subscription_id = coalesce(excluded.stripe_subscription_id, smart_quota_accounts.stripe_subscription_id),
        stripe_subscription_status = coalesce(excluded.stripe_subscription_status, smart_quota_accounts.stripe_subscription_status),
        updated_at = now()
    `,
    [
      input.userId,
      input.planCode,
      input.monthlyCreditLimit,
      input.customerId || null,
      input.subscriptionId || null,
      input.subscriptionStatus || null,
    ],
  );
}

export async function applyManualBillingPlan(input: {
  monthlyCreditLimit: number | null;
  planCode: string;
  userId: string;
}) {
  await query(
    `
      insert into smart_quota_accounts (
        user_id,
        plan_code,
        enforcement_mode,
        monthly_credit_limit,
        quota_source,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_subscription_status,
        updated_at
      )
      values ($1, $2, $3, $4, 'manual', null, null, null, now())
      on conflict (user_id)
      do update set
        plan_code = excluded.plan_code,
        enforcement_mode = excluded.enforcement_mode,
        monthly_credit_limit = excluded.monthly_credit_limit,
        quota_source = excluded.quota_source,
        stripe_customer_id = null,
        stripe_subscription_id = null,
        stripe_subscription_status = null,
        updated_at = now()
    `,
    [
      input.userId,
      input.planCode,
      input.monthlyCreditLimit === null ? "unlimited" : "hard_limit",
      input.monthlyCreditLimit,
    ],
  );
}

export async function downgradeStripeSubscription(input: {
  subscriptionId: string;
  subscriptionStatus?: string | null;
}) {
  await query(
    `
      update smart_quota_accounts
      set plan_code = 'free',
          enforcement_mode = 'hard_limit',
          monthly_credit_limit = 500,
          quota_source = 'stripe',
          stripe_subscription_status = $2,
          updated_at = now()
      where stripe_subscription_id = $1
    `,
    [input.subscriptionId, input.subscriptionStatus || "canceled"],
  );
}

async function ensureSmartQuotaAccount(userId: string): Promise<SmartQuotaAccount> {
  await query(
    `
      insert into smart_quota_accounts (user_id, plan_code, enforcement_mode, monthly_credit_limit)
      values ($1, 'local', 'unlimited', null)
      on conflict (user_id) do nothing
    `,
    [userId],
  );

  const result = await query<SmartQuotaAccountRow>(
    `
      select
        user_id,
        plan_code,
        enforcement_mode,
        monthly_credit_limit,
        period_anchor_day,
        quota_source,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_subscription_status
      from smart_quota_accounts
      where user_id = $1
      limit 1
    `,
    [userId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error("Smart quota account was not initialized.");
  }

  return {
    enforcementMode: row.enforcement_mode,
    monthlyCreditLimit: row.monthly_credit_limit,
    periodAnchorDay: row.period_anchor_day,
    planCode: row.plan_code,
    quotaSource: row.quota_source,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeSubscriptionStatus: row.stripe_subscription_status,
    userId: row.user_id,
  };
}

function createDefaultSmartQuotaAccount(userId: string): SmartQuotaAccount {
  return {
    enforcementMode: "unlimited",
    monthlyCreditLimit: 10000,
    periodAnchorDay: 1,
    planCode: "local",
    quotaSource: "local",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeSubscriptionStatus: null,
    userId,
  };
}

export function estimateSmartQuotaCredits(input: {
  context: ModelCallContext;
  inputChars?: number | null;
  outputChars?: number | null;
  requestCount: number;
  usage?: ModelUsagePayload | null;
}) {
  return calculateSmartQuotaDebit(input).credits;
}

function calculateSmartQuotaDebit(input: {
  context: ModelCallContext;
  inputChars?: number | null;
  outputChars?: number | null;
  requestCount: number;
  usage?: ModelUsagePayload | null;
}) {
  const category = getQuotaCategory(input.context);
  const costEstimate = calculateCostBasedCredits(input);
  const calculation: Record<string, Json> = {
    ...costEstimate.calculation,
    category,
    input_chars: input.inputChars || 0,
    output_chars: input.outputChars || 0,
    request_count: Math.max(1, input.requestCount),
    total_tokens: input.usage?.total_tokens || 0,
  };

  return {
    calculation,
    category,
    credits: costEstimate.credits,
  };
}

function getQuotaCategory(context: ModelCallContext): SmartQuotaCategory {
  if (context.role === "vision") {
    return "image_ocr";
  }

  if (context.stage === "ask") {
    return "ask";
  }

  if (context.role === "embedding" && context.stage === "processing") {
    return "semantic_indexing";
  }

  if (context.stage === "processing") {
    return "capture_processing";
  }

  return "retrieval";
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

function isMissingQuotaTableError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01",
  );
}
