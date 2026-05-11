import { notFound, redirect } from "next/navigation";
import { normalizeEmail } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { getOptionalUserContextFromHeaders, getUserContextFromRequest } from "@/lib/user-context";

export async function requireSupportAdmin(next = "/admin/account-support") {
  const userContext = await getOptionalUserContextFromHeaders();

  if (!userContext?.email) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!isSupportAdminEmail(userContext.email)) {
    notFound();
  }

  return userContext;
}

export function isSupportAdminEmail(email: string | null | undefined) {
  if (!email) {
    return false;
  }

  const admins = getSupportAdminEmails();
  return admins.has(normalizeEmail(email));
}

export async function getSupportAdminFromRequest(request: Request) {
  const userContext = await getUserContextFromRequest(request);

  if (!isSupportAdminEmail(userContext.email)) {
    return null;
  }

  return userContext;
}

function getSupportAdminEmails() {
  const env = getServerEnv();

  return new Set(
    (env.SIFT_ADMIN_EMAILS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map(normalizeEmail),
  );
}
