import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadActiveSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getServerEnv } from "@/lib/env";

export interface UserContext {
  displayName?: string | null;
  email?: string | null;
  userId: string;
  source: "agent_api_key" | "default" | "session" | "trusted_header";
}

export async function getUserContextFromRequest(request: Request): Promise<UserContext> {
  return resolveUserContext((name) => request.headers.get(name), { agentFallback: false, optional: false });
}

export async function getAgentUserContextFromRequest(request: Request): Promise<UserContext> {
  return resolveUserContext((name) => request.headers.get(name), { agentFallback: true, optional: true });
}

export async function getUserContextFromHeaders(): Promise<UserContext> {
  const headerStore = headers();

  try {
    return await resolveUserContext((name) => headerStore.get(name), { agentFallback: false, optional: false });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/login");
    }

    throw error;
  }
}

export async function getOptionalUserContextFromHeaders(): Promise<UserContext | null> {
  try {
    const headerStore = headers();
    return resolveUserContext((name) => headerStore.get(name), { agentFallback: false, optional: true });
  } catch {
    return null;
  }
}

async function resolveUserContext(
  readHeader: (name: string) => string | null,
  options: { agentFallback: boolean; optional: boolean },
): Promise<UserContext> {
  const env = getServerEnv();
  const session = await loadActiveSessionUser(readHeader("cookie"));

  if (session) {
    return {
      displayName: session.displayName,
      email: session.email,
      source: "session",
      userId: session.id,
    };
  }

  if (env.SIFT_AGENT_API_KEY && readHeader("authorization") === `Bearer ${env.SIFT_AGENT_API_KEY}`) {
    return {
      source: "agent_api_key",
      userId: await resolveAgentApiUserId(env.SIFT_SINGLE_USER_ID),
    };
  }

  if (env.SIFT_TRUST_USER_HEADER) {
    const headerValue = readHeader(env.SIFT_USER_ID_HEADER);

    if (headerValue && isUuid(headerValue)) {
      return {
        source: "trusted_header",
        userId: headerValue,
      };
    }
  }

  if (options.agentFallback) {
    return {
      source: env.SIFT_AGENT_API_KEY ? "agent_api_key" : "default",
      userId: await resolveAgentApiUserId(env.SIFT_SINGLE_USER_ID),
    };
  }

  if (!env.SIFT_REQUIRE_AUTH || options.optional) {
    return {
      source: "default",
      userId: env.SIFT_SINGLE_USER_ID,
    };
  }

  throw new AuthenticationRequiredError();
}

async function resolveAgentApiUserId(defaultUserId: string) {
  const env = getServerEnv();

  if (env.SIFT_AGENT_USER_ID) {
    return env.SIFT_AGENT_USER_ID;
  }

  try {
    const { rows } = await query<{ id: string; total: string }>(
      `
        select id, count(*) over ()::text as total
        from users
        order by created_at asc
        limit 2
      `,
    );

    if (rows.length === 1 && Number(rows[0].total) === 1) {
      return rows[0].id;
    }

    if (rows.length > 1) {
      throw new AgentIdentityAmbiguousError();
    }
  } catch {
    if (env.SIFT_REQUIRE_AUTH) {
      throw new AgentIdentityAmbiguousError();
    }

    return defaultUserId;
  }

  return defaultUserId;
}

export class AgentIdentityAmbiguousError extends Error {
  constructor() {
    super("Agent user is ambiguous. Set SIFT_AGENT_USER_ID or use a signed-in session.");
    this.name = "AgentIdentityAmbiguousError";
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "AuthenticationRequiredError";
  }
}
