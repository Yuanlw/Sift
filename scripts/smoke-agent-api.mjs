const baseUrl = trimTrailingSlash(process.env.SIFT_BASE_URL || "http://localhost:3000");
const agentApiKey = process.env.SIFT_AGENT_API_KEY || "";

const headers = {
  "Content-Type": "application/json",
};

if (agentApiKey) {
  headers.Authorization = `Bearer ${agentApiKey}`;
}

await assertServerReachable();
await assertMcpInitialize();
await assertMcpToolsList();
await assertMcpResourceTemplatesList();
await assertAgentQueryValidation();

console.log("Agent API smoke checks passed.");

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

async function postJson(path, payload) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
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

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
