import { query } from "@/lib/db";
import type { Json } from "@/types/database";

export interface AuditLogInput {
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  status: "success" | "failure" | "denied";
  metadata?: Json;
  request?: Request;
}

export async function writeAuditLog(input: AuditLogInput) {
  try {
    await query(
      `
        insert into audit_logs (
          user_id,
          action,
          resource_type,
          resource_id,
          status,
          metadata,
          ip_address,
          user_agent
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      `,
      [
        input.userId,
        input.action,
        input.resourceType,
        input.resourceId || null,
        input.status,
        JSON.stringify(input.metadata || {}),
        input.request ? getRequestIp(input.request) : null,
        input.request?.headers.get("user-agent") || null,
      ],
    );
  } catch (error) {
    console.error("Failed to write audit log:", error);
  }
}

function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return request.headers.get("x-real-ip");
}
