import { NextResponse } from "next/server";
import { z } from "zod";
import { createStripeCheckoutSession } from "@/lib/billing";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  planCode: z.enum(["personal", "pro", "team"]),
});

export async function POST(request: Request) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const contentType = request.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await request.json()
      : Object.fromEntries((await request.formData()).entries());
    const parsed = checkoutSchema.parse(body);
    const userContext = await getUserContextFromRequest(request);
    const url = await createStripeCheckoutSession({
      planCode: parsed.planCode,
      userId: userContext.userId,
    });

    return NextResponse.redirect(url, 303);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid checkout input" }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown checkout error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
