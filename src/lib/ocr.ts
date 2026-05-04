import { getServerEnv } from "@/lib/env";
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

export async function extractTextFromImages(input: { fileUrl?: string | null; attachments: RawAttachment[] }) {
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

  const env = getServerEnv();
  const response = await fetch(`${trimTrailingSlash(env.MODEL_VISION_BASE_URL)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MODEL_VISION_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.MODEL_VISION_MODEL,
      messages: [
        {
          role: "user",
          content,
        },
      ],
      temperature: 0,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision OCR request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: ChatContent; reasoning_content?: string | null } }>;
  };
  const text = extractOcrText(data);

  if (!text) {
    throw new Error("Vision OCR response did not include text content.");
  }

  return {
    text,
    imageCount: imageAttachments.length,
  };
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
  if (attachment.storage === "local") {
    const filename = getFilenameFromCaptureUploadUrl(attachment.url);

    if (!filename) {
      throw new Error(`Unsupported local image URL: ${attachment.url}`);
    }

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
