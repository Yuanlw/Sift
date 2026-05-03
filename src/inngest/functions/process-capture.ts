import { inngest } from "@/lib/inngest/client";
import { processCaptureById } from "@/lib/processing/process-capture";

export const processCapture = inngest.createFunction(
  { id: "process-capture" },
  { event: "capture/process.requested" },
  async ({ event, step }) => {
    const captureId = event.data.captureId as string;
    return step.run("process capture", async () => processCaptureById(captureId));
  },
);
