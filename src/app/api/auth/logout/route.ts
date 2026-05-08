import { NextResponse } from "next/server";
import { revokeSessionCookie } from "@/lib/auth";
import { validateSameOriginRequest } from "@/lib/request-security";

export async function POST(request: Request) {
  const originError = validateSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const cookie = await revokeSessionCookie(request.headers.get("cookie"));

  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ status: "ok" }, { headers: { "Set-Cookie": cookie } });
  }

  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  response.headers.set("Set-Cookie", cookie);
  return response;
}
