# 部署方式

Sift 应该支持多种部署和使用方式。Docker 是最方便的一种，但不是唯一方式。

## 方式一：Docker Compose 全量启动

适合想最快跑起来的人。

包含：

- Sift Web App
- Postgres
- pgvector
- 初始化 schema

前置条件：

- Docker Desktop
- 云模型、本地模型或自定义中转站模型；第一轮要求 OpenAI-compatible 接口

步骤：

```bash
cp .env.docker.example .env
docker compose up -d --build
```

Docker Compose 默认读取 `.env`，不会读取 `.env.local`。因此全量 Docker 启动时以 `.env` 为准；本机开发和本机 smoke 测试时以 `.env.local` 为准。

访问：

```text
http://127.0.0.1:3000
```

如果数据库容器之前已经启动过，Docker 会复用旧 volume，`supabase/schema.sql` 不会再次自动执行。升级已有本地 Docker 数据库时运行：

```bash
npm run docker:migrate
```

如果只是本地测试、没有需要保留的数据，可以直接重建：

```bash
npm run docker:reset
```

已有数据的部署不要用 reset 当迁移手段。reset 会删除 Docker volume 中的数据；非一次性测试环境应使用 `npm run docker:migrate` 或手动执行 `supabase/migrations/*.sql`。

默认情况下，容器内的 Sift 会通过下面地址访问宿主机上的本地模型服务：

```text
http://host.docker.internal:9000/v1
```

如果模型服务也在 Docker 网络里，可以把 `MODEL_BASE_URL` 改成对应服务名。

## 方式二：本机开发 + Docker 数据库

适合开发 Sift 本身。

包含：

- 本机运行 Next.js
- Docker 只运行 Postgres + pgvector

步骤：

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run dev
```

这种方式下 Next.js 和 `npm run smoke:agent` 都读取 `.env.local`。

默认数据库连接：

```text
DATABASE_URL=postgres://sift:sift@localhost:5432/sift
```

访问：

```text
http://127.0.0.1:3000
```

## 方式三：完全本机运行

适合已经在本机安装 Postgres 和 pgvector 的用户。

步骤：

1. 创建数据库。
2. 执行 `supabase/schema.sql`。
3. 在 `.env.local` 中填写自己的 `DATABASE_URL`。
4. 执行 `npm run dev`。

这种方式不依赖 Docker。

## 方式四：云部署

适合未来 Beta 或生产环境。

可选组合：

- App：Vercel、Railway、Render、Fly.io、Node 服务器
- Database：Supabase、Neon、RDS、Railway Postgres、Render Postgres
- Model：OpenAI、Anthropic、Google Gemini、阿里 Qwen、DeepSeek、豆包、智谱 AI、Kimi、本地模型网关、自定义中转站

要求：

- 数据库兼容 Postgres + pgvector。
- 执行同一份 schema。
- 模型 provider 提供 Sift adapter 支持的接口。

当前公开托管还不是推荐默认形态。账号体系已有本地邮箱密码、HttpOnly session、登录限流和核心页面保护，但仍缺邮箱验证、找回密码、团队/组织、邀请和完整多租户运营能力。公开部署前应把这些作为单独阶段处理。

如果放在反向代理或认证网关后面：

- 默认使用 `SIFT_REQUIRE_AUTH=true` 和 Sift 自己的 session。
- 只有网关已经完成认证、并能保证用户 UUID 请求头不可被外部伪造时，才开启 `SIFT_TRUST_USER_HEADER=true`。
- 多账号场景下使用 Agent Bearer Token 时，必须配置 `SIFT_AGENT_USER_ID`。

## 模型部署原则

Sift 核心代码不直接绑定具体模型厂商，也不把“本地模型”作为唯一优先级。模型层应该允许用户选择自己的云模型账号、本地模型或自定义中转站。

当前第一轮支持：

```text
MODEL_PROVIDER=openai-compatible
MODEL_BASE_URL=http://127.0.0.1:9000/v1
```

后续增加专用 adapter：

- `openai`
- `anthropic`
- `google`
- `qwen`
- `deepseek`
- `doubao`
- `zhipu`
- `kimi`
- `ollama`
- `lmstudio`
- `mlx`

不同 provider 只应该影响 adapter，不应该影响业务逻辑。文本、embedding、视觉 OCR 可以分别选择不同 provider，方便项目内部评测，也方便开放后用户接入自己的模型账号。

## 任务派发

Docker 一键启动默认使用：

```text
JOB_DISPATCHER=inline
```

这会让保存请求只写入原始 Capture 和 ProcessingJob 后立刻返回，并在本地进程里异步启动处理。需要独立后台任务时切换为：

```text
JOB_DISPATCHER=inngest
```

并接入本地 Inngest dev server 或云端 Inngest。
