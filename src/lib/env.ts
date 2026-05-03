import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_TEXT_MODEL: z.string().min(1).default("gpt-5-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
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
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL,
    OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL,
    SIFT_SINGLE_USER_ID: process.env.SIFT_SINGLE_USER_ID,
  });

  if (!result.success) {
    throw new MissingEnvError(
      result.error.issues.map((issue) => issue.path.join(".")).filter(Boolean),
    );
  }

  return result.data;
}
