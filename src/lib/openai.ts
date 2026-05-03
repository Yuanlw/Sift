import { getServerEnv } from "@/lib/env";

export interface KnowledgeDraft {
  title: string;
  summary: string;
  wikiTitle: string;
  wikiMarkdown: string;
}

export async function generateKnowledgeDraft(input: {
  title: string;
  text: string;
  note?: string | null;
  originalUrl?: string | null;
}): Promise<KnowledgeDraft> {
  const env = getServerEnv();
  const prompt = [
    "你是 Sift 的知识库维护助手。",
    "请把输入资料整理成可追溯的 Source 摘要和一篇 draft WikiPage。",
    "只输出 JSON，不要输出 Markdown 代码块。",
    "",
    "JSON 字段：title, summary, wikiTitle, wikiMarkdown。",
    "",
    `资料标题：${input.title}`,
    input.originalUrl ? `原始链接：${input.originalUrl}` : "",
    input.note ? `用户备注：${input.note}` : "",
    "",
    "资料正文：",
    input.text.slice(0, 18000),
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_TEXT_MODEL,
      input: prompt,
      text: {
        format: {
          type: "json_object",
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI draft generation failed: ${response.status}`);
  }

  const data = (await response.json()) as { output_text?: string };
  const outputText = data.output_text;

  if (!outputText) {
    throw new Error("OpenAI response did not include output_text.");
  }

  return JSON.parse(outputText) as KnowledgeDraft;
}

export async function embedTexts(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const env = getServerEnv();
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embedding failed: ${response.status}`);
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((item) => item.embedding);
}
