import { NextResponse } from "next/server";
import { createStripeBillingPortalSession } from "@/lib/billing";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const userContext = await getUserContextFromRequest(request);
    const url = await createStripeBillingPortalSession({
      userId: userContext.userId,
    });

    return NextResponse.redirect(url, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown billing portal error";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
