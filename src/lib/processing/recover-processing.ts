import { query } from "@/lib/db";
import { processCaptureById } from "@/lib/processing/process-capture";

type Dispatcher = "none" | "inngest" | "inline";

interface InterruptedJobRow {
  capture_id: string;
  job_id: string;
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
