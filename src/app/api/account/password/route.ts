import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, changeUserPassword, loadActiveSessionUser } from "@/lib/auth";
import { validateSameOriginRequest } from "@/lib/request-security";

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    newPasswordConfirm: z.string().optional(),
  })
  .refine((input) => !input.newPasswordConfirm || input.newPassword === input.newPasswordConfirm, {
    message: "两次输入的新密码不一致。",
    path: ["newPasswordConfirm"],
  });

export async function POST(request: Request) {
  const originError = validateSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const session = await loadActiveSessionUser(request.headers.get("cookie"));

  if (!session) {
    return accountErrorResponse(request, "请先登录。", 401);
  }

  const parsed = passwordSchema.safeParse(await readBody(request));

  if (!parsed.success) {
    return accountErrorResponse(request, parsed.error.issues[0]?.message || "新密码至少需要 8 个字符。", 400);
  }

  try {
    const result = await changeUserPassword({
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      sessionId: session.sessionId,
      userId: session.id,
    });

    return accountSuccessResponse(request, result.revokedSessions);
  } catch (error) {
    if (error instanceof AuthError) {
      return accountErrorResponse(request, error.message, error.code === "invalid_credentials" ? 401 : 400);
    }

    const message = error instanceof Error ? error.message : "密码更新失败。";
    return accountErrorResponse(request, message, 500);
  }
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const formData = await request.formData();
  return {
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    newPasswordConfirm: formData.get("newPasswordConfirm"),
  };
}

function accountSuccessResponse(request: Request, revokedSessions: number) {
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ revokedSessions, status: "ok" });
  }

  const url = new URL("/settings", request.url);
  url.searchParams.set("account", "password-updated");
  if (revokedSessions > 0) {
    url.searchParams.set("revokedSessions", String(revokedSessions));
  }
  return NextResponse.redirect(url, { status: 303 });
}

function accountErrorResponse(request: Request, message: string, status: number) {
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ error: message }, { status });
  }

  const url = new URL("/settings", request.url);
  url.searchParams.set("accountError", message);
  url.searchParams.set("accountScope", "password");
  return NextResponse.redirect(url, { status: 303 });
}
