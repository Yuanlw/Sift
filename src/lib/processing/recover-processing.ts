import { query } from "@/lib/db";
import { createKnowledgeDiscoveriesForProcessedCapture } from "@/lib/knowledge-discoveries";
import { createKnowledgeEdgesForProcessedCapture } from "@/lib/knowledge-edges";
import { refreshKnowledgeRecommendationsForProcessedCapture } from "@/lib/knowledge-recommendations";
import { embedTexts } from "@/lib/models";
import { processCaptureById } from "@/lib/processing/process-capture";
import { toSqlVector } from "@/lib/vector";
import type { Source, WikiPage } from "@/types/database";

type Dispatcher = "none" | "inngest" | "inline";

interface InterruptedJobRow {
  capture_id: string;
  job_id: string;
}

interface RecoveryCandidateRow {
  capture_id: string;
  job_id: string | null;
}

interface CaptureKnowledgeRow {
  user_id: string;
  source_id: string;
  source_title: string;
  source_type: Source["source_type"];
  original_url: string | null;
  extracted_text: string;
  source_summary: string | null;
  source_metadata: Source["metadata"];
  source_created_at: string;
  wiki_page_id: string;
  wiki_title: string;
  wiki_slug: string;
  wiki_content_markdown: string;
  wiki_status: WikiPage["status"];
  wiki_created_at: string;
  wiki_updated_at: string;
}

interface ChunkBackfillRow {
  id: string;
  content: string;
}

interface RecoverySummary {
  interrupted: number;
  fullReprocessed: number;
  embeddingsBackfilled: number;
  enrichmentsRecovered: number;
}

export async function recoverInterruptedProcessingJobs(input: {
  dispatcher: Dispatcher;
  limit?: number;
  staleSeconds?: number;
  userId: string;
}) {
  if (input.dispatcher !== "inline") {
    return 0;
  }

  const rows = await findInterruptedJobs({
    limit: input.limit || 5,
    staleSeconds: input.staleSeconds || 60,
    userId: input.userId,
  });

  if (rows.length === 0) {
    return 0;
  }

  await markJobsRecovered(rows.map((row) => row.job_id));

  for (const row of rows) {
    setTimeout(() => {
      void processCaptureById(row.capture_id).catch(async (error) => {
        const message = error instanceof Error ? error.message : "Unknown recovery processing error";
        console.error(`Recovered capture processing failed for ${row.capture_id}:`, error);
        await query(
          `
            update processing_jobs
            set status = 'failed',
                current_step = case when current_step in ('queued', 'recovered') then 'failed' else current_step end,
                error_message = coalesce(error_message, $2),
                finished_at = coalesce(finished_at, now())
            where id = $1
          `,
          [row.job_id, message],
        ).catch(() => undefined);
      });
    }, 0);
  }

  return rows.length;
}

export async function recoverProcessingBacklog(input: {
  embeddingLimit?: number;
  enrichmentLimit?: number;
  fullReprocessLimit?: number;
  staleSeconds?: number;
  userId?: string;
}): Promise<RecoverySummary> {
  const summary: RecoverySummary = {
    interrupted: 0,
    fullReprocessed: 0,
    embeddingsBackfilled: 0,
    enrichmentsRecovered: 0,
  };

  const fullReprocessRows = await findFullReprocessCandidates({
    limit: input.fullReprocessLimit || 10,
    staleSeconds: input.staleSeconds || 60 * 60,
    userId: input.userId,
  });
  const fullReprocessIds = new Set(fullReprocessRows.map((row) => row.capture_id));

  summary.interrupted = fullReprocessRows.filter((row) => row.job_id).length;

  for (const row of fullReprocessRows) {
    const jobId = await markJobForFullReprocess(row);

    try {
      await processCaptureById(row.capture_id);
      summary.fullReprocessed += 1;
    } catch (error) {
      await markRecoveryFailed(jobId, error, "Full recovery processing failed");
    }
  }

  const embeddingRows = await findEmbeddingBackfillCandidates({
    excludedCaptureIds: [...fullReprocessIds],
    limit: input.embeddingLimit || 25,
    userId: input.userId,
  });

  for (const row of embeddingRows) {
    summary.embeddingsBackfilled += await backfillCaptureEmbeddings(row);
  }

  const enrichmentRows = await findEnrichmentRecoveryCandidates({
    excludedCaptureIds: [...fullReprocessIds],
    limit: input.enrichmentLimit || 25,
    userId: input.userId,
  });

  for (const row of enrichmentRows) {
    if (await recoverCaptureEnrichment(row)) {
      summary.enrichmentsRecovered += 1;
    }
  }

  return summary;
}

async function findInterruptedJobs(input: { limit: number; staleSeconds: number; userId: string }) {
  const result = await query<InterruptedJobRow>(
    `
      select c.id as capture_id, pj.id as job_id
      from captures c
      join lateral (
        select id, status, current_step, started_at, created_at
        from processing_jobs
        where capture_id = c.id
        order by created_at desc
        limit 1
      ) pj on true
      where c.user_id = $1
        and c.status in ('queued', 'processing')
        and pj.status in ('queued', 'running')
        and (
          pj.status = 'queued'
          or coalesce(pj.started_at, pj.created_at) < now() - ($2::int * interval '1 second')
        )
      order by coalesce(pj.started_at, pj.created_at) asc
      limit $3
    `,
    [input.userId, input.staleSeconds, input.limit],
  );

  return result.rows;
}

async function findFullReprocessCandidates(input: { limit: number; staleSeconds: number; userId?: string }) {
  const result = await query<RecoveryCandidateRow>(
    `
      with latest_jobs as (
        select distinct on (capture_id)
          id,
          capture_id,
          user_id,
          status,
          current_step,
          step_status,
          error_message,
          started_at,
          created_at
        from processing_jobs
        order by capture_id, created_at desc
      )
      select c.id as capture_id, pj.id as job_id
      from captures c
      left join latest_jobs pj on pj.capture_id = c.id
      where c.status <> 'ignored'
        and ($1::uuid is null or c.user_id = $1::uuid)
        and (
          (
            (c.status = 'failed' or pj.status = 'failed')
            and not exists (
              select 1
              from extracted_contents ec
              where ec.capture_id = c.id
                and ec.status = 'fallback'
            )
          )
          or (
            c.status in ('queued', 'processing')
            and (
              pj.id is null
              or pj.status = 'queued'
              or coalesce(pj.started_at, pj.created_at) < now() - ($2::int * interval '1 second')
            )
          )
          or (
            c.status = 'completed'
            and (
              not exists (
                select 1
                from sources s
                join source_wiki_pages swp on swp.source_id = s.id
                join wiki_pages wp on wp.id = swp.wiki_page_id
                where s.capture_id = c.id
              )
              or pj.step_status #>> '{fetch_link,status}' in ('failed', 'skipped')
              or pj.step_status #>> '{extracting,status}' in ('failed', 'skipped')
              or pj.step_status #>> '{structuring,status}' in ('failed', 'skipped')
              or pj.step_status #>> '{create_source,status}' in ('failed', 'skipped')
              or pj.step_status #>> '{create_wiki_page,status}' in ('failed', 'skipped')
              or pj.step_status #>> '{create_chunks,status}' in ('failed', 'skipped')
              or exists (
                select 1
                from sources s
                join source_wiki_pages swp on swp.source_id = s.id
                join wiki_pages wp on wp.id = swp.wiki_page_id
                where s.capture_id = c.id
                  and (
                    not exists (
                      select 1
                      from chunks chs
                      where chs.user_id = c.user_id
                        and chs.parent_type = 'source'
                        and chs.parent_id = s.id
                    )
                    or not exists (
                      select 1
                      from chunks chw
                      where chw.user_id = c.user_id
                        and chw.parent_type = 'wiki_page'
                        and chw.parent_id = wp.id
                    )
                  )
              )
              or exists (
                select 1
                from extracted_contents ec
                where ec.capture_id = c.id
                  and ec.status = 'fallback'
              )
            )
          )
        )
      order by c.created_at asc
      limit $3
    `,
    [input.userId || null, input.staleSeconds, input.limit],
  );

  return result.rows;
}

async function findEmbeddingBackfillCandidates(input: {
  excludedCaptureIds: string[];
  limit: number;
  userId?: string;
}) {
  const result = await query<RecoveryCandidateRow>(
    `
      with latest_jobs as (
        select distinct on (capture_id)
          id,
          capture_id,
          step_status
        from processing_jobs
        order by capture_id, created_at desc
      )
      select distinct c.id as capture_id, pj.id as job_id
      from captures c
      join latest_jobs pj on pj.capture_id = c.id
      join sources s on s.capture_id = c.id
      join source_wiki_pages swp on swp.source_id = s.id
      join wiki_pages wp on wp.id = swp.wiki_page_id
      join chunks ch on ch.user_id = c.user_id
        and (
          (ch.parent_type = 'source' and ch.parent_id = s.id)
          or (ch.parent_type = 'wiki_page' and ch.parent_id = wp.id)
        )
      where c.status = 'completed'
        and ($1::uuid is null or c.user_id = $1::uuid)
        and not (c.id = any($2::uuid[]))
        and (
          pj.step_status #>> '{create_embeddings,status}' in ('failed', 'skipped')
          or ch.embedding is null
        )
      order by c.id
      limit $3
    `,
    [input.userId || null, input.excludedCaptureIds, input.limit],
  );

  return result.rows;
}

async function findEnrichmentRecoveryCandidates(input: {
  excludedCaptureIds: string[];
  limit: number;
  userId?: string;
}) {
  const result = await query<RecoveryCandidateRow>(
    `
      with latest_jobs as (
        select distinct on (capture_id)
          id,
          capture_id,
          step_status
        from processing_jobs
        order by capture_id, created_at desc
      )
      select c.id as capture_id, pj.id as job_id
      from captures c
      join latest_jobs pj on pj.capture_id = c.id
      where c.status = 'completed'
        and ($1::uuid is null or c.user_id = $1::uuid)
        and not (c.id = any($2::uuid[]))
        and exists (
          select 1
          from sources s
          join source_wiki_pages swp on swp.source_id = s.id
          join wiki_pages wp on wp.id = swp.wiki_page_id
          where s.capture_id = c.id
        )
        and (
          pj.step_status #>> '{create_knowledge_edges,status}' in ('failed', 'skipped')
          or exists (
            select 1
            from sources s
            join source_wiki_pages swp on swp.source_id = s.id
            where s.capture_id = c.id
              and not exists (
                select 1
                from knowledge_edges ke
                where ke.user_id = c.user_id
                  and ke.edge_type = 'source_wiki'
                  and ke.from_type = 'source'
                  and ke.from_id = s.id
                  and ke.to_type = 'wiki_page'
                  and ke.to_id = swp.wiki_page_id
              )
          )
          or
          pj.step_status #>> '{create_discoveries,status}' in ('failed', 'skipped')
          or pj.step_status #>> '{refresh_recommendations,status}' in ('failed', 'skipped')
        )
      order by c.created_at asc
      limit $3
    `,
    [input.userId || null, input.excludedCaptureIds, input.limit],
  );

  return result.rows;
}

async function markJobForFullReprocess(row: RecoveryCandidateRow) {
  await query(
    `
      update captures
      set status = 'queued'
      where id = $1
        and status <> 'ignored'
    `,
    [row.capture_id],
  );

  if (row.job_id) {
    await query(
      `
        update processing_jobs
        set status = 'queued',
            current_step = 'recovered',
            step_status = '{}'::jsonb,
            error_message = null,
            started_at = null,
            finished_at = null
        where id = $1
      `,
      [row.job_id],
    );
    return row.job_id;
  }

  const result = await query<{ id: string }>(
    `
      insert into processing_jobs (capture_id, user_id, job_type, status, current_step)
      select id, user_id, 'process_capture', 'queued', 'recovered'
      from captures
      where id = $1
      returning id
    `,
    [row.capture_id],
  );

  return result.rows[0].id;
}

async function backfillCaptureEmbeddings(row: RecoveryCandidateRow) {
  const knowledge = await loadCaptureKnowledge(row.capture_id);

  if (!knowledge) {
    return 0;
  }

  const chunks = await loadChunksWithoutEmbeddings(knowledge);

  if (chunks.length === 0) {
    await markJobStep(row.job_id!, "create_chunks", "skipped", "No chunks found; full reprocess is required.");
    return 0;
  }

  await markJobStep(row.job_id!, "create_embeddings", "running");

  try {
    const embeddings = await embedTexts(chunks.map((chunk) => chunk.content), {
      userId: knowledge.user_id,
      stage: "processing",
      role: "embedding",
      purpose: "capture.create_embeddings.recovery",
      resourceType: "capture",
      resourceId: row.capture_id,
      metadata: {
        chunk_count: chunks.length,
        recovery: true,
      },
    });

    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding response count mismatch: expected ${chunks.length}, got ${embeddings.length}.`);
    }

    for (const [index, chunk] of chunks.entries()) {
      await query(
        "update chunks set embedding = $2::vector where id = $1",
        [chunk.id, toSqlVector(embeddings[index])],
      );
    }

    await markJobStep(row.job_id!, "create_embeddings", "completed");
    return chunks.length;
  } catch (error) {
    await markJobStep(row.job_id!, "create_embeddings", "skipped", getErrorMessage(error));
    return 0;
  }
}

async function recoverCaptureEnrichment(row: RecoveryCandidateRow) {
  const knowledge = await loadCaptureKnowledge(row.capture_id);

  if (!knowledge) {
    return false;
  }

  const source = toSource(knowledge, row.capture_id);
  const wikiPage = toWikiPage(knowledge);
  let recovered = false;

  try {
    await markJobStep(row.job_id!, "create_knowledge_edges", "running");
    await createKnowledgeEdgesForProcessedCapture({
      userId: knowledge.user_id,
      source,
      wikiPage,
    });
    await markJobStep(row.job_id!, "create_knowledge_edges", "completed");
    recovered = true;
  } catch (error) {
    await markJobStep(row.job_id!, "create_knowledge_edges", "skipped", getErrorMessage(error));
  }

  try {
    await markJobStep(row.job_id!, "create_discoveries", "running");
    await createKnowledgeDiscoveriesForProcessedCapture({
      userId: knowledge.user_id,
      source,
      wikiPage,
    });
    await markJobStep(row.job_id!, "create_discoveries", "completed");
    recovered = true;
  } catch (error) {
    await markJobStep(row.job_id!, "create_discoveries", "skipped", getErrorMessage(error));
  }

  try {
    await markJobStep(row.job_id!, "refresh_recommendations", "running");
    await refreshKnowledgeRecommendationsForProcessedCapture({
      userId: knowledge.user_id,
      source,
    });
    await markJobStep(row.job_id!, "refresh_recommendations", "completed");
    recovered = true;
  } catch (error) {
    await markJobStep(row.job_id!, "refresh_recommendations", "skipped", getErrorMessage(error));
  }

  return recovered;
}

async function loadCaptureKnowledge(captureId: string) {
  const result = await query<CaptureKnowledgeRow>(
    `
      select
        c.user_id,
        s.id as source_id,
        s.title as source_title,
        s.source_type,
        s.original_url,
        s.extracted_text,
        s.summary as source_summary,
        s.metadata as source_metadata,
        s.created_at as source_created_at,
        wp.id as wiki_page_id,
        wp.title as wiki_title,
        wp.slug as wiki_slug,
        wp.content_markdown as wiki_content_markdown,
        wp.status as wiki_status,
        wp.created_at as wiki_created_at,
        wp.updated_at as wiki_updated_at
      from captures c
      join sources s on s.capture_id = c.id
      join source_wiki_pages swp on swp.source_id = s.id
      join wiki_pages wp on wp.id = swp.wiki_page_id
      where c.id = $1
      limit 1
    `,
    [captureId],
  );

  return result.rows[0] || null;
}

async function loadChunksWithoutEmbeddings(knowledge: CaptureKnowledgeRow) {
  const result = await query<ChunkBackfillRow>(
    `
      select id, content
      from chunks
      where user_id = $1
        and embedding is null
        and (
          (parent_type = 'source' and parent_id = $2)
          or (parent_type = 'wiki_page' and parent_id = $3)
        )
      order by created_at asc
      limit 80
    `,
    [knowledge.user_id, knowledge.source_id, knowledge.wiki_page_id],
  );

  return result.rows;
}

async function markJobStep(
  jobId: string,
  step: string,
  status: "running" | "completed" | "failed" | "skipped",
  error?: string,
) {
  const timestampField = status === "running" ? "started_at" : "finished_at";

  await query(
    `
      update processing_jobs
      set
        current_step = $2,
        step_status = coalesce(step_status, '{}'::jsonb)
          || jsonb_build_object(
            $2::text,
            case
              when $4::text is null then
                (
                  coalesce(step_status -> $2::text, '{}'::jsonb)
                  || jsonb_build_object('status', $3::text, '${timestampField}', now())
                ) - 'error'
              else
                coalesce(step_status -> $2::text, '{}'::jsonb)
                || jsonb_build_object('status', $3::text, '${timestampField}', now(), 'error', $4::text)
            end
          )
      where id = $1
    `,
    [jobId, step, status, error || null],
  );
}

async function markRecoveryFailed(jobId: string, error: unknown, fallback: string) {
  await query(
    `
      update processing_jobs
      set status = 'failed',
          current_step = case when current_step in ('queued', 'recovered') then 'failed' else current_step end,
          error_message = $2,
          finished_at = coalesce(finished_at, now())
      where id = $1
    `,
    [jobId, getErrorMessage(error) || fallback],
  ).catch(() => undefined);
}

async function markJobsRecovered(jobIds: string[]) {
  if (jobIds.length === 0) {
    return;
  }

  await query(
    `
      update processing_jobs
      set status = 'queued',
          current_step = 'recovered',
          step_status = '{}'::jsonb,
          error_message = null,
          started_at = null,
          finished_at = null
      where id = any($1::uuid[])
    `,
    [jobIds],
  );
}

function toSource(row: CaptureKnowledgeRow, captureId: string): Source {
  return {
    id: row.source_id,
    capture_id: captureId,
    user_id: row.user_id,
    title: row.source_title,
    source_type: row.source_type,
    original_url: row.original_url,
    extracted_text: row.extracted_text,
    summary: row.source_summary,
    metadata: row.source_metadata,
    created_at: row.source_created_at,
  };
}

function toWikiPage(row: CaptureKnowledgeRow): WikiPage {
  return {
    id: row.wiki_page_id,
    user_id: row.user_id,
    title: row.wiki_title,
    slug: row.wiki_slug,
    content_markdown: row.wiki_content_markdown,
    status: row.wiki_status,
    created_at: row.wiki_created_at,
    updated_at: row.wiki_updated_at,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown recovery error";
}
