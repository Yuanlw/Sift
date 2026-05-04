import { headers } from "next/headers";
import { getServerEnv } from "@/lib/env";

export interface UserContext {
  userId: string;
  source: "default" | "trusted_header";
}

export function getUserContextFromRequest(request: Request): UserContext {
  return resolveUserContext((name) => request.headers.get(name));
}

export function getUserContextFromHeaders(): UserContext {
  const headerStore = headers();
  return resolveUserContext((name) => headerStore.get(name));
}

function resolveUserContext(readHeader: (name: string) => string | null): UserContext {
  const env = getServerEnv();

  if (!env.SIFT_TRUST_USER_HEADER) {
    return {
      userId: env.SIFT_SINGLE_USER_ID,
      source: "default",
    };
  }

  const headerValue = readHeader(env.SIFT_USER_ID_HEADER);

  if (headerValue && isUuid(headerValue)) {
    return {
      userId: headerValue,
      source: "trusted_header",
    };
  }

  return {
    userId: env.SIFT_SINGLE_USER_ID,
    source: "default",
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
