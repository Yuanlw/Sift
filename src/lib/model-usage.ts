import { query } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { recordSmartQuotaDebit } from "@/lib/smart-quota";
import type { ModelSettingsMode } from "@/lib/model-settings";
import type { Json } from "@/types/database";

export type ModelCallRole = "text" | "embedding" | "vision";
export type ModelCallStage = "processing" | "ask" | "retrieval" | "management" | "agent";

export interface ModelCallContext {
  userId?: string;
  stage: ModelCallStage;
  role: ModelCallRole;
  purpose: string;
  resourceType?: string;
  resourceId?: string | null;
  metadata?: Record<string, Json | undefined>;
}

export interface ModelUsagePayload {
  completion_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

export async function recordModelCall(input: {
  baseUrl: string;
  context?: ModelCallContext;
  durationMs: number;
  errorMessage?: string | null;
  inputChars?: number | null;
  model: string;
  modelMode?: ModelSettingsMode;
  outputChars?: number | null;
  provider: string;
  requestCount?: number;
  status: "success" | "failed";
  usage?: ModelUsagePayload | null;
}) {
  if (!input.context?.userId) {
    return;
  }

  try {
    const result = await query<{ id: string }>(
      `
        insert into model_call_logs (
          user_id,
          stage,
          role,
          purpose,
          provider,
          model,
          endpoint_host,
          status,
          duration_ms,
          request_count,
          input_chars,
          output_chars,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          resource_type,
          resource_id,
          error_message,
          metadata
        )
        values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19::jsonb
        )
        returning id
      `,
      [
        input.context.userId,
        input.context.stage,
        input.context.role,
        input.context.purpose,
        input.provider,
        input.model,
        toEndpointHost(input.baseUrl),
        input.status,
        input.durationMs,
        input.requestCount || 1,
        input.inputChars ?? null,
        input.outputChars ?? null,
        input.usage?.prompt_tokens ?? null,
        input.usage?.completion_tokens ?? null,
        input.usage?.total_tokens ?? null,
        input.context.resourceType || null,
        input.context.resourceId || null,
        input.errorMessage || null,
        JSON.stringify(input.context.metadata || {}),
      ],
    );
    const modelCallLogId = result.rows[0]?.id;

    if (modelCallLogId && input.status === "success" && !isSiftGatewayCall(input.baseUrl)) {
      await recordSmartQuotaDebit({
        context: input.context,
        inputChars: input.inputChars,
        modelCallLogId,
        modelMode: input.modelMode || "default",
        outputChars: input.outputChars,
        requestCount: input.requestCount || 1,
        usage: input.usage,
      });
    }
  } catch (error) {
    console.warn("Failed to record model call log", error);
  }
}

export function countTextChars(input: unknown) {
  return JSON.stringify(input).length;
}

function toEndpointHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "unknown";
  }
}

function isSiftGatewayCall(baseUrl: string) {
  try {
    const env = getServerEnv();

    if (!env.SIFT_MODEL_GATEWAY_CONFIGURED) {
      return false;
    }

    return trimTrailingSlash(baseUrl) === trimTrailingSlash(env.SIFT_MODEL_GATEWAY_BASE_URL!);
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
