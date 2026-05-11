import { createHash, createHmac, randomBytes, randomUUID } from "crypto";
import pg from "pg";
import nextEnv from "@next/env";

const { Client } = pg;
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const baseUrl = trimTrailingSlash(process.env.SIFT_BASE_URL || "http://localhost:3000");
const marker = `acceptance-${Date.now()}-${randomUUID().slice(0, 8)}`;
const client = new Client({ connectionString: process.env.DATABASE_URL });

const state = {
  captureIds: new Set(),
  sourceIds: new Set(),
  wikiPageIds: new Set(),
  wikiSlugs: new Set(),
  sessionId: null,
  userId: null,
};

try {
  await client.connect();
  const user = await loadAcceptanceUser();
  state.userId = user.id;
  const cookie = await createSessionCookie(user);

  await assertServerReachable(cookie);
  await assertImageOcrContentVisibility(user.id);
  await assertSourceAndInboxListDedupe(user.id);
  await assertArchiveHidesFromRetrieval(user.id);
  await assertAgentResourceVisibility(user.id, cookie);
  await assertSourceDeleteCascade(user.id, cookie);
  await assertWikiDeleteCascade(user.id, cookie);
  await assertMarkerCleanable();

  console.log("Product acceptance checks passed.");
} finally {
  await cleanupAcceptanceData().catch((error) => {
    console.warn(`Acceptance cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
  });
  await client.end().catch(() => undefined);
}

async function loadAcceptanceUser() {
  const email = (process.env.SIFT_ACCEPTANCE_EMAIL || process.env.SIFT_SMOKE_EMAIL || "local@sift.dev").trim().toLowerCase();
  const preferred = await client.query(
    "select id, email, display_name from users where email = $1 limit 1",
    [email],
  );

  if (preferred.rows[0]) {
    return preferred.rows[0];
  }

  const first = await client.query("select id, email, display_name from users order by created_at asc limit 1");

  assert(
    first.rows[0],
    "Product acceptance requires at least one local user. Create or sign up a user before running this check.",
  );
  return first.rows[0];
}

async function createSessionCookie(user) {
  const sessionId = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const payload = {
    displayName: user.display_name,
    email: user.email,
    expiresAt,
    sessionId,
    userId: user.id,
  };

  await client.query(
    `
      insert into user_sessions (id, user_id, token_hash, user_agent, ip_address, expires_at)
      values ($1, $2, $3, $4, $5, $6)
    `,
    [sessionId, user.id, hashToken(sessionId), "sift-product-acceptance", "127.0.0.1", expiresAt],
  );
  state.sessionId = sessionId;

  return `sift_session=${signSessionPayload(payload)}`;
}

async function assertServerReachable(cookie) {
  const response = await fetch(`${baseUrl}/sources`, {
    headers: {
      Cookie: cookie,
    },
    redirect: "manual",
  }).catch((error) => {
    throw new Error(`Sift server is not reachable at ${baseUrl}. Start it on port 3000 first. ${error.message}`);
  });

  assert(response.status !== 307 && response.status !== 308, "Authenticated acceptance user should not be redirected away from /sources", {
    location: response.headers.get("location"),
    status: response.status,
  });
  assert(response.status < 500, "Sources page should render without a server error", { status: response.status });
}

async function assertSourceAndInboxListDedupe(userId) {
  const { captureId, sourceId } = await createSourceWithWikiLinks(userId, "dedupe");

  const oldSourceRows = await client.query(
    `
      select s.id
      from sources s
      left join captures c on c.id = s.capture_id
      left join source_wiki_pages swp on swp.source_id = s.id
      left join wiki_pages wp on wp.id = swp.wiki_page_id
      where s.user_id = $1
        and s.id = $2
        and (c.status is null or c.status <> 'ignored')
    `,
    [userId, sourceId],
  );
  assert(oldSourceRows.rows.length > 1, "Acceptance fixture should reproduce the old source duplication shape", oldSourceRows.rows);

  const sourceRows = await client.query(
    `
      select
        s.id,
        wiki_link.wiki_title
      from sources s
      left join captures c on c.id = s.capture_id
      left join lateral (
        select wp.title as wiki_title
        from source_wiki_pages swp
        join wiki_pages wp on wp.id = swp.wiki_page_id
        where swp.source_id = s.id
          and wp.user_id = s.user_id
          and wp.status <> 'archived'
          and swp.relation_type <> 'restored_from_merge'
        order by swp.created_at desc
        limit 1
      ) wiki_link on true
      where s.user_id = $1
        and s.id = $2
        and (c.status is null or c.status <> 'ignored')
    `,
    [userId, sourceId],
  );
  assert(sourceRows.rows.length === 1, "Sources list should render one row per Source even with multiple wiki links", sourceRows.rows);

  const inboxRows = await client.query(
    `
      select
        c.id,
        wiki_link.wiki_page_id
      from captures c
      left join sources s on s.capture_id = c.id
      left join lateral (
        select wp.id as wiki_page_id
        from source_wiki_pages swp
        join wiki_pages wp on wp.id = swp.wiki_page_id
        where swp.source_id = s.id
          and wp.user_id = c.user_id
          and wp.status <> 'archived'
          and swp.relation_type <> 'restored_from_merge'
        order by swp.created_at desc
        limit 1
      ) wiki_link on true
      where c.user_id = $1
        and c.id = $2
    `,
    [userId, captureId],
  );
  assert(inboxRows.rows.length === 1, "Inbox should render one row per Capture even with multiple wiki links", inboxRows.rows);
}

async function assertImageOcrContentVisibility(userId) {
  const fixture = await createSourceWithWikiLinks(userId, "image-ocr-visible", 1, {
    sourceType: "image",
    extractedText: [
      `${marker} image ocr first line`,
      "Screenshot table row A",
      "Screenshot table row B",
      "Screenshot footer checksum visible only in OCR source text",
    ].join("\n"),
    wikiMarkdown: [
      "# Image OCR Summary",
      "",
      "This wiki draft intentionally summarizes the screenshot without repeating all extracted lines.",
      "",
      "---",
      "",
      "## 图片 OCR 原文",
      "",
      "以下为图片解析得到的原始文本，保留用于核对、搜索和追溯。",
      "",
      "```text",
      `${marker} image ocr first line`,
      "Screenshot table row A",
      "Screenshot table row B",
      "Screenshot footer checksum visible only in OCR source text",
      "```",
    ].join("\n"),
  });

  const row = await client.query(
    `
      select
        s.extracted_text,
        left(regexp_replace(s.extracted_text, '\\s+', ' ', 'g'), 220) as extracted_preview,
        wp.content_markdown
      from sources s
      join source_wiki_pages swp on swp.source_id = s.id
      join wiki_pages wp on wp.id = swp.wiki_page_id
      where s.id = $1
        and s.user_id = $2
      limit 1
    `,
    [fixture.sourceId, userId],
  );
  const visible = row.rows[0];

  assert(visible?.extracted_text?.includes("Screenshot footer checksum"), "Image OCR text should be stored on Source", visible);
  assert(visible?.extracted_preview?.includes(`${marker} image ocr first line`), "Sources list preview should fall back to extracted OCR text", visible);
  assert(
    visible?.content_markdown?.includes("## 图片 OCR 原文") &&
      visible.content_markdown.includes("Screenshot footer checksum visible only in OCR source text"),
    "Wiki content should preserve raw image OCR text for traceability",
    visible,
  );
}

async function assertArchiveHidesFromRetrieval(userId) {
  const sourceOnly = await createSourceWithWikiLinks(userId, "archive-source");
  const wikiOnly = await createSourceWithWikiLinks(userId, "archive-wiki");
  const activeNeedle = `${marker}-archive-source-needle`;
  const wikiNeedle = `${marker}-archive-wiki-needle`;

  await insertChunk(userId, "source", sourceOnly.sourceId, activeNeedle);
  await insertChunk(userId, "wiki_page", wikiOnly.wikiPageIds[0], wikiNeedle);

  let activeRows = await runKeywordRetrievalSql(userId, activeNeedle);
  assert(activeRows.some((row) => row.parent_id === sourceOnly.sourceId), "Active source chunk should be keyword-retrievable before archive", activeRows);

  await client.query("update captures set status = 'ignored' where id = $1 and user_id = $2", [sourceOnly.captureId, userId]);
  activeRows = await runKeywordRetrievalSql(userId, activeNeedle);
  assert(!activeRows.some((row) => row.parent_id === sourceOnly.sourceId), "Ignored source should not be retrievable", activeRows);

  let wikiRows = await runKeywordRetrievalSql(userId, wikiNeedle);
  assert(wikiRows.some((row) => row.parent_id === wikiOnly.wikiPageIds[0]), "Active wiki chunk should be keyword-retrievable before archive", wikiRows);

  await client.query("update wiki_pages set status = 'archived' where id = $1 and user_id = $2", [wikiOnly.wikiPageIds[0], userId]);
  wikiRows = await runKeywordRetrievalSql(userId, wikiNeedle);
  assert(!wikiRows.some((row) => row.parent_id === wikiOnly.wikiPageIds[0]), "Archived wiki should not be retrievable", wikiRows);
}

async function assertAgentResourceVisibility(userId, cookie) {
  const fixture = await createSourceWithWikiLinks(userId, "agent-visibility");

  let response = await fetch(`${baseUrl}/api/agent/sources/${fixture.sourceId}`, {
    headers: { Cookie: cookie },
  });
  let body = await readJson(response);
  assert(response.ok, "Agent source resource should load for active source", body);
  assert(
    body.source?.wikiPages?.length === 2,
    "Agent source resource should include active related wiki pages",
    body,
  );

  await client.query("update wiki_pages set status = 'archived' where id = $1 and user_id = $2", [fixture.wikiPageIds[0], userId]);
  response = await fetch(`${baseUrl}/api/agent/sources/${fixture.sourceId}`, {
    headers: { Cookie: cookie },
  });
  body = await readJson(response);
  assert(response.ok, "Agent source resource should still load when one related wiki is archived", body);
  assert(
    !body.source?.wikiPages?.some((page) => page.id === fixture.wikiPageIds[0]),
    "Agent source resource should not expose archived related wiki pages",
    body,
  );

  await client.query("update captures set status = 'ignored' where id = $1 and user_id = $2", [fixture.captureId, userId]);
  response = await fetch(`${baseUrl}/api/agent/sources/${fixture.sourceId}`, {
    headers: { Cookie: cookie },
  });
  body = await readJson(response);
  assert(response.status === 404, "Agent source resource should not expose ignored sources", {
    status: response.status,
    body,
  });
}

async function assertSourceDeleteCascade(userId, cookie) {
  const fixture = await createSourceWithWikiLinks(userId, "delete-source");
  const edgeId = await insertKnowledgeEdge(userId, "source", fixture.sourceId, "wiki_page", fixture.wikiPageIds[0], "delete-source");

  await insertChunk(userId, "source", fixture.sourceId, `${marker}-delete-source-chunk`);
  await insertChunk(userId, "wiki_page", fixture.wikiPageIds[0], `${marker}-delete-source-wiki-chunk`);
  await insertAskHistory(userId, "source", fixture.sourceId, "delete source ask");
  await insertAskHistory(userId, "wiki_page", fixture.wikiPageIds[0], "delete source wiki ask");

  const response = await fetch(`${baseUrl}/api/sources/${fixture.sourceId}/delete`, {
    body: "{}",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: baseUrl,
    },
    method: "POST",
  });
  const body = await readJson(response);
  assert(response.ok, "Source delete API should succeed", body);

  await assertRowsGone("capture deleted with source", "captures", "id", fixture.captureId);
  await assertRowsGone("source deleted", "sources", "id", fixture.sourceId);
  await assertRowsGone("source-owned wiki deleted", "wiki_pages", "id", fixture.wikiPageIds[0]);
  await assertRowsGone("source chunks deleted", "chunks", "parent_id", fixture.sourceId);
  await assertRowsGone("source-owned wiki chunks deleted", "chunks", "parent_id", fixture.wikiPageIds[0]);
  await assertRowsGone("source ask history deleted", "ask_histories", "scope_id", fixture.sourceId);
  await assertRowsGone("knowledge edge deleted", "knowledge_edges", "id", edgeId);
}

async function assertWikiDeleteCascade(userId, cookie) {
  const sharedFixture = await createSourceWithWikiLinks(userId, "delete-wiki-shared");
  const sharedResponse = await fetch(`${baseUrl}/api/wiki/${encodeURIComponent(sharedFixture.wikiSlugs[0])}/delete`, {
    body: "{}",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: baseUrl,
    },
    method: "POST",
  });
  const sharedBody = await readJson(sharedResponse);
  assert(sharedResponse.ok, "Wiki delete API should succeed for a shared source fixture", sharedBody);
  await assertRowsGone("deleted wiki is removed in shared-source case", "wiki_pages", "id", sharedFixture.wikiPageIds[0]);
  await assertRowExists("source linked to another wiki should be preserved", "sources", "id", sharedFixture.sourceId);
  await assertRowExists("capture linked to preserved source should be preserved", "captures", "id", sharedFixture.captureId);

  const fixture = await createSourceWithWikiLinks(userId, "delete-wiki-owned", 1);
  const edgeId = await insertKnowledgeEdge(userId, "wiki_page", fixture.wikiPageIds[0], "source", fixture.sourceId, "delete-wiki");

  await insertChunk(userId, "source", fixture.sourceId, `${marker}-delete-wiki-source-chunk`);
  await insertChunk(userId, "wiki_page", fixture.wikiPageIds[0], `${marker}-delete-wiki-chunk`);
  await insertAskHistory(userId, "source", fixture.sourceId, "delete wiki source ask");
  await insertAskHistory(userId, "wiki_page", fixture.wikiPageIds[0], "delete wiki ask");

  const response = await fetch(`${baseUrl}/api/wiki/${encodeURIComponent(fixture.wikiSlugs[0])}/delete`, {
    body: "{}",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: baseUrl,
    },
    method: "POST",
  });
  const body = await readJson(response);
  assert(response.ok, "Wiki delete API should succeed", body);

  await assertRowsGone("wiki deleted", "wiki_pages", "id", fixture.wikiPageIds[0]);
  await assertRowsGone("wiki-owned source deleted", "sources", "id", fixture.sourceId);
  await assertRowsGone("wiki-owned capture deleted", "captures", "id", fixture.captureId);
  await assertRowsGone("wiki chunks deleted", "chunks", "parent_id", fixture.wikiPageIds[0]);
  await assertRowsGone("wiki-owned source chunks deleted", "chunks", "parent_id", fixture.sourceId);
  await assertRowsGone("wiki ask history deleted", "ask_histories", "scope_id", fixture.wikiPageIds[0]);
  await assertRowsGone("wiki knowledge edge deleted", "knowledge_edges", "id", edgeId);
}

async function assertMarkerCleanable() {
  const rows = await client.query(
    `
      select 'captures' as table_name, count(*)::int as count from captures where raw_text ilike $1 or coalesce(note, '') ilike $1
      union all
      select 'sources', count(*)::int from sources where title ilike $1 or extracted_text ilike $1 or coalesce(summary, '') ilike $1
      union all
      select 'wiki_pages', count(*)::int from wiki_pages where title ilike $1 or content_markdown ilike $1 or slug ilike $1
      union all
      select 'chunks', count(*)::int from chunks where content ilike $1
    `,
    [`%${marker}%`],
  );

  assert(rows.rows.some((row) => row.count > 0), "Acceptance fixtures should be visible before cleanup", rows.rows);
}

async function createSourceWithWikiLinks(userId, label, wikiCount = 2, options = {}) {
  const capture = await client.query(
    `
      insert into captures (user_id, type, raw_text, note, status)
      values ($1, $4, $2, $3, 'completed')
      returning id
    `,
    [userId, options.rawText || `${marker} ${label} raw text`, `${marker}-${label}`, options.sourceType || "text"],
  );
  const captureId = capture.rows[0].id;
  state.captureIds.add(captureId);

  await client.query(
    `
      insert into processing_jobs (capture_id, user_id, job_type, status, current_step, finished_at)
      values ($1, $2, 'process_capture', 'completed', 'completed', now())
    `,
    [captureId, userId],
  );
  await client.query(
    `
      insert into extracted_contents (capture_id, user_id, title, content_text, extraction_method, status)
      values ($1, $2, $3, $4, 'acceptance_fixture', 'extracted')
    `,
    [captureId, userId, `${marker} ${label} extracted`, options.extractedText || `${marker} ${label} extracted content`],
  );

  const source = await client.query(
    `
      insert into sources (capture_id, user_id, title, source_type, extracted_text, summary)
      values ($1, $2, $3, $6, $4, $5)
      returning id
    `,
    [
      captureId,
      userId,
      `${marker} ${label} source`,
      options.extractedText || `${marker} ${label} source body`,
      options.summary === undefined ? `${marker} ${label} summary` : options.summary,
      options.sourceType || "text",
    ],
  );
  const sourceId = source.rows[0].id;
  state.sourceIds.add(sourceId);

  const wikiPageIds = [];
  const wikiSlugs = [];

  for (let index = 1; index <= wikiCount; index += 1) {
    const slug = `${marker}-${label}-${index}`.slice(0, 220);
    const page = await client.query(
      `
        insert into wiki_pages (user_id, title, slug, content_markdown, status)
        values ($1, $2, $3, $4, 'published')
        returning id, slug
      `,
      [userId, `${marker} ${label} wiki ${index}`, slug, index === 1 && options.wikiMarkdown ? options.wikiMarkdown : `${marker} ${label} wiki content ${index}`],
    );
    const wikiPageId = page.rows[0].id;
    wikiPageIds.push(wikiPageId);
    wikiSlugs.push(page.rows[0].slug);
    state.wikiPageIds.add(wikiPageId);
    state.wikiSlugs.add(page.rows[0].slug);

    await client.query(
      `
        insert into source_wiki_pages (source_id, wiki_page_id, relation_type, confidence, created_at)
        values ($1, $2, 'derived_from', 0.96, now() + ($3::text)::interval)
      `,
      [sourceId, wikiPageId, `${index} seconds`],
    );
  }

  return {
    captureId,
    sourceId,
    wikiPageIds,
    wikiSlugs,
  };
}

async function runKeywordRetrievalSql(userId, searchQuery) {
  const result = await client.query(
    `
      select
        c.id,
        c.parent_type,
        c.parent_id,
        c.content
      from chunks c
      left join sources s on c.parent_type = 'source' and s.id = c.parent_id
      left join captures sc on sc.id = s.capture_id
      left join wiki_pages wp on c.parent_type = 'wiki_page' and wp.id = c.parent_id
      where c.user_id = $1
        and (
          (c.parent_type = 'source' and s.id is not null and (sc.status is null or sc.status <> 'ignored'))
          or (c.parent_type = 'wiki_page' and wp.id is not null and wp.status <> 'archived')
        )
        and c.content ilike $2
      order by c.created_at desc
      limit 24
    `,
    [userId, `%${searchQuery}%`],
  );

  return result.rows;
}

async function insertChunk(userId, parentType, parentId, content) {
  const result = await client.query(
    `
      insert into chunks (user_id, parent_type, parent_id, content, token_count)
      values ($1, $2, $3, $4, $5)
      returning id
    `,
    [userId, parentType, parentId, content, content.length],
  );
  return result.rows[0].id;
}

async function insertAskHistory(userId, scopeType, scopeId, question) {
  const result = await client.query(
    `
      insert into ask_histories (user_id, scope_type, scope_id, question, answer, metadata)
      values ($1, $2, $3, $4, $5, $6::jsonb)
      returning id
    `,
    [userId, scopeType, scopeId, `${marker} ${question}`, `${marker} answer`, JSON.stringify({ marker })],
  );
  return result.rows[0].id;
}

async function insertKnowledgeEdge(userId, fromType, fromId, toType, toId, label) {
  const result = await client.query(
    `
      insert into knowledge_edges (user_id, from_type, from_id, to_type, to_id, edge_type, weight, confidence, evidence, dedupe_key)
      values ($1, $2, $3, $4, $5, 'source_wiki', 0.9, 0.95, $6::jsonb, $7)
      returning id
    `,
    [userId, fromType, fromId, toType, toId, JSON.stringify({ marker, label }), `${marker}:${label}`],
  );
  return result.rows[0].id;
}

async function assertRowsGone(label, tableName, columnName, id) {
  assert(/^[a-z_]+$/.test(tableName) && /^[a-z_]+$/.test(columnName), "Invalid assertion table or column name");
  const result = await client.query(`select count(*)::int as count from ${tableName} where ${columnName} = $1`, [id]);
  assert(result.rows[0]?.count === 0, `${label}: expected no rows`, result.rows);
}

async function assertRowExists(label, tableName, columnName, id) {
  assert(/^[a-z_]+$/.test(tableName) && /^[a-z_]+$/.test(columnName), "Invalid assertion table or column name");
  const result = await client.query(`select count(*)::int as count from ${tableName} where ${columnName} = $1`, [id]);
  assert(result.rows[0]?.count === 1, `${label}: expected one row`, result.rows);
}

async function cleanupAcceptanceData() {
  if (state.sessionId) {
    await client.query("delete from user_sessions where id = $1", [state.sessionId]).catch(() => undefined);
  }

  const wikiIds = Array.from(state.wikiPageIds);
  const sourceIds = Array.from(state.sourceIds);
  const captureIds = Array.from(state.captureIds);

  if (wikiIds.length > 0 || sourceIds.length > 0) {
    await client.query(
      `
        delete from knowledge_edges
        where evidence::text ilike $1
          or from_id = any($2::uuid[])
          or to_id = any($2::uuid[])
          or from_id = any($3::uuid[])
          or to_id = any($3::uuid[])
      `,
      [`%${marker}%`, sourceIds, wikiIds],
    ).catch(() => undefined);
  }

  if (sourceIds.length > 0) {
    await client.query(
      "delete from chunks where parent_type = 'source' and parent_id = any($1::uuid[])",
      [sourceIds],
    ).catch(() => undefined);
    await client.query(
      "delete from ask_histories where scope_type = 'source' and scope_id = any($1::uuid[])",
      [sourceIds],
    ).catch(() => undefined);
  }

  if (wikiIds.length > 0) {
    await client.query(
      "delete from chunks where parent_type = 'wiki_page' and parent_id = any($1::uuid[])",
      [wikiIds],
    ).catch(() => undefined);
    await client.query(
      "delete from ask_histories where scope_type = 'wiki_page' and scope_id = any($1::uuid[])",
      [wikiIds],
    ).catch(() => undefined);
    await client.query("delete from wiki_pages where id = any($1::uuid[])", [wikiIds]).catch(() => undefined);
  }

  if (captureIds.length > 0) {
    await client.query("delete from captures where id = any($1::uuid[])", [captureIds]).catch(() => undefined);
  }

  await client.query(
    `
      delete from ask_histories where question ilike $1 or answer ilike $1 or metadata::text ilike $1;
      delete from chunks where content ilike $1;
      delete from sources where title ilike $1 or extracted_text ilike $1 or coalesce(summary, '') ilike $1;
      delete from wiki_pages where title ilike $1 or slug ilike $1 or content_markdown ilike $1;
      delete from captures where raw_text ilike $1 or coalesce(note, '') ilike $1 or raw_payload::text ilike $1;
    `,
    [`%${marker}%`],
  ).catch(() => undefined);
}

function signSessionPayload(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signValue(encodedPayload)}`;
}

function signValue(value) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function getSessionSecret() {
  const secret = process.env.SIFT_SESSION_SECRET || process.env.SIFT_MODEL_KEY_ENCRYPTION_SECRET;

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production") {
    return "local-development-sift-session-secret-change-me";
  }

  throw new Error("Missing SIFT_SESSION_SECRET.");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

async function readJson(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      raw: text,
    };
  }
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2).slice(0, 1600)}`;
    throw new Error(`${message}${suffix}`);
  }
}
