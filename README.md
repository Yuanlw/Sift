# Sift

Sift 把散落的信息收集，沉淀成可复用的个人知识库。

它面向每天在手机和电脑上阅读、截图、收藏、做判断的人：写作者、创业者、研究者、投资人、咨询顾问，以及任何依赖高质量信息输入来产出结果的人。

## 核心判断

收藏很容易，复用很难。

今天的信息工作流通常是断裂的：

1. 在手机上看到文章、截图、帖子或想法。
2. 保存到微信、备忘录、稍后读、相册或浏览器收藏。
3. 之后很难找回，也很难变成文章、判断、研究材料或行动。

Sift 的目标是把这条链路合成一个入口：

```text
收集 -> 识别 -> 整理 -> 关联 -> 复用
```

## 产品一句话

Sift is an AI-native personal knowledge base that turns scattered captures into reusable knowledge.

中文定位：

> Sift 把你每天看到的信息，沉淀成以后能用的知识资产。

## MVP

第一版先做小，但要完整解决一个真实场景：

> 用户在手机上看到有价值的内容，一键保存到 Sift，Sift 自动识别、整理、关联，并让用户之后能搜索、浏览和提问。

MVP 包含：

- 移动端分享入口
- Inbox 收集箱
- 网页正文提取
- 图片 OCR
- AI 自动整理为 Markdown 知识页
- 来源资料保存
- 简单知识库浏览
- 基于个人知识库的问答

## 模型可替换

Sift 不绑定 Supabase 或 OpenAI 官方服务。

第一轮为了降低启动成本，默认使用：

- Docker Postgres + pgvector
- OpenAI-compatible 模型接口
- 示例文本模型：`Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit`
- 示例 embedding 模型：`bge-m3-mlx-fp16`

这不代表 Sift 以本地模型为主。Sift 的模型层应支持云模型、本地模型和自定义中转站模型，并允许不同任务分别配置文本、embedding 和视觉模型。

优先支持的模型来源：

- 国际云模型：OpenAI、Anthropic、Google Gemini
- 中国云模型：阿里 Qwen、DeepSeek、豆包、智谱 AI、Kimi
- 本地或自定义网关：Ollama、LM Studio、MLX、vLLM、One API、LiteLLM 等 OpenAI-compatible 服务

## 核心原则

- 不做又一个收藏夹。
- 不只做 AI 总结。
- 让每次输入都变成长期资产。
- 保留来源，区分事实和解释。
- 优先服务复用：写作、研究、判断和行动。
- 不做通用 Agent Runtime；Sift 是 Capture-first LLM Wiki 和 Knowledge Agent Layer。
- 保存动作必须先快：先保存原始数据，再异步提取、整理、检索和引用。

## 文档

- [产品简报](docs/product-brief.md)
- [MVP 范围](docs/mvp.md)
- [用户故事](docs/user-stories.md)
- [架构草图](docs/architecture.md)
- [数据模型](docs/data-model.md)
- [本地启动](docs/local-setup.md)
- [部署方式](docs/deployment.md)
- [Phase 0 可执行计划](docs/phase-0-plan.md)
- [Capture-first Roadmap](docs/capture-first-roadmap.md)
- [Agent API / MCP 接入](docs/agent-api.md)
- [知识库规则](prompts/wiki-maintenance.md)
- [资料摄入提示词](prompts/ingestion.md)
