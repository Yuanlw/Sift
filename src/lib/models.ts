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
    "只输出一个 JSON 对象，不要输出 Markdown 代码块，不要在 JSON 前后添加任何解释。",
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

  const content = await createChatCompletion({
    model: env.MODEL_TEXT_MODEL,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    responseFormat: "json_object",
  });

  return JSON.parse(extractJsonObject(content)) as KnowledgeDraft;
}

export async function embedTexts(texts: string[]) {
  if (texts.length === 0) {
    return [];
  }

  const env = getServerEnv();
  const response = await fetch(`${env.MODEL_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MODEL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.MODEL_EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((item) => item.embedding);
}

async function createChatCompletion(input: {
  model: string;
  messages: Array<{ role: "user" | "system" | "assistant"; content: string }>;
  responseFormat?: "json_object";
}) {
  const env = getServerEnv();
  const response = await fetch(`${env.MODEL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MODEL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: 0.2,
      response_format: input.responseFormat ? { type: input.responseFormat } : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Chat completion request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Model response did not include message content.");
  }

  return content;
}

function extractJsonObject(input: string) {
  const unfenced = input
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    JSON.parse(unfenced);
    return unfenced;
  } catch {
    // Some local models obey JSON mode loosely and append notes after the object.
  }

  const start = unfenced.indexOf("{");

  if (start === -1) {
    throw new Error(`Model response did not include a JSON object: ${unfenced.slice(0, 240)}`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < unfenced.length; index += 1) {
    const char = unfenced[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return unfenced.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Model response JSON object was incomplete: ${unfenced.slice(0, 240)}`);
}
