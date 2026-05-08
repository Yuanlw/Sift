import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { authorizeAgentRequest } from "@/lib/agent-auth";
import { MissingEnvError } from "@/lib/env";
import {
  listAgentResources,
  loadAgentSource,
  loadAgentWikiPage,
  queryAgentContext,
  readAgentResource,
} from "@/lib/sift-query";
import { getAgentUserContextFromRequest, type UserContext } from "@/lib/user-context";

const MCP_PROTOCOL_VERSION = "2025-11-25";

const toolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.unknown()).optional(),
});

const resourceReadSchema = z.object({
  uri: z.string().trim().min(1),
});

const siftQueryArgsSchema = z.object({
  query: z.string().trim().min(1).max(1200),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

const siftSourceArgsSchema = z.object({
  sourceId: z.string().uuid(),
});

const siftWikiArgsSchema = z.object({
  slug: z.string().trim().min(1).max(240),
});

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId | null;
  method?: string;
  params?: unknown;
}

export async function POST(request: Request) {
  try {
    const originError = validateMcpOrigin(request);

    if (originError) {
      return originError;
    }

    const unauthorized = await authorizeAgentRequest(request);

    if (unauthorized) {
      return unauthorized;
    }

    const payload = await request.json();

    if (Array.isArray(payload)) {
      return NextResponse.json(jsonRpcError(undefined, -32600, "JSON-RPC batching is not supported."), {
        status: 400,
      });
    }

    const userContext = await getAgentUserContextFromRequest(request);
    const response = await handleJsonRpc(payload as JsonRpcRequest, userContext, request);

    if (!response) {
      return new NextResponse(null, { status: 202 });
    }

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof MissingEnvError) {
      return NextResponse.json(
        jsonRpcError(undefined, -32000, "Sift 还没有完成本地环境配置。", { missingKeys: error.missingKeys }),
        { status: 503 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown MCP error";
    return NextResponse.json(jsonRpcError(undefined, -32700, message), { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Sift MCP does not expose an SSE stream." }, { status: 405 });
}

async function handleJsonRpc(rpcRequest: JsonRpcRequest, userContext: UserContext, httpRequest: Request) {
  const id = typeof rpcRequest.id === "string" || typeof rpcRequest.id === "number" ? rpcRequest.id : undefined;
  const isNotification = !("id" in rpcRequest);

  if (isNotification) {
    return null;
  }

  if (rpcRequest.id === null) {
    return jsonRpcError(undefined, -32600, "Request id must be a string or number.");
  }

  if (rpcRequest.jsonrpc && rpcRequest.jsonrpc !== "2.0") {
    return jsonRpcError(id, -32600, "Invalid JSON-RPC version.");
  }

  switch (rpcRequest.method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          resources: {
            listChanged: false,
          },
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: "sift",
          version: "0.1.0",
        },
      });

    case "ping":
      return jsonRpcResult(id, {});

    case "tools/list":
      return jsonRpcResult(id, {
        tools: [
          {
            name: "sift_query",
            title: "Query Sift",
            description: "Search the user's Sift knowledge base and return reusable context chunks with citations.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Question or search query for the knowledge base.",
                },
                limit: {
                  type: "integer",
                  minimum: 1,
                  maximum: 12,
                  description: "Maximum number of context chunks to return.",
                },
              },
              required: ["query"],
              additionalProperties: false,
            },
          },
          {
            name: "sift_get_source",
            title: "Get Sift Source",
            description: "Fetch a source document, its extracted text, and linked WikiPages by source id.",
            inputSchema: {
              type: "object",
              properties: {
                sourceId: {
                  type: "string",
                  format: "uuid",
                  description: "Sift Source id.",
                },
              },
              required: ["sourceId"],
              additionalProperties: false,
            },
          },
          {
            name: "sift_get_wiki_page",
            title: "Get Sift WikiPage",
            description: "Fetch a WikiPage markdown document and its supporting sources by slug.",
            inputSchema: {
              type: "object",
              properties: {
                slug: {
                  type: "string",
                  description: "Sift WikiPage slug.",
                },
              },
              required: ["slug"],
              additionalProperties: false,
            },
          },
        ],
      });

    case "resources/list": {
      const resources = await listAgentResources(userContext.userId);
      return jsonRpcResult(id, { resources });
    }

    case "resources/templates/list":
      return jsonRpcResult(id, {
        resourceTemplates: [
          {
            uriTemplate: "sift://source/{sourceId}",
            name: "Sift Source",
            title: "Sift Source",
            description: "Read a Sift source document by Source id.",
            mimeType: "application/json",
          },
          {
            uriTemplate: "sift://wiki/{slug}",
            name: "Sift WikiPage",
            title: "Sift WikiPage",
            description: "Read a Sift WikiPage by slug.",
            mimeType: "application/json",
          },
        ],
      });

    case "resources/read":
      return handleResourceRead(id, rpcRequest.params, userContext, httpRequest);

    case "tools/call":
      return handleToolCall(id, rpcRequest.params, userContext, httpRequest);

    default:
      return jsonRpcError(id, -32601, `Unsupported MCP method: ${rpcRequest.method || "unknown"}`);
  }
}

async function handleResourceRead(
  id: JsonRpcId | undefined,
  params: unknown,
  userContext: UserContext,
  request: Request,
) {
  try {
    const args = resourceReadSchema.parse(params);
    const resource = await readAgentResource(userContext.userId, args.uri);

    if (!resource) {
      await writeAuditLog({
        userId: userContext.userId,
        action: "mcp.resource.read",
        resourceType: "mcp_resource",
        resourceId: args.uri,
        status: "denied",
        request,
      });
      return jsonRpcError(id, -32002, `Resource not found: ${args.uri}`);
    }

    await writeAuditLog({
      userId: userContext.userId,
      action: "mcp.resource.read",
      resourceType: "mcp_resource",
      resourceId: args.uri,
      status: "success",
      request,
    });

    return jsonRpcResult(id, {
      contents: [resource],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonRpcError(id, -32602, error.issues[0]?.message || "Invalid resource arguments.");
    }

    throw error;
  }
}

async function handleToolCall(id: JsonRpcId | undefined, params: unknown, userContext: UserContext, request: Request) {
  try {
    const toolCall = toolCallSchema.parse(params);

    if (toolCall.name === "sift_query") {
      const args = siftQueryArgsSchema.parse(toolCall.arguments || {});
      const result = await queryAgentContext({
        userId: userContext.userId,
        query: args.query,
        limit: args.limit,
      });
      await writeAuditLog({
        userId: userContext.userId,
        action: "mcp.tool.sift_query",
        resourceType: "knowledge_base",
        status: "success",
        request,
        metadata: {
          context_count: result.contexts.length,
          citation_count: result.citations.length,
        },
      });
      return jsonRpcResult(id, toolResult(result));
    }

    if (toolCall.name === "sift_get_source") {
      const args = siftSourceArgsSchema.parse(toolCall.arguments || {});
      const source = await loadAgentSource(userContext.userId, args.sourceId);

      if (!source) {
        await writeAuditLog({
          userId: userContext.userId,
          action: "mcp.tool.sift_get_source",
          resourceType: "source",
          resourceId: args.sourceId,
          status: "denied",
          request,
        });
        return jsonRpcResult(id, toolResult({ error: "Source not found." }, true));
      }

      await writeAuditLog({
        userId: userContext.userId,
        action: "mcp.tool.sift_get_source",
        resourceType: "source",
        resourceId: args.sourceId,
        status: "success",
        request,
      });

      return jsonRpcResult(id, toolResult({ source }));
    }

    if (toolCall.name === "sift_get_wiki_page") {
      const args = siftWikiArgsSchema.parse(toolCall.arguments || {});
      const wikiPage = await loadAgentWikiPage(userContext.userId, args.slug);

      if (!wikiPage) {
        await writeAuditLog({
          userId: userContext.userId,
          action: "mcp.tool.sift_get_wiki_page",
          resourceType: "wiki_page",
          resourceId: args.slug,
          status: "denied",
          request,
        });
        return jsonRpcResult(id, toolResult({ error: "WikiPage not found." }, true));
      }

      await writeAuditLog({
        userId: userContext.userId,
        action: "mcp.tool.sift_get_wiki_page",
        resourceType: "wiki_page",
        resourceId: args.slug,
        status: "success",
        request,
      });

      return jsonRpcResult(id, toolResult({ wikiPage }));
    }

    return jsonRpcResult(id, toolResult({ error: `Unknown tool: ${toolCall.name}` }, true));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonRpcResult(id, toolResult({ error: error.issues[0]?.message || "Invalid tool arguments." }, true));
    }

    throw error;
  }
}

function toolResult(payload: unknown, isError = false) {
  const text = JSON.stringify(payload, null, 2);

  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    structuredContent: payload,
    isError,
  };
}

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

function validateMcpOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return null;
  }

  const requestUrl = new URL(request.url);
  const originUrl = new URL(origin);

  if (originUrl.host === requestUrl.host) {
    return null;
  }

  const allowedLocalHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  if (allowedLocalHosts.has(originUrl.hostname) && allowedLocalHosts.has(requestUrl.hostname)) {
    return null;
  }

  return NextResponse.json(jsonRpcError(undefined, -32000, "Invalid Origin header."), { status: 403 });
}
