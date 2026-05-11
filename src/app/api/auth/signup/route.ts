import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, createSignedSessionCookie, registerUser } from "@/lib/auth";
import { recordProductEvent } from "@/lib/product-events";
import { validateSameOriginRequest } from "@/lib/request-security";

const signupSchema = z.object({
  displayName: z.string().trim().optional().nullable(),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  const originError = validateSameOriginRequest(request);

  if (originError) {
    return originError;
  }

  const parsed = signupSchema.safeParse(await readBody(request));

  if (!parsed.success) {
    return authErrorResponse(request, "请填写有效邮箱和至少 8 位密码。", 400);
  }

  try {
    const user = await registerUser(parsed.data);
    await recordProductEvent({
      eventName: "signup.completed",
      metadata: {
        next: new URL(request.url).searchParams.get("next") || null,
      },
      resourceId: user.id,
      resourceType: "user",
      source: "signup",
      userId: user.id,
    });
    const cookie = await createSignedSessionCookie({
      displayName: user.displayName,
      email: user.email,
      request,
      userId: user.id,
    });

    return successResponse(request, cookie);
  } catch (error) {
    if (error instanceof AuthError) {
      return authErrorResponse(request, error.message, error.code === "email_taken" ? 409 : error.code === "signup_closed" ? 403 : 400);
    }

    const message = error instanceof Error ? error.message : "注册失败。";
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
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
  };
}

function successResponse(request: Request, cookie: string) {
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ status: "ok" }, { headers: { "Set-Cookie": cookie } });
  }

  const nextUrl = safeNextUrl(request);
  const response = NextResponse.redirect(nextUrl, { status: 303 });
  response.headers.set("Set-Cookie", cookie);
  return response;
}

function authErrorResponse(request: Request, message: string, status: number) {
  if ((request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ error: message }, { status });
  }

  const url = new URL("/signup", request.url);
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
