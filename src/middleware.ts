import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "sift_session";

const protectedPagePrefixes = ["/", "/inbox", "/settings", "/sources", "/wiki"];
const publicPagePrefixes = ["/contact", "/login", "/pricing", "/privacy", "/refund", "/signup", "/terms"];
const protectedApiPrefixes = [
  "/api/account",
  "/api/ask",
  "/api/billing/checkout",
  "/api/billing/portal",
  "/api/captures",
  "/api/discoveries",
  "/api/recommendations",
  "/api/settings",
  "/api/sources",
  "/api/uploads",
  "/api/wiki",
];
const publicApiPrefixes = [
  "/api/agent",
  "/api/auth",
  "/api/billing/stripe/webhook",
  "/api/inngest",
  "/api/maintenance",
  "/api/mcp",
];

export async function middleware(request: NextRequest) {
  if (!isAuthRequired()) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const signedSession = request.cookies.get(SESSION_COOKIE_NAME)?.value || "";
  const hasSession = await isValidSessionCookie(signedSession);
  const trustedHeader = isTrustedHeaderAuthenticated(request);

  if ((pathname === "/login" || pathname === "/signup") && (hasSession || trustedHeader)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  if (hasSession || trustedHeader) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/).*)"],
};

function isProtectedPath(pathname: string) {
  if (publicPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }

  if (publicApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return false;
  }

  if (protectedApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }

  return protectedPagePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isAuthRequired() {
  return process.env.SIFT_REQUIRE_AUTH !== "false";
}

function isTrustedHeaderAuthenticated(request: NextRequest) {
  if (process.env.SIFT_TRUST_USER_HEADER !== "true") {
    return false;
  }

  const headerName = process.env.SIFT_USER_ID_HEADER || "x-sift-user-id";
  const headerValue = request.headers.get(headerName);

  return Boolean(headerValue && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerValue));
}

async function isValidSessionCookie(value: string) {
  const [encodedPayload, signature] = value.split(".");

  if (!encodedPayload || !signature) {
    return false;
  }

  const expected = await signValue(encodedPayload);

  if (signature !== expected) {
    return false;
  }

  try {
    const payload = JSON.parse(atobBase64Url(encodedPayload)) as { expiresAt?: string };
    return Boolean(payload.expiresAt && new Date(payload.expiresAt).getTime() > Date.now());
  } catch {
    return false;
  }
}

async function signValue(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret()),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function getSessionSecret() {
  const secret = process.env.SIFT_SESSION_SECRET || process.env.SIFT_MODEL_KEY_ENCRYPTION_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    return "local-development-sift-session-secret-change-me";
  }

  return randomUnavailableSecret();
}

function randomUnavailableSecret() {
  return "missing-production-session-secret";
}

function atobBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
