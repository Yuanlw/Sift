import { query } from "@/lib/db";
import type { Json } from "@/types/database";

export type ProductEventName =
  | "ask.global"
  | "capture.created"
  | "capture.entry.viewed"
  | "signup.completed"
  | "source.created"
  | "source.updated"
  | "wiki.created"
  | "wiki.updated";

export async function recordProductEvent(input: {
  eventName: ProductEventName;
  metadata?: Record<string, Json | undefined>;
  resourceId?: string | null;
  resourceType?: string | null;
  source?: string | null;
  userId?: string | null;
}) {
  try {
    await query(
      `
        insert into product_events (
          user_id,
          event_name,
          resource_type,
          resource_id,
          source,
          metadata
        )
        values ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        input.userId || null,
        input.eventName,
        input.resourceType || null,
        input.resourceId || null,
        input.source || null,
        JSON.stringify(input.metadata || {}),
      ],
    );
  } catch (error) {
    if (!isMissingRelationError(error)) {
      console.warn("Failed to record product event", error);
    }
  }
}

function isMissingRelationError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P01";
}
