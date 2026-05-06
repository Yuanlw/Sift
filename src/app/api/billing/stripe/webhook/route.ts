import { NextResponse } from "next/server";
import { handleStripeWebhook } from "@/lib/billing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const result = await handleStripeWebhook(rawBody, request.headers.get("stripe-signature"));
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Stripe webhook error";
    return NextResponse.json({ error: message, ok: false }, { status: 400 });
  }
}
