import { NextResponse } from "next/server";
import { z } from "zod";
import { loadStoredModelApiKey } from "@/lib/model-settings";
import { validateModelConfig } from "@/lib/model-validation";
import { getUserContextFromRequest } from "@/lib/user-context";

const validateSchema = z.object({
  apiKey: z.string().optional().nullable(),
  baseUrl: z.string().url(),
  dimensions: z.coerce.number().int().positive().optional().nullable(),
  model: z.string().min(1),
  target: z.enum(["text", "embedding", "vision"]),
});

export async function POST(request: Request) {
  try {
    const body = validateSchema.parse(await request.json());
    const userContext = getUserContextFromRequest(request);
    const apiKey = body.apiKey?.trim() || (await loadStoredModelApiKey(userContext.userId, body.target));

    if (!apiKey) {
      return NextResponse.json({ error: "请先填写或保存该模型的 API Key。", ok: false }, { status: 400 });
    }

    const result = await validateModelConfig({ ...body, apiKey });
    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid validation input", ok: false }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown validation error";
    return NextResponse.json({ error: message, ok: false }, { status: 400 });
  }
}
