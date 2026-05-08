import { NextResponse } from "next/server";
import { getServerEnv, MissingEnvError } from "@/lib/env";
import { recoverProcessingBacklog } from "@/lib/processing/recover-processing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const env = getServerEnv();

    if (!isAuthorized(request, env.SIFT_AGENT_API_KEY)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const summary = await recoverProcessingBacklog({
      embeddingLimit: 50,
      enrichmentLimit: 50,
      fullReprocessLimit: 20,
      staleSeconds: 60 * 60,
    });

    return NextResponse.json({
      status: "completed",
      summary,
    });
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return NextResponse.json(
        {
          error: "Sift 还没有完成本地环境配置。",
          missingKeys: error.missingKeys,
        },
        { status: 503 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isAuthorized(request: Request, apiKey: string | undefined) {
  if (!apiKey && process.env.NODE_ENV !== "production") {
    return true;
  }

  if (!apiKey) {
    return false;
  }

  return request.headers.get("authorization") === `Bearer ${apiKey}`;
}
