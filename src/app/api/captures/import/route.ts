import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { CaptureValidationError, createCapture, normalizeHttpUrl } from "@/lib/captures/create-capture";
import { query } from "@/lib/db";
import { getServerEnv, MissingEnvError } from "@/lib/env";
import { MAX_CAPTURE_IMPORT_FILES, saveCaptureUploads, UploadValidationError } from "@/lib/upload-storage";
import { getUserContextFromRequest } from "@/lib/user-context";
import type { Json, RawAttachment } from "@/types/database";

const MAX_IMPORT_ITEMS = 100;

const textInput = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => value || null);

const importItemSchema = z.object({
  url: z.string().trim().min(1),
  title: textInput,
  text: textInput,
  note: textInput,
  importedAt: textInput,
  metadata: z.record(z.string()).default({}),
});

const importSchema = z.object({
  source: z.enum(["url_batch", "bookmark_html", "photo_batch", "mixed_import"]).default("url_batch"),
  note: textInput,
  skipDuplicates: z.boolean().default(true),
  items: z.array(importItemSchema).max(MAX_IMPORT_ITEMS, `一次最多导入 ${MAX_IMPORT_ITEMS} 条。`).default([]),
  imageMetadata: z.array(z.object({
    name: textInput,
    lastModified: z.number().int().positive().optional().nullable(),
  })).default([]),
}).refine((data) => data.items.length > 0 || data.source === "photo_batch" || data.source === "mixed_import", {
  message: "请至少提供一个链接或一组截图。",
});

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    const userContext = getUserContextFromRequest(request);
    const parsedRequest = await parseImportRequest(request);
    const body = importSchema.parse(parsedRequest.payload);

    if (body.items.length === 0 && parsedRequest.attachments.length === 0) {
      return NextResponse.json({ error: "请至少提供一个链接或一组截图。" }, { status: 400 });
    }

    const batchId = randomUUID();
    const normalizedImport = normalizeImportItems(body.items);
    const normalizedItems = normalizedImport.items;
    const existingUrls = body.skipDuplicates
      ? await loadExistingCaptureUrls(userContext.userId, normalizedItems.map((item) => item.normalizedUrl))
      : new Set<string>();
    const created: Array<{ id: string; kind: "image" | "link"; url: string | null }> = [];
    const skipped: Array<{ reason: "duplicate" | "invalid_url"; title: string | null; url: string }> = [
      ...normalizedImport.duplicates,
      ...normalizedImport.invalid,
      ...normalizedItems
        .filter((item) => existingUrls.has(item.normalizedUrl))
        .map((item) => ({ reason: "duplicate" as const, title: item.title, url: item.normalizedUrl })),
    ];

    for (const item of normalizedItems) {
      if (existingUrls.has(item.normalizedUrl)) {
        continue;
      }

      const result = await createCapture({
        url: item.normalizedUrl,
        text: buildImportedText(item),
        note: item.note || body.note,
        fileUrl: null,
        attachments: [],
        attachmentSource: "json",
        sourceApp: `import:${body.source}`,
        extraPayload: {
          importBatchId: batchId,
          importSource: body.source,
          importedTitle: item.title,
          importedAt: item.importedAt,
          importMetadata: item.metadata,
        },
      }, {
        dispatcher: env.JOB_DISPATCHER,
        userId: userContext.userId,
      });
      created.push({ id: result.capture.id, kind: "link", url: item.normalizedUrl });
    }

    for (const photo of buildPhotoImportItems(parsedRequest.attachments, body.imageMetadata)) {
      const result = await createCapture({
        url: null,
        text: null,
        note: body.note,
        fileUrl: photo.attachment.url,
        attachments: [photo.attachment],
        attachmentSource: "multipart",
        sourceApp: "import:photo_batch",
        extraPayload: {
          importBatchId: batchId,
          importSource: "photo_batch",
          importedTitle: photo.attachment.name || null,
          importedAt: photo.importedAt,
          importMetadata: photo.metadata,
        },
      }, {
        dispatcher: env.JOB_DISPATCHER,
        userId: userContext.userId,
      });
      created.push({ id: result.capture.id, kind: "image", url: null });
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: "capture.import",
      resourceType: "capture",
      resourceId: null,
      status: "success",
      request,
      metadata: {
        batch_id: batchId,
        source: body.source,
        created_count: created.length,
        image_count: parsedRequest.attachments.length,
        skipped_count: skipped.length,
        submitted_count: body.items.length + parsedRequest.attachments.length,
        user_context_source: userContext.source,
      },
    });

    return NextResponse.json({
      batchId,
      created,
      skipped,
      summary: {
        created: created.length,
        images: created.filter((item) => item.kind === "image").length,
        invalid: skipped.filter((item) => item.reason === "invalid_url").length,
        links: created.filter((item) => item.kind === "link").length,
        skippedDuplicates: skipped.filter((item) => item.reason === "duplicate").length,
        submitted: body.items.length + parsedRequest.attachments.length,
      },
    }, { status: 201 });
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

    if (error instanceof CaptureValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof UploadValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function parseImportRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.includes("multipart/form-data")) {
    return {
      attachments: [] as RawAttachment[],
      payload: await request.json(),
    };
  }

  const formData = await request.formData();
  const attachments = await saveCaptureUploads(formData.getAll("files"), { maxFiles: MAX_CAPTURE_IMPORT_FILES });

  return {
    attachments,
    payload: {
      source: formData.get("source"),
      note: formData.get("note"),
      skipDuplicates: formData.get("skipDuplicates") !== "false",
      items: parseJsonFormField(formData.get("items"), []),
      imageMetadata: parseJsonFormField(formData.get("imageMetadata"), []),
    },
  };
}

function normalizeImportItems(items: z.infer<typeof importItemSchema>[]) {
  const seen = new Set<string>();
  const normalized: Array<z.infer<typeof importItemSchema> & { normalizedUrl: string }> = [];
  const duplicates: Array<{ reason: "duplicate"; title: string | null; url: string }> = [];
  const invalid: Array<{ reason: "invalid_url"; title: string | null; url: string }> = [];

  for (const item of items) {
    const normalizedUrl = normalizeHttpUrl(item.url);

    if (!normalizedUrl) {
      invalid.push({ reason: "invalid_url", title: item.title, url: item.url });
      continue;
    }

    if (seen.has(normalizedUrl)) {
      duplicates.push({ reason: "duplicate", title: item.title, url: normalizedUrl });
      continue;
    }

    seen.add(normalizedUrl);
    normalized.push({
      ...item,
      normalizedUrl,
    });
  }

  return {
    duplicates,
    invalid,
    items: normalized,
  };
}

async function loadExistingCaptureUrls(userId: string, urls: string[]) {
  if (urls.length === 0) {
    return new Set<string>();
  }

  const result = await query<{ raw_url: string }>(
    `
      select raw_url
      from captures
      where user_id = $1
        and raw_url = any($2::text[])
    `,
    [userId, urls],
  );

  return new Set(result.rows.map((row) => row.raw_url));
}

function buildImportedText(item: z.infer<typeof importItemSchema>) {
  return [
    item.title ? `标题：${item.title}` : null,
    item.text,
  ]
    .filter(Boolean)
    .join("\n\n") || null;
}

function buildPhotoImportItems(
  attachments: RawAttachment[],
  imageMetadata: Array<{ name: string | null; lastModified?: number | null }>,
) {
  return attachments.map((attachment, index) => {
    const metadata = imageMetadata[index];
    const importedAt = metadata?.lastModified ? new Date(metadata.lastModified).toISOString() : new Date().toISOString();

    return {
      attachment,
      importedAt,
      metadata: {
        fileName: attachment.name || metadata?.name || "",
        lastModified: metadata?.lastModified ? String(metadata.lastModified) : "",
      } satisfies Record<string, Json>,
    };
  });
}

function parseJsonFormField(value: FormDataEntryValue | null, fallback: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
