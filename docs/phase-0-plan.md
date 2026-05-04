# Phase 0 可执行计划

## 目标

用最小工程闭环验证 Sift 的核心价值：

```text
链接/截图 -> 异步处理 -> Source -> draft WikiPage
```

Phase 0 不追求完整产品，只验证用户把资料丢进去之后，Sift 是否能产出一篇有用、可信、可读的知识页。

## 范围

必须完成：

- 单用户 Web App
- Capture 创建：链接、文本、图片元数据
- Capture 列表和详情
- ProcessingJob 状态
- Inngest 任务入口
- Source 生成入口
- draft WikiPage 生成入口
- chunk + embedding 的数据结构预留
- 基础 UI：Inbox、Sources、Wiki Pages

暂时不做：

- 正式登录
- iOS 分享扩展
- 复杂 RAG
- 自动合并旧 WikiPage
- Claim 模型
- 付费

## 技术决策

- 使用 Next.js App Router。
- 使用 TypeScript。
- 使用 Postgres + pgvector 作为主数据库，Phase 0 本地用 Docker 启动。
- 使用 pgvector 存 embeddings。
- 使用 Inngest 作为异步任务系统。
- 使用模型 provider 抽象层，Phase 0 先接本地 OpenAI-compatible 模型。
- Prototype 阶段允许 hardcoded 单用户。

## 产品边界

Sift 不做通用 Agent，不从头造 Claude Code、Codex 或 pi-mono。

Sift 的目标是 Capture-first LLM Wiki 和 Knowledge Agent Layer：

- 丝滑收集用户看到、听到、想到的一切资料。
- 极速保存原始数据，再异步处理。
- 做结构化沉淀、去重关联、混合检索和可信引用。
- 作为外部 Agent 的长期知识底座。

复杂执行动作交给外部 Agent 工作台。Sift 优先做好资料入口、知识治理和检索引用。

## 里程碑

### M0：项目骨架

- Next.js 项目可启动。
- 基础页面可访问。
- 环境变量模板存在。
- Postgres schema 初稿存在。
- Inngest client 和函数目录存在。

### M1：Capture 闭环

- 用户能提交链接或文本。
- 系统创建 Capture。
- 系统创建 ProcessingJob。
- UI 能看到处理状态。

### M2：处理链路

- Inngest 任务能接收 Capture。
- 链接正文提取或文本直通。
- AI 生成 Source。
- AI 生成 draft WikiPage。

### M3：可信复用

- WikiPage 能显示来源。
- Source 和 WikiPage 可浏览。
- 写入时生成 chunks。
- embeddings 写入 pgvector。

## 稳步推进原则

- 先让链路跑通，再优化体验。
- 保存动作必须先快，先保存原始数据，再后台处理。
- 先保留来源，再追求智能合并。
- 先做单用户，再做账号系统。
- 先做 draft WikiPage，再做长期主题页自动合并。
- 所有耗时处理都走任务系统，不塞进普通请求。

后续开发计划见 [Capture-first Roadmap](capture-first-roadmap.md)。
