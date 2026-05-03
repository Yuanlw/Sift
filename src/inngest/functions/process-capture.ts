import { chunkText, roughTokenCount } from "@/lib/chunk";
import { query } from "@/lib/db";
import { extractCaptureText } from "@/lib/extraction";
import { inngest } from "@/lib/inngest/client";
import { embedTexts, generateKnowledgeDraft } from "@/lib/models";
import { toSlug } from "@/lib/slug";
import type { Capture, Source, WikiPage } from "@/types/database";

export const processCapture = inngest.createFunction(
  { id: "process-capture" },
  { event: "capture/process.requested" },
  async ({ event, step }) => {
    const captureId = event.data.captureId as string;

    const capture = await step.run("load capture", async () => {
      const result = await query<Capture>("select * from captures where id = $1", [captureId]);
      const row = result.rows[0];

      if (!row) {
        throw new Error(`Capture not found: ${captureId}`);
      }

      return row;
    });

    await step.run("mark processing", async () => {
      await query("update captures set status = 'processing' where id = $1", [capture.id]);
      await query(
        `
          update processing_jobs
          set status = 'running', started_at = now()
          where capture_id = $1
        `,
        [capture.id],
      );
    });

    try {
      const extracted = await step.run("extract text", async () => extractCaptureText(capture));

      const draft = await step.run("generate knowledge draft", async () =>
        generateKnowledgeDraft({
          title: extracted.title,
          text: extracted.text,
          note: capture.note,
          originalUrl: capture.raw_url,
        }),
      );

      const source = await step.run("create source", async () => {
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
            draft.title || extracted.title,
            capture.type,
            capture.raw_url,
            extracted.text,
            draft.summary,
            extracted.metadata,
          ],
        );

        return result.rows[0];
      });

      const wikiPage = await step.run("create wiki page", async () => {
        const slug = toSlug(draft.wikiTitle || source.title || source.id) || source.id;
        const result = await query<WikiPage>(
          `
            insert into wiki_pages (user_id, title, slug, content_markdown, status)
            values ($1, $2, $3, $4, 'draft')
            returning *
          `,
          [
            capture.user_id,
            draft.wikiTitle || source.title,
            `${slug}-${source.id.slice(0, 8)}`,
            draft.wikiMarkdown,
          ],
        );

        return result.rows[0];
      });

      await step.run("link source and wiki page", async () => {
        await query(
          `
            insert into source_wiki_pages (source_id, wiki_page_id, relation_type, confidence)
            values ($1, $2, 'draft_from_source', 1)
          `,
          [source.id, wikiPage.id],
        );
      });

      await step.run("create chunks and embeddings", async () => {
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

        const rows = chunkInputs.map((chunk, index) => ({
          user_id: capture.user_id,
          parent_type: chunk.parent_type,
          parent_id: chunk.parent_id,
          content: chunk.content,
          embedding: toSqlVector(embeddings[index]),
          token_count: roughTokenCount(chunk.content),
        }));

        for (const row of rows) {
          await query(
            `
              insert into chunks (user_id, parent_type, parent_id, content, embedding, token_count)
              values ($1, $2, $3, $4, $5::vector, $6)
            `,
            [
              row.user_id,
              row.parent_type,
              row.parent_id,
              row.content,
              row.embedding,
              row.token_count,
            ],
          );
        }
      });

      await step.run("mark completed", async () => {
        await query("update captures set status = 'completed' where id = $1", [capture.id]);
        await query(
          `
            update processing_jobs
            set status = 'completed', finished_at = now()
            where capture_id = $1
          `,
          [capture.id],
        );
      });

      return {
        captureId: capture.id,
        sourceId: source.id,
        wikiPageId: wikiPage.id,
      };
    } catch (error) {
      await step.run("mark failed", async () => {
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
      });

      throw error;
    }
  },
);

function toSqlVector(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}
