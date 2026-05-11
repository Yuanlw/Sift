# Sift 部署策略：最佳实践

## 先说结论

**当前阶段（个人 MVP）：一台 VPS + Docker Compose，Cloudflare 做 DNS/CDN。**

Vercel + Neon + Inngest 是优雅的架构，但对现在的 Sift 是过度工程。多了三个平台、三套账号、三处故障点，还必须改掉 `inline` dispatcher。VPS + Docker 反而更稳、更省、更容易维护。

等产品有真实用户、需要扩容时，再迁移到 Serverless 不晚。

---

## 三种方案对比

| | 方案 A：VPS + Docker | 方案 B：Vercel + Neon + Inngest | 方案 C：Railway / Render |
|---|---|---|---|
| **适合阶段** | MVP → 早期公测 | 公测 → 正式 SaaS | MVP → 早期公测 |
| **月费用** | $5–12 | $0–40（用量计费） | $5–20 |
| **配置复杂度** | 低（一台机器） | 高（3+ 平台协作） | 中 |
| **inline dispatcher** | ✅ 完全可用 | ❌ 必须改 Inngest | ✅ 可用 |
| **pgvector** | ✅ 原生支持 | ✅（Neon） | ✅ |
| **冷启动延迟** | 无 | 有（Serverless） | 基本无 |
| **背景任务稳定性** | 高（持久进程） | 需 Inngest 保障 | 高 |
| **运维负担** | 需自管 Nginx/证书 | 托管，零运维 | 托管，低运维 |
| **产品存活成本** | 最低 | 流量少时接近免费 | 中 |

---

## 推荐：方案 A（VPS + Docker），分阶段演进

### Phase 1：MVP / 个人使用（现在）

**目标**：跑起来，稳定用，花最少钱。

**架构**：

```
用户
 └─→ Cloudflare（DNS + CDN + SSL）
       └─→ VPS（Nginx 反向代理）
             └─→ Docker Compose
                   ├─→ sift-app（Next.js）
                   └─→ postgres（pgvector）
```

**推荐 VPS**：

| 服务商 | 套餐 | 规格 | 月费 | 推荐理由 |
|---|---|---|---|---|
| **Hetzner** | CX22 | 2 vCPU / 4 GB / 40 GB | €3.29 | 欧洲最高性价比，速度好 |
| **Vultr** | Regular | 1 vCPU / 2 GB / 55 GB | $6 | 新加坡节点，亚太延迟低 |
| **DigitalOcean** | Basic | 1 vCPU / 2 GB / 50 GB | $6 | 文档最好，适合新手 |

> **建议选 Hetzner CX22（新加坡或芬兰）或 Vultr 新加坡**。国内访问延迟可接受，Cloudflare CDN 套上去后会更快。

**总成本**：$5–8/月（VPS + Cloudflare 免费层）

---

**快速启动步骤**：

1. 购买 VPS，选 Ubuntu 22.04。
2. 安装 Docker 和 Docker Compose。
3. 克隆 Sift 仓库，复制 `.env.docker.example` 为 `.env`，填写模型配置。
4. 启动服务：
   ```bash
   docker compose up -d --build
   ```
5. 安装 Nginx，配置反向代理（见下方配置）。
6. 用 Certbot 申请 Let's Encrypt SSL 证书。
7. 在 Cloudflare 添加 DNS A 记录指向 VPS IP，开启橙云代理。

**Nginx 最小配置**：

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**关键环境变量**（`.env` 里填写）：

```env
DATABASE_URL=postgres://sift:sift@postgres:5432/sift
JOB_DISPATCHER=inline                          # VPS 上用 inline，没问题
SIFT_SESSION_SECRET=<openssl rand -hex 32>
SIFT_APP_URL=https://yourdomain.com
SIFT_REQUIRE_AUTH=true
SIFT_ALLOW_PUBLIC_SIGNUP=false
SIFT_SINGLE_USER_ID=00000000-0000-0000-0000-000000000001

# 模型配置（OpenAI 或中转站）
MODEL_PROVIDER=openai-compatible
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=sk-xxxxxxx
MODEL_TEXT_MODEL=gpt-4o-mini
MODEL_EMBEDDING_MODEL=text-embedding-3-small
MODEL_EMBEDDING_DIMENSIONS=1536
```

**日常维护**：

```bash
# 更新代码后重建
docker compose up -d --build

# 查看日志
docker compose logs -f sift

# 迁移数据库（代码更新后）
npm run docker:migrate

# 备份数据库
docker exec sift-postgres pg_dump -U sift sift > backup_$(date +%Y%m%d).sql
```

---

### Phase 2：早期公测（10–200 用户）

**触发条件**：VPS 内存经常超过 80%，或需要开放公开注册。

**升级方案**：
- VPS 升配（Hetzner CX32：4 vCPU / 8 GB，€5.77/月）
- 或将数据库迁移到 **Neon**（释放 VPS 内存压力，获得自动备份）
- 开启 `SIFT_ALLOW_PUBLIC_SIGNUP=true`，补充邮箱验证逻辑

```
用户
 └─→ Cloudflare
       └─→ VPS（Next.js + Nginx）
             └─→ Neon（Postgres + pgvector，托管）
```

数据库迁移步骤：
```bash
# 从 Docker Postgres 导出
docker exec sift-postgres pg_dump -U sift sift > sift_export.sql

# 导入到 Neon（替换连接串）
psql "<neon连接串>" < sift_export.sql

# 更新 .env，重启
DATABASE_URL=postgres://...neon.tech/...
docker compose restart sift
```

---

### Phase 3：正式 SaaS（200+ 用户 / 需要横向扩展）

**触发条件**：单台 VPS 撑不住，或需要多区域部署，或 Stripe 计费上线。

**此时再迁移到 Vercel + Neon + Inngest**，参见 `deployment-cloudflare-vercel.md`。

改动点：
- 将 `JOB_DISPATCHER` 从 `inline` 改为 `inngest`
- 接入 Inngest Cloud
- 将 Next.js 部署到 Vercel
- Cloudflare 套在 Vercel 前面

---

## Cloudflare 在任何阶段都有用

无论 Phase 1 还是 Phase 3，Cloudflare 始终值得接入：

- **免费 SSL**：Cloudflare 提供免费的边缘 SSL，HTTPS 开箱即用
- **CDN**：静态资源（JS / CSS / 图片）在全球边缘缓存，中国用户访问明显更快
- **DDoS 防护**：隐藏 VPS 真实 IP，免费层已有基础防护
- **域名注册**：Cloudflare Registrar 按成本价出售，比国内注册商便宜

接入方式：在 Cloudflare 添加 A 记录指向 VPS IP，开启橙云（Proxied）。

> **如果开启了橙云**：Nginx 收到的 IP 都是 Cloudflare 的，需要在 Nginx 里信任 Cloudflare 的 IP 段，才能正确获取用户真实 IP。可以参考 [Cloudflare IP 列表](https://www.cloudflare.com/ips/) 配置 `real_ip_header CF-Connecting-IP`。

---

## 资源浪费防线

几个原则，防止过早花冤枉钱：

**不要现在上的**：
- Inngest（inline 在 VPS 上完全够用）
- Neon / PlanetScale（Docker Postgres 足够稳定）
- Vercel Pro / Neon Pro（免费层先用到极限）
- Cloudflare R2（除非图片/附件量很大）
- 多台 VPS 负载均衡（单台先撑到顶）

**要做的**：
- 定期备份数据库（cron + pg_dump，存到本地或 Cloudflare R2）
- 监控 VPS 内存/磁盘（装个 Netdata 或 UptimeRobot 免费监控）
- 保持 Docker Compose 配置简单，不要引入不必要的中间件

---

## 小结

```
现在   →  VPS + Docker Compose + Cloudflare        $6–8/月
中期   →  VPS + Neon + Cloudflare                  $10–15/月
远期   →  Vercel + Neon + Inngest + Cloudflare     $20–40/月
```

**产品没有用户之前，不值得为扩展性提前买单。** 先把 Sift 跑起来、用起来，等真实问题出现再做针对性的架构决策。
