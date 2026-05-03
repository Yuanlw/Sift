import { chunkText, roughTokenCount } from "@/lib/chunk";
import { extractCaptureText } from "@/lib/extraction";
import { inngest } from "@/lib/inngest/client";
import { embedTexts, generateKnowledgeDraft } from "@/lib/openai";
import { toSlug } from "@/lib/slug";
import { createServiceClient } from "@/lib/supabase/server";

export const processCapture = inngest.createFunction(
  { id: "process-capture" },
  { event: "capture/process.requested" },
  async ({ event, step }) => {
    const captureId = event.data.captureId as string;
    const supabase = createServiceClient();

    const capture = await step.run("load capture", async () => {
      const { data, error } = await supabase
        .from("captures")
        .select("*")
        .eq("id", captureId)
        .single();

      if (error) {
        throw new Error(error.message);
      }

      return data;
    });

    await step.run("mark processing", async () => {
      await supabase.from("captures").update({ status: "processing" }).eq("id", capture.id);
      await supabase
        .from("processing_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("capture_id", capture.id);
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
        const { data, error } = await supabase
          .from("sources")
          .insert({
            capture_id: capture.id,
            user_id: capture.user_id,
            title: draft.title || extracted.title,
            source_type: capture.type,
            original_url: capture.raw_url,
            extracted_text: extracted.text,
            summary: draft.summary,
            metadata: extracted.metadata,
          })
          .select()
          .single();

        if (error) {
          throw new Error(error.message);
        }

        return data;
      });

      const wikiPage = await step.run("create wiki page", async () => {
        const slug = toSlug(draft.wikiTitle || source.title || source.id) || source.id;
        const { data, error } = await supabase
          .from("wiki_pages")
          .insert({
            user_id: capture.user_id,
            title: draft.wikiTitle || source.title,
            slug: `${slug}-${source.id.slice(0, 8)}`,
            content_markdown: draft.wikiMarkdown,
            status: "draft",
          })
          .select()
          .single();

        if (error) {
          throw new Error(error.message);
        }

        return data;
      });

      await step.run("link source and wiki page", async () => {
        const { error } = await supabase.from("source_wiki_pages").insert({
          source_id: source.id,
          wiki_page_id: wikiPage.id,
          relation_type: "draft_from_source",
          confidence: 1,
        });

        if (error) {
          throw new Error(error.message);
        }
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

        const { error } = await supabase.from("chunks").insert(rows);

        if (error) {
          throw new Error(error.message);
        }
      });

      await step.run("mark completed", async () => {
        await supabase.from("captures").update({ status: "completed" }).eq("id", capture.id);
        await supabase
          .from("processing_jobs")
          .update({ status: "completed", finished_at: new Date().toISOString() })
          .eq("capture_id", capture.id);
      });

      return {
        captureId: capture.id,
        sourceId: source.id,
        wikiPageId: wikiPage.id,
      };
    } catch (error) {
      await step.run("mark failed", async () => {
        const message = error instanceof Error ? error.message : "Unknown processing error";
        await supabase.from("captures").update({ status: "failed" }).eq("id", capture.id);
        await supabase
          .from("processing_jobs")
          .update({
            status: "failed",
            error_message: message,
            finished_at: new Date().toISOString(),
          })
          .eq("capture_id", capture.id);
      });

      throw error;
    }
  },
);

function toSqlVector(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}
