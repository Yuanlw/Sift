import { getServerEnv } from "@/lib/env";
import type { ModelCallContext, ModelUsagePayload } from "@/lib/model-usage";
import type { Json } from "@/types/database";

export interface SmartQuotaCostInput {
  context: ModelCallContext;
  inputChars?: number | null;
  outputChars?: number | null;
  requestCount: number;
  usage?: ModelUsagePayload | null;
}

export interface SmartQuotaCostEstimate {
  calculation: Record<string, Json>;
  credits: number;
}

export function calculateCostBasedCredits(input: SmartQuotaCostInput): SmartQuotaCostEstimate {
  const env = getServerEnv();
  const imageCount = getMetadataNumber(input.context.metadata?.image_count);
  const requestCount = Math.max(1, input.requestCount);
  const usage = normalizeUsage(input.usage, input.inputChars, input.outputChars, input.context.role);
  const rawCostUsd = calculateRawCostUsd({
    imageCount,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    role: input.context.role,
  });
  const minimumCredits = getMinimumCredits(input.context.role, imageCount, requestCount);
  const costCredits = Math.ceil((rawCostUsd * env.SIFT_SMART_QUOTA_COST_MULTIPLIER) / env.SIFT_SMART_QUOTA_USD_PER_CREDIT);
  const credits = Math.max(minimumCredits, costCredits);

  return {
    calculation: {
      cost_multiplier: env.SIFT_SMART_QUOTA_COST_MULTIPLIER,
      estimated_input_tokens: usage.inputTokens,
      estimated_output_tokens: usage.outputTokens,
      image_count: imageCount || 0,
      minimum_credits: minimumCredits,
      pricing_role: input.context.role,
      raw_cost_usd: roundCost(rawCostUsd),
      rule: "cost: ceil(raw_cost_usd * multiplier / usd_per_credit), with role minimum",
      usd_per_credit: env.SIFT_SMART_QUOTA_USD_PER_CREDIT,
    },
    credits,
  };
}

function calculateRawCostUsd(input: {
  imageCount: number | null;
  inputTokens: number;
  outputTokens: number;
  role: ModelCallContext["role"];
}) {
  const env = getServerEnv();

  if (input.role === "embedding") {
    return (input.inputTokens / 1_000_000) * env.SIFT_COST_EMBEDDING_INPUT_USD_PER_MILLION_TOKENS;
  }

  if (input.role === "vision") {
    return (
      (input.inputTokens / 1_000_000) * env.SIFT_COST_VISION_INPUT_USD_PER_MILLION_TOKENS +
      (input.outputTokens / 1_000_000) * env.SIFT_COST_VISION_OUTPUT_USD_PER_MILLION_TOKENS +
      Math.max(0, input.imageCount || 0) * env.SIFT_COST_VISION_IMAGE_USD
    );
  }

  return (
    (input.inputTokens / 1_000_000) * env.SIFT_COST_TEXT_INPUT_USD_PER_MILLION_TOKENS +
    (input.outputTokens / 1_000_000) * env.SIFT_COST_TEXT_OUTPUT_USD_PER_MILLION_TOKENS
  );
}

function normalizeUsage(
  usage: ModelUsagePayload | null | undefined,
  inputChars: number | null | undefined,
  outputChars: number | null | undefined,
  role: ModelCallContext["role"],
) {
  const promptTokens = toSafeInt(usage?.prompt_tokens);
  const completionTokens = toSafeInt(usage?.completion_tokens);
  const totalTokens = toSafeInt(usage?.total_tokens);

  if (role === "embedding") {
    return {
      inputTokens: promptTokens || totalTokens || estimateTokensFromChars(inputChars),
      outputTokens: 0,
    };
  }

  if (promptTokens || completionTokens) {
    return {
      inputTokens: promptTokens,
      outputTokens: completionTokens,
    };
  }

  if (totalTokens > 0) {
    const estimatedOutputTokens = Math.min(totalTokens, estimateTokensFromChars(outputChars));
    return {
      inputTokens: Math.max(0, totalTokens - estimatedOutputTokens),
      outputTokens: estimatedOutputTokens,
    };
  }

  return {
    inputTokens: estimateTokensFromChars(inputChars),
    outputTokens: estimateTokensFromChars(outputChars),
  };
}

function estimateTokensFromChars(chars: number | null | undefined) {
  return Math.max(0, Math.ceil((chars || 0) / 2));
}

function getMinimumCredits(role: ModelCallContext["role"], imageCount: number | null, requestCount: number) {
  if (role === "vision") {
    return Math.max(20, Math.max(imageCount || 0, requestCount) * 20);
  }

  return Math.max(1, requestCount);
}

function getMetadataNumber(value: Json | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function roundCost(value: number) {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function toSafeInt(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value || 0)) : 0;
}
