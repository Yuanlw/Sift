import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { MissingEnvError } from "@/lib/env";
import { validateSameOriginRequest } from "@/lib/request-security";
import { getUserContextFromRequest } from "@/lib/user-context";

const updateNoteSchema = z.object({
  note: z
    .string()
    .trim()
    .max(2000, "备注最多 2000 个字符。")
    .optional()
    .nullable()
    .transform((value) => value || null),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    if (!isUuid(params.id)) {
      return NextResponse.json({ error: "Invalid capture id." }, { status: 400 });
    }

    const body = updateNoteSchema.parse(await request.json());
    const userContext = await getUserContextFromRequest(request);
    const result = await query<{ id: string }>(
      `
        update captures
        set note = $3,
            raw_payload = coalesce(raw_payload, '{}'::jsonb)
              || jsonb_build_object('noteUpdatedAt', now())
        where id = $1 and user_id = $2
        returning id
      `,
      [params.id, userContext.userId, body.note],
    );

    if (!result.rows[0]) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "capture.note",
        resourceType: "capture",
        resourceId: params.id,
        status: "denied",
        request,
      });
      return NextResponse.json({ error: "Capture not found." }, { status: 404 });
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: "capture.note",
      resourceType: "capture",
      resourceId: params.id,
      status: "success",
      request,
      metadata: {
        has_note: Boolean(body.note),
      },
    });

    return NextResponse.json({
      status: "saved",
      message: "备注已保存。",
    });
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return NextResponse.json(
        {
          error: "Sift 还没有完成本地环境配置。",
          missingKeys: error.missingKeys,
        },
        { status: 503 },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid input" }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
