import { inngest } from "@/lib/inngest/client";
import { recoverProcessingBacklog } from "@/lib/processing/recover-processing";

export const recoverProcessing = inngest.createFunction(
  { id: "recover-processing-backlog" },
  // Inngest cron is UTC by default; 19:00 UTC is 03:00 in Asia/Shanghai.
  { cron: "0 19 * * *" },
  async ({ step }) =>
    step.run("recover processing backlog", async () =>
      recoverProcessingBacklog({
        embeddingLimit: 50,
        enrichmentLimit: 50,
        fullReprocessLimit: 20,
        staleSeconds: 60 * 60,
      }),
    ),
);
