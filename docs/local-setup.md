# 本地启动

## 前置条件

- Node.js 20+
- npm
- Docker Desktop
- 云模型、本地模型或自定义中转站模型；第一轮只要求兼容 `/v1/chat/completions` 和 `/v1/embeddings`
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
- `MODEL_EMBEDDING_DIMENSIONS`
- `MODEL_VISION_BASE_URL`
- `MODEL_VISION_API_KEY`
- `MODEL_VISION_MODEL`
- `JOB_DISPATCHER`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `SIFT_SINGLE_USER_ID`
- `SIFT_TRUST_USER_HEADER`
- `SIFT_USER_ID_HEADER`
- `SIFT_AGENT_API_KEY`

Phase 0 使用 hardcoded 单用户，`SIFT_SINGLE_USER_ID` 可以先保留默认值。

`SIFT_AGENT_API_KEY` 是可选项。留空时本地 Agent API 不强制认证；填写后，`/api/agent/*` 和 `/api/mcp` 请求需要携带 Bearer Token。

`MODEL_VISION_*` 是图片 OCR 使用的 OpenAI-compatible 视觉模型配置。留空时会复用文本模型配置；如果文本模型不支持图片输入，图片会保存原始附件并降级为 fallback。上传文件会保存在私有 `.data/uploads/captures` 目录，通过授权 API 读取；当前只支持图片文件，单张 10MB，一次最多 6 张。

`SIFT_TRUST_USER_HEADER=false` 时保持单用户模式。只有在反向代理或网关已经完成认证时，才建议改成 `true`，此时 Sift 会从 `SIFT_USER_ID_HEADER` 指定的请求头读取用户 UUID。

## 启动方式

Sift 支持几种运行方式：

- Docker Compose 全量启动：App + Postgres + pgvector
- 本机开发：本机跑 Next.js，Docker 只跑数据库
- 完全本机：自己安装 Postgres + pgvector
- 云部署：App 和数据库分别托管

完整说明见 [部署方式](deployment.md)。

## 数据库

本地开发建议使用 Docker 启动 Postgres + pgvector：

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

Sift 不以本地模型为唯一方向，也不绑定 OpenAI 官方服务。第一轮默认使用 OpenAI-compatible API，是为了同时兼容本地模型、云模型的中转网关和自定义模型服务：

```text
MODEL_BASE_URL=http://127.0.0.1:9000/v1
MODEL_TEXT_MODEL=Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit
MODEL_EMBEDDING_MODEL=bge-m3-mlx-fp16
MODEL_EMBEDDING_DIMENSIONS=1024
MODEL_API_KEY=local
```

只要模型服务提供：

- `/v1/chat/completions`
- `/v1/embeddings`

Sift 就可以先跑通。这个服务可以是本地服务，也可以是 One API、LiteLLM、vLLM、自建网关，或云模型厂商的 OpenAI-compatible 入口。

后续应提供专用 provider adapter，优先覆盖：

- OpenAI、Anthropic、Google Gemini
- 阿里 Qwen、DeepSeek、豆包、智谱 AI、Kimi
- Ollama、LM Studio、MLX、vLLM 等本地模型入口

文本生成、embedding 和视觉 OCR 不要求使用同一家模型。项目内部也应该保留切换空间，方便比较不同模型在提取、总结、问答和 OCR 上的实际效果。

## 任务派发

Capture-first P0 默认：

```text
JOB_DISPATCHER=inline
```

这表示保存请求只负责写入 Capture 和 ProcessingJob，然后立刻返回；处理链路会在本地进程里异步启动，不在用户等待的请求里同步提取、总结或写 embedding。

需要后台处理时改成：

```text
JOB_DISPATCHER=inngest
```

并配置本地或云端 Inngest。需要只保存不处理时，可以临时改成：

```text
JOB_DISPATCHER=none
```

## 开发命令

```bash
npm run dev
```

Docker 数据库已经启动过之后，`schema.sql` 不会自动重新执行。升级已有 Docker 数据库时运行：

```bash
npm run docker:migrate
```

如果只是本地测试、数据库里没有需要保留的资料，也可以重建 Docker 卷：

```bash
npm run docker:reset
```

只启动开发数据库时，对应命令是：

```bash
npm run db:migrate
```

检查：

```bash
npm run typecheck
npm run lint
npm run build
```

Agent API / MCP smoke check：

```bash
npm run smoke:agent
```

## Phase 0 当前链路

1. 用户在 `/inbox` 提交链接、文本或图片。
2. `/api/captures` 创建 Capture 和 ProcessingJob。
3. API 按 `JOB_DISPATCHER` 配置派发后台处理。
4. 后台调用 `processCapture`。
5. 任务提取文本，生成 Source、draft WikiPage、chunks 和 embeddings。

## 当前限制

- 图片可以上传并保存原始附件，OCR 依赖 `MODEL_VISION_*` 指向的视觉模型能力；PDF 和音频暂未开放上传处理。
- 还没有正式账号系统；当前多用户模式依赖受信任网关传入用户 UUID 请求头。
- 知识库级问答已有基础版本，但还没有完整的权限、审计和评测体系。
- 模型层当前先支持 OpenAI-compatible provider，后续再增加 OpenAI、Anthropic、Google Gemini、阿里 Qwen、DeepSeek、豆包、智谱 AI、Kimi 等专用 adapter。
