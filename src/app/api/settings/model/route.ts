import { NextResponse } from "next/server";
import { z } from "zod";
import { modelSettingsInputSchema, saveUserModelSettings } from "@/lib/model-settings";
import { getUserContextFromRequest } from "@/lib/user-context";

export async function POST(request: Request) {
  try {
    const body = modelSettingsInputSchema.parse(await request.json());
    const userContext = getUserContextFromRequest(request);
    const settings = await saveUserModelSettings(userContext.userId, body);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid model settings" }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown settings error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
