import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MODEL_PROVIDER: z.enum(["openai-compatible"]).default("openai-compatible"),
  MODEL_BASE_URL: z.string().url().default("http://127.0.0.1:9000/v1"),
  MODEL_API_KEY: z.string().min(1).default("local"),
  MODEL_TEXT_BASE_URL: z.string().url().optional(),
  MODEL_TEXT_API_KEY: z.string().min(1).optional(),
  MODEL_TEXT_MODEL: z
    .string()
    .min(1)
    .default("Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit"),
  MODEL_TEXT_THINKING: z.enum(["enabled", "disabled"]).optional(),
  MODEL_TEXT_REASONING_EFFORT: z.enum(["low", "medium", "high"]).optional(),
  MODEL_EMBEDDING_BASE_URL: z.string().url().optional(),
  MODEL_EMBEDDING_API_KEY: z.string().min(1).optional(),
  MODEL_EMBEDDING_MODEL: z.string().min(1).default("bge-m3-mlx-fp16"),
  MODEL_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  MODEL_VISION_BASE_URL: z.string().url().optional(),
  MODEL_VISION_API_KEY: z.string().min(1).optional(),
  MODEL_VISION_MODEL: z.string().min(1).optional(),
  JOB_DISPATCHER: z.enum(["none", "inngest", "inline"]).default("inline"),
  SIFT_SINGLE_USER_ID: z.string().uuid().default("00000000-0000-0000-0000-000000000001"),
  SIFT_REQUIRE_AUTH: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SIFT_TRUST_USER_HEADER: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SIFT_USER_ID_HEADER: z.string().min(1).default("x-sift-user-id"),
  SIFT_AGENT_API_KEY: z.string().min(1).optional(),
  SIFT_AGENT_USER_ID: z.string().uuid().optional(),
  SIFT_ALLOW_PUBLIC_SIGNUP: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SIFT_SESSION_SECRET: z.string().min(32).optional(),
  SIFT_APP_URL: z.string().url().default("http://localhost:3000"),
  SIFT_MODEL_GATEWAY_BASE_URL: z.string().url().optional(),
  SIFT_MODEL_GATEWAY_API_KEY: z.string().min(1).optional(),
  SIFT_CLOUD_CONTROL_API_KEY: z.string().min(1).optional(),
  SIFT_SMART_QUOTA_USD_PER_CREDIT: z.coerce.number().positive().default(0.0001),
  SIFT_SMART_QUOTA_COST_MULTIPLIER: z.coerce.number().min(1).default(2),
  SIFT_COST_TEXT_INPUT_USD_PER_MILLION_TOKENS: z.coerce.number().min(0).default(0.029),
  SIFT_COST_TEXT_OUTPUT_USD_PER_MILLION_TOKENS: z.coerce.number().min(0).default(0.287),
  SIFT_COST_EMBEDDING_INPUT_USD_PER_MILLION_TOKENS: z.coerce.number().min(0).default(0.072),
  SIFT_COST_VISION_INPUT_USD_PER_MILLION_TOKENS: z.coerce.number().min(0).default(0.043),
  SIFT_COST_VISION_OUTPUT_USD_PER_MILLION_TOKENS: z.coerce.number().min(0).default(0.072),
  SIFT_COST_VISION_IMAGE_USD: z.coerce.number().min(0).default(0.002),
  SIFT_ADMIN_EMAILS: z.string().min(1).optional(),
  SIFT_MODEL_KEY_ENCRYPTION_SECRET: z.string().min(32).optional(),
  SIFT_PRICE_LABEL_PERSONAL: z.string().min(1).optional(),
  SIFT_PRICE_LABEL_PRO: z.string().min(1).optional(),
  SIFT_PRICE_LABEL_TEAM: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_PERSONAL: z.string().min(1).optional(),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  STRIPE_PRICE_TEAM: z.string().min(1).optional(),
});

const optionalEnvKeys = [
  "MODEL_TEXT_BASE_URL",
  "MODEL_TEXT_API_KEY",
  "MODEL_TEXT_THINKING",
  "MODEL_TEXT_REASONING_EFFORT",
  "MODEL_EMBEDDING_BASE_URL",
  "MODEL_EMBEDDING_API_KEY",
  "MODEL_VISION_BASE_URL",
  "MODEL_VISION_API_KEY",
  "MODEL_VISION_MODEL",
  "SIFT_AGENT_API_KEY",
  "SIFT_AGENT_USER_ID",
  "SIFT_SESSION_SECRET",
  "SIFT_MODEL_GATEWAY_BASE_URL",
  "SIFT_MODEL_GATEWAY_API_KEY",
  "SIFT_CLOUD_CONTROL_API_KEY",
  "SIFT_SMART_QUOTA_USD_PER_CREDIT",
  "SIFT_SMART_QUOTA_COST_MULTIPLIER",
  "SIFT_COST_TEXT_INPUT_USD_PER_MILLION_TOKENS",
  "SIFT_COST_TEXT_OUTPUT_USD_PER_MILLION_TOKENS",
  "SIFT_COST_EMBEDDING_INPUT_USD_PER_MILLION_TOKENS",
  "SIFT_COST_VISION_INPUT_USD_PER_MILLION_TOKENS",
  "SIFT_COST_VISION_OUTPUT_USD_PER_MILLION_TOKENS",
  "SIFT_COST_VISION_IMAGE_USD",
  "SIFT_ADMIN_EMAILS",
  "SIFT_MODEL_KEY_ENCRYPTION_SECRET",
  "SIFT_PRICE_LABEL_PERSONAL",
  "SIFT_PRICE_LABEL_PRO",
  "SIFT_PRICE_LABEL_TEAM",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PERSONAL",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_TEAM",
] as const;

export class MissingEnvError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`Missing environment variables: ${missingKeys.join(", ")}`);
    this.name = "MissingEnvError";
  }
}

export function getServerEnv() {
  const rawEnv = normalizeOptionalEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    MODEL_PROVIDER: process.env.MODEL_PROVIDER,
    MODEL_BASE_URL: process.env.MODEL_BASE_URL,
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    MODEL_TEXT_BASE_URL: process.env.MODEL_TEXT_BASE_URL,
    MODEL_TEXT_API_KEY: process.env.MODEL_TEXT_API_KEY,
    MODEL_TEXT_MODEL: process.env.MODEL_TEXT_MODEL,
    MODEL_TEXT_THINKING: process.env.MODEL_TEXT_THINKING,
    MODEL_TEXT_REASONING_EFFORT: process.env.MODEL_TEXT_REASONING_EFFORT,
    MODEL_EMBEDDING_BASE_URL: process.env.MODEL_EMBEDDING_BASE_URL,
    MODEL_EMBEDDING_API_KEY: process.env.MODEL_EMBEDDING_API_KEY,
    MODEL_EMBEDDING_MODEL: process.env.MODEL_EMBEDDING_MODEL,
    MODEL_EMBEDDING_DIMENSIONS: process.env.MODEL_EMBEDDING_DIMENSIONS,
    MODEL_VISION_BASE_URL: process.env.MODEL_VISION_BASE_URL,
    MODEL_VISION_API_KEY: process.env.MODEL_VISION_API_KEY,
    MODEL_VISION_MODEL: process.env.MODEL_VISION_MODEL,
    JOB_DISPATCHER: process.env.JOB_DISPATCHER,
    SIFT_SINGLE_USER_ID: process.env.SIFT_SINGLE_USER_ID,
    SIFT_REQUIRE_AUTH: process.env.SIFT_REQUIRE_AUTH,
    SIFT_TRUST_USER_HEADER: process.env.SIFT_TRUST_USER_HEADER,
    SIFT_USER_ID_HEADER: process.env.SIFT_USER_ID_HEADER,
    SIFT_AGENT_API_KEY: process.env.SIFT_AGENT_API_KEY,
    SIFT_AGENT_USER_ID: process.env.SIFT_AGENT_USER_ID,
    SIFT_ALLOW_PUBLIC_SIGNUP: process.env.SIFT_ALLOW_PUBLIC_SIGNUP,
    SIFT_SESSION_SECRET: process.env.SIFT_SESSION_SECRET,
    SIFT_APP_URL: process.env.SIFT_APP_URL,
    SIFT_MODEL_GATEWAY_BASE_URL: process.env.SIFT_MODEL_GATEWAY_BASE_URL,
    SIFT_MODEL_GATEWAY_API_KEY: process.env.SIFT_MODEL_GATEWAY_API_KEY,
    SIFT_CLOUD_CONTROL_API_KEY: process.env.SIFT_CLOUD_CONTROL_API_KEY,
    SIFT_SMART_QUOTA_USD_PER_CREDIT: process.env.SIFT_SMART_QUOTA_USD_PER_CREDIT,
    SIFT_SMART_QUOTA_COST_MULTIPLIER: process.env.SIFT_SMART_QUOTA_COST_MULTIPLIER,
    SIFT_COST_TEXT_INPUT_USD_PER_MILLION_TOKENS: process.env.SIFT_COST_TEXT_INPUT_USD_PER_MILLION_TOKENS,
    SIFT_COST_TEXT_OUTPUT_USD_PER_MILLION_TOKENS: process.env.SIFT_COST_TEXT_OUTPUT_USD_PER_MILLION_TOKENS,
    SIFT_COST_EMBEDDING_INPUT_USD_PER_MILLION_TOKENS: process.env.SIFT_COST_EMBEDDING_INPUT_USD_PER_MILLION_TOKENS,
    SIFT_COST_VISION_INPUT_USD_PER_MILLION_TOKENS: process.env.SIFT_COST_VISION_INPUT_USD_PER_MILLION_TOKENS,
    SIFT_COST_VISION_OUTPUT_USD_PER_MILLION_TOKENS: process.env.SIFT_COST_VISION_OUTPUT_USD_PER_MILLION_TOKENS,
    SIFT_COST_VISION_IMAGE_USD: process.env.SIFT_COST_VISION_IMAGE_USD,
    SIFT_ADMIN_EMAILS: process.env.SIFT_ADMIN_EMAILS,
    SIFT_MODEL_KEY_ENCRYPTION_SECRET: process.env.SIFT_MODEL_KEY_ENCRYPTION_SECRET,
    SIFT_PRICE_LABEL_PERSONAL: process.env.SIFT_PRICE_LABEL_PERSONAL,
    SIFT_PRICE_LABEL_PRO: process.env.SIFT_PRICE_LABEL_PRO,
    SIFT_PRICE_LABEL_TEAM: process.env.SIFT_PRICE_LABEL_TEAM,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_PERSONAL: process.env.STRIPE_PRICE_PERSONAL,
    STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO,
    STRIPE_PRICE_TEAM: process.env.STRIPE_PRICE_TEAM,
  });
  const result = serverEnvSchema.safeParse(rawEnv);

  if (!result.success) {
    throw new MissingEnvError(
      result.error.issues.map((issue) => issue.path.join(".")).filter(Boolean),
    );
  }

  const gatewayBaseUrl = result.data.SIFT_MODEL_GATEWAY_BASE_URL;
  const gatewayApiKey = result.data.SIFT_MODEL_GATEWAY_API_KEY;

  if (Boolean(gatewayBaseUrl) !== Boolean(gatewayApiKey)) {
    throw new MissingEnvError([
      gatewayBaseUrl ? "SIFT_MODEL_GATEWAY_API_KEY" : "SIFT_MODEL_GATEWAY_BASE_URL",
    ]);
  }

  const gatewayConfigured = Boolean(gatewayBaseUrl && gatewayApiKey);
  const defaultModelBaseUrl = gatewayConfigured ? gatewayBaseUrl! : result.data.MODEL_BASE_URL;
  const defaultModelApiKey = gatewayConfigured ? gatewayApiKey! : result.data.MODEL_API_KEY;
  const textBaseUrl = result.data.MODEL_TEXT_BASE_URL || defaultModelBaseUrl;
  const textApiKey = result.data.MODEL_TEXT_API_KEY || defaultModelApiKey;

  return {
    ...result.data,
    MODEL_BASE_URL: defaultModelBaseUrl,
    MODEL_API_KEY: defaultModelApiKey,
    MODEL_TEXT_BASE_URL: textBaseUrl,
    MODEL_TEXT_API_KEY: textApiKey,
    MODEL_EMBEDDING_BASE_URL: result.data.MODEL_EMBEDDING_BASE_URL || defaultModelBaseUrl,
    MODEL_EMBEDDING_API_KEY: result.data.MODEL_EMBEDDING_API_KEY || defaultModelApiKey,
    MODEL_VISION_BASE_URL: result.data.MODEL_VISION_BASE_URL || textBaseUrl,
    MODEL_VISION_API_KEY: result.data.MODEL_VISION_API_KEY || textApiKey,
    MODEL_VISION_MODEL: result.data.MODEL_VISION_MODEL || result.data.MODEL_TEXT_MODEL,
    SIFT_MODEL_GATEWAY_CONFIGURED: gatewayConfigured,
  };
}

function normalizeOptionalEnv(env: Record<string, string | undefined>) {
  const normalized: Record<string, string | undefined> = { ...env };

  for (const key of optionalEnvKeys) {
    if (normalized[key] === "") {
      normalized[key] = undefined;
    }
  }

  return normalized;
}
