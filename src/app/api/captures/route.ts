import { NextResponse } from "next/server";
import { z } from "zod";
import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";

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
  const body = createCaptureSchema.parse(await request.json());
  const env = getServerEnv();
  const supabase = createServiceClient();
  const type = body.url ? "link" : "text";

  const { data: capture, error: captureError } = await supabase
    .from("captures")
    .insert({
      user_id: env.SIFT_SINGLE_USER_ID,
      type,
      raw_url: body.url || null,
      raw_text: body.text || null,
      note: body.note || null,
      status: "queued",
    })
    .select()
    .single();

  if (captureError) {
    return NextResponse.json({ error: captureError.message }, { status: 500 });
  }

  const { error: jobError } = await supabase.from("processing_jobs").insert({
    capture_id: capture.id,
    user_id: env.SIFT_SINGLE_USER_ID,
    job_type: "process_capture",
    status: "queued",
  });

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  await inngest.send({
    name: "capture/process.requested",
    data: {
      captureId: capture.id,
    },
  });

  return NextResponse.json({ capture });
}
