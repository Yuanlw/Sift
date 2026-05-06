import crypto from "crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

export type ModelSettingsMode = "default" | "custom";
export type ModelSettingsTarget = "text" | "embedding" | "vision";

export interface UserModelSettings {
  embeddingApiKeyConfigured: boolean;
  embeddingBaseUrl: string | null;
  embeddingDimensions: number | null;
  embeddingModel: string | null;
  mode: ModelSettingsMode;
  textApiKeyConfigured: boolean;
  textBaseUrl: string | null;
  textModel: string | null;
  textReasoningEffort: "low" | "medium" | "high" | null;
  textThinking: "enabled" | "disabled" | null;
  updatedAt: string | null;
  userId: string;
  visionApiKeyConfigured: boolean;
  visionBaseUrl: string | null;
  visionModel: string | null;
}

interface UserModelSettingsRow {
  embedding_api_key: string | null;
  embedding_base_url: string | null;
  embedding_dimensions: number | null;
  embedding_model: string | null;
  mode: ModelSettingsMode;
  text_api_key: string | null;
  text_base_url: string | null;
  text_model: string | null;
  text_reasoning_effort: "low" | "medium" | "high" | null;
  text_thinking: "enabled" | "disabled" | null;
  updated_at: string | null;
  user_id: string;
  vision_api_key: string | null;
  vision_base_url: string | null;
  vision_model: string | null;
}

export const modelSettingsInputSchema = z.object({
  mode: z.enum(["default", "custom"]),
  textBaseUrl: z.string().trim().url().optional().nullable(),
  textApiKey: z.string().optional().nullable(),
  textModel: z.string().trim().optional().nullable(),
  textThinking: z.enum(["enabled", "disabled"]).optional().nullable(),
  textReasoningEffort: z.enum(["low", "medium", "high"]).optional().nullable(),
  embeddingBaseUrl: z.string().trim().url().optional().nullable(),
  embeddingApiKey: z.string().optional().nullable(),
  embeddingModel: z.string().trim().optional().nullable(),
  embeddingDimensions: z.coerce.number().int().positive().optional().nullable(),
  visionBaseUrl: z.string().trim().url().optional().nullable(),
  visionApiKey: z.string().optional().nullable(),
  visionModel: z.string().trim().optional().nullable(),
});

export type ModelSettingsInput = z.infer<typeof modelSettingsInputSchema>;

export interface EffectiveModelConfig {
  embedding: {
    apiKey: string;
    baseUrl: string;
    dimensions: number;
    model: string;
  };
  mode: ModelSettingsMode;
  provider: "openai-compatible";
  text: {
    apiKey: string;
    baseUrl: string;
    model: string;
    reasoningEffort?: "low" | "medium" | "high";
    thinking?: "enabled" | "disabled";
  };
  vision: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
}

const ENCRYPTED_MODEL_KEY_PREFIX = "enc:v1:";

export async function loadUserModelSettings(userId: string): Promise<UserModelSettings> {
  const result = await query<UserModelSettingsRow>(
    `
      select *
      from user_model_settings
      where user_id = $1
      limit 1
    `,
    [userId],
  );
  const row = result.rows[0];

  if (!row) {
    return {
      embeddingApiKeyConfigured: false,
      embeddingBaseUrl: null,
      embeddingDimensions: null,
      embeddingModel: null,
      mode: "default",
      textApiKeyConfigured: false,
      textBaseUrl: null,
      textModel: null,
      textReasoningEffort: null,
      textThinking: null,
      updatedAt: null,
      userId,
      visionApiKeyConfigured: false,
      visionBaseUrl: null,
      visionModel: null,
    };
  }

  return {
    embeddingApiKeyConfigured: Boolean(row.embedding_api_key),
    embeddingBaseUrl: row.embedding_base_url,
    embeddingDimensions: row.embedding_dimensions,
    embeddingModel: row.embedding_model,
    mode: row.mode,
    textApiKeyConfigured: Boolean(row.text_api_key),
    textBaseUrl: row.text_base_url,
    textModel: row.text_model,
    textReasoningEffort: row.text_reasoning_effort,
    textThinking: row.text_thinking,
    updatedAt: row.updated_at,
    userId,
    visionApiKeyConfigured: Boolean(row.vision_api_key),
    visionBaseUrl: row.vision_base_url,
    visionModel: row.vision_model,
  };
}

export async function saveUserModelSettings(userId: string, input: ModelSettingsInput) {
  const normalized = normalizeSettingsInput(input);
  const textApiKey = protectModelApiKey(emptyToNull(normalized.textApiKey));
  const embeddingApiKey = protectModelApiKey(emptyToNull(normalized.embeddingApiKey));
  const visionApiKey = protectModelApiKey(emptyToNull(normalized.visionApiKey));

  await query(
    `
      insert into user_model_settings (
        user_id,
        mode,
        text_base_url,
        text_api_key,
        text_model,
        text_thinking,
        text_reasoning_effort,
        embedding_base_url,
        embedding_api_key,
        embedding_model,
        embedding_dimensions,
        vision_base_url,
        vision_api_key,
        vision_model,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
      on conflict (user_id)
      do update set
        mode = excluded.mode,
        text_base_url = excluded.text_base_url,
        text_api_key = coalesce(excluded.text_api_key, user_model_settings.text_api_key),
        text_model = excluded.text_model,
        text_thinking = excluded.text_thinking,
        text_reasoning_effort = excluded.text_reasoning_effort,
        embedding_base_url = excluded.embedding_base_url,
        embedding_api_key = coalesce(excluded.embedding_api_key, user_model_settings.embedding_api_key),
        embedding_model = excluded.embedding_model,
        embedding_dimensions = excluded.embedding_dimensions,
        vision_base_url = excluded.vision_base_url,
        vision_api_key = coalesce(excluded.vision_api_key, user_model_settings.vision_api_key),
        vision_model = excluded.vision_model,
        updated_at = now()
    `,
    [
      userId,
      normalized.mode,
      normalized.textBaseUrl,
      textApiKey,
      normalized.textModel,
      normalized.textThinking,
      normalized.textReasoningEffort,
      normalized.embeddingBaseUrl,
      embeddingApiKey,
      normalized.embeddingModel,
      normalized.embeddingDimensions,
      normalized.visionBaseUrl,
      visionApiKey,
      normalized.visionModel,
    ],
  );

  return loadUserModelSettings(userId);
}

export async function getEffectiveModelConfig(userId?: string | null): Promise<EffectiveModelConfig> {
  const env = getServerEnv();
  const defaults: EffectiveModelConfig = {
    embedding: {
      apiKey: env.MODEL_EMBEDDING_API_KEY,
      baseUrl: env.MODEL_EMBEDDING_BASE_URL,
      dimensions: env.MODEL_EMBEDDING_DIMENSIONS,
      model: env.MODEL_EMBEDDING_MODEL,
    },
    mode: "default",
    provider: env.MODEL_PROVIDER,
    text: {
      apiKey: env.MODEL_TEXT_API_KEY,
      baseUrl: env.MODEL_TEXT_BASE_URL,
      model: env.MODEL_TEXT_MODEL,
      reasoningEffort: env.MODEL_TEXT_REASONING_EFFORT,
      thinking: env.MODEL_TEXT_THINKING,
    },
    vision: {
      apiKey: env.MODEL_VISION_API_KEY,
      baseUrl: env.MODEL_VISION_BASE_URL,
      model: env.MODEL_VISION_MODEL,
    },
  };

  if (!userId) {
    return defaults;
  }

  const result = await query<UserModelSettingsRow>(
    `
      select *
      from user_model_settings
      where user_id = $1
        and mode = 'custom'
      limit 1
    `,
    [userId],
  );
  const row = result.rows[0];

  if (!row) {
    return defaults;
  }

  const missing = getCustomConfigMissingFields(row);

  if (missing.length > 0) {
    throw new Error(`自定义模型配置不完整：${missing.join("、")}。请到设置中心补齐或切回 Sift 默认模型。`);
  }

  const textApiKey = revealModelApiKey(row.text_api_key)!;
  const embeddingApiKey = revealModelApiKey(row.embedding_api_key)!;
  const visionApiKey = revealModelApiKey(row.vision_api_key)!;

  return {
    embedding: {
      apiKey: embeddingApiKey,
      baseUrl: row.embedding_base_url!,
      dimensions: row.embedding_dimensions!,
      model: row.embedding_model!,
    },
    mode: "custom",
    provider: defaults.provider,
    text: {
      apiKey: textApiKey,
      baseUrl: row.text_base_url!,
      model: row.text_model!,
      reasoningEffort: row.text_reasoning_effort || undefined,
      thinking: row.text_thinking || undefined,
    },
    vision: {
      apiKey: visionApiKey,
      baseUrl: row.vision_base_url!,
      model: row.vision_model!,
    },
  };
}

export async function loadStoredModelApiKey(userId: string, target: ModelSettingsTarget) {
  const column = getApiKeyColumn(target);
  const result = await query<{ api_key: string | null }>(
    `
      select ${column} as api_key
      from user_model_settings
      where user_id = $1
      limit 1
    `,
    [userId],
  );

  return revealModelApiKey(result.rows[0]?.api_key || null);
}

export function normalizeSettingsInput(input: ModelSettingsInput): ModelSettingsInput {
  return {
    ...input,
    embeddingBaseUrl: input.embeddingBaseUrl || null,
    embeddingModel: input.embeddingModel || null,
    textBaseUrl: input.textBaseUrl || null,
    textModel: input.textModel || null,
    visionBaseUrl: input.visionBaseUrl || null,
    visionModel: input.visionModel || null,
  };
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function protectModelApiKey(value: string | null) {
  if (!value) {
    return null;
  }

  if (isProtectedModelApiKey(value)) {
    return value;
  }

  const secret = getServerEnv().SIFT_MODEL_KEY_ENCRYPTION_SECRET;

  if (!secret) {
    return value;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_MODEL_KEY_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function revealModelApiKey(value: string | null) {
  if (!value) {
    return null;
  }

  if (!isProtectedModelApiKey(value)) {
    return value;
  }

  const secret = getServerEnv().SIFT_MODEL_KEY_ENCRYPTION_SECRET;

  if (!secret) {
    throw new Error("自定义模型 API Key 已加密，但服务端缺少 SIFT_MODEL_KEY_ENCRYPTION_SECRET。");
  }

  const [ivText, tagText, encryptedText] = value.slice(ENCRYPTED_MODEL_KEY_PREFIX.length).split(".");

  if (!ivText || !tagText || !encryptedText) {
    throw new Error("自定义模型 API Key 加密格式无效，请重新保存模型配置。");
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveEncryptionKey(secret),
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("自定义模型 API Key 解密失败，请检查服务端加密密钥或重新保存模型配置。");
  }
}

function isProtectedModelApiKey(value: string) {
  return value.startsWith(ENCRYPTED_MODEL_KEY_PREFIX);
}

function deriveEncryptionKey(secret: string) {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function getApiKeyColumn(target: ModelSettingsTarget) {
  const columns: Record<ModelSettingsTarget, string> = {
    embedding: "embedding_api_key",
    text: "text_api_key",
    vision: "vision_api_key",
  };

  return columns[target];
}

function getCustomConfigMissingFields(row: UserModelSettingsRow) {
  const missing: string[] = [];

  if (!row.text_base_url) missing.push("文本模型 Base URL");
  if (!row.text_api_key) missing.push("文本模型 API Key");
  if (!row.text_model) missing.push("文本模型名称");
  if (!row.embedding_base_url) missing.push("Embedding Base URL");
  if (!row.embedding_api_key) missing.push("Embedding API Key");
  if (!row.embedding_model) missing.push("Embedding 模型名称");
  if (!row.embedding_dimensions) missing.push("Embedding 维度");
  if (!row.vision_base_url) missing.push("OCR Base URL");
  if (!row.vision_api_key) missing.push("OCR API Key");
  if (!row.vision_model) missing.push("OCR 模型名称");

  return missing;
}
