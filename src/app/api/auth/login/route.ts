import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  assertLoginAllowed,
  authenticateUser,
  clearLoginFailures,
  createSignedSessionCookie,
  normalizeEmail,
  recordFailedLogin,
} from "@/lib/auth";
import { validateSameOriginRequest } from "@/lib/request-security";

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const originError = validateSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const parsed = loginSchema.safeParse(await readBody(request));

  if (!parsed.success) {
    return authErrorResponse(request, "请填写有效邮箱和密码。", 400);
  }

  try {
    await assertLoginAllowed({ email: parsed.data.email, request });
    const user = await authenticateUser(parsed.data);
    await clearLoginFailures({ email: user.email, request });
    const cookie = await createSignedSessionCookie({
      displayName: user.displayName,
      email: user.email,
      request,
      userId: user.id,
    });

    return successResponse(request, cookie);
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "invalid_credentials") {
        await recordFailedLogin({ email: normalizeEmail(parsed.data.email), request });
      }

      return authErrorResponse(request, error.message, error.code === "rate_limited" ? 429 : 401);
    }

    const message = error instanceof Error ? error.message : "登录失败。";
    return authErrorResponse(request, message, 500);
  }
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const formData = await request.formData();
  return {
    email: formData.get("email"),
    password: formData.get("password"),
  };
}

function successResponse(request: Request, cookie: string) {
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ status: "ok" }, { headers: { "Set-Cookie": cookie } });
  }

  const response = NextResponse.redirect(safeNextUrl(request), { status: 303 });
  response.headers.set("Set-Cookie", cookie);
  return response;
}

function authErrorResponse(request: Request, message: string, status: number) {
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ error: message }, { status });
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("error", message);
  const next = new URL(request.url).searchParams.get("next");
  if (next) url.searchParams.set("next", next);
  return NextResponse.redirect(url, { status: 303 });
}

function safeNextUrl(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  return new URL(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", request.url);
}
