import type { Capture } from "@/types/database";

export function ensureRawImageTextVisibleInWiki(capture: Capture, markdown: string, extractedText: string) {
  if (!captureHasImageInput(capture) || !extractedText.trim()) {
    return markdown;
  }

  if (containsMeaningfulExtractedText(markdown, extractedText)) {
    return markdown;
  }

  return [
    markdown.trim(),
    "",
    "---",
    "",
    "## 图片 OCR 原文",
    "",
    "以下为图片解析得到的原始文本，保留用于核对、搜索和追溯。",
    "",
    "```text",
    extractedText.trim(),
    "```",
  ].join("\n");
}

function captureHasImageInput(capture: Capture) {
  return capture.type === "image" || (Array.isArray(capture.raw_attachments) && capture.raw_attachments.length > 0);
}

function containsMeaningfulExtractedText(markdown: string, extractedText: string) {
  const normalizedMarkdown = normalizeComparableText(markdown);
  const normalizedExtracted = normalizeComparableText(extractedText);

  if (!normalizedExtracted) {
    return true;
  }

  const probe = normalizedExtracted.slice(0, Math.min(120, normalizedExtracted.length));
  return probe.length >= 24 && normalizedMarkdown.includes(probe);
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, "");
}
