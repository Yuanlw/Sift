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

本机开发和本机测试以 `.env.local` 为准。`npm run dev`、`npm run build`、`npm run start` 会按 Next.js 规则加载 `.env.local`；`npm run smoke:agent` 也会主动加载同一份配置。

复制环境变量模板：

```bash
cp .env.example .env.local
```

填写：

- `DATABASE_URL`
- `MODEL_PROVIDER`
- `MODEL_BASE_URL`
- `MODEL_API_KEY`
- `SIFT_MODEL_GATEWAY_BASE_URL`
- `SIFT_MODEL_GATEWAY_API_KEY`
- `MODEL_TEXT_MODEL`
- `MODEL_TEXT_THINKING`
- `MODEL_TEXT_REASONING_EFFORT`
- `MODEL_EMBEDDING_MODEL`
- `MODEL_EMBEDDING_DIMENSIONS`
- `MODEL_VISION_BASE_URL`
- `MODEL_VISION_API_KEY`
- `MODEL_VISION_MODEL`
- `JOB_DISPATCHER`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `SIFT_SINGLE_USER_ID`
- `SIFT_REQUIRE_AUTH`
- `SIFT_SESSION_SECRET`
- `SIFT_TRUST_USER_HEADER`
- `SIFT_USER_ID_HEADER`
- `SIFT_AGENT_API_KEY`

本地账号体系默认开启，`SIFT_REQUIRE_AUTH=true` 时核心页面和用户 API 需要登录。首次打开 `/signup` 创建第一个账号时，Sift 会把原来的 `SIFT_SINGLE_USER_ID` 默认用户数据认领到这个新账号下。

登录后可以在 `/settings` 更新显示名称、修改密码或退出登录。修改密码会保留当前会话，并让其他已登录会话失效。

登录接口带基础防暴力破解：同一邮箱或同一来源 IP 在 15 分钟内连续失败 5 次，会锁定 15 分钟；正常登录成功后会清理失败记录。

浏览器登录态的写接口带同源校验：当请求带有跨站 `Origin`，或没有 `Origin` 但 `Referer` 跨站时，会被拒绝。这个校验覆盖保存、导入、补充、重试、忽略、问答、发现合并、归档/删除、模型设置和账单入口。Agent/MCP、Inngest、Stripe Webhook 和维护任务属于外部集成入口，使用各自的认证方式。

`SIFT_SINGLE_USER_ID` 仍用于兼容旧数据、受信 Header 和不启用登录的本地模式。新部署可以保留默认值；已有部署不要随意改这个 UUID。

`SIFT_SESSION_SECRET` 用于签名登录 Cookie。本地开发可以使用模板里的值；生产环境必须替换成至少 32 个字符的随机密钥。

`SIFT_ALLOW_PUBLIC_SIGNUP=false` 时只允许创建第一个账号。已有账号后再次访问 `/signup` 会显示公开注册已关闭；如需临时开放注册，显式改成 `true`。

`SIFT_AGENT_API_KEY` 是可选项。`SIFT_REQUIRE_AUTH=true` 时，Agent API / MCP 必须携带登录 session 或正确的 Bearer Token；`SIFT_REQUIRE_AUTH=false` 时才允许本地匿名调试。只有一个真实账号时，Agent API / MCP 会自动使用这个账号的数据；多账号部署使用 Agent Key 时必须配置 `SIFT_AGENT_USER_ID`，否则会拒绝请求，避免误读默认空用户。

`MODEL_VISION_*` 是图片 OCR 使用的 OpenAI-compatible 视觉模型配置。留空时会复用文本模型配置；如果文本模型不支持图片输入，图片会保存原始附件并降级为 fallback。上传文件会保存在私有 `.data/uploads/captures` 目录，通过授权 API 读取；当前只支持图片文件，单张 10MB，一次最多 6 张。

`SIFT_REQUIRE_AUTH=false` 时会回到本地默认用户模式，适合一次性调试，不建议公开部署使用。

`SIFT_TRUST_USER_HEADER=false` 时使用 Sift 自己的登录 session。只有在反向代理或网关已经完成认证时，才建议改成 `true`，此时 Sift 会从 `SIFT_USER_ID_HEADER` 指定的请求头读取用户 UUID。

配置文件用途：

- `.env.local`：本机开发和本机测试的真实配置，优先维护这一份。
- `.env.example`：给 `.env.local` 用的模板，不放真实密钥。
- `.env`：Docker Compose 全量启动时读取。
- `.env.docker.example`：给 `.env` 用的模板，容器内地址可能和 `.env.local` 不同。

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

如果使用个人订阅或托管默认模型，可以改用 Sift Model Gateway：

```text
SIFT_MODEL_GATEWAY_BASE_URL=https://gateway.example.com/v1
SIFT_MODEL_GATEWAY_API_KEY=your-sift-gateway-token
```

这两个变量是 Sift 网关授权，不是底层模型供应商 API Key，必须成对填写。只填写 `SIFT_MODEL_GATEWAY_BASE_URL` 或只填写 `SIFT_MODEL_GATEWAY_API_KEY` 会被视为配置错误，避免把网关 endpoint 和本地 key 混用。配置完整后，默认模型会优先走 Sift Gateway；`MODEL_TEXT_BASE_URL`、`MODEL_EMBEDDING_BASE_URL` 或 `MODEL_VISION_BASE_URL` 单独填写时仍会覆盖对应角色。使用 Sift Gateway 时，待处理内容会发送到云端模型服务；如果需要完全离线，应使用自定义本地模型模式。

Gateway token 应从 Sift 账号/订阅中心签发，并只保存在本机服务端配置里。更换电脑、疑似泄露或取消订阅时，应该在账号中心吊销旧 token，再替换 `SIFT_MODEL_GATEWAY_API_KEY` 并重启本地服务。它不应该被当作 OpenAI、Claude、Gemini、DeepSeek、Qwen 或 Kimi 的供应商 API Key 分发给用户。

如果本地环境也承担早期运营/客服查询，可配置只读后台白名单：

```text
SIFT_ADMIN_EMAILS=ops@example.com,support@example.com
```

未配置时 `/admin/account-support` 默认关闭；配置后只有白名单邮箱登录后才能按用户邮箱查询订阅、额度、token prefix 和最近 Gateway 拒绝原因。

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

默认 smoke 账号是 `local@sift.dev` / `SiftLocal123!`，可用 `SIFT_SMOKE_EMAIL`、`SIFT_SMOKE_PASSWORD` 覆盖。

注意：为了保护首次账号认领旧数据的路径，smoke 脚本不会在零账号数据库里直接插入用户；零账号时会走 `/api/auth/signup`。数据库已有账号时，脚本才会按需 provision 默认 smoke 用户，并清理对应登录限流记录。

如果需要检查非默认端口：

```bash
SIFT_BASE_URL=http://127.0.0.1:3001 npm run smoke:agent
```

## 处理兜底

Sift 会通过 Inngest 注册一个每日恢复任务，默认按 UTC `19:00` 执行，也就是北京时间凌晨 `03:00`。它会低频扫描处理链路里的未完成、失败或降级步骤：

- 卡在 `queued` / `running` 的任务，或抓取、提取、结构化、生成 Source/Wiki、切分片段等关键步骤失败的资料，会重新跑完整处理。
- 已经生成 Source/Wiki/Chunks、但 embedding 缺失的资料，只补写缺失 chunk 的向量，不重写知识页。
- 发现关系和推荐这类后置增强步骤失败时，会单独补跑。

本地开发时也可以手动触发一次：

```bash
curl -X POST http://localhost:3000/api/maintenance/recover-processing
```

生产环境建议配置 `SIFT_AGENT_API_KEY`，然后携带 `Authorization: Bearer <key>` 触发该维护接口。

## Phase 0 当前链路

1. 用户在 `/inbox` 提交链接、文本或图片。
2. `/api/captures` 创建 Capture 和 ProcessingJob。
3. API 按 `JOB_DISPATCHER` 配置派发后台处理。
4. 后台调用 `processCapture`。
5. 任务提取文本，生成 Source、draft WikiPage、chunks、embeddings 和隐形关系边。

## 当前限制

- 图片可以上传并保存原始附件，OCR 依赖 `MODEL_VISION_*` 指向的视觉模型能力；PDF 和音频暂未开放上传处理。
- 已有本地邮箱密码账号和 HttpOnly session；当前还没有邮箱验证、找回密码、团队空间、邀请成员和第三方登录。
- 知识库级问答已有基础版本，但还没有完整的权限、审计和评测体系。
- 模型层当前先支持 OpenAI-compatible provider，后续再增加 OpenAI、Anthropic、Google Gemini、阿里 Qwen、DeepSeek、豆包、智谱 AI、Kimi 等专用 adapter。
