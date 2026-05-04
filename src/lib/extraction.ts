import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { extractTextFromImages } from "@/lib/ocr";
import type { Database } from "@/types/database";

type Capture = Database["public"]["Tables"]["captures"]["Row"];

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

  const attachmentUrl = capture.file_url || capture.raw_attachments?.[0]?.url;

  if (attachmentUrl) {
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

  throw new Error("Capture has no extractable content.");
}

async function extractUrl(url: string) {
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
  return {
    title: getUrlTitle(url),
    text: [
      `原始链接：${url}`,
      "",
      "链接正文暂时无法自动提取。可以稍后重试，或补充复制正文、截图、图片资料。",
    ].join("\n"),
    contentFormat: "plain_text",
    method: "url_fallback",
    status: "fallback",
    metadata: {
      extraction: "url_fallback",
      url,
      hostname: getHostname(url),
      source_platform: getSourcePlatform(url),
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

function extractLinks(text: string) {
  return Array.from(new Set(text.match(/https?:\/\/[^\s)）\]}>"']+/g) || []));
}

function getUrlTitle(url: string) {
  const hostname = getHostname(url);
  return hostname || url;
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
