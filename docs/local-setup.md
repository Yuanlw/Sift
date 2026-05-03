# 本地启动

## 前置条件

- Node.js 20+
- npm
- Docker Desktop
- 本地 OpenAI-compatible 模型服务，或其他兼容 `/v1/chat/completions` 和 `/v1/embeddings` 的模型服务
- Inngest 开发环境

## 安装依赖

```bash
npm install
```

## 环境变量

复制环境变量模板：

```bash
cp .env.example .env.local
```

填写：

- `DATABASE_URL`
- `MODEL_PROVIDER`
- `MODEL_BASE_URL`
- `MODEL_API_KEY`
- `MODEL_TEXT_MODEL`
- `MODEL_EMBEDDING_MODEL`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `SIFT_SINGLE_USER_ID`

Phase 0 使用 hardcoded 单用户，`SIFT_SINGLE_USER_ID` 可以先保留默认值。

## 数据库

本地优先使用 Docker 启动 Postgres + pgvector：

```bash
npm run db:up
```

默认连接：

```text
postgres://sift:sift@localhost:5432/sift
```

容器首次启动会自动执行：

```text
supabase/schema.sql
```

这个 schema 会创建：

- `captures`
- `processing_jobs`
- `sources`
- `wiki_pages`
- `source_wiki_pages`
- `chunks`
- pgvector extension

如果未来使用 Supabase、Neon、RDS 或其他 Postgres 服务，只要执行同一份 schema，并把 `DATABASE_URL` 改成对应连接串即可。

## 模型

Phase 0 不绑定 OpenAI 官方服务。默认使用 OpenAI-compatible API：

```text
MODEL_BASE_URL=http://127.0.0.1:9000/v1
MODEL_TEXT_MODEL=Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit
MODEL_EMBEDDING_MODEL=bge-m3-mlx-fp16
MODEL_API_KEY=local
```

只要本地模型服务提供：

- `/v1/chat/completions`
- `/v1/embeddings`

Sift 就可以先用本地模型跑通。

## 开发命令

```bash
npm run dev
```

检查：

```bash
npm run typecheck
npm run lint
npm run build
```

## Phase 0 当前链路

1. 用户在 `/inbox` 提交链接或文本。
2. `/api/captures` 创建 Capture 和 ProcessingJob。
3. API 发送 `capture/process.requested` 事件。
4. Inngest 调用 `processCapture`。
5. 任务提取文本，生成 Source、draft WikiPage、chunks 和 embeddings。

## 当前限制

- 图片上传 UI 还没接入，只预留了数据结构。
- 还没有正式账号系统。
- 还没有知识库级问答。
- 模型层当前先支持 OpenAI-compatible provider，后续再增加 Anthropic、OpenAI、Gemini 等专用 adapter。
