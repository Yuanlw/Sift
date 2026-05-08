import { NextResponse } from "next/server";

export function validateSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const requestOrigin = new URL(request.url).origin;

  if (origin && origin !== requestOrigin) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== requestOrigin) {
        return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
    }
  }

  return null;
}
