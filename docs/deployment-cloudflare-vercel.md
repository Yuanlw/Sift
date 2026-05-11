# Sift 云部署方案：Cloudflare + Vercel + Neon

## 架构总览

```
用户
 └─→ Cloudflare DNS / CDN（域名解析 + 边缘缓存）
       └─→ Vercel（Next.js App，Serverless Functions）
             ├─→ Neon（Postgres + pgvector，数据库）
             ├─→ Inngest（后台任务队列，替换 inline dispatcher）
             └─→ AI 模型 Provider（OpenAI / 中转站 / 自定义）
```

| 层级 | 服务 | 用途 | 费用起点 |
|---|---|---|---|
| 域名 / DNS | Cloudflare Registrar | 域名注册、DNS 解析、CDN | 成本价，约 $8–10/年 |
| App 托管 | Vercel | Next.js Serverless 部署 | 免费（Hobby） |
| 数据库 | Neon | Postgres + pgvector | 免费（0.5 GB） |
| 后台任务 | Inngest | 异步处理队列 | 免费（50k 步/月） |

---

## 第一步：注册域名（Cloudflare）

1. 打开 [cloudflare.com](https://cloudflare.com)，注册账号。
2. 进入 **Domain Registration → Register Domains**，搜索你想要的域名（建议 `.com` / `.app` / `.so`）。
3. 购买后，域名自动托管在 Cloudflare DNS，无需额外操作。

> **注意**：如果域名在其他注册商（如阿里云、腾讯云），可以将 DNS Nameserver 迁移到 Cloudflare，或者直接转移域名到 Cloudflare Registrar。迁移后 Cloudflare 接管 DNS。

---

## 第二步：创建数据库（Neon）

Sift 需要 Postgres + pgvector，Neon 原生支持，免费层够个人 MVP 使用。

1. 打开 [neon.tech](https://neon.tech)，用 GitHub 账号注册。
2. 创建新项目，选择离用户最近的区域（推荐 `AWS ap-southeast-1` 新加坡，或 `AWS us-east-1`）。
3. 项目创建后，进入 **Dashboard → Connection Details**，复制 **Connection String**，格式如下：
   ```
   postgres://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   这就是 `DATABASE_URL`，后面配置 Vercel 环境变量时会用到。

4. 在 Neon SQL Editor 里执行 Sift 的初始化 schema：
   ```sql
   -- 粘贴 supabase/schema.sql 的完整内容并执行
   ```
   或者在本地通过环境变量指向 Neon 后运行迁移：
   ```bash
   DATABASE_URL="<neon连接串>" npm run db:migrate
   ```

> **pgvector**：Neon 默认已启用 pgvector 扩展，schema.sql 里的 `CREATE EXTENSION IF NOT EXISTS vector` 会直接生效，无需额外操作。

---

## 第三步：部署到 Vercel

### 3.1 连接仓库

1. 打开 [vercel.com](https://vercel.com)，用 GitHub 账号注册。
2. 点击 **Add New Project → Import Git Repository**，选择 Sift 的 GitHub 仓库。
3. Framework 会自动识别为 **Next.js**，保持默认即可。

### 3.2 配置环境变量

在 Vercel 项目的 **Settings → Environment Variables** 里，逐一添加以下变量：

#### 必填

```env
# 数据库（Neon 连接串）
DATABASE_URL=postgres://user:password@ep-xxx.neon.tech/neondb?sslmode=require

# Session 签名密钥，生产环境必须换成随机字符串（至少 32 位）
SIFT_SESSION_SECRET=<随机生成，例如用 openssl rand -hex 32>

# 应用公开地址（绑定域名后填真实域名）
SIFT_APP_URL=https://yourdomain.com

# 后台任务模式：必须改为 inngest（见第四步）
JOB_DISPATCHER=inngest
INNGEST_EVENT_KEY=<Inngest 项目的 Event Key>
INNGEST_SIGNING_KEY=<Inngest 项目的 Signing Key>

# 认证开关
SIFT_REQUIRE_AUTH=true
SIFT_ALLOW_PUBLIC_SIGNUP=false

# 单用户 ID（保持稳定 UUID，首次部署后不要改）
SIFT_SINGLE_USER_ID=00000000-0000-0000-0000-000000000001
```

#### 模型配置（选其一）

**方案 A：使用 OpenAI 官方 API**
```env
MODEL_PROVIDER=openai-compatible
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=sk-xxxxxxx
MODEL_TEXT_MODEL=gpt-4o
MODEL_EMBEDDING_MODEL=text-embedding-3-small
MODEL_EMBEDDING_DIMENSIONS=1536
```

**方案 B：使用中转站（如 One API / LiteLLM）**
```env
MODEL_PROVIDER=openai-compatible
MODEL_BASE_URL=https://your-gateway.com/v1
MODEL_API_KEY=<中转站 Key>
MODEL_TEXT_MODEL=<你的模型名>
MODEL_EMBEDDING_MODEL=<你的 embedding 模型>
MODEL_EMBEDDING_DIMENSIONS=1024
```

#### 可选（多用户 / SaaS 场景）

```env
# 多用户部署时，自定义模型 Key 的服务端加密密钥（至少 32 位）
SIFT_MODEL_KEY_ENCRYPTION_SECRET=<随机生成>

# Stripe 计费（暂不需要可留空）
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PERSONAL=
STRIPE_PRICE_PRO=
STRIPE_PRICE_TEAM=

# 公开网站信息（Stripe 审核前填写）
SIFT_CONTACT_EMAIL=contact@yourdomain.com
SIFT_BUSINESS_NAME=Sift
SIFT_BUSINESS_ADDRESS=
```

### 3.3 部署

环境变量填好后，点击 **Deploy**。Vercel 会自动运行：
```
npm run build
```
首次部署大约 1–3 分钟完成。

---

## 第四步：配置 Inngest（后台任务队列）

这是 Vercel 部署最关键的一步。`JOB_DISPATCHER=inline` 在 Serverless 环境下不可靠——函数执行完毕进程即销毁，异步任务会被直接杀掉。必须切换为 Inngest。

### 4.1 注册 Inngest

1. 打开 [inngest.com](https://inngest.com)，注册账号（可用 GitHub 登录）。
2. 创建新应用（App），记下：
   - **Event Key**（用于发送事件）→ 填入 `INNGEST_EVENT_KEY`
   - **Signing Key**（用于验证回调签名）→ 填入 `INNGEST_SIGNING_KEY`

### 4.2 在 Vercel 里同步 Inngest

Inngest 需要知道你的 Sift 部署地址，才能回调触发任务。

1. 在 Inngest 控制台 → **Apps → Sync App**，填入：
   ```
   https://yourdomain.com/api/inngest
   ```
   （或 Vercel 自动生成的 `xxx.vercel.app/api/inngest`）
2. Inngest 会扫描该 endpoint，自动发现 Sift 注册的所有 function。

### 4.3 验证

部署完成后，在 Sift 界面里保存一条内容，进入 Inngest 控制台 **Runs** 页面，应该能看到处理任务正在执行。

---

## 第五步：绑定域名（Cloudflare + Vercel）

### 5.1 在 Vercel 添加域名

1. Vercel 项目 → **Settings → Domains → Add Domain**，填入你的域名，如 `yourdomain.com`。
2. Vercel 会给出两个 DNS 记录，选择其中一种：
   - **推荐（CNAME）**：`www → cname.vercel-dns.com`
   - **根域名（A 记录）**：`@ → 76.76.21.21`

### 5.2 在 Cloudflare 配置 DNS

1. 进入 Cloudflare Dashboard → 你的域名 → **DNS → Records**。
2. 添加上面 Vercel 给出的 DNS 记录。
3. **重要**：将该记录的 **Proxy 状态设置为 DNS only（灰云图标）**，不要开启橙云代理。
   - 原因：Vercel 需要自动申请 SSL 证书，开启 Cloudflare 代理后会干扰证书签发。
   - 等 Vercel 证书签发完成（通常几分钟）后，可以再开启橙云。

4. 回到 Vercel，等待域名状态变为 **Valid Configuration**，即绑定成功。

### 5.3 开启 Cloudflare 代理（可选）

域名在 Vercel 验证通过后，可以在 Cloudflare 将 DNS 记录切换回橙云（Proxied），享受：
- 边缘缓存加速静态资源
- DDoS 防护
- 隐藏 Vercel origin IP

---

## 第六步：上线后检查清单

部署完成后，按顺序确认以下内容：

- [ ] 打开 `https://yourdomain.com`，能正常访问 Sift 首页
- [ ] 注册第一个账号，登录成功
- [ ] 在 `/inbox` 保存一条链接，观察处理状态
- [ ] 在 Inngest 控制台确认任务有执行记录（Run 有日志）
- [ ] 在 `/wiki` 能看到生成的知识页
- [ ] 在 `/settings` 确认模型配置正常、无报错

---

## 常见问题

**Q：Vercel 免费版（Hobby）够用吗？**

个人 MVP 阶段完全够用。Hobby 限制：每月 100GB 带宽、Function 执行时间最长 60 秒。Sift 的单条处理链路（提取 + AI + embedding）在 60 秒内应该能完成；如果遇到超时，升级 Pro（$20/月）可以将 Function 超时延长至 300 秒。

**Q：Neon 免费版够用吗？**

免费版 0.5 GB 存储，对于个人知识库早期使用没问题。存储增长后可按需升级，计费按实际用量（$0.000164/GB·小时）。

**Q：inline 模式真的不能用吗？**

短链接、纯文本的快速处理可能侥幸成功，但长文章、图片 OCR、embedding 生成等耗时任务极大概率被 Serverless 平台在函数返回时终止。不建议在生产环境依赖 inline。

**Q：能不能用 Cloudflare Workers 替代 Vercel？**

技术上可以用 `@cloudflare/next-on-pages`，但 Sift 使用了一些 Node.js 原生依赖，兼容性需要逐一验证，迁移成本较高。当前阶段推荐 Vercel，稳定性和兼容性更好。

**Q：需要 Cloudflare R2 吗？**

Sift 目前的截图/图片走的是数据库存储或本地路径。如果后续需要把上传的图片存到对象存储，R2 是很好的选择（免费 10 GB，流量免费）。当前阶段可以暂时跳过。

---

## 小结

| 阶段 | 操作 | 预计时间 |
|---|---|---|
| 1 | Cloudflare 注册域名 | 10 分钟 |
| 2 | Neon 建库 + 执行 schema | 15 分钟 |
| 3 | Vercel 部署 + 环境变量 | 20 分钟 |
| 4 | Inngest 注册 + Sync | 10 分钟 |
| 5 | Cloudflare 绑定域名 | 10 分钟 |
| 6 | 上线验证 | 15 分钟 |

**总计约 1–1.5 小时**，完成后 Sift 就跑在完整的 Serverless 云端环境里了。
