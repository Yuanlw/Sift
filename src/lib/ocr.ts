import { getEffectiveModelConfig } from "@/lib/model-settings";
import { countTextChars, recordModelCall, type ModelCallContext, type ModelUsagePayload } from "@/lib/model-usage";
import { assertSmartQuotaAvailable, estimateSmartQuotaCredits } from "@/lib/smart-quota";
import {
  getFilenameFromCaptureUploadUrl,
  getMimeTypeFromCaptureUploadFilename,
  isRemoteImageUrl,
  readCaptureUpload,
} from "@/lib/upload-storage";
import type { RawAttachment } from "@/types/database";

interface VisionContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

type ChatContent =
  | string
  | Array<{
      type?: string;
      text?: string;
      content?: string;
    }>
  | null
  | undefined;

export async function extractTextFromImages(input: {
  attachments: RawAttachment[];
  fileUrl?: string | null;
  modelContext?: ModelCallContext;
}) {
  const imageAttachments = collectImageAttachments(input);

  if (imageAttachments.length === 0) {
    return null;
  }

  const imageContents = await Promise.all(imageAttachments.slice(0, 6).map(toVisionImageContent));
  const content: VisionContent[] = [
    {
      type: "text",
      text: "请做 OCR，只输出图片里的文字。",
    },
    ...imageContents,
  ];

  const config = await getEffectiveModelConfig(input.modelContext?.userId);
  const quotaContext = input.modelContext
    ? {
        ...input.modelContext,
        metadata: {
          ...input.modelContext.metadata,
          image_count: imageAttachments.length,
        },
      }
    : input.modelContext;
  const inputChars = countTextChars({
    imageCount: imageAttachments.length,
    prompt: "ocr",
  });
  if (input.modelContext?.userId) {
    await assertSmartQuotaAvailable(
      input.modelContext.userId,
      config.mode,
      estimateSmartQuotaCredits({
        context: quotaContext!,
        inputChars,
        requestCount: 1,
      }),
    );
  }
  const startedAt = Date.now();
  const body = {
    model: config.vision.model,
    messages: [
      {
        role: "user",
        content,
      },
    ],
    temperature: 0,
    stream: false,
  };

  try {
    const response = await fetch(`${trimTrailingSlash(config.vision.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.vision.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Vision OCR request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: ChatContent; reasoning_content?: string | null } }>;
      usage?: ModelUsagePayload;
    };
    const text = extractOcrText(data);

    if (!text) {
      throw new Error("Vision OCR response did not include text content.");
    }

    await recordModelCall({
      baseUrl: config.vision.baseUrl,
      context: quotaContext,
      durationMs: Date.now() - startedAt,
      inputChars,
      model: config.vision.model,
      modelMode: config.mode,
      outputChars: text.length,
      provider: config.provider,
      requestCount: 1,
      status: "success",
      usage: data.usage || null,
    });

    return {
      text,
      imageCount: imageAttachments.length,
    };
  } catch (error) {
    await recordModelCall({
      baseUrl: config.vision.baseUrl,
      context: quotaContext,
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : "Unknown OCR error",
      inputChars,
      model: config.vision.model,
      modelMode: config.mode,
      outputChars: null,
      provider: config.provider,
      requestCount: 1,
      status: "failed",
    });
    throw error;
  }
}

function extractOcrText(data: { choices?: Array<{ message?: { content?: ChatContent; reasoning_content?: string | null } }> }) {
  const message = data.choices?.[0]?.message;
  const contentText = normalizeChatContent(message?.content);
  const reasoningText = normalizeChatContent(message?.reasoning_content);
  return (contentText || reasoningText)?.trim() || null;
}

function normalizeChatContent(content: ChatContent) {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text || part.content || "")
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function collectImageAttachments(input: { fileUrl?: string | null; attachments: RawAttachment[] }) {
  const attachments = new Map<string, RawAttachment>();

  for (const attachment of input.attachments) {
    if (isImageAttachment(attachment)) {
      attachments.set(attachment.url, attachment);
    }
  }

  if (input.fileUrl && attachments.size === 0 && isRemoteImageUrl(input.fileUrl)) {
    attachments.set(input.fileUrl, {
      kind: "image",
      url: input.fileUrl,
      storage: "remote",
    });
  }

  return Array.from(attachments.values());
}

async function toVisionImageContent(attachment: RawAttachment): Promise<VisionContent> {
  return {
    type: "image_url",
    image_url: {
      url: await toVisionImageUrl(attachment),
    },
  };
}

async function toVisionImageUrl(attachment: RawAttachment) {
  const filename = getFilenameFromCaptureUploadUrl(attachment.url);

  if (filename) {
    const bytes = await readCaptureUpload(filename);
    const mimeType = attachment.mime_type || getMimeTypeFromCaptureUploadFilename(filename);
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  }

  if (isRemoteImageUrl(attachment.url)) {
    return attachment.url;
  }

  throw new Error(`Unsupported image URL: ${attachment.url}`);
}

function isImageAttachment(attachment: RawAttachment) {
  return (
    attachment.kind === "image" ||
    Boolean(attachment.mime_type?.startsWith("image/")) ||
    isRemoteImageUrl(attachment.url) ||
    Boolean(getFilenameFromCaptureUploadUrl(attachment.url))
  );
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
