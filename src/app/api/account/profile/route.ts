import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  createSignedSessionCookieFromPayload,
  loadActiveSessionUser,
  updateUserProfile,
} from "@/lib/auth";
import { validateSameOriginRequest } from "@/lib/request-security";

const profileSchema = z.object({
  displayName: z.string().trim().max(80).optional().nullable(),
});

export async function PATCH(request: Request) {
  return handleUpdate(request);
}

export async function POST(request: Request) {
  return handleUpdate(request);
}

async function handleUpdate(request: Request) {
  const originError = validateSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const session = await loadActiveSessionUser(request.headers.get("cookie"));

  if (!session) {
    return accountErrorResponse(request, "请先登录。", 401, "profile");
  }

  const parsed = profileSchema.safeParse(await readBody(request));

  if (!parsed.success) {
    return accountErrorResponse(request, "显示名称不能超过 80 个字符。", 400, "profile");
  }

  try {
    const user = await updateUserProfile({
      displayName: parsed.data.displayName,
      userId: session.id,
    });
    const cookie = createSignedSessionCookieFromPayload({
      displayName: user.displayName,
      email: user.email,
      expiresAt: session.expiresAt,
      sessionId: session.sessionId,
      userId: user.id,
    });

    return accountSuccessResponse(request, cookie, "profile-updated");
  } catch (error) {
    if (error instanceof AuthError) {
      return accountErrorResponse(request, error.message, error.code === "session_required" ? 401 : 400, "profile");
    }

    const message = error instanceof Error ? error.message : "资料保存失败。";
    return accountErrorResponse(request, message, 500, "profile");
  }
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const formData = await request.formData();
  return {
    displayName: formData.get("displayName"),
  };
}

function accountSuccessResponse(request: Request, cookie: string, status: string) {
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ status: "ok" }, { headers: { "Set-Cookie": cookie } });
  }

  const url = new URL("/settings", request.url);
  url.searchParams.set("account", status);
  const response = NextResponse.redirect(url, { status: 303 });
  response.headers.set("Set-Cookie", cookie);
  return response;
}

function accountErrorResponse(request: Request, message: string, status: number, scope: "profile") {
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ error: message }, { status });
  }

  const url = new URL("/settings", request.url);
  url.searchParams.set("accountError", message);
  url.searchParams.set("accountScope", scope);
  return NextResponse.redirect(url, { status: 303 });
}
