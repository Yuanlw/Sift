import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeControlPlaneRequest } from "@/lib/gateway-control-auth";
import { settleGatewayUsage } from "@/lib/gateway-tokens";

export const runtime = "nodejs";

const usageSchema = z.object({
  authorizationId: z.string().uuid(),
  credits: z.coerce.number().int().min(0).max(1_000_000).optional(),
  errorCode: z.string().trim().max(120).optional().nullable(),
  inputChars: z.coerce.number().int().min(0).max(10_000_000).optional(),
  metadata: z.record(z.unknown()).optional(),
  outputChars: z.coerce.number().int().min(0).max(10_000_000).optional(),
  status: z.enum(["failure", "success"]),
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

    const body = usageSchema.parse(await request.json());
    const usage = await settleGatewayUsage({
      authorizationId: body.authorizationId,
      credits: body.credits,
      errorCode: body.errorCode,
      inputChars: body.inputChars,
      metadata: body.metadata,
      outputChars: body.outputChars,
      status: body.status,
      usage: body.usage,
    });

    return NextResponse.json({ usage });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid gateway usage input" }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown gateway usage error";
    return NextResponse.json(
      { error: message },
      { status: message === "Gateway authorization was not found or already settled." ? 409 : 500 },
    );
  }
}
