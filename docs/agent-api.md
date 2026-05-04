# Sift Agent API

Sift 的 Agent 接入层用于外部工作台拉取长期知识上下文，不负责执行通用动作。

当前提供两种入口：

- HTTP Query API：适合 Codex、Claude Code、脚本或内部服务直接调用。
- MCP endpoint：适合支持 Model Context Protocol 的 Agent 客户端把 Sift 挂成工具。

## 认证

本地开发默认不强制认证。

如果配置了 `SIFT_AGENT_API_KEY`，所有 Agent API 和 MCP 请求都需要携带：

```text
Authorization: Bearer <SIFT_AGENT_API_KEY>
```

## HTTP API

### 查询知识库上下文

```text
POST /api/agent/query
Content-Type: application/json
```

请求：

```json
{
  "query": "我保存过哪些关于企业 Agent 选型的资料？",
  "limit": 6
}
```

响应会返回可直接塞进外部 Agent prompt 的 `contexts`，以及可追溯的 `citations`。

### 获取 Source

```text
GET /api/agent/sources/:id
```

返回单份来源资料、提取正文、摘要、原始链接、关联 WikiPage。

### 获取 WikiPage

```text
GET /api/agent/wiki/:slug
```

返回知识页 Markdown、状态、更新时间和支撑 Sources。

## MCP Endpoint

```text
POST /api/mcp
```

当前 MCP endpoint 是无状态 JSON-RPC 入口，暴露三个工具：

- `sift_query`：检索知识库并返回上下文片段和引用。
- `sift_get_source`：按 Source id 拉取来源正文。
- `sift_get_wiki_page`：按 WikiPage slug 拉取知识页和支撑来源。

同时暴露两类可读资源：

- `sift://source/{sourceId}`：读取单份 Source。
- `sift://wiki/{slug}`：读取单篇 WikiPage。

客户端可以通过 `resources/list` 查看最近的 Sift 资源，通过 `resources/templates/list` 获取 URI 模板，通过 `resources/read` 读取具体资源。

示例 `tools/call`：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "sift_query",
    "arguments": {
      "query": "Capture-first 的核心原则是什么？",
      "limit": 5
    }
  }
}
```

## 返回结构约定

上下文片段包含：

- `label`：引用标签，例如 `K1`。
- `parentType`：`source` 或 `wiki_page`。
- `content`：召回片段正文。
- `sourceId` / `wikiSlug` / `originalUrl`：可追溯引用。
- `score` 和 `matchReasons`：便于外部 Agent 判断可信度。

外部 Agent 生成文章、研究笔记或行动清单时，应保留 `label`，必要时再通过 Source 或 WikiPage 详情接口补全文。

## Smoke Check

启动 Sift 后可以运行：

```bash
npm run smoke:agent
```

默认检查 `http://localhost:3000`。如果本地服务不在默认地址，可以指定：

```bash
SIFT_BASE_URL=http://127.0.0.1:3001 npm run smoke:agent
```

如果配置了 `SIFT_AGENT_API_KEY`，脚本会自动读取同名环境变量并发送 Bearer Token。
