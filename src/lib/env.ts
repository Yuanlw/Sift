import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  MODEL_PROVIDER: z.enum(["openai-compatible"]).default("openai-compatible"),
  MODEL_BASE_URL: z.string().url().default("http://127.0.0.1:9000/v1"),
  MODEL_API_KEY: z.string().min(1).default("local"),
  MODEL_TEXT_MODEL: z
    .string()
    .min(1)
    .default("Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit"),
  MODEL_EMBEDDING_MODEL: z.string().min(1).default("bge-m3-mlx-fp16"),
  MODEL_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  JOB_DISPATCHER: z.enum(["none", "inngest", "inline"]).default("inline"),
  SIFT_SINGLE_USER_ID: z.string().uuid().default("00000000-0000-0000-0000-000000000001"),
});

export class MissingEnvError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(`Missing environment variables: ${missingKeys.join(", ")}`);
    this.name = "MissingEnvError";
  }
}

export function getServerEnv() {
  const result = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    MODEL_PROVIDER: process.env.MODEL_PROVIDER,
    MODEL_BASE_URL: process.env.MODEL_BASE_URL,
    MODEL_API_KEY: process.env.MODEL_API_KEY,
    MODEL_TEXT_MODEL: process.env.MODEL_TEXT_MODEL,
    MODEL_EMBEDDING_MODEL: process.env.MODEL_EMBEDDING_MODEL,
    MODEL_EMBEDDING_DIMENSIONS: process.env.MODEL_EMBEDDING_DIMENSIONS,
    JOB_DISPATCHER: process.env.JOB_DISPATCHER,
    SIFT_SINGLE_USER_ID: process.env.SIFT_SINGLE_USER_ID,
  });

  if (!result.success) {
    throw new MissingEnvError(
      result.error.issues.map((issue) => issue.path.join(".")).filter(Boolean),
    );
  }

  return result.data;
}
