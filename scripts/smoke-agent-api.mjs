import { createHash, randomBytes, randomUUID, scrypt as scryptCallback } from "crypto";
import { unlink } from "fs/promises";
import path from "path";
import pg from "pg";
import nextEnv from "@next/env";
import { promisify } from "util";
import { deflateSync } from "zlib";

const { Client } = pg;
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const scrypt = promisify(scryptCallback);

const baseUrl = trimTrailingSlash(process.env.SIFT_BASE_URL || "http://localhost:3000");
const agentApiKey = process.env.SIFT_AGENT_API_KEY || "";
const authRequired = process.env.SIFT_REQUIRE_AUTH !== "false";
const smokeEmail = process.env.SIFT_SMOKE_EMAIL || "local@sift.dev";
const smokePassword = process.env.SIFT_SMOKE_PASSWORD || "SiftLocal123!";
const marker = `codex-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`;
const headers = {
  "Content-Type": "application/json",
};

if (agentApiKey) {
  headers.Authorization = `Bearer ${agentApiKey}`;
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
const cleanupState = {
  captureIds: new Set(),
  uploadUrls: new Set(),
};

const FONT = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
};

try {
  await client.connect();
  if (authRequired) {
    await ensureSmokeUser();
    await authenticateSmokeUser();
  }
  await assertServerReachable();
  await assertMcpInitialize();
  await assertMcpToolsList();
  await assertMcpResourceTemplatesList();
  await assertAgentQueryValidation();
  await assertCaptureFirstE2e();
  console.log("Agent API smoke checks passed.");
} finally {
  await cleanupSmokeData().catch((error) => {
    console.warn(`Smoke cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
  });
  await client.end().catch(() => undefined);
}

async function assertServerReachable() {
  try {
    await fetch(`${baseUrl}/api/mcp`, {
      method: "GET",
      headers,
    });
  } catch (error) {
    throw new Error(`Sift server is not reachable at ${baseUrl}. Start it with npm run dev or npm start first.`);
  }
}

async function assertMcpInitialize() {
  const response = await postJson("/api/mcp", {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "sift-smoke",
        version: "0.1.0",
      },
    },
  });
  const body = await readJson(response);

  assert(response.ok, "MCP initialize should return 2xx", body);
  assert(body.result?.protocolVersion === "2025-11-25", "MCP initialize should return protocolVersion", body);
  assert(body.result?.capabilities?.tools, "MCP initialize should advertise tools capability", body);
  assert(body.result?.capabilities?.resources, "MCP initialize should advertise resources capability", body);
}

async function assertMcpToolsList() {
  const response = await postJson("/api/mcp", {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  const body = await readJson(response);
  const toolNames = new Set((body.result?.tools || []).map((tool) => tool.name));

  assert(response.ok, "MCP tools/list should return 2xx", body);
  assert(toolNames.has("sift_query"), "MCP tools/list should include sift_query", body);
  assert(toolNames.has("sift_get_source"), "MCP tools/list should include sift_get_source", body);
  assert(toolNames.has("sift_get_wiki_page"), "MCP tools/list should include sift_get_wiki_page", body);
}

async function assertMcpResourceTemplatesList() {
  const response = await postJson("/api/mcp", {
    jsonrpc: "2.0",
    id: 3,
    method: "resources/templates/list",
    params: {},
  });
  const body = await readJson(response);
  const templates = new Set((body.result?.resourceTemplates || []).map((template) => template.uriTemplate));

  assert(response.ok, "MCP resources/templates/list should return 2xx", body);
  assert(templates.has("sift://source/{sourceId}"), "MCP should expose source resource template", body);
  assert(templates.has("sift://wiki/{slug}"), "MCP should expose wiki resource template", body);
}

async function assertAgentQueryValidation() {
  const response = await postJson("/api/agent/query", {
    query: "",
  });
  const body = await readJson(response);

  assert(response.status === 400, "Agent query should reject empty query", body);
  assert(typeof body.error === "string", "Agent query validation should return an error message", body);
}

async function assertCaptureFirstE2e() {
  const textCaptureId = await createTextCapture();
  const imageCaptureId = await createImageCapture();
  const rows = await waitForCaptureCompletion([textCaptureId, imageCaptureId]);
  const textRow = rows.find((row) => row.capture_id === textCaptureId);
  const imageRow = rows.find((row) => row.capture_id === imageCaptureId);

  assert(textRow?.capture_status === "completed", "Text capture should complete processing", textRow);
  assert(textRow?.source_id, "Text capture should create a Source", textRow);
  assert(textRow?.wiki_id, "Text capture should create a WikiPage", textRow);
  assert(imageRow?.capture_status === "completed", "Image capture should complete processing", imageRow);
  assert(imageRow?.extraction_method === "vision_ocr", "Image capture should use vision OCR", imageRow);
  assert(/SIFT|OCR|SMOKE|2026/i.test(imageRow?.extracted_text || ""), "OCR text should include smoke image text", imageRow);

  const chineseSlug = `中文-smoke-${marker.slice(-8)}`;
  await client.query("update wiki_pages set slug = $1 where id = $2", [chineseSlug, textRow.wiki_id]);
  await client.query(
    `
      insert into knowledge_edges (
        user_id,
        from_type,
        from_id,
        to_type,
        to_id,
        edge_type,
        weight,
        confidence,
        evidence,
        dedupe_key
      )
      select
        c.user_id,
        'wiki_page',
        $1::uuid,
        'wiki_page',
        $2::uuid,
        'related_wiki',
        0.9,
        0.95,
        '{"reason":"smoke_graph_aware_retrieval"}'::jsonb,
        'smoke:' || $1::text || ':related:' || $2::text
      from captures c
      where c.id = $3
      on conflict (user_id, dedupe_key) do nothing
    `,
    [textRow.wiki_id, imageRow.wiki_id, textCaptureId],
  );

  const wikiResponse = await fetch(`${baseUrl}/wiki/${encodeURIComponent(chineseSlug)}`, {
    headers: getNonJsonHeaders(),
  });
  const wikiHtml = await wikiResponse.text();
  assert(wikiResponse.ok, "Encoded Chinese wiki slug should render a Wiki page", {
    status: wikiResponse.status,
    snippet: wikiHtml.slice(0, 240),
  });

  const wikiAskResponse = await postJson(`/api/wiki/${encodeURIComponent(chineseSlug)}/ask`, {
    question: "这页主要说什么？",
  });
  const wikiAskBody = await readJson(wikiAskResponse);
  assert(wikiAskResponse.ok, "Wiki Ask should support encoded Chinese slugs", wikiAskBody);
  assert(wikiAskBody.answer, "Wiki Ask should return an answer", wikiAskBody);

  const askResponse = await postJson("/api/ask", {
    question: "SIFT OCR SMOKE 2026",
  });
  const askBody = await readJson(askResponse);
  assert(askResponse.ok, "Global Ask should return 2xx for OCR content", askBody);
  assert((askBody.retrieval?.contexts || []).length > 0, "Global Ask should retrieve OCR contexts", askBody);

  const agentResponse = await postJson("/api/agent/query", {
    query: "SIFT OCR SMOKE 2026",
    limit: 5,
  });
  const agentBody = await readJson(agentResponse);
  assert(agentResponse.ok, "Agent Query should return 2xx for OCR content", agentBody);
  assert((agentBody.contexts || []).length > 0, "Agent Query should return OCR contexts", agentBody);

  const graphResponse = await postJson("/api/agent/query", {
    query: `相关资料 ${marker}`,
    limit: 8,
  });
  const graphBody = await readJson(graphResponse);
  const graphContexts = graphBody.contexts || [];
  assert(graphResponse.ok, "Agent Query should return 2xx for graph-aware retrieval", graphBody);
  assert(
    graphContexts.some((context) => context.scores?.graph > 0 && context.graph?.path?.length > 0),
    "Agent Query should expose graph-aware retrieval metadata",
    graphBody,
  );
}

async function createTextCapture() {
  const response = await postJson("/api/captures", {
    text: [
      `中文 Smoke 测试 ${marker}`,
      "Sift should save raw input first, process it in the background, and create a traceable wiki page.",
    ].join("\n"),
    note: `${marker}-text`,
  });
  const body = await readJson(response);
  const captureId = body.capture?.id;

  assert(response.status === 201, "Text capture should return 201", body);
  assert(captureId, "Text capture should return capture id", body);
  cleanupState.captureIds.add(captureId);
  return captureId;
}

async function createImageCapture() {
  const formData = new FormData();
  formData.append("note", `${marker}-ocr`);
  formData.append("files", new Blob([createSmokePng()], { type: "image/png" }), "sift-ocr-smoke.png");

  const response = await fetch(`${baseUrl}/api/captures`, {
    method: "POST",
    headers: getNonJsonHeaders(),
    body: formData,
  });
  const body = await readJson(response);
  const captureId = body.capture?.id;

  assert(response.status === 201, "Image capture should return 201", body);
  assert(captureId, "Image capture should return capture id", body);
  cleanupState.captureIds.add(captureId);

  for (const attachment of body.capture?.raw_attachments || []) {
    if (attachment.url) {
      cleanupState.uploadUrls.add(attachment.url);
    }
  }

  return captureId;
}

async function authenticateSmokeUser() {
  let response = await postJson("/api/auth/login", {
    email: smokeEmail,
    password: smokePassword,
  });

  if (!response.ok) {
    response = await postJson("/api/auth/signup", {
      displayName: "Sift Smoke",
      email: smokeEmail,
      password: smokePassword,
    });
  }

  const body = await readJson(response);
  assert(response.ok, "Smoke auth should log in or create a test account", {
    ...body,
    hint: "Set SIFT_SMOKE_EMAIL/SIFT_SMOKE_PASSWORD to an existing account, or enable first-account signup on a fresh database.",
    status: response.status,
  });

  const cookie = extractCookie(response.headers.get("set-cookie"));
  assert(cookie, "Smoke auth should return a session cookie", body);
  headers.Cookie = cookie;
}

async function ensureSmokeUser() {
  const provisionSetting = process.env.SIFT_SMOKE_PROVISION_USER;
  const shouldProvision =
    provisionSetting === "true" || (provisionSetting !== "false" && smokeEmail.trim().toLowerCase() === "local@sift.dev");

  if (!shouldProvision) {
    return;
  }

  const email = smokeEmail.trim().toLowerCase();
  const passwordHash = await hashSmokePassword(smokePassword);
  const userCount = await client.query("select count(*)::int as count from users");

  if ((userCount.rows[0]?.count || 0) === 0) {
    return;
  }

  await client.query(
    `
      insert into users (email, display_name, password_hash)
      values ($1, $2, $3)
      on conflict (email) do update
      set password_hash = excluded.password_hash,
          display_name = coalesce(users.display_name, excluded.display_name),
          updated_at = now()
    `,
    [email, "Sift Smoke", passwordHash],
  );
  await client.query("delete from auth_rate_limits where key = any($1::text[])", [
    [getEmailLoginRateLimitKey(email), getIpLoginRateLimitKey("unknown")],
  ]);
}

async function hashSmokePassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await scrypt(password, salt, 64);

  return `scrypt$${salt}$${Buffer.from(derivedKey).toString("base64url")}`;
}

function getEmailLoginRateLimitKey(email) {
  return createHash("sha256").update(`login:email:${email.trim().toLowerCase()}`).digest("hex");
}

function getIpLoginRateLimitKey(ip) {
  return createHash("sha256").update(`login:ip:${ip}`).digest("hex");
}

async function waitForCaptureCompletion(captureIds) {
  const deadline = Date.now() + Number(process.env.SIFT_SMOKE_TIMEOUT_MS || 120000);
  let lastRows = [];

  while (Date.now() < deadline) {
    lastRows = await loadCaptureRows(captureIds);

    if (lastRows.length === captureIds.length && lastRows.every((row) => row.job_status === "completed")) {
      return lastRows;
    }

    const failed = lastRows.find((row) => row.job_status === "failed" || row.capture_status === "failed");

    if (failed) {
      throw new Error(`Capture processing failed: ${JSON.stringify(failed, null, 2)}`);
    }

    await sleep(1500);
  }

  throw new Error(`Timed out waiting for capture processing.\nLast rows: ${JSON.stringify(lastRows, null, 2)}`);
}

async function loadCaptureRows(captureIds) {
  const result = await client.query(
    `
      select
        c.id as capture_id,
        c.status::text as capture_status,
        c.raw_attachments,
        p.status::text as job_status,
        p.current_step,
        p.error_message as job_error,
        ec.extraction_method,
        ec.content_text as extracted_text,
        ec.error_message as extraction_error,
        s.id as source_id,
        wp.id as wiki_id,
        wp.slug as wiki_slug
      from captures c
      left join processing_jobs p on p.capture_id = c.id
      left join extracted_contents ec on ec.capture_id = c.id
      left join sources s on s.capture_id = c.id
      left join source_wiki_pages swp on swp.source_id = s.id
      left join wiki_pages wp on wp.id = swp.wiki_page_id
      where c.id = any($1::uuid[])
      order by c.created_at
    `,
    [captureIds],
  );

  for (const row of result.rows) {
    for (const attachment of row.raw_attachments || []) {
      if (attachment.url) {
        cleanupState.uploadUrls.add(attachment.url);
      }
    }
  }

  return result.rows;
}

async function cleanupSmokeData() {
  const captureIds = Array.from(cleanupState.captureIds);

  if (captureIds.length > 0) {
    const targetWikiIds = await loadTargetWikiIds(captureIds);

    await client.query(
      `
        with target_sources as (
          select id from sources where capture_id = any($1::uuid[])
        )
        delete from chunks
        where (parent_type = 'source' and parent_id in (select id from target_sources))
           or (parent_type = 'wiki_page' and parent_id = any($2::uuid[]))
      `,
      [captureIds, targetWikiIds],
    );
    await client.query(
      `
        with target_wikis as (
          select unnest($2::uuid[]) as id
        )
        delete from audit_logs
        where resource_id in (
          select id::text from captures where id = any($1::uuid[])
          union select id::text from sources where capture_id = any($1::uuid[])
          union select id::text from target_wikis
        )
      `,
      [captureIds, targetWikiIds],
    );
    await client.query(
      `
        with target_sources as (
          select id from sources where capture_id = any($1::uuid[])
        ),
        target_wikis as (
          select unnest($2::uuid[]) as id
        )
        delete from knowledge_edges
        where (from_type = 'source' and from_id in (select id from target_sources))
           or (to_type = 'source' and to_id in (select id from target_sources))
           or (from_type = 'wiki_page' and from_id in (select id from target_wikis))
           or (to_type = 'wiki_page' and to_id in (select id from target_wikis))
      `,
      [captureIds, targetWikiIds],
    );
    await client.query("delete from captures where id = any($1::uuid[])", [captureIds]);

    if (targetWikiIds.length > 0) {
      await client.query("delete from wiki_pages where id = any($1::uuid[])", [targetWikiIds]);
    }
  }

  await cleanupUploads();
}

async function loadTargetWikiIds(captureIds) {
  const result = await client.query(
    `
      select distinct wp.id
      from sources s
      join source_wiki_pages swp on swp.source_id = s.id
      join wiki_pages wp on wp.id = swp.wiki_page_id
      where s.capture_id = any($1::uuid[])
    `,
    [captureIds],
  );

  return result.rows.map((row) => row.id);
}

async function cleanupUploads() {
  for (const url of cleanupState.uploadUrls) {
    const filename = getCaptureUploadFilename(url);

    if (!filename) {
      continue;
    }

    await unlink(path.join(process.cwd(), ".data", "uploads", "captures", filename)).catch(() => undefined);
  }
}

async function postJson(route, payload) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function getNonJsonHeaders() {
  const result = {};

  if (headers.Authorization) {
    result.Authorization = headers.Authorization;
  }

  if (headers.Cookie) {
    result.Cookie = headers.Cookie;
  }

  return result;
}

function extractCookie(setCookieHeader) {
  return setCookieHeader?.split(",").map((value) => value.trim()).find((value) => value.startsWith("sift_session="))?.split(";")[0] || "";
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

function assert(condition, message, body) {
  if (condition) {
    return;
  }

  const details = body ? `\nResponse: ${JSON.stringify(body, null, 2)}` : "";
  throw new Error(`${message}${details}`);
}

function createSmokePng() {
  const scale = 14;
  const margin = 36;
  const lines = ["SIFT OCR SMOKE 2026", "DEEPSEEK OCR"];
  const charWidth = 5 * scale;
  const charGap = scale;
  const lineHeight = 7 * scale;
  const lineGap = 28;
  const width = Math.max(...lines.map((line) => line.length * charWidth + (line.length - 1) * charGap)) + margin * 2;
  const height = lines.length * lineHeight + (lines.length - 1) * lineGap + margin * 2;
  const pixels = Buffer.alloc(width * height * 3, 255);

  lines.forEach((line, lineIndex) => {
    let x = margin;
    const y = margin + lineIndex * (lineHeight + lineGap);

    for (const char of line) {
      drawChar(pixels, width, x, y, char, scale);
      x += charWidth + charGap;
    }
  });

  const raw = Buffer.alloc((width * 3 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (width * 3 + 1);
    raw[rawOffset] = 0;
    pixels.copy(raw, rawOffset + 1, y * width * 3, (y + 1) * width * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 2, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawChar(pixels, width, x, y, char, scale) {
  const glyph = FONT[char] || FONT[" "];

  glyph.forEach((row, rowIndex) => {
    [...row].forEach((value, columnIndex) => {
      if (value !== "1") {
        return;
      }

      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const offset = ((y + rowIndex * scale + dy) * width + x + columnIndex * scale + dx) * 3;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
        }
      }
    });
  });
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getCaptureUploadFilename(url) {
  const prefix = "/api/uploads/captures/";

  if (!url.startsWith(prefix)) {
    return null;
  }

  const filename = url.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif|bmp|avif)$/i.test(filename)
    ? filename
    : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
