import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";

export function authorizeControlPlaneRequest(request: Request) {
  const env = getServerEnv();

  if (!env.SIFT_CLOUD_CONTROL_API_KEY) {
    return NextResponse.json({ error: "Sift Cloud control API key is not configured." }, { status: 503 });
  }

  if (request.headers.get("authorization") !== `Bearer ${env.SIFT_CLOUD_CONTROL_API_KEY}`) {
    return NextResponse.json({ error: "Unauthorized control-plane request." }, { status: 401 });
  }

  return null;
}
