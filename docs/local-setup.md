# 本地启动

## 前置条件

- Node.js 20+
- npm
- Supabase 项目
- OpenAI API Key
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

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_TEXT_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `SIFT_SINGLE_USER_ID`

Phase 0 使用 hardcoded 单用户，`SIFT_SINGLE_USER_ID` 可以先保留默认值。

## 数据库

在 Supabase SQL Editor 中执行：

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
- Supabase 类型暂时使用运行时客户端，等真实数据库稳定后再用 Supabase CLI 生成类型。
