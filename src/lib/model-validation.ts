import type { ModelSettingsTarget } from "@/lib/model-settings";
import type { ModelUsagePayload } from "@/lib/model-usage";

export async function validateModelConfig(input: {
  apiKey: string;
  baseUrl: string;
  dimensions?: number | null;
  model: string;
  target: ModelSettingsTarget;
}) {
  const startedAt = Date.now();

  if (input.target === "embedding") {
    const response = await fetch(`${trimTrailingSlash(input.baseUrl)}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: ["Sift model configuration validation."],
        model: input.model,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding validation failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding?: number[] }>; usage?: ModelUsagePayload };
    const dimensions = data.data?.[0]?.embedding?.length || 0;

    if (!dimensions) {
      throw new Error("Embedding validation failed: response did not include an embedding vector.");
    }

    if (input.dimensions && dimensions !== input.dimensions) {
      throw new Error(`Embedding dimensions mismatch: expected ${input.dimensions}, got ${dimensions}.`);
    }

    return {
      dimensions,
      durationMs: Date.now() - startedAt,
      usage: data.usage || null,
    };
  }

  const content = input.target === "vision" ? buildVisionValidationContent() : "只回复 OK。";
  const response = await fetch(`${trimTrailingSlash(input.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          content,
          role: "user",
        },
      ],
      model: input.model,
      stream: false,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`${input.target === "vision" ? "Vision" : "Text"} validation failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: ModelUsagePayload;
  };
  const output = data.choices?.[0]?.message?.content || "";

  if (!output) {
    throw new Error("Validation failed: response did not include message content.");
  }

  return {
    durationMs: Date.now() - startedAt,
    outputPreview: output.slice(0, 80),
    usage: data.usage || null,
  };
}

function buildVisionValidationContent() {
  return [
    {
      text: "请识别这张图片里的文字，只回复识别结果。",
      type: "text",
    },
    {
      image_url: {
        url: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iOTAiPjxyZWN0IHdpZHRoPSIyNDAiIGhlaWdodD0iOTAiIGZpbGw9IndoaXRlIi8+PHRleHQgeD0iMjQiIHk9IjU0IiBmb250LXNpemU9IjMyIiBmaWxsPSJibGFjayI+U2lmdCBPSzwvdGV4dD48L3N2Zz4=",
      },
      type: "image_url",
    },
  ];
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
