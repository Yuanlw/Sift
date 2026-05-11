import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  getCaptureUploadUrlVariants,
  getFilenameFromCaptureUploadUrl,
  getMimeTypeFromCaptureUploadFilename,
  readCaptureUpload,
} from "@/lib/upload-storage";
import { getUserContextFromRequest } from "@/lib/user-context";

interface AttachmentRow {
  mime_type: string | null;
  name: string | null;
}

export async function GET(request: Request, { params }: { params: { filename: string } }) {
  const userContext = await getUserContextFromRequest(request);
  const url = `/api/uploads/captures/${params.filename}`;
  const filename = getFilenameFromCaptureUploadUrl(url);

  if (!filename) {
    return NextResponse.json({ error: "Invalid upload filename." }, { status: 400 });
  }

  const urlVariants = getCaptureUploadUrlVariants(filename);
  const attachment = await query<AttachmentRow>(
    `
      select
        attachment ->> 'mime_type' as mime_type,
        attachment ->> 'name' as name
      from captures c
      cross join lateral jsonb_array_elements(c.raw_attachments) attachment
      where c.user_id = $1
        and attachment ->> 'url' = any($2::text[])
        and coalesce(attachment ->> 'storage', 'local') = 'local'
      limit 1
    `,
    [userContext.userId, urlVariants],
  );

  if (!attachment.rows[0]) {
    return NextResponse.json({ error: "Upload not found." }, { status: 404 });
  }

  try {
    const bytes = await readCaptureUpload(filename);
    const mimeType = attachment.rows[0].mime_type || getMimeTypeFromCaptureUploadFilename(filename);

    return new Response(bytes, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Upload file not found." }, { status: 404 });
  }
}
