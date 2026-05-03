import { NextResponse } from "next/server";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { query } from "@/lib/db";
import { getServerEnv, MissingEnvError } from "@/lib/env";
import type { Capture } from "@/types/database";

const createCaptureSchema = z
  .object({
    url: z.string().trim().optional().nullable(),
    text: z.string().trim().optional().nullable(),
    note: z.string().trim().optional().nullable(),
  })
  .refine((data) => Boolean(data.url || data.text), {
    message: "Provide a URL or text.",
  });

export async function POST(request: Request) {
  try {
    const body = createCaptureSchema.parse(await request.json());
    const env = getServerEnv();
    const type = body.url ? "link" : "text";

    const captureResult = await query<Capture>(
      `
        insert into captures (user_id, type, raw_url, raw_text, note, status)
        values ($1, $2, $3, $4, $5, 'queued')
        returning *
      `,
      [env.SIFT_SINGLE_USER_ID, type, body.url || null, body.text || null, body.note || null],
    );
    const capture = captureResult.rows[0];

    await query(
      `
        insert into processing_jobs (capture_id, user_id, job_type, status)
        values ($1, $2, 'process_capture', 'queued')
      `,
      [capture.id, env.SIFT_SINGLE_USER_ID],
    );

    await inngest.send({
      name: "capture/process.requested",
      data: {
        captureId: capture.id,
      },
    });

    return NextResponse.json({ capture });
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
