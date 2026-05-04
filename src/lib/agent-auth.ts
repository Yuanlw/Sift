import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";

export function authorizeAgentRequest(request: Request) {
  const env = getServerEnv();

  if (!env.SIFT_AGENT_API_KEY) {
    return null;
  }

  const authorization = request.headers.get("authorization") || "";
  const expected = `Bearer ${env.SIFT_AGENT_API_KEY}`;

  if (authorization === expected) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized agent request." }, { status: 401 });
}
