import { chunkText, roughTokenCount } from "@/lib/chunk";
import { query } from "@/lib/db";
import { type ExtractedCaptureContent, extractCaptureText } from "@/lib/extraction";
import { createKnowledgeDiscoveriesForProcessedCapture } from "@/lib/knowledge-discoveries";
import { refreshKnowledgeRecommendationsForProcessedCapture } from "@/lib/knowledge-recommendations";
import { embedTexts, generateKnowledgeDraft, type KnowledgeDraft } from "@/lib/models";
import { SmartQuotaExceededError } from "@/lib/smart-quota";
import { toSlug } from "@/lib/slug";
import { toSqlVector } from "@/lib/vector";
import type { Capture, ExtractedContent, ProcessingJob, Source, WikiPage } from "@/types/database";

export async function processCaptureById(captureId: string) {
  const capture = await loadCapture(captureId);
  const job = await ensureProcessingJob(capture);
  let currentStep = "starting";

  if (capture.status === "ignored") {
    await markJobIgnored(job.id);
    return {
      captureId: capture.id,
      sourceId: null,
      wikiPageId: null,
    };
  }

  await query("update captures set status = 'processing' where id = $1", [capture.id]);
  await query(
    `
      update processing_jobs
      set status = 'running', current_step = 'starting', started_at = coalesce(started_at, now())
      where id = $1
    `,
    [job.id],
  );

  try {
    currentStep = capture.raw_url ? "fetch_link" : "extracting";
    const extracted = await runJobStep(job.id, currentStep, async () => {
      const result = await extractCaptureText(capture);
      await saveExtractedContent(capture, result);
      return result;
    });

    currentStep = "structuring";
    await markJobStep(job.id, currentStep, "running");
    const draft = await withTimeout(
      generateKnowledgeDraft({
        modelContext: {
          userId: capture.user_id,
          stage: "processing",
          role: "text",
          purpose: "capture.structure",
          resourceType: "capture",
          resourceId: capture.id,
        },
        title: extracted.title,
        text: extracted.text,
        note: capture.note,
        originalUrl: capture.raw_url,
      }),
      25000,
      () => createFallbackDraft(extracted),
    )
      .then(async (result) => {
        await markJobStep(job.id, currentStep, "completed");
        return result;
      })
      .catch(async (error) => {
        if (error instanceof SmartQuotaExceededError) {
          await markJobStep(job.id, currentStep, "skipped", error.message);
        } else {
          await markJobStep(job.id, currentStep, "skipped", "AI 结构化整理暂时不可用，已使用基础整理结果。");
        }
        return createFallbackDraft(extracted);
      });

    currentStep = "create_source";
    const source = await runJobStep(job.id, currentStep, () =>
      createSource(capture, {
        title: draft.title || extracted.title,
        text: extracted.text,
        summary: draft.summary,
        metadata: {
          ...extracted.metadata,
          extraction_status: extracted.status,
          extraction_method: extracted.method,
          extraction_error: extracted.errorMessage || undefined,
        },
      }),
    );

    currentStep = "create_wiki_page";
    const wikiPage = await runJobStep(job.id, currentStep, () =>
      createWikiPage(capture, source, {
        title: draft.wikiTitle || source.title,
        markdown: draft.wikiMarkdown,
      }),
    );

    await linkSourceToWikiPage(source, wikiPage);

    const chunkInputs = buildChunkInputs(source, wikiPage);
    let embeddings: number[][] = [];

    currentStep = "create_embeddings";
    try {
      embeddings = await runJobStep(job.id, currentStep, () =>
        withTimeout(
          embedTexts(chunkInputs.map((chunk) => chunk.content), {
            userId: capture.user_id,
            stage: "processing",
            role: "embedding",
            purpose: "capture.create_embeddings",
            resourceType: "capture",
            resourceId: capture.id,
            metadata: {
              chunk_count: chunkInputs.length,
            },
          }),
          25000,
          () => [],
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown embedding error";
      await markJobStep(job.id, currentStep, "skipped", message);
      embeddings = [];
    }

    currentStep = "create_chunks";
    await runJobStep(job.id, currentStep, () => createChunks(capture, source, wikiPage, chunkInputs, embeddings));

    currentStep = "create_discoveries";
    try {
      await runJobStep(job.id, currentStep, () =>
        createKnowledgeDiscoveriesForProcessedCapture({
          userId: capture.user_id,
          source,
          wikiPage,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown discovery error";
      await markJobStep(job.id, currentStep, "skipped", message);
    }

    currentStep = "refresh_recommendations";
    try {
      await runJobStep(job.id, currentStep, () =>
        refreshKnowledgeRecommendationsForProcessedCapture({
          userId: capture.user_id,
          source,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown recommendation error";
      await markJobStep(job.id, currentStep, "skipped", message);
    }

    if (await isCaptureIgnored(capture.id)) {
      await markJobIgnored(job.id);
      return {
        captureId: capture.id,
        sourceId: source.id,
        wikiPageId: wikiPage.id,
      };
    }

    const completedCapture = await query<{ id: string }>(
      "update captures set status = 'completed' where id = $1 and status <> 'ignored' returning id",
      [capture.id],
    );

    if (!completedCapture.rows[0]) {
      await markJobIgnored(job.id);
      return {
        captureId: capture.id,
        sourceId: source.id,
        wikiPageId: wikiPage.id,
      };
    }

    await query(
      `
        update processing_jobs
        set status = 'completed', current_step = 'completed', finished_at = now()
        where id = $1
      `,
      [job.id],
    );

    return {
      captureId: capture.id,
      sourceId: source.id,
      wikiPageId: wikiPage.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    if (await isCaptureIgnored(capture.id)) {
      await markJobIgnored(job.id);
      return {
        captureId: capture.id,
        sourceId: null,
        wikiPageId: null,
      };
    }

    await query("update captures set status = 'failed' where id = $1", [capture.id]);
    await query(
      `
        update processing_jobs
        set
          status = 'failed',
          current_step = $2,
          step_status = coalesce(step_status, '{}'::jsonb)
            || jsonb_build_object($2::text, jsonb_build_object('status', 'failed', 'finished_at', now(), 'error', $3::text)),
          error_message = $3,
          finished_at = now()
        where id = $1
      `,
      [job.id, currentStep, message],
    );
    throw error;
  }
}

async function isCaptureIgnored(captureId: string) {
  const result = await query<{ status: string }>("select status from captures where id = $1", [captureId]);
  return result.rows[0]?.status === "ignored";
}

async function markJobIgnored(jobId: string) {
  await query(
    `
      update processing_jobs
      set status = 'completed',
          current_step = 'ignored',
          step_status = jsonb_build_object(
            'ignored',
            jsonb_build_object('status', 'completed', 'finished_at', now())
          ),
          error_message = null,
          started_at = null,
          finished_at = now()
      where id = $1
    `,
    [jobId],
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: () => T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    promise.finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    }),
    new Promise<T>((resolve) => {
      timeout = setTimeout(() => resolve(fallback()), timeoutMs);
    }),
  ]);
}

function createFallbackDraft(extracted: ExtractedCaptureContent): KnowledgeDraft {
  const statusNote =
    extracted.status === "fallback"
      ? "这份资料已先保存原始内容，后续可在 OCR、转写或正文提取能力完善后重新处理。"
      : "这份资料已完成基础提取，但 AI 结构化整理暂时不可用。";

  return {
    title: extracted.title,
    summary: extracted.text.replace(/\s+/g, " ").slice(0, 220),
    wikiTitle: extracted.title,
    wikiMarkdown: [
      `# ${extracted.title}`,
      "",
      "## 当前状态",
      statusNote,
      extracted.errorMessage ? `处理提示：${extracted.errorMessage}` : "",
      "",
      "## 已保存内容",
      extracted.text,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function saveExtractedContent(capture: Capture, extracted: ExtractedCaptureContent) {
  const result = await query<ExtractedContent>(
    `
      insert into extracted_contents (
        capture_id,
        user_id,
        title,
        content_text,
        content_format,
        extraction_method,
        status,
        metadata,
        error_message
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      on conflict (capture_id)
      do update set
        title = excluded.title,
        content_text = excluded.content_text,
        content_format = excluded.content_format,
        extraction_method = excluded.extraction_method,
        status = excluded.status,
        metadata = excluded.metadata,
        error_message = excluded.error_message,
        created_at = now()
      returning *
    `,
    [
      capture.id,
      capture.user_id,
      extracted.title,
      extracted.text,
      extracted.contentFormat,
      extracted.method,
      extracted.status,
      JSON.stringify(extracted.metadata),
      extracted.errorMessage || null,
    ],
  );

  return result.rows[0];
}

async function loadCapture(captureId: string) {
  const result = await query<Capture>("select * from captures where id = $1", [captureId]);
  const row = result.rows[0];

  if (!row) {
    throw new Error(`Capture not found: ${captureId}`);
  }

  return row;
}

async function ensureProcessingJob(capture: Capture) {
  const existing = await query<ProcessingJob>(
    `
      select *
      from processing_jobs
      where capture_id = $1
      order by created_at desc
      limit 1
    `,
    [capture.id],
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await query<ProcessingJob>(
    `
      insert into processing_jobs (capture_id, user_id, job_type, status, current_step)
      values ($1, $2, 'process_capture', 'queued', 'queued')
      returning *
    `,
    [capture.id, capture.user_id],
  );

  return created.rows[0];
}

async function runJobStep<T>(jobId: string, step: string, action: () => Promise<T>) {
  await markJobStep(jobId, step, "running");
  const result = await action();
  await markJobStep(jobId, step, "completed");
  return result;
}

async function markJobStep(jobId: string, step: string, status: "running" | "completed" | "failed" | "skipped", error?: string) {
  const timestampField = status === "running" ? "started_at" : "finished_at";

  await query(
    `
      update processing_jobs
      set
        current_step = $2,
        step_status = coalesce(step_status, '{}'::jsonb)
          || jsonb_build_object(
            $2::text,
            coalesce(step_status -> $2::text, '{}'::jsonb)
              || jsonb_build_object('status', $3::text, '${timestampField}', now())
              || case when $4::text is null then '{}'::jsonb else jsonb_build_object('error', $4::text) end
          )
      where id = $1
    `,
    [jobId, step, status, error || null],
  );
}

async function createSource(
  capture: Capture,
  input: { title: string; text: string; summary: string; metadata: unknown },
) {
  const result = await query<Source>(
    `
      insert into sources (
        capture_id, user_id, title, source_type, original_url, extracted_text, summary, metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (capture_id)
      do update set
        title = excluded.title,
        source_type = excluded.source_type,
        original_url = excluded.original_url,
        extracted_text = excluded.extracted_text,
        summary = excluded.summary,
        metadata = excluded.metadata
      returning *
    `,
    [
      capture.id,
      capture.user_id,
      input.title,
      capture.type,
      capture.raw_url,
      input.text,
      input.summary,
      input.metadata,
    ],
  );

  return result.rows[0];
}

async function createWikiPage(
  capture: Capture,
  source: Source,
  input: { title: string; markdown: string },
) {
  const existing = await query<WikiPage>(
    `
      select wp.*
      from source_wiki_pages swp
      join wiki_pages wp on wp.id = swp.wiki_page_id
      where swp.source_id = $1
      limit 1
    `,
    [source.id],
  );

  if (existing.rows[0]) {
    const updated = await query<WikiPage>(
      `
        update wiki_pages
        set title = $2,
            content_markdown = $3,
            updated_at = now()
        where id = $1
        returning *
      `,
      [existing.rows[0].id, input.title, input.markdown],
    );

    return updated.rows[0];
  }

  const slug = toSlug(input.title || source.title || source.id) || source.id;
  const result = await query<WikiPage>(
    `
      insert into wiki_pages (user_id, title, slug, content_markdown, status)
      values ($1, $2, $3, $4, 'draft')
      on conflict (user_id, slug)
      do update set
        title = excluded.title,
        content_markdown = excluded.content_markdown,
        updated_at = now()
      returning *
    `,
    [capture.user_id, input.title, `${slug}-${source.id.slice(0, 8)}`, input.markdown],
  );

  return result.rows[0];
}

async function linkSourceToWikiPage(source: Source, wikiPage: WikiPage) {
  await query(
    `
      insert into source_wiki_pages (source_id, wiki_page_id, relation_type, confidence)
      values ($1, $2, 'draft_from_source', 1)
      on conflict (source_id, wiki_page_id) do nothing
    `,
    [source.id, wikiPage.id],
  );
}

function buildChunkInputs(source: Source, wikiPage: WikiPage) {
  return [
    ...chunkText(source.extracted_text).map((content) => ({
      parent_type: "source" as const,
      parent_id: source.id,
      content,
    })),
    ...chunkText(wikiPage.content_markdown).map((content) => ({
      parent_type: "wiki_page" as const,
      parent_id: wikiPage.id,
      content,
    })),
  ];
}

async function createChunks(
  capture: Capture,
  source: Source,
  wikiPage: WikiPage,
  chunkInputs: Array<{ parent_type: "source" | "wiki_page"; parent_id: string; content: string }>,
  embeddings: number[][],
) {
  await query(
    `
      delete from chunks
      where user_id = $1
        and (
          (parent_type = 'source' and parent_id = $2)
          or (parent_type = 'wiki_page' and parent_id = $3)
        )
    `,
    [capture.user_id, source.id, wikiPage.id],
  );

  for (const [index, chunk] of chunkInputs.entries()) {
    await query(
      `
        insert into chunks (user_id, parent_type, parent_id, content, embedding, token_count)
        values ($1, $2, $3, $4, $5::vector, $6)
      `,
      [
        capture.user_id,
        chunk.parent_type,
        chunk.parent_id,
        chunk.content,
        embeddings[index] ? toSqlVector(embeddings[index]) : null,
        roughTokenCount(chunk.content),
      ],
    );
  }
}
