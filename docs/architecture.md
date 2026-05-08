# 架构草图

## 核心判断

Sift 不是普通 CRUD 产品。它的核心处理链路天然是异步的：

```text
保存内容
-> 提取正文或 OCR
-> AI 整理
-> 生成 Source
-> 生成 WikiPage
-> 生成 chunks
-> 生成 embeddings
-> 更新处理状态
```

因此第一版就要引入任务系统，而不是把处理塞进普通 API Route。

更具体地说，保存动作必须先快：

```text
接收输入 -> 保存原始数据 -> 创建处理任务 -> 立刻返回成功
```

网页提取、OCR、音频转写、AI 整理、Wiki 生成、chunk 切分和 embedding 写入都应该异步运行。用户体验上，资料应先进入 Inbox，处理结果再逐步出现。

Sift 的产品边界不是通用 Agent Runtime。它应作为 Capture-first LLM Wiki 和 Knowledge Agent Layer，负责资料入口、知识治理、混合检索和可信引用；复杂执行动作交给 Claude Code、Codex、pi-mono 等外部 Agent 工作台。

## 推荐技术栈

Prototype / Validated MVP：

- 前端：Next.js
- 后端：Next.js API
- 数据库：Postgres
- 向量存储：pgvector
- 任务队列：Inngest 或 Trigger.dev
- 文件存储：Supabase Storage 或 S3
- 认证：Prototype 暂时单用户，Validated MVP 使用 Supabase Auth 或 Clerk
- 网页正文提取：Readability 类库
- OCR：接入视觉模型，来源可以是云模型、本地模型或自定义中转站
- AI：模型提供商抽象层，第一轮先用 OpenAI-compatible 接口跑通
- 本地开发：Docker Postgres + pgvector
- 部署：Vercel/Node 服务 + Postgres，可替换为 Supabase/Neon/RDS

## 可替换基础设施

Sift 不应该绑定 Supabase、OpenAI 或任何单一模型厂商。

数据库只依赖 Postgres + pgvector：

- 本地：Docker `pgvector/pgvector`
- 云端：Supabase、Neon、RDS、Railway、Render Postgres

模型只依赖 provider adapter。业务代码不关心模型来自哪里，只关心 Sift 内部统一接口：

- 第一轮：OpenAI-compatible endpoint，例如本地服务、自定义中转站、One API、LiteLLM、vLLM、Ollama、LM Studio、MLX 服务。
- 后续专用 adapter：OpenAI、Anthropic、Google Gemini、阿里 Qwen、DeepSeek、豆包、智谱 AI、Kimi。
- 模型角色可拆分：文本生成、embedding、视觉 OCR 可以分别配置，不要求来自同一家厂商。

核心代码只调用 Sift 自己的模型接口，不直接散落调用具体厂商 SDK。

## 核心模块

```text
Capture Interface
  -> Inbox API
  -> Processing Queue
  -> Extraction Pipeline
  -> AI Processing
  -> Knowledge Store
  -> Search / Ask / Browse
```

## Capture Interface

负责低摩擦收集。

Prototype：

- Web 输入框
- 链接保存
- 图片上传
- 文本快速输入

Beta：

- iOS 分享扩展
- Android 分享入口
- 浏览器扩展

## Inbox API

负责接收用户保存的原始内容，并创建 `Capture`。

保存内容包括：

- 原始链接
- 原始图片
- 原始文本
- 用户附加说明
- 保存时间
- 来源平台
- 处理状态

Inbox API 不应该同步调用大模型。它只做保存、校验、入库和派发任务。任何耗时处理都由后台任务完成。

## Processing Queue

负责运行耗时任务。

建议从第一版开始使用 Inngest 或 Trigger.dev。

任务包括：

- 提取网页正文
- 图片 OCR
- 生成 Source
- 生成 draft WikiPage
- 切分 chunks
- 生成 embeddings
- 更新处理状态
- 失败重试

Prototype 阶段 UI 可以用轮询显示处理状态，但后台仍应按任务模型设计。

处理阶段应尽量可观察：

- `fetch_link`
- `ocr_images`
- `transcribe_audio`
- `create_source`
- `create_wiki_page`
- `create_chunks`
- `create_embeddings`

每一步都应该可以失败、记录错误、重试。链接抓取失败不应影响原始链接保存；OCR 失败不应影响原始图片保存；embedding 慢不应影响 Source 和 Wiki 先出现。

处理链路需要一个低频兜底恢复机制。每日任务会扫描 `processing_jobs.step_status`、`captures.status` 和缺失 embedding 的 chunks：

- 对卡住、失败或关键步骤降级的 capture，重新触发完整处理。
- 对 Source/Wiki/Chunks 已存在但 embedding 为空的 capture，只补写缺失向量，避免重写知识页。
- 对知识发现和推荐等后置增强步骤，单独补跑对应增强逻辑。

## Extraction Pipeline

负责把原始内容变成可处理文本。

能力包括：

- 网页正文提取
- OCR
- 元数据提取
- 去重
- 语言检测

第一版不要承诺处理所有封闭平台。微信、小红书、X 等内容可以先通过截图、复制文本或手动输入进入系统。

## AI Processing

负责把资料沉淀成知识。

处理结果包括：

- 来源记录
- 一句话摘要
- 核心观点
- 重要例子
- 关键词和主题
- draft WikiPage
- 相关页面建议
- 可能冲突
- 开放问题

## Knowledge Store

第一版使用 Markdown 风格内容，但底层应该保留结构化对象。

核心对象：

- `Capture`：用户的一次保存动作
- `Source`：清理后的单份来源资料
- `WikiPage`：长期沉淀的主题知识页
- `Chunk`：用于搜索和问答的文本片段
- `KnowledgeEdge`：Source / WikiPage 之间的隐形关系边，用于关系扩展、推荐和后续洞察
- `ProcessingJob`：处理任务状态

暂时不做：

- `Claim`
- 复杂可视化知识图谱

Sift 的关系层优先服务检索和内容复用，不优先做节点图 UI。第一版只记录强证据关系，例如 Source-Wiki 归属、相似 Wiki、重复 Source；后续再扩展支持、冲突、实体提及等更细关系。

P10 暂不引入独立图数据库。当前关系查询只需要一跳扩展、权限过滤和引用回溯，用 Postgres 的 `knowledge_edges` 更简单，也能复用现有事务、备份和用户边界；只有当关系规模、路径查询或图算法成为核心瓶颈时，再评估 Neo4j / Kuzu 等图数据库并放入 Docker 部署。

## Embeddings

embedding 不应该推迟到搜索功能上线后再补。

第一版只要写入 Source 或 WikiPage，就应该同步创建 chunks 并生成 embeddings：

```text
Source -> source_chunks -> embeddings
WikiPage -> wiki_page_chunks -> embeddings
```

向量搜索入口可以晚一点做，但 embedding pipeline 要第一天存在。

## Search / Ask / Browse

Prototype：

- Capture 列表
- Source 详情
- WikiPage 详情

检索链路采用混合召回：

```text
query
-> infer retrieval intent
-> keyword / embedding seed chunks
-> KnowledgeEdge graph expansion, 1-hop by default and 2-hop only for relation/evidence/comparison intent
-> graph-aware rerank
-> citations
```

关系扩展必须保留来源引用和关系路径，避免把关系层变成幻觉放大器。普通问题默认只做一跳；当用户明确在问“相关资料、证据来源、对比、重复内容”时，可以启用带降权的二跳扩展。
- 基础标题和正文搜索
- 局部关系展示：Source / Wiki 详情页可以展示当前节点附近的一跳关系，帮助用户理解“为什么相关”和“下一条该看什么”。这类展示服务检索和阅读，不替代 Wiki 正文，也不要求用户手工整理图谱。

知识融合链路采用人工确认的合并动作：

```text
KnowledgeDiscovery
-> merge preview
-> user confirms or edits
-> update target WikiPage
-> link incoming Source to target WikiPage
-> archive incoming temporary WikiPage
-> record WikiMergeHistory
-> rebuild target Wiki chunks / embeddings
```

P12 的合并不是自动覆盖。AI 负责生成融合草稿，用户负责确认，系统负责保留来源、关系边和合并前快照。

Validated MVP：

- 全文搜索
- 单页问答
- 粗粒度来源引用
- 最近更新

Beta：

- 知识库级问答
- 片段级引用
- 混合搜索：全文搜索 + 向量搜索
- 相似页面推荐
