import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { processCapture } from "@/inngest/functions/process-capture";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processCapture],
});
