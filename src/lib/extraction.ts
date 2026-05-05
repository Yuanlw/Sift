import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { extractTextFromImages } from "@/lib/ocr";
import type { Database } from "@/types/database";

type Capture = Database["public"]["Tables"]["captures"]["Row"];
type InputKind = "link" | "text" | "image";

export interface ExtractedCaptureContent {
  title: string;
  text: string;
  contentFormat: "plain_text";
  method: string;
  status: "extracted" | "fallback";
  metadata: Record<string, unknown>;
  errorMessage?: string | null;
}

export async function extractCaptureText(capture: Capture) {
  const inputKinds = getInputKinds(capture);

  if (inputKinds.length > 1) {
    return extractMixedCapture(capture, inputKinds);
  }

  if (capture.raw_text?.trim()) {
    const text = normalizePastedText(capture.raw_text);

    return {
      title: getTextTitle(text),
      text,
      contentFormat: "plain_text",
      method: "raw_text",
      status: "extracted",
      metadata: {
        extraction: "raw_text",
        detected_links: extractLinks(text),
      },
      errorMessage: null,
    } satisfies ExtractedCaptureContent;
  }

  if (capture.raw_url) {
    return extractUrl(capture.raw_url);
  }

  if (getPrimaryAttachmentUrl(capture)) {
    return extractImageCapture(capture);
  }

  throw new Error("Capture has no extractable content.");
}

async function extractMixedCapture(capture: Capture, inputKinds: InputKind[]) {
  const sections: string[] = [];
  const errors: string[] = [];
  const metadata: Record<string, unknown> = {
    extraction: "mixed",
    input_kinds: inputKinds,
    url: capture.raw_url,
    hostname: capture.raw_url ? getHostname(capture.raw_url) : null,
    source_platform: capture.raw_url ? getSourcePlatform(capture.raw_url) : null,
    attachments: capture.raw_attachments || [],
  };

  if (capture.raw_text?.trim()) {
    const text = normalizePastedText(capture.raw_text);
    sections.push(["## 粘贴文本", text].join("\n\n"));
    metadata.detected_links = extractLinks(text);
  }

  if (capture.raw_url) {
    const urlExtracted = await extractUrl(capture.raw_url);
    sections.push(["## 原始链接", capture.raw_url, "", "## 链接正文", urlExtracted.text].join("\n"));
    metadata.link_extraction = {
      method: urlExtracted.method,
      status: urlExtracted.status,
      error: urlExtracted.errorMessage || null,
      metadata: urlExtracted.metadata,
    };

    if (urlExtracted.errorMessage) {
      errors.push(`链接提取：${urlExtracted.errorMessage}`);
    }
  }

  if (getPrimaryAttachmentUrl(capture)) {
    const imageExtracted = await extractImageCapture(capture);
    sections.push(["## 图片 OCR", imageExtracted.text].join("\n\n"));
    metadata.image_extraction = {
      method: imageExtracted.method,
      status: imageExtracted.status,
      error: imageExtracted.errorMessage || null,
      metadata: imageExtracted.metadata,
    };

    if (imageExtracted.errorMessage) {
      errors.push(`图片 OCR：${imageExtracted.errorMessage}`);
    }
  }

  const text = sections.join("\n\n").trim();

  return {
    title: getMixedTitle(capture, text),
    text,
    contentFormat: "plain_text",
    method: "mixed_capture",
    status: text ? "extracted" : "fallback",
    metadata,
    errorMessage: errors.length > 0 ? errors.join("\n") : null,
  } satisfies ExtractedCaptureContent;
}

async function extractImageCapture(capture: Capture) {
  const attachmentUrl = getPrimaryAttachmentUrl(capture);

  if (!attachmentUrl) {
    throw new Error("Capture has no image attachment.");
  }

  try {
    const ocr = await extractTextFromImages({
      fileUrl: capture.file_url,
      attachments: capture.raw_attachments || [],
    });

    if (ocr?.text) {
      return {
        title: getTextTitle(ocr.text) || "图片 OCR 资料",
        text: ocr.text,
        contentFormat: "plain_text",
        method: "vision_ocr",
        status: "extracted",
        metadata: {
          extraction: "vision_ocr",
          file_url: attachmentUrl,
          image_count: ocr.imageCount,
          attachments: capture.raw_attachments || [],
        },
        errorMessage: null,
      } satisfies ExtractedCaptureContent;
    }
  } catch (error) {
    return {
      title: "图片资料",
      text: `图片资料已保存：${attachmentUrl}`,
      contentFormat: "plain_text",
      method: "image_ocr_failed",
      status: "fallback",
      metadata: {
        extraction: "image_ocr_failed",
        file_url: attachmentUrl,
        attachments: capture.raw_attachments || [],
      },
      errorMessage: error instanceof Error ? error.message : "图片 OCR 暂时失败，已先保留原始附件。",
    } satisfies ExtractedCaptureContent;
  }

  return {
    title: "图片资料",
    text: `图片资料已保存：${attachmentUrl}`,
    contentFormat: "plain_text",
    method: "image_placeholder",
    status: "fallback",
    metadata: {
      extraction: "image_placeholder",
      file_url: attachmentUrl,
      attachments: capture.raw_attachments || [],
    },
    errorMessage: "图片 OCR 尚未接入，已先保留原始附件。",
  } satisfies ExtractedCaptureContent;
}

async function extractUrl(url: string) {
  const platform = getSourcePlatform(url);

  if (platform === "x") {
    return createUrlFallback(url, "X 平台暂不支持稳定自动提取正文。");
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "SiftBot/0.1",
      },
    });

    if (!response.ok) {
      return createUrlFallback(url, `Failed to fetch URL: ${response.status}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const text = normalizePastedText(
      article?.textContent || dom.window.document.body.textContent || "",
    );

    if (!text) {
      return createUrlFallback(url, "Fetched page did not include readable text.");
    }

    return {
      title: article?.title || getUrlTitle(url),
      text,
      contentFormat: "plain_text",
      method: article ? "readability" : "body_text",
      status: "extracted",
      metadata: {
        extraction: article ? "readability" : "body_text",
        url,
        hostname: getHostname(url),
        source_platform: getSourcePlatform(url),
        site_name: article?.siteName,
        excerpt: article?.excerpt,
      },
      errorMessage: null,
    } satisfies ExtractedCaptureContent;
  } catch (error) {
    return createUrlFallback(url, error instanceof Error ? error.message : "Unknown URL extraction error");
  }
}

function createUrlFallback(url: string, errorMessage: string) {
  const platform = getSourcePlatform(url);
  const platformLabel = getPlatformLabel(platform);

  return {
    title: getFallbackTitle(url, platformLabel),
    text: getFallbackText(url, platformLabel),
    contentFormat: "plain_text",
    method: "url_fallback",
    status: "fallback",
    metadata: {
      extraction: "url_fallback",
      url,
      hostname: getHostname(url),
      source_platform: platform,
      platform_label: platformLabel,
    },
    errorMessage,
  } satisfies ExtractedCaptureContent;
}

function normalizePastedText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function getTextTitle(text: string) {
  const firstLine = text.split("\n").find((line) => line.trim());

  if (!firstLine) {
    return "手动保存的文本";
  }

  return firstLine.trim().slice(0, 80);
}

function getMixedTitle(capture: Capture, text: string) {
  const noteTitle = capture.note?.trim();

  if (noteTitle) {
    return noteTitle.slice(0, 80);
  }

  if (capture.raw_text?.trim()) {
    return getTextTitle(normalizePastedText(capture.raw_text));
  }

  const textTitle = getTextTitle(text);

  if (textTitle !== "手动保存的文本" && !textTitle.startsWith("## ")) {
    return textTitle;
  }

  if (capture.raw_url) {
    return getUrlTitle(capture.raw_url);
  }

  return "混合保存资料";
}

function getInputKinds(capture: Capture) {
  const kinds: InputKind[] = [];

  if (capture.raw_url) {
    kinds.push("link");
  }

  if (capture.raw_text?.trim()) {
    kinds.push("text");
  }

  if (getPrimaryAttachmentUrl(capture)) {
    kinds.push("image");
  }

  return kinds;
}

function getPrimaryAttachmentUrl(capture: Capture) {
  return capture.file_url || capture.raw_attachments?.[0]?.url || null;
}

function extractLinks(text: string) {
  return Array.from(new Set(text.match(/https?:\/\/[^\s)）\]}>"']+/g) || []));
}

function getUrlTitle(url: string) {
  const hostname = getHostname(url);
  return hostname || url;
}

function getFallbackTitle(url: string, platformLabel: string | null) {
  if (platformLabel) {
    const statusId = getXStatusId(url);
    return statusId ? `${platformLabel} 链接：${statusId}` : `${platformLabel} 链接`;
  }

  return getUrlTitle(url);
}

function getFallbackText(url: string, platformLabel: string | null) {
  if (platformLabel === "X") {
    return [
      `原始链接：${url}`,
      "",
      "X 平台正文暂时无法自动读取，Sift 已先保存原始链接。",
      "如果这条内容很重要，可以补充截图、复制正文，或稍后重新处理。",
    ].join("\n");
  }

  return [
    `原始链接：${url}`,
    "",
    "链接正文暂时无法自动提取，Sift 已先保存原始链接。",
    "可以稍后重试，或补充复制正文、截图、图片资料。",
  ].join("\n");
}

function getPlatformLabel(platform: string) {
  const labels: Record<string, string> = {
    x: "X",
    wechat: "微信公众号",
    xiaohongshu: "小红书",
    medium: "Medium",
    github: "GitHub",
    youtube: "YouTube",
  };

  return labels[platform] || null;
}

function getXStatusId(url: string) {
  try {
    return new URL(url).pathname.match(/\/status\/(\d+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function getSourcePlatform(url: string) {
  const hostname = getHostname(url);

  if (!hostname) {
    return "unknown";
  }

  const compactHost = hostname.replace(/^www\./, "");
  const knownPlatforms: Record<string, string> = {
    "mp.weixin.qq.com": "wechat",
    "xiaohongshu.com": "xiaohongshu",
    "x.com": "x",
    "twitter.com": "x",
    "medium.com": "medium",
    "github.com": "github",
    "youtube.com": "youtube",
    "youtu.be": "youtube",
  };

  return knownPlatforms[compactHost] || compactHost;
}
