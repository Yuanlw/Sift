import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupportAdminFromRequest } from "@/lib/admin-auth";
import { normalizeEmail } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { query } from "@/lib/db";
import { validateSameOriginRequest } from "@/lib/request-security";
import { AuthenticationRequiredError } from "@/lib/user-context";

export const runtime = "nodejs";

const supportNoteSchema = z.object({
  contactStatus: z.enum(["not_contacted", "contacted", "waiting_user", "resolved"]),
  issueType: z.enum(["billing", "refund", "gateway", "quota", "login", "product", "other"]),
  note: z.string().trim().min(1).max(4000),
  userEmail: z.string().trim().email(),
});

interface UserRow {
  email: string;
  id: string;
}

interface NoteRow {
  id: string;
  user_email: string;
}

export async function POST(request: Request) {
  let adminUserId: string | null = null;

  try {
    const originError = validateSameOriginRequest(request);

    if (originError) {
      return originError;
    }

    const admin = await getSupportAdminFromRequest(request);

    if (!admin) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    adminUserId = admin.userId;
    const body = supportNoteSchema.parse(await readBody(request));
    const user = await findUserByEmail(normalizeEmail(body.userEmail));

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const result = await query<NoteRow>(
      `
        insert into support_case_notes (
          user_id,
          admin_user_id,
          user_email,
          issue_type,
          contact_status,
          note
        )
        values ($1, $2, $3, $4, $5, $6)
        returning id, user_email
      `,
      [user.id, admin.userId, user.email, body.issueType, body.contactStatus, body.note],
    );
    const note = result.rows[0];

    await writeAuditLog({
      action: "support_case.note.create",
      metadata: {
        contact_status: body.contactStatus,
        issue_type: body.issueType,
        user_email: user.email,
      },
      request,
      resourceId: note.id,
      resourceType: "support_case_note",
      status: "success",
      userId: admin.userId,
    });

    const url = new URL("/admin/account-support", request.url);
    url.searchParams.set("email", note.user_email);
    url.searchParams.set("status", "note_created");
    return NextResponse.redirect(url, 303);
  } catch (error) {
    if (adminUserId) {
      await writeAuditLog({
        action: "support_case.note.error",
        metadata: {
          error: error instanceof Error ? error.message : "Unknown support note error",
        },
        request,
        resourceType: "support_case_note",
        status: "failure",
        userId: adminUserId,
      });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || "Invalid support note input." }, { status: 400 });
    }

    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Unknown support note error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function findUserByEmail(email: string) {
  const result = await query<UserRow>("select id, email from users where email = $1 limit 1", [email]);
  return result.rows[0] || null;
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  return Object.fromEntries((await request.formData()).entries());
}
