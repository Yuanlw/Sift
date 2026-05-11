# 部署方式

Sift 应该支持多种部署和使用方式。Docker 是最方便的一种，但不是唯一方式。

部署前先按 [Deployment Readiness Checklist](deployment-readiness.md) 收口。P22 之后再讨论具体部署方式，默认优先考虑 VPS + Docker Compose + Cloudflare。

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

如果部署给个人订阅用户使用 Sift Model Gateway，不要把底层模型供应商 Key 放进用户环境变量。改用网关授权：

```text
SIFT_MODEL_GATEWAY_BASE_URL=https://gateway.example.com/v1
SIFT_MODEL_GATEWAY_API_KEY=your-sift-gateway-token
```

`SIFT_MODEL_GATEWAY_BASE_URL` 和 `SIFT_MODEL_GATEWAY_API_KEY` 必须成对填写；只填一个会让应用启动时报配置错误，避免把网关 endpoint 和本地 key 混用。`SIFT_MODEL_GATEWAY_API_KEY` 是订阅/网关授权令牌，不是 OpenAI、Claude、Gemini、DeepSeek 或 Qwen 的供应商密钥。默认模型会优先使用该网关；单独配置 `MODEL_TEXT_*`、`MODEL_EMBEDDING_*` 或 `MODEL_VISION_*` 时，对应角色仍可走自管模型。

网关令牌的生命周期应由 Sift 账号/订阅中心管理：

- 签发：订阅账号生成 scoped gateway token，本地应用只接收 token。
- 绑定：token 应绑定到 Sift 账号、套餐和可选安装设备，不绑定底层供应商账号。
- 保存：只放在服务端 `.env`、Secret Manager 或容器 secret 中，不返回给浏览器设置页。
- 轮换：更换机器、疑似泄露或团队成员离开时，先在账号中心吊销旧 token，再替换部署环境变量并重启服务。
- 吊销：取消订阅、支付失败降级或管理员手动处理时，网关侧应拒绝旧 token，不需要轮换 OpenAI/Claude/Gemini/DeepSeek/Qwen 等供应商 Key。

### VPS 上线前的重配清单

上云时不要沿用本机 `.env.local`。至少要重新配置：

- `DATABASE_URL`
- `SIFT_APP_URL`
- `SIFT_SESSION_SECRET`
- `SIFT_REQUIRE_AUTH=true`
- `SIFT_ALLOW_PUBLIC_SIGNUP=false`
- `SIFT_ADMIN_EMAILS`
- `SIFT_MODEL_KEY_ENCRYPTION_SECRET`
- `SIFT_MODEL_GATEWAY_BASE_URL` / `SIFT_MODEL_GATEWAY_API_KEY`
- `SIFT_CLOUD_CONTROL_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PERSONAL`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_TEAM`
- `SIFT_SMART_QUOTA_USD_PER_CREDIT`
- `SIFT_SMART_QUOTA_COST_MULTIPLIER`
- `SIFT_COST_TEXT_INPUT_USD_PER_MILLION_TOKENS`
- `SIFT_COST_TEXT_OUTPUT_USD_PER_MILLION_TOKENS`
- `SIFT_COST_EMBEDDING_INPUT_USD_PER_MILLION_TOKENS`
- `SIFT_COST_VISION_INPUT_USD_PER_MILLION_TOKENS`
- `SIFT_COST_VISION_OUTPUT_USD_PER_MILLION_TOKENS`
- `SIFT_COST_VISION_IMAGE_USD`

建议先按低成本 Qwen 组合起步，再根据实际调用成本调整这几个参数。`SIFT_SMART_QUOTA_USD_PER_CREDIT` 是内部额度单价，`SIFT_SMART_QUOTA_COST_MULTIPLIER` 是安全系数。前者越小，额度越细；后者越大，越不容易被成本打穿。

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

个人订阅或本地运行 + Sift Gateway 可以使用：

```text
SIFT_MODEL_GATEWAY_BASE_URL=https://gateway.example.com/v1
SIFT_MODEL_GATEWAY_API_KEY=your-sift-gateway-token
```

该 token 只代表 Sift Gateway 授权。轮换或吊销时更新 `SIFT_MODEL_GATEWAY_API_KEY` 并重启应用即可；不要把底层模型供应商 Key 分发给个人用户或写入本地订阅安装包。

如果当前部署同时承担 Sift Cloud control plane / Gateway token 校验职责，还需要配置服务端控制面密钥：

```text
SIFT_CLOUD_CONTROL_API_KEY=your-control-plane-server-key
```

这个 key 只给 Sift Model Gateway 服务端调用 `/api/gateway/tokens/validate` 使用，不应该放进个人用户本地安装环境。

P15.2 起，Gateway 应按下面顺序调用控制面：

1. 调用 `/api/gateway/tokens/validate`，校验 token 并预占 estimated credits，拿到 `authorizationId`。
2. 调用底层模型供应商。
3. 调用 `/api/gateway/usage`，把 `authorizationId` 结算为 `success` 或 `failure`，并回写实际 credits / 错误码。

本地客户端不能直接调用这些控制面接口来增加额度或绕过扣费；这些接口只接受 `SIFT_CLOUD_CONTROL_API_KEY` 保护的服务端请求。

运营/客服查询台使用单独管理员白名单：

```text
SIFT_ADMIN_EMAILS=ops@example.com,support@example.com
```

`/admin/account-support`、`/admin/refunds` 和 `/admin/retention` 默认不开放；只有已登录且邮箱命中 `SIFT_ADMIN_EMAILS` 的账号能访问。客服台展示用户订阅、额度、Gateway token prefix 和最近 Gateway 拒绝/失败原因，不显示完整 token，也不提供套餐或额度写操作；退款台只记录线下退款处理，不调用 Stripe Refund API；留存看板用于早期真实用户验证。

真实用户试运行前建议运行：

```bash
npm run verify:release
```

`verify:release` 会串联 typecheck、lint、build、trial preflight 和产品验收。产品验收会临时造数据检查列表去重、归档不可见、Agent 资源过滤和删除级联，因此运行前要保证 Postgres 与 Sift Web 服务可达。

如果当前环境可以连接数据库，也可以检查关键表是否已迁移：

```bash
node scripts/preflight-real-user.mjs --db
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
