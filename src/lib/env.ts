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
  SIFT_TRUST_USER_HEADER: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SIFT_USER_ID_HEADER: z.string().min(1).default("x-sift-user-id"),
  SIFT_AGENT_API_KEY: z.string().min(1).optional(),
  SIFT_APP_URL: z.string().url().default("http://localhost:3000"),
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
    SIFT_TRUST_USER_HEADER: process.env.SIFT_TRUST_USER_HEADER,
    SIFT_USER_ID_HEADER: process.env.SIFT_USER_ID_HEADER,
    SIFT_AGENT_API_KEY: process.env.SIFT_AGENT_API_KEY,
    SIFT_APP_URL: process.env.SIFT_APP_URL,
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

  return {
    ...result.data,
    MODEL_TEXT_BASE_URL: result.data.MODEL_TEXT_BASE_URL || result.data.MODEL_BASE_URL,
    MODEL_TEXT_API_KEY: result.data.MODEL_TEXT_API_KEY || result.data.MODEL_API_KEY,
    MODEL_EMBEDDING_BASE_URL: result.data.MODEL_EMBEDDING_BASE_URL || result.data.MODEL_BASE_URL,
    MODEL_EMBEDDING_API_KEY: result.data.MODEL_EMBEDDING_API_KEY || result.data.MODEL_API_KEY,
    MODEL_VISION_BASE_URL: result.data.MODEL_VISION_BASE_URL || result.data.MODEL_TEXT_BASE_URL || result.data.MODEL_BASE_URL,
    MODEL_VISION_API_KEY: result.data.MODEL_VISION_API_KEY || result.data.MODEL_TEXT_API_KEY || result.data.MODEL_API_KEY,
    MODEL_VISION_MODEL: result.data.MODEL_VISION_MODEL || result.data.MODEL_TEXT_MODEL,
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
