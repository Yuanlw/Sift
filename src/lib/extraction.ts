import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { Database } from "@/types/database";

type Capture = Database["public"]["Tables"]["captures"]["Row"];

export async function extractCaptureText(capture: Capture) {
  if (capture.raw_text?.trim()) {
    return {
      title: "手动保存的文本",
      text: capture.raw_text.trim(),
      metadata: {
        extraction: "raw_text",
      },
    };
  }

  if (capture.raw_url) {
    return extractUrl(capture.raw_url);
  }

  if (capture.file_url) {
    return {
      title: "图片资料",
      text: `图片资料已保存：${capture.file_url}`,
      metadata: {
        extraction: "image_placeholder",
        file_url: capture.file_url,
      },
    };
  }

  throw new Error("Capture has no extractable content.");
}

async function extractUrl(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SiftBot/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();

  return {
    title: article?.title || new URL(url).hostname,
    text: article?.textContent?.trim() || dom.window.document.body.textContent?.trim() || "",
    metadata: {
      extraction: article ? "readability" : "body_text",
      url,
      site_name: article?.siteName,
      excerpt: article?.excerpt,
    },
  };
}
