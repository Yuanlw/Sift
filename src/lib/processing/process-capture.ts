import { chunkText, roughTokenCount } from "@/lib/chunk";
import { query } from "@/lib/db";
import { extractCaptureText } from "@/lib/extraction";
import { embedTexts, generateKnowledgeDraft } from "@/lib/models";
import { toSlug } from "@/lib/slug";
import type { Capture, Source, WikiPage } from "@/types/database";

export async function processCaptureById(captureId: string) {
  const capture = await loadCapture(captureId);

  await query("update captures set status = 'processing' where id = $1", [capture.id]);
  await query(
    `
      update processing_jobs
      set status = 'running', started_at = now()
      where capture_id = $1
    `,
    [capture.id],
  );

  try {
    const extracted = await extractCaptureText(capture);
    const draft = await generateKnowledgeDraft({
      title: extracted.title,
      text: extracted.text,
      note: capture.note,
      originalUrl: capture.raw_url,
    });

    const source = await createSource(capture, {
      title: draft.title || extracted.title,
      text: extracted.text,
      summary: draft.summary,
      metadata: extracted.metadata,
    });
    const wikiPage = await createWikiPage(capture, source, {
      title: draft.wikiTitle || source.title,
      markdown: draft.wikiMarkdown,
    });

    await query(
      `
        insert into source_wiki_pages (source_id, wiki_page_id, relation_type, confidence)
        values ($1, $2, 'draft_from_source', 1)
      `,
      [source.id, wikiPage.id],
    );

    await createChunks(capture, source, wikiPage);

    await query("update captures set status = 'completed' where id = $1", [capture.id]);
    await query(
      `
        update processing_jobs
        set status = 'completed', finished_at = now()
        where capture_id = $1
      `,
      [capture.id],
    );

    return {
      captureId: capture.id,
      sourceId: source.id,
      wikiPageId: wikiPage.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    await query("update captures set status = 'failed' where id = $1", [capture.id]);
    await query(
      `
        update processing_jobs
        set status = 'failed', error_message = $2, finished_at = now()
        where capture_id = $1
      `,
      [capture.id, message],
    );
    throw error;
  }
}

async function loadCapture(captureId: string) {
  const result = await query<Capture>("select * from captures where id = $1", [captureId]);
  const row = result.rows[0];

  if (!row) {
    throw new Error(`Capture not found: ${captureId}`);
  }

  return row;
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
  const slug = toSlug(input.title || source.title || source.id) || source.id;
  const result = await query<WikiPage>(
    `
      insert into wiki_pages (user_id, title, slug, content_markdown, status)
      values ($1, $2, $3, $4, 'draft')
      returning *
    `,
    [capture.user_id, input.title, `${slug}-${source.id.slice(0, 8)}`, input.markdown],
  );

  return result.rows[0];
}

async function createChunks(capture: Capture, source: Source, wikiPage: WikiPage) {
  const chunkInputs = [
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

  const embeddings = await embedTexts(chunkInputs.map((chunk) => chunk.content));

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
        toSqlVector(embeddings[index]),
        roughTokenCount(chunk.content),
      ],
    );
  }
}

function toSqlVector(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}
