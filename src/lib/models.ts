import { getEffectiveModelConfig } from "@/lib/model-settings";
import { countTextChars, recordModelCall, type ModelCallContext, type ModelUsagePayload } from "@/lib/model-usage";
import { assertSmartQuotaAvailable, estimateSmartQuotaCredits } from "@/lib/smart-quota";

export interface KnowledgeDraft {
  title: string;
  summary: string;
  wikiTitle: string;
  wikiMarkdown: string;
}

export interface WikiAnswer {
  answer: string;
  citations: Array<{
    label: string;
    title: string;
    sourceId?: string;
    wikiSlug?: string;
    originalUrl?: string | null;
  }>;
}

export async function generateKnowledgeDraft(input: {
  modelContext?: ModelCallContext;
  title: string;
  text: string;
  note?: string | null;
  originalUrl?: string | null;
}): Promise<KnowledgeDraft> {
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
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    responseFormat: "json_object",
  }, input.modelContext);

  return JSON.parse(extractJsonObject(content)) as KnowledgeDraft;
}

export async function answerWikiQuestion(input: {
  modelContext?: ModelCallContext;
  question: string;
  wikiTitle: string;
  wikiMarkdown: string;
  sources: Array<{
    label: string;
    id: string;
    title: string;
    summary?: string | null;
    originalUrl?: string | null;
    extractedText: string;
  }>;
}): Promise<WikiAnswer> {
  const sourceContext = input.sources
    .map((source) =>
      [
        `[${source.label}] ${source.title}`,
        source.originalUrl ? `原始链接：${source.originalUrl}` : "",
        source.summary ? `摘要：${source.summary}` : "",
        "正文：",
        source.extractedText.slice(0, 10000),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  const prompt = [
    "你是 Sift 的 Wiki 问答助手。",
    "只能根据给定 WikiPage 和 Source 回答，不要编造上下文中不存在的信息。",
    "如果资料不足，请直接说资料不足，并指出还缺什么。",
    "回答要有助于用户复用资料：可以总结、对比、提炼行动点，但必须保留来源标记。",
    "引用来源时使用 [S1]、[S2] 这样的标记。",
    "只输出一个 JSON 对象，不要输出 Markdown 代码块，不要在 JSON 前后添加解释。",
    "",
    "JSON 字段：answer, citations。",
    "citations 是数组，元素字段：label, title, sourceId, originalUrl。",
    "",
    `问题：${input.question}`,
    "",
    `Wiki 标题：${input.wikiTitle}`,
    "Wiki 内容：",
    input.wikiMarkdown.slice(0, 12000),
    "",
    "关联 Sources：",
    sourceContext || "无关联 Source。",
  ].join("\n");

  const content = await createChatCompletion({
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    responseFormat: "json_object",
  }, input.modelContext);

  const parsed = JSON.parse(extractJsonObject(content)) as Partial<WikiAnswer>;
  const citedLabels = new Set(
    Array.from((parsed.answer || "").matchAll(/\[?(S\d+)\]?/gi)).map((match) => match[1].toUpperCase()),
  );
  const citations = input.sources
    .filter((source) => citedLabels.size === 0 || citedLabels.has(source.label.toUpperCase()))
    .map((source) => ({
      label: source.label,
      title: source.title,
      sourceId: source.id,
      originalUrl: source.originalUrl,
    }));

  return {
    answer: parsed.answer || "资料不足，暂时无法回答这个问题。",
    citations,
  };
}

export async function answerKnowledgeBaseQuestion(input: {
  modelContext?: ModelCallContext;
  question: string;
  contexts: Array<{
    label: string;
    title: string;
    parentType: "source" | "wiki_page";
    content: string;
    sourceId?: string | null;
    wikiSlug?: string | null;
    originalUrl?: string | null;
  }>;
}): Promise<WikiAnswer> {
  const contextText = input.contexts
    .map((context) =>
      [
        `[${context.label}] ${context.parentType === "source" ? "Source" : "WikiPage"}：${context.title}`,
        context.originalUrl ? `原始链接：${context.originalUrl}` : "",
        "片段：",
        context.content.slice(0, 1800),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  const prompt = [
    "你是 Sift 的全库问答助手。",
    "你会基于用户的个人知识库片段回答问题，适合处理资料逐渐变多、主题互相交叉的个人知识库。",
    "只能根据给定的召回片段回答，不要编造片段中不存在的信息；历史问答只能作为用户意图线索，不能当作事实依据。",
    "先判断用户问题是在问事实、总结、比较、找资料、还是要行动建议，再组织回答。",
    "如果召回片段不足，请说明资料不足，并给出下一步应该补充或继续追问什么。",
    "回答要像知识库产品的阅读结果，而不是聊天记录：先给一句话结论，再给重点判断，再说明资料盲区或建议追问。",
    "如果资料之间高度重复或来自同一主题，要合并成一条判断，并说明证据重复，不要把重复片段当成多份独立证据。",
    "如果片段之间有冲突或时间先后不清，要直接指出不确定性。",
    "关键判断必须带来源标记，引用格式使用 [K1]、[K2]；没有来源支撑的判断只能放在资料盲区或建议追问里。",
    "answer 字段用简洁 Markdown：固定使用这些小节：**一句话结论**、**重点判断**、**资料盲区**、**建议追问**。",
    "每个重点判断用编号列表，每条尽量控制在 60 字以内。",
    "只输出一个 JSON 对象，不要输出 Markdown 代码块，不要在 JSON 前后添加解释。",
    "",
    "JSON 字段：answer, citations。",
    "citations 是数组，元素字段：label, title, sourceId, wikiSlug, originalUrl。",
    "",
    `问题：${input.question}`,
    "",
    "召回片段：",
    contextText || "没有召回到相关片段。",
  ].join("\n");

  const content = await createChatCompletion({
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    responseFormat: "json_object",
  }, input.modelContext);

  const parsed = JSON.parse(extractJsonObject(content)) as Partial<WikiAnswer>;
  const citedLabels = new Set(
    Array.from((parsed.answer || "").matchAll(/\[?(K\d+)\]?/gi)).map((match) => match[1].toUpperCase()),
  );
  const citations = input.contexts
    .filter((context) => citedLabels.size === 0 || citedLabels.has(context.label.toUpperCase()))
    .map((context) => ({
      label: context.label,
      title: context.title,
      sourceId: context.sourceId || undefined,
      wikiSlug: context.wikiSlug || undefined,
      originalUrl: context.originalUrl,
    }));

  return {
    answer: parsed.answer || "资料不足，暂时无法回答这个问题。",
    citations,
  };
}

export async function embedTexts(texts: string[], modelContext?: ModelCallContext) {
  if (texts.length === 0) {
    return [];
  }

  const config = await getEffectiveModelConfig(modelContext?.userId);
  const inputChars = countTextChars(texts);
  if (modelContext?.userId) {
    await assertSmartQuotaAvailable(
      modelContext.userId,
      config.mode,
      estimateSmartQuotaCredits({
        context: modelContext,
        inputChars,
        requestCount: texts.length,
      }),
    );
  }
  const startedAt = Date.now();
  const body = {
    model: config.embedding.model,
    input: texts,
  };

  try {
    const response = await fetch(`${trimTrailingSlash(config.embedding.baseUrl)}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.embedding.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      usage?: ModelUsagePayload;
    };
    await recordModelCall({
      baseUrl: config.embedding.baseUrl,
      context: modelContext,
      durationMs: Date.now() - startedAt,
      inputChars,
      model: config.embedding.model,
      modelMode: config.mode,
      outputChars: null,
      provider: config.provider,
      requestCount: texts.length,
      status: "success",
      usage: data.usage || null,
    });

    return data.data.map((item) => item.embedding);
  } catch (error) {
    const message = getModelErrorMessage(error);
    await recordModelCall({
      baseUrl: config.embedding.baseUrl,
      context: modelContext,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
      inputChars,
      model: config.embedding.model,
      modelMode: config.mode,
      outputChars: null,
      provider: config.provider,
      requestCount: texts.length,
      status: "failed",
    });
    throw new Error(message);
  }
}

async function createChatCompletion(input: {
  model?: string;
  messages: Array<{ role: "user" | "system" | "assistant"; content: string }>;
  responseFormat?: "json_object";
}, modelContext?: ModelCallContext) {
  const config = await getEffectiveModelConfig(modelContext?.userId);
  const inputChars = countTextChars(input.messages);
  if (modelContext?.userId) {
    await assertSmartQuotaAvailable(
      modelContext.userId,
      config.mode,
      estimateSmartQuotaCredits({
        context: modelContext,
        inputChars,
        requestCount: 1,
      }),
    );
  }
  const startedAt = Date.now();
  const model = input.model || config.text.model;
  const body = buildChatCompletionBody({ ...input, model }, config);

  try {
    const response = await fetch(`${trimTrailingSlash(config.text.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.text.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (input.responseFormat && response.status >= 400 && response.status < 500) {
        const retryBody = { ...body };
        delete retryBody.response_format;
        const retryResponse = await fetch(`${trimTrailingSlash(config.text.baseUrl)}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.text.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(retryBody),
        });

        if (retryResponse.ok) {
          const retryResult = await readChatCompletionContent(retryResponse);
          await recordModelCall({
            baseUrl: config.text.baseUrl,
            context: modelContext,
            durationMs: Date.now() - startedAt,
            inputChars,
            model,
            modelMode: config.mode,
            outputChars: retryResult.content.length,
            provider: config.provider,
            requestCount: 2,
            status: "success",
            usage: retryResult.usage,
          });
          return retryResult.content;
        }
      }

      throw new Error(`Chat completion request failed: ${response.status} ${errorText}`);
    }

    const result = await readChatCompletionContent(response);
    await recordModelCall({
      baseUrl: config.text.baseUrl,
      context: modelContext,
      durationMs: Date.now() - startedAt,
      inputChars,
      model,
      modelMode: config.mode,
      outputChars: result.content.length,
      provider: config.provider,
      requestCount: 1,
      status: "success",
      usage: result.usage,
    });

    return result.content;
  } catch (error) {
    await recordModelCall({
      baseUrl: config.text.baseUrl,
      context: modelContext,
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : "Unknown chat completion error",
      inputChars,
      model,
      modelMode: config.mode,
      outputChars: null,
      provider: config.provider,
      requestCount: 1,
      status: "failed",
    });
    throw error;
  }
}

function buildChatCompletionBody(
  input: {
    model: string;
    messages: Array<{ role: "user" | "system" | "assistant"; content: string }>;
    responseFormat?: "json_object";
  },
  config: Awaited<ReturnType<typeof getEffectiveModelConfig>>,
) {
  return {
    model: input.model,
    messages: input.messages,
    temperature: 0.2,
    stream: false,
    response_format: input.responseFormat ? { type: input.responseFormat } : undefined,
    thinking: config.text.thinking ? { type: config.text.thinking } : undefined,
    reasoning_effort: config.text.reasoningEffort,
  };
}

async function readChatCompletionContent(response: Response) {
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: ModelUsagePayload;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Model response did not include message content.");
  }

  return {
    content,
    usage: data.usage || null,
  };
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getModelErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Unknown model request error";
  }

  const cause = error.cause;

  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`;
  }

  if (cause && typeof cause === "object") {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
    const syscall = "syscall" in cause && typeof cause.syscall === "string" ? cause.syscall : null;
    const address = "address" in cause && typeof cause.address === "string" ? cause.address : null;
    const port = "port" in cause && (typeof cause.port === "string" || typeof cause.port === "number") ? String(cause.port) : null;
    const parts = [code, syscall, address, port].filter(Boolean);

    if (parts.length > 0) {
      return `${error.message}: ${parts.join(" ")}`;
    }
  }

  return error.message;
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
