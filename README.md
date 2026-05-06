# Sift

[English](README.en.md)

Sift 是一个 capture-first 的个人知识库。

它帮你把散落在浏览器、聊天、社交平台、相册、稍后读和临时笔记里的链接、文本、截图、备注、收藏导入进来，再整理成可追溯的来源资料、可阅读的知识页，以及后续搜索、问答、写作、研究和 Agent 工作流能复用的上下文。

> Sift 把你每天看到、想到、收藏的信息，沉淀成以后真正能用的知识资产。

## 为什么做 Sift

很多人不缺收藏工具，真正缺的是复用能力。

常见的信息工作流是断裂的：

1. 你在浏览器、聊天、社交流、Newsletter、PDF 或截图里看到有价值的信息。
2. 你把它存到书签、备忘录、相册、稍后读工具，或者发给自己的聊天窗口。
3. 几周后，它很难被找回，也很难变成文章、判断、研究材料或行动。

Sift 想把这条链路闭合起来：

```text
收集 -> 处理 -> 来源 -> 知识页 -> 搜索 / 问答 / 回顾
```

产品的核心原则是：

> 保存必须快。理解可以在后台慢慢发生。

## 现在能做什么

Sift 目前已经跑通一个完整的个人 MVP 闭环：

- 快速保存链接、文本、截图和备注。
- 支持混合收集，例如 URL + 复制正文 + 图片 + 保存理由。
- 收集箱按时间组织，支持今日收集、处理中、失败、待补备注、已忽略、测试资料等视图。
- 后台处理为提取内容、来源资料、知识页、检索片段和向量。
- 失败资料可补充、重试、忽略；来源和知识页可归档、恢复、永久删除。
- 支持批量 URL 导入、浏览器书签 HTML 导入、相册截图批量导入。
- 支持近期回顾、知识发现、疑似重复提示和持久化推荐。
- 支持全库问答和单个知识页问答，并保留历史问答。
- 来源资料和知识页支持筛选、全文搜索、语义召回、加载更多、批量归档/恢复/删除。
- 提供 Agent API 和 MCP endpoint，方便外部工具读取 Sift 的知识上下文。

## 产品边界

Sift 不是通用 Agent Runtime。

它不试图替代 Claude Code、Codex、pi-mono、工作流 Agent 或自动化平台。Sift 聚焦在长期知识层：

- 收集用户看到、读到、保存和想到的资料。
- 保留原始材料和可追溯来源。
- 把资料整理成可复用的知识页和上下文片段。
- 帮外部 Agent 获取可信的、属于用户自己的长期知识。

复杂执行动作应该交给专门的 Agent 工作台。Sift 提供记忆、来源、引用和知识结构。

## 当前状态

Sift 现在已经是一个可用的个人 MVP：

- P0-P4：capture-first 基础、提取、来源/知识页生成、搜索、问答、Agent API、MCP。
- P5/P5.5：手机优先的 Capture Composer、每日整理、补充/重试/忽略、备注。
- P6：外部收藏导入，包括 URL、浏览器书签、相册截图。
- P7：近期回顾、知识发现、推荐、长列表管理、归档/恢复/删除、资料管理搜索。
- P8：模型调用计量、模型策略文档、账号/模型/消耗设置中心、智能额度账本。

它已经适合个人日常试用和持续产品 review。

它还不是成熟的公开托管 SaaS 产品。在更大范围部署前，还需要补强认证、多租户、生产任务队列、模型 provider、评测集、回归测试和更清晰的账号/部署体系。

当前完整度评估见 [Project Review](docs/project-review.md)。

## 快速启动

本机开发，使用 Docker Postgres：

```bash
npm install
cp .env.example .env.local
npm run db:up
npm run db:migrate
npm run dev
```

打开：

```text
http://127.0.0.1:3000
```

常用检查：

```bash
npm run typecheck
npm run lint
npm run build
```

Docker Compose 部署和迁移说明见 [Deployment](docs/deployment.md)。

## 模型配置

Sift 的模型设置现在走 `/settings` 页面，而不是让普通用户直接改 `.env`。

页面里有两种模式：

- 使用 Sift 默认模型：只展示能力、额度、消耗和健康状态，不展示底层供应商、模型名、endpoint 或密钥。
- 使用自定义模型：用户自己配置 OpenAI-compatible 的文本模型、embedding 模型和视觉 OCR 模型，并可在页面验证配置是否可用。

整体上需要：

- 一个文本/聊天模型，用于提取、结构化、生成知识页和回答问题。
- 一个 embedding 模型，用于检索。
- 可选的视觉模型，用于图片 OCR。

`.env` 中的模型变量只作为部署默认值或未来 SaaS 托管模型配置使用；对普通使用者来说，模型选择和密钥管理应该在设置中心完成。

自定义模型 API Key 不会返回给前端。SaaS 或多人部署应配置 `SIFT_MODEL_KEY_ENCRYPTION_SECRET`，新保存的用户自定义模型 Key 会在服务端加密后写入数据库；本地单用户部署可以留空以降低配置复杂度。

默认模型使用统一的智能额度。用户看到的是本月额度、已用、剩余和消耗去向；系统内部再按资料处理、图片识别、语义索引、知识问答和检索召回分项记账。自定义模型模式不扣 Sift 智能额度。

SaaS 计费使用 Stripe Checkout。托管部署需要在 Stripe 后台创建订阅价格，并配置 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`STRIPE_PRICE_PERSONAL`、`STRIPE_PRICE_PRO`、`STRIPE_PRICE_TEAM` 和 `SIFT_APP_URL`。本地单租户可全部留空。

正式提交 Stripe 审核前，还需要把公开网站准备完整：HTTPS 域名、真实联系邮箱、真实且一致的服务主体信息、价格页、Contact Us、Privacy Policy、Terms of Service 和 Refund Policy。Sift 已提供这些公开页面入口；部署时用 `SIFT_CONTACT_EMAIL`、`SIFT_BUSINESS_NAME`、`SIFT_BUSINESS_ADDRESS` 和 `SIFT_PRICE_LABEL_*` 替换占位信息。

模型层的目标是不改变产品边界的前提下持续演进。后续 provider 可支持 OpenAI、Anthropic、Google Gemini、Qwen、DeepSeek、豆包、智谱、Kimi、本地模型网关和自定义 OpenAI-compatible 服务。

## 主要页面

- `/` - 首页、近期回顾、推荐、全库问答。
- `/inbox` - 快速收集、导入、每日整理、失败/处理中/已忽略视图。
- `/sources` - 来源资料管理，支持搜索、筛选、归档、恢复和删除。
- `/wiki` - 知识页管理，支持搜索、筛选、归档、恢复、删除和单页问答。
- `/settings` - 设置中心，查看账号/部署信息、模型配置、模型消耗和计费边界。

## 文档

- [Project Review](docs/project-review.md)
- [Model Strategy and Billing](docs/model-strategy-and-billing.md)
- [Capture-first Roadmap](docs/capture-first-roadmap.md)
- [Mobile-first Capture Roadmap](docs/mobile-capture-roadmap.md)
- [Local Setup](docs/local-setup.md)
- [Deployment](docs/deployment.md)
- [Agent API / MCP](docs/agent-api.md)
- [Product Brief](docs/product-brief.md)
- [MVP Scope](docs/mvp.md)
- [Architecture](docs/architecture.md)
- [Data Model](docs/data-model.md)

## 协议

Sift 是 source-available，不是 open source。

你可以在协议约束下，为个人、教育、研究、评估和组织内部使用而阅读、学习、修改和运行本项目。

未经明确书面许可，不允许把 Sift、修改后的 Sift，或实质相似的托管衍生版本，对外提供为公开 SaaS、托管服务、付费产品、白标产品或转售服务。

完整条款见 [LICENSE](LICENSE)。如需商业授权或托管服务授权，请联系项目所有者。
