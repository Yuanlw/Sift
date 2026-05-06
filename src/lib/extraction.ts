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
      modelContext: {
        userId: capture.user_id,
        stage: "processing",
        role: "vision",
        purpose: "capture.ocr",
        resourceType: "capture",
        resourceId: capture.id,
      },
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
    return extractXUrl(url);
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

async function extractXUrl(url: string) {
  const defuddle = await extractXWithDefuddle(url);

  if (defuddle) {
    return defuddle;
  }

  const jina = await extractXWithJina(url);

  if (jina) {
    return jina;
  }

  return createUrlFallback(url, "X 平台正文暂时无法自动读取。");
}

async function extractXWithDefuddle(url: string) {
  try {
    const response = await fetch(buildDefuddleUrl(url), {
      headers: {
        Accept: "text/markdown,text/plain",
        "User-Agent": "SiftBot/0.1",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return null;
    }

    const markdown = await response.text();
    const parsed = parseFrontMatterMarkdown(markdown);
    const text = normalizePastedText(parsed.body);

    if (!isUsefulXText(text)) {
      return null;
    }

    return {
      title: parsed.frontMatter.title || getXTitle(url, parsed.frontMatter.author),
      text,
      contentFormat: "plain_text",
      method: "x_defuddle",
      status: "extracted",
      metadata: {
        extraction: "x_defuddle",
        url,
        hostname: getHostname(url),
        source_platform: "x",
        title: parsed.frontMatter.title || null,
        author: parsed.frontMatter.author || null,
        site: parsed.frontMatter.site || null,
        published: parsed.frontMatter.published || null,
        description: parsed.frontMatter.description || null,
        word_count: parsed.frontMatter.word_count || null,
      },
      errorMessage: null,
    } satisfies ExtractedCaptureContent;
  } catch {
    return null;
  }
}

async function extractXWithJina(url: string) {
  try {
    const response = await fetch(buildJinaUrl(url), {
      headers: {
        Accept: "text/plain,text/markdown",
        "User-Agent": "SiftBot/0.1",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return null;
    }

    const content = await response.text();
    const parsed = parseJinaMarkdown(content);
    const text = normalizePastedText(extractXPostTextFromJina(parsed.markdown));

    if (!isUsefulXText(text)) {
      return null;
    }

    return {
      title: parsed.title || getXTitle(url, null),
      text,
      contentFormat: "plain_text",
      method: "x_jina",
      status: "extracted",
      metadata: {
        extraction: "x_jina",
        url,
        hostname: getHostname(url),
        source_platform: "x",
        title: parsed.title || null,
        source_url: parsed.sourceUrl || null,
      },
      errorMessage: null,
    } satisfies ExtractedCaptureContent;
  } catch {
    return null;
  }
}

function buildDefuddleUrl(url: string) {
  const parsed = new URL(url);
  return `http://defuddle.md/${parsed.hostname}${parsed.pathname}${parsed.search}`;
}

function buildJinaUrl(url: string) {
  return `https://r.jina.ai/${url}`;
}

function parseFrontMatterMarkdown(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    return {
      body: markdown,
      frontMatter: {} as Record<string, string>,
    };
  }

  return {
    body: match[2],
    frontMatter: parseYamlLikeFrontMatter(match[1]),
  };
}

function parseYamlLikeFrontMatter(value: string) {
  const fields: Record<string, string> = {};

  for (const line of value.split("\n")) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);

    if (!match) {
      continue;
    }

    fields[match[1]] = stripYamlScalarQuotes(match[2].trim());
  }

  return fields;
}

function stripYamlScalarQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseJinaMarkdown(content: string) {
  const markdownMarker = "\nMarkdown Content:\n";
  const markerIndex = content.indexOf(markdownMarker);
  const header = markerIndex >= 0 ? content.slice(0, markerIndex) : content;
  const markdown = markerIndex >= 0 ? content.slice(markerIndex + markdownMarker.length) : content;

  return {
    markdown,
    sourceUrl: header.match(/^URL Source:\s*(.+)$/m)?.[1]?.trim() || null,
    title: normalizeJinaHeaderTitle(header),
  };
}

function normalizeJinaHeaderTitle(header: string) {
  const titleStart = header.indexOf("Title:");

  if (titleStart < 0) {
    return null;
  }

  const afterTitle = header.slice(titleStart + "Title:".length);
  const sourceStart = afterTitle.indexOf("\nURL Source:");
  const title = sourceStart >= 0 ? afterTitle.slice(0, sourceStart) : afterTitle;

  return normalizePastedText(title).replace(/\s+/g, " ").slice(0, 160) || null;
}

function extractXPostTextFromJina(markdown: string) {
  const lines = markdown.split("\n").map((line) => line.trim());
  const handleIndex = lines.findIndex((line) => /^@[\w_]+$/.test(stripMarkdownLinkText(line)));

  if (handleIndex < 0) {
    return markdown;
  }

  const textLines: string[] = [];

  for (const line of lines.slice(handleIndex + 1)) {
    if (!line) {
      if (textLines.length > 0) {
        break;
      }

      continue;
    }

    if (isXJinaStopLine(line)) {
      break;
    }

    textLines.push(stripMarkdownLinkText(line));
  }

  return textLines.length > 0 ? textLines.join("\n") : markdown;
}

function stripMarkdownLinkText(line: string) {
  const match = line.match(/^\[([^\]]+)\]\([^)]+\)$/);
  return match ? match[1] : line;
}

function isXJinaStopLine(line: string) {
  const plain = stripMarkdownLinkText(line);

  return (
    /^(\d{1,2}:\d{2}\s*(AM|PM)|\d{1,2}\s+Views?|New to X\?|Trending now|What.s happening)$/i.test(plain) ||
    line.includes("/analytics)") ||
    line.includes("/status/") && /·/.test(plain)
  );
}

function isUsefulXText(text: string) {
  if (!text || text.length < 8) {
    return false;
  }

  const lower = text.toLowerCase();
  const noisyPhrases = [
    "don’t miss what’s happening",
    "people on x are the first to know",
    "sign up now",
    "create account",
    "already have an account",
  ];

  return !noisyPhrases.some((phrase) => lower.includes(phrase));
}

function getXTitle(url: string, author: string | null | undefined) {
  const statusId = getXStatusId(url);

  if (author) {
    return statusId ? `X ${author}：${statusId}` : `X ${author}`;
  }

  return statusId ? `X 链接：${statusId}` : "X 链接";
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
