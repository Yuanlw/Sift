import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeControlPlaneRequest } from "@/lib/gateway-control-auth";
import { validateGatewayToken } from "@/lib/gateway-tokens";

export const runtime = "nodejs";

const validateSchema = z.object({
  category: z.enum(["capture_processing", "image_ocr", "semantic_indexing", "ask", "retrieval"]).optional(),
  estimatedCredits: z.coerce.number().int().positive().max(1_000_000).optional(),
  inputChars: z.coerce.number().int().min(0).max(10_000_000).optional(),
  metadata: z.record(z.unknown()).optional(),
  modelRole: z.string().trim().max(40).optional(),
  outputChars: z.coerce.number().int().min(0).max(10_000_000).optional(),
  purpose: z.string().trim().max(120).optional(),
  requestCount: z.coerce.number().int().positive().max(1000).optional(),
  token: z.string().trim().min(16),
  usage: z
    .object({
      completion_tokens: z.coerce.number().int().min(0).optional(),
      prompt_tokens: z.coerce.number().int().min(0).optional(),
      total_tokens: z.coerce.number().int().min(0).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  try {
    const authorizationError = authorizeControlPlaneRequest(request);

    if (authorizationError) {
      return authorizationError;
    }

    const body = validateSchema.parse(await request.json());
    const result = await validateGatewayToken({
      category: body.category,
      estimatedCredits: body.estimatedCredits,
      inputChars: body.inputChars,
      metadata: body.metadata,
      modelRole: body.modelRole,
      outputChars: body.outputChars,
      purpose: body.purpose,
      requestCount: body.requestCount,
      token: body.token,
      usage: body.usage,
    });

    if (!result.valid) {
      return NextResponse.json(result, { status: 401 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid gateway token validation input" }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown gateway token validation error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
