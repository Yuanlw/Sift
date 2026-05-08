import { NextResponse } from "next/server";
import { loadActiveSessionUser } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";

export async function authorizeAgentRequest(request: Request) {
  const env = getServerEnv();
  const authorization = request.headers.get("authorization") || "";
  const hasAgentToken = Boolean(env.SIFT_AGENT_API_KEY && authorization === `Bearer ${env.SIFT_AGENT_API_KEY}`);

  if (hasAgentToken) {
    return null;
  }

  const session = await loadActiveSessionUser(request.headers.get("cookie"));

  if (session) {
    return null;
  }

  if (!env.SIFT_REQUIRE_AUTH && !env.SIFT_AGENT_API_KEY) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized agent request." }, { status: 401 });
}
