import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { query, transaction } from "@/lib/db";
import { getServerEnv, MissingEnvError } from "@/lib/env";

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE_NAME = "sift_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_LOCK_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string;
}

export interface SessionPayload {
  displayName: string | null;
  email: string;
  expiresAt: string;
  sessionId: string;
  userId: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "email_taken"
      | "invalid_credentials"
      | "rate_limited"
      | "session_required"
      | "signup_closed"
      | "weak_password",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthUser {
  displayName: string | null;
  email: string;
  id: string;
}

export interface ActiveSessionUser extends AuthUser {
  expiresAt: string;
  sessionId: string;
}

export async function registerUser(input: { displayName?: string | null; email: string; password: string }) {
  const email = normalizeEmail(input.email);
  validatePassword(input.password);
  const passwordHash = await hashPassword(input.password);
  const env = getServerEnv();

  return transaction(async (client) => {
    await client.query("lock table users in exclusive mode");
    const countResult = await client.query<{ count: string }>("select count(*)::text as count from users");
    const isFirstUser = Number(countResult.rows[0]?.count || 0) === 0;

    if (!isFirstUser && !env.SIFT_ALLOW_PUBLIC_SIGNUP) {
      throw new AuthError("当前部署已关闭公开注册，请使用已有账号登录。", "signup_closed");
    }

    try {
      const result = await client.query<UserRow>(
        `
          insert into users (email, display_name, password_hash)
          values ($1, $2, $3)
          returning id, email, display_name, password_hash
        `,
        [email, normalizeDisplayName(input.displayName), passwordHash],
      );
      const user = result.rows[0];

      if (isFirstUser) {
        await claimDefaultUserData(client, env.SIFT_SINGLE_USER_ID, user.id);
      }

      return toAuthUser(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthError("这个邮箱已经注册。", "email_taken");
      }

      throw error;
    }
  });
}

export async function isSignupOpen() {
  const env = getServerEnv();

  if (env.SIFT_ALLOW_PUBLIC_SIGNUP) {
    return true;
  }

  const { rows } = await query<{ count: string }>("select count(*)::text as count from users");
  return Number(rows[0]?.count || 0) === 0;
}

export async function authenticateUser(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const result = await transaction(async (client) => {
    const userResult = await client.query<UserRow>(
      "select id, email, display_name, password_hash from users where email = $1 limit 1",
      [email],
    );
    const user = userResult.rows[0];

    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      throw new AuthError("邮箱或密码不正确。", "invalid_credentials");
    }

    await client.query("update users set last_login_at = now(), updated_at = now() where id = $1", [user.id]);
    return user;
  });

  return toAuthUser(result);
}

export async function assertLoginAllowed(input: { email: string; request: Request }) {
  const keys = getLoginRateLimitKeys(input.email, input.request);
  const { rows } = await query<{ locked_until: string }>(
    `
      select locked_until::text as locked_until
      from auth_rate_limits
      where key = any($1::text[])
        and locked_until is not null
        and locked_until > now()
      order by locked_until desc
      limit 1
    `,
    [keys],
  );
  const lockedUntil = rows[0]?.locked_until;

  if (lockedUntil) {
    const seconds = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000));
    throw new AuthError(`登录尝试过于频繁，请 ${Math.ceil(seconds / 60)} 分钟后再试。`, "rate_limited");
  }
}

export async function clearLoginFailures(input: { email: string; request: Request }) {
  const keys = getLoginRateLimitKeys(input.email, input.request);
  await query("delete from auth_rate_limits where key = any($1::text[])", [keys]);
}

export async function recordFailedLogin(input: { email: string; request: Request }) {
  const entries = [
    { key: getLoginRateLimitKey("email", normalizeEmail(input.email)), scope: "email" },
    { key: getLoginRateLimitKey("ip", getRequestIp(input.request) || "unknown"), scope: "ip" },
  ];

  await transaction(async (client) => {
    for (const entry of entries) {
      await client.query(
        `
          insert into auth_rate_limits (key, scope, attempts, locked_until, updated_at)
          values ($1, $2, 1, null, now())
          on conflict (key) do update
          set attempts = case
                when auth_rate_limits.updated_at < now() - ($3::text)::interval then 1
                else auth_rate_limits.attempts + 1
              end,
              locked_until = case
                when (
                  case
                    when auth_rate_limits.updated_at < now() - ($3::text)::interval then 1
                    else auth_rate_limits.attempts + 1
                  end
                ) >= $4 then now() + ($5::text)::interval
                else auth_rate_limits.locked_until
              end,
              updated_at = now()
        `,
        [entry.key, entry.scope, `${LOGIN_WINDOW_SECONDS} seconds`, LOGIN_MAX_FAILURES, `${LOGIN_LOCK_SECONDS} seconds`],
      );
    }
  });
}

export async function loadActiveSessionUser(cookieHeader: string | null): Promise<ActiveSessionUser | null> {
  const payload = readSessionPayload(cookieHeader);

  if (!payload) {
    return null;
  }

  const { rows } = await query<UserRow & { expires_at: string; session_id: string }>(
    `
      select
        users.id,
        users.email,
        users.display_name,
        users.password_hash,
        user_sessions.id as session_id,
        user_sessions.expires_at::text as expires_at
      from user_sessions
      join users on users.id = user_sessions.user_id
      where user_sessions.id = $1
        and user_sessions.user_id = $2
        and user_sessions.token_hash = $3
        and user_sessions.revoked_at is null
        and user_sessions.expires_at > now()
      limit 1
    `,
    [payload.sessionId, payload.userId, hashToken(payload.sessionId)],
  );
  const user = rows[0];

  if (!user) {
    return null;
  }

  return {
    displayName: user.display_name,
    email: user.email,
    expiresAt: user.expires_at,
    id: user.id,
    sessionId: user.session_id,
  };
}

export async function updateUserProfile(input: { displayName?: string | null; userId: string }) {
  const { rows } = await query<UserRow>(
    `
      update users
      set display_name = $2,
          updated_at = now()
      where id = $1
      returning id, email, display_name, password_hash
    `,
    [input.userId, normalizeDisplayName(input.displayName)],
  );
  const user = rows[0];

  if (!user) {
    throw new AuthError("请先登录。", "session_required");
  }

  return toAuthUser(user);
}

export async function changeUserPassword(input: { currentPassword: string; newPassword: string; sessionId: string; userId: string }) {
  validatePassword(input.newPassword);

  const revokedSessions = await transaction(async (client) => {
    const { rows } = await client.query<UserRow>(
      "select id, email, display_name, password_hash from users where id = $1 limit 1",
      [input.userId],
    );
    const user = rows[0];

    if (!user || !(await verifyPassword(input.currentPassword, user.password_hash))) {
      throw new AuthError("当前密码不正确。", "invalid_credentials");
    }

    const passwordHash = await hashPassword(input.newPassword);
    await client.query("update users set password_hash = $2, updated_at = now() where id = $1", [input.userId, passwordHash]);
    const revokeResult = await client.query(
      `
        update user_sessions
        set revoked_at = now()
        where user_id = $1
          and id <> $2
          and revoked_at is null
      `,
      [input.userId, input.sessionId],
    );

    return revokeResult.rowCount || 0;
  });

  return { revokedSessions };
}

export async function createSignedSessionCookie(input: {
  displayName: string | null;
  email: string;
  request: Request;
  userId: string;
}) {
  const sessionId = randomBytes(16).toString("hex");
  const tokenHash = hashToken(sessionId);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await transaction(async (client) => {
    await client.query(
      `
        insert into user_sessions (id, user_id, token_hash, user_agent, ip_address, expires_at)
        values ($1, $2, $3, $4, $5, $6)
      `,
      [
        sessionId,
        input.userId,
        tokenHash,
        input.request.headers.get("user-agent") || null,
        getRequestIp(input.request),
        expiresAt.toISOString(),
      ],
    );
  });

  const payload: SessionPayload = {
    displayName: input.displayName,
    email: input.email,
    expiresAt: expiresAt.toISOString(),
    sessionId,
    userId: input.userId,
  };

  return serializeCookie(SESSION_COOKIE_NAME, signSessionPayload(payload), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function createSignedSessionCookieFromPayload(payload: SessionPayload) {
  const secondsUntilExpiry = Math.max(0, Math.floor((new Date(payload.expiresAt).getTime() - Date.now()) / 1000));

  return serializeCookie(SESSION_COOKIE_NAME, signSessionPayload(payload), {
    httpOnly: true,
    maxAge: secondsUntilExpiry,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function revokeSessionCookie(cookieHeader: string | null) {
  const payload = readSessionPayload(cookieHeader);

  if (payload) {
    await transaction(async (client) => {
      await client.query("update user_sessions set revoked_at = now() where id = $1", [payload.sessionId]);
    });
  }

  return serializeCookie(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function readSessionPayload(cookieHeader: string | null): SessionPayload | null {
  const rawCookie = parseCookieHeader(cookieHeader)[SESSION_COOKIE_NAME];

  if (!rawCookie) {
    return null;
  }

  const [encodedPayload, signature] = rawCookie.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload);

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionPayload;

    if (!payload.userId || !payload.email || !payload.sessionId || !payload.expiresAt) {
      return null;
    }

    if (new Date(payload.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getSessionSecret() {
  const env = getServerEnv();
  const secret = env.SIFT_SESSION_SECRET || env.SIFT_MODEL_KEY_ENCRYPTION_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    return "local-development-sift-session-secret-change-me";
  }

  throw new MissingEnvError(["SIFT_SESSION_SECRET"]);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string | null | undefined) {
  const normalized = displayName?.trim();
  return normalized || null;
}

function validatePassword(password: string) {
  if (password.length < 8) {
    throw new AuthError("密码至少需要 8 个字符。", "weak_password");
  }

  if (password.length > 200) {
    throw new AuthError("密码不能超过 200 个字符。", "weak_password");
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("base64url")}`;
}

async function verifyPassword(password: string, passwordHash: string) {
  const [scheme, salt, stored] = passwordHash.split("$");

  if (scheme !== "scrypt" || !salt || !stored) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const storedKey = Buffer.from(stored, "base64url");

  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}

function signSessionPayload(payload: SessionPayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signValue(encodedPayload)}`;
}

function signValue(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getLoginRateLimitKeys(email: string, request: Request) {
  return [
    getLoginRateLimitKey("email", normalizeEmail(email)),
    getLoginRateLimitKey("ip", getRequestIp(request) || "unknown"),
  ];
}

function getLoginRateLimitKey(scope: "email" | "ip", value: string) {
  return createHash("sha256").update(`login:${scope}:${value}`).digest("hex");
}

function parseCookieHeader(cookieHeader: string | null) {
  const cookies: Record<string, string> = {};

  for (const part of (cookieHeader || "").split(";")) {
    const [name, ...rest] = part.trim().split("=");

    if (!name || rest.length === 0) {
      continue;
    }

    cookies[name] = rest.join("=");
  }

  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    maxAge: number;
    path: string;
    sameSite: "lax";
    secure: boolean;
  },
) {
  const parts = [
    `${name}=${value}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");

  return parts.join("; ");
}

function getRequestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

function toAuthUser(row: UserRow) {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
  };
}

async function claimDefaultUserData(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, defaultUserId: string, userId: string) {
  if (defaultUserId === userId) {
    return;
  }

  const userScopedTables = [
    "captures",
    "processing_jobs",
    "extracted_contents",
    "sources",
    "wiki_pages",
    "chunks",
    "audit_logs",
    "ask_histories",
    "knowledge_discoveries",
    "knowledge_edges",
    "knowledge_recommendations",
    "wiki_merge_histories",
    "model_call_logs",
    "smart_quota_ledger",
    "sift_gateway_tokens",
    "sift_gateway_usage_ledger",
    "manual_refunds",
    "support_case_notes",
    "product_events",
  ];

  for (const table of userScopedTables) {
    await updateClaimColumnIfTableExists(client, table, "user_id", defaultUserId, userId);
  }

  await updateClaimColumnIfTableExists(client, "manual_refunds", "requested_by_user_id", defaultUserId, userId);
  await updateClaimColumnIfTableExists(client, "manual_refunds", "processed_by_user_id", defaultUserId, userId);
  await updateClaimColumnIfTableExists(client, "support_case_notes", "admin_user_id", defaultUserId, userId);

  await client.query(
    `
      insert into user_model_settings (
        user_id,
        mode,
        text_base_url,
        text_api_key,
        text_model,
        text_thinking,
        text_reasoning_effort,
        embedding_base_url,
        embedding_api_key,
        embedding_model,
        embedding_dimensions,
        vision_base_url,
        vision_api_key,
        vision_model,
        created_at,
        updated_at
      )
      select
        $2,
        mode,
        text_base_url,
        text_api_key,
        text_model,
        text_thinking,
        text_reasoning_effort,
        embedding_base_url,
        embedding_api_key,
        embedding_model,
        embedding_dimensions,
        vision_base_url,
        vision_api_key,
        vision_model,
        created_at,
        updated_at
      from user_model_settings
      where user_id = $1
      on conflict (user_id) do nothing
    `,
    [defaultUserId, userId],
  );
  await client.query("delete from user_model_settings where user_id = $1", [defaultUserId]);

  await client.query(
    `
      insert into smart_quota_accounts (
        user_id,
        plan_code,
        enforcement_mode,
        monthly_credit_limit,
        period_anchor_day,
        quota_source,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_subscription_status,
        created_at,
        updated_at
      )
      select
        $2,
        plan_code,
        enforcement_mode,
        monthly_credit_limit,
        period_anchor_day,
        quota_source,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_subscription_status,
        created_at,
        updated_at
      from smart_quota_accounts
      where user_id = $1
      on conflict (user_id) do nothing
    `,
    [defaultUserId, userId],
  );
  await client.query("delete from smart_quota_accounts where user_id = $1", [defaultUserId]);
}

async function updateClaimColumnIfTableExists(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  table: string,
  column: string,
  defaultUserId: string,
  userId: string,
) {
  try {
    await client.query(`update ${table} set ${column} = $2 where ${column} = $1`, [defaultUserId, userId]);
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }
}

function isMissingRelationError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01");
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
