import crypto from "crypto";
import { getServerEnv } from "@/lib/env";
import { applyStripeBillingPlan, downgradeStripeSubscription, loadSmartQuotaSummary } from "@/lib/smart-quota";

export type BillingPlanCode = "personal" | "pro" | "team";

export interface BillingPlan {
  code: BillingPlanCode;
  description: string;
  enabled: boolean;
  monthlyCredits: number;
  name: string;
  priceEnvKey: "STRIPE_PRICE_PERSONAL" | "STRIPE_PRICE_PRO" | "STRIPE_PRICE_TEAM";
  priceId?: string;
  priceLabel?: string;
}

interface StripeCheckoutSession {
  customer?: string | null;
  id: string;
  metadata?: Record<string, string | undefined> | null;
  mode?: string | null;
  subscription?: string | null;
  url?: string | null;
}

interface StripeBillingPortalSession {
  id: string;
  url?: string | null;
}

interface StripeSubscription {
  customer?: string | null;
  id: string;
  metadata?: Record<string, string | undefined> | null;
  status?: string | null;
}

interface StripeEvent {
  data?: {
    object?: unknown;
  };
  id: string;
  type: string;
}

export function getBillingPlans(): BillingPlan[] {
  const env = getServerEnv();
  const plans: Array<Omit<BillingPlan, "enabled" | "priceId"> & { priceId?: string }> = [
    {
      code: "personal",
      description: "适合个人日常收集、整理和问答。",
      monthlyCredits: 10000,
      name: "Personal",
      priceEnvKey: "STRIPE_PRICE_PERSONAL",
      priceId: env.STRIPE_PRICE_PERSONAL,
      priceLabel: env.SIFT_PRICE_LABEL_PERSONAL,
    },
    {
      code: "pro",
      description: "适合重度导入、图片 OCR 和更频繁的 Ask。",
      monthlyCredits: 50000,
      name: "Pro",
      priceEnvKey: "STRIPE_PRICE_PRO",
      priceId: env.STRIPE_PRICE_PRO,
      priceLabel: env.SIFT_PRICE_LABEL_PRO,
    },
    {
      code: "team",
      description: "为团队共享额度预留，当前先按用户账户开通。",
      monthlyCredits: 200000,
      name: "Team",
      priceEnvKey: "STRIPE_PRICE_TEAM",
      priceId: env.STRIPE_PRICE_TEAM,
      priceLabel: env.SIFT_PRICE_LABEL_TEAM,
    },
  ];

  return plans.map((plan) => ({
    ...plan,
    enabled: Boolean(env.STRIPE_SECRET_KEY && plan.priceId),
  }));
}

export function isStripeBillingConfigured() {
  const env = getServerEnv();
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

export function getBillingPlan(planCode: string) {
  return getBillingPlans().find((plan) => plan.code === planCode);
}

export async function createStripeCheckoutSession(input: {
  planCode: string;
  userId: string;
}) {
  const env = getServerEnv();
  const plan = getBillingPlan(input.planCode);

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe billing is not configured.");
  }

  if (!plan || !plan.priceId) {
    throw new Error("Selected billing plan is not configured.");
  }

  const successUrl = new URL("/settings", env.SIFT_APP_URL);
  successUrl.searchParams.set("billing", "success");
  const cancelUrl = new URL("/settings", env.SIFT_APP_URL);
  cancelUrl.searchParams.set("billing", "cancelled");

  const body = new URLSearchParams({
    "allow_promotion_codes": "true",
    "client_reference_id": input.userId,
    "customer_creation": "always",
    "line_items[0][price]": plan.priceId,
    "line_items[0][quantity]": "1",
    "metadata[monthly_credits]": String(plan.monthlyCredits),
    "metadata[plan_code]": plan.code,
    "metadata[user_id]": input.userId,
    "mode": "subscription",
    "subscription_data[metadata][monthly_credits]": String(plan.monthlyCredits),
    "subscription_data[metadata][plan_code]": plan.code,
    "subscription_data[metadata][user_id]": input.userId,
    "success_url": successUrl.toString(),
    "cancel_url": cancelUrl.toString(),
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    body,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Stripe Checkout failed: ${response.status} ${await response.text()}`);
  }

  const session = (await response.json()) as StripeCheckoutSession;

  if (!session.url) {
    throw new Error("Stripe Checkout did not return a redirect URL.");
  }

  return session.url;
}

export async function createStripeBillingPortalSession(input: {
  userId: string;
}) {
  const env = getServerEnv();

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe billing is not configured.");
  }

  const quota = await loadSmartQuotaSummary(input.userId);
  const customerId = quota.account.stripeCustomerId;

  if (!customerId) {
    throw new Error("No Stripe customer is linked to this account yet.");
  }

  const returnUrl = new URL("/settings", env.SIFT_APP_URL);
  returnUrl.searchParams.set("billing", "portal");

  const body = new URLSearchParams({
    customer: customerId,
    return_url: returnUrl.toString(),
  });

  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    body,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Stripe Billing Portal failed: ${response.status} ${await response.text()}`);
  }

  const session = (await response.json()) as StripeBillingPortalSession;

  if (!session.url) {
    throw new Error("Stripe Billing Portal did not return a redirect URL.");
  }

  return session.url;
}

export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  const env = getServerEnv();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Stripe webhook secret is not configured.");
  }

  verifyStripeSignature({
    payload: rawBody,
    signature,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });

  const event = JSON.parse(rawBody) as StripeEvent;

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(event.data?.object as StripeCheckoutSession);
  }

  if (event.type === "customer.subscription.updated") {
    await handleSubscriptionUpdated(event.data?.object as StripeSubscription);
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data?.object as StripeSubscription;
    if (subscription?.id) {
      await downgradeStripeSubscription({
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status || "canceled",
      });
    }
  }

  return {
    ok: true,
    type: event.type,
  };
}

async function handleCheckoutCompleted(session: StripeCheckoutSession) {
  const userId = session?.metadata?.user_id;
  const planCode = session?.metadata?.plan_code;
  const plan = planCode ? getBillingPlan(planCode) : null;

  if (!userId || !plan) {
    return;
  }

  await applyStripeBillingPlan({
    customerId: session.customer || null,
    monthlyCreditLimit: plan.monthlyCredits,
    planCode: plan.code,
    subscriptionId: session.subscription || null,
    subscriptionStatus: "active",
    userId,
  });
}

async function handleSubscriptionUpdated(subscription: StripeSubscription) {
  const userId = subscription?.metadata?.user_id;
  const planCode = subscription?.metadata?.plan_code;
  const plan = planCode ? getBillingPlan(planCode) : null;

  if (!subscription?.id) {
    return;
  }

  if (!userId || !plan || !["active", "trialing"].includes(subscription.status || "")) {
    if (["canceled", "unpaid", "incomplete_expired", "past_due"].includes(subscription.status || "")) {
      await downgradeStripeSubscription({
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
      });
    }
    return;
  }

  await applyStripeBillingPlan({
    customerId: subscription.customer || null,
    monthlyCreditLimit: plan.monthlyCredits,
    planCode: plan.code,
    subscriptionId: subscription.id,
    subscriptionStatus: subscription.status || null,
    userId,
  });
}

function verifyStripeSignature(input: {
  payload: string;
  secret: string;
  signature: string | null;
}) {
  if (!input.signature) {
    throw new Error("Missing Stripe-Signature header.");
  }

  const parts = Object.fromEntries(
    input.signature.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );
  const timestamp = parts.t;
  const receivedSignature = parts.v1;

  if (!timestamp || !receivedSignature) {
    throw new Error("Invalid Stripe signature header.");
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) {
    throw new Error("Stripe webhook signature timestamp is outside the allowed tolerance.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.payload}`, "utf8")
    .digest("hex");
  const received = Buffer.from(receivedSignature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new Error("Invalid Stripe webhook signature.");
  }
}
