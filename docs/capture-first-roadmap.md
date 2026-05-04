# Capture-first Roadmap

## 核心结论

Sift 不做通用 Agent，不从头造 Claude Code、Codex 或 pi-mono。

Sift 的目标是做 Capture-first LLM Wiki 和 Knowledge Agent Layer：

- 前端负责丝滑收集用户看到、听到、想到的一切资料。
- 后端负责极速保存原始数据，再异步提取、整理、关联、检索和引用。
- Sift 作为外部 Agent 的长期知识底座，而不是替代外部 Agent 的通用执行环境。
- 复杂执行动作交给 Claude Code、Codex、pi-mono 等 Agent 工作台。

后续关于产品目标、技术路线和优先级，都应以这个边界为准。

## 体验原则

用户的保存动作必须快。

保存时只做最小必要动作：

```text
接收输入 -> 保存原始数据 -> 创建处理任务 -> 立刻返回成功
```

不要在保存请求里同步等待：

- 网页正文提取
- 图片 OCR
- 音频转写
- AI 总结
- Wiki 生成
- chunk 切分
- embedding 写入

这些都应该进入后台任务。用户应先看到资料已经进入 Inbox，再看到处理结果逐步出现。

## 目标链路

```text
Raw Capture
  -> Extracted Content
  -> Source
  -> WikiPage
  -> Chunks / Embeddings
  -> Search / Ask / Agent Context
```

每一层都应该可以单独查看、失败、重试和调试。

这意味着：

- 链接抓取失败，不影响原始链接保存。
- OCR 失败，不影响图片保存。
- AI 整理失败，不影响提取文本保存。
- embedding 慢，不影响 Source 和 Wiki 先出现。
- 问答检索失败，不影响资料浏览。

## Capture 入口优先级

### 1. 链接保存

用户只粘贴链接即可保存。

后台应自动尝试：

- 获取标题
- 提取正文
- 识别来源平台
- 保留原始 URL
- 记录抓取失败原因

微信、小红书、X 等封闭或半封闭平台可能无法稳定抓取正文。失败时不能丢失资料，应提示用户补充复制内容、截图或图片。

### 2. 文本和图文粘贴

支持用户直接粘贴文章正文、笔记、聊天记录或网页复制内容。

后续应支持：

- 自动识别粘贴内容里的链接
- 保留段落结构
- 尽量保留标题、列表、引用、代码块
- 对图文复制中的图片做附件保留

### 3. 图片和截图

支持截图、长图、文章图片、多图上传。

后台应做：

- OCR
- 标题和段落结构恢复
- 表格、列表、引用识别
- 多图合并成一个 Capture
- 原始图片和识别文本同时保留

### 4. 语音和会议记录

先支持音频文件上传，后续再做按住语音输入和会议录音导入。

后台应做：

- 转写
- 说话人和时间段预留
- 摘要
- 行动项
- 关键观点和来源时间戳

## 后台处理阶段

处理任务应拆成可观察的阶段：

```text
queued
extracting
extracted
structuring
embedded
completed
failed
```

或者在 `ProcessingJob` 中记录更细的 step 状态：

- `fetch_link`
- `ocr_images`
- `transcribe_audio`
- `create_source`
- `create_wiki_page`
- `create_chunks`
- `create_embeddings`

前端不应该只显示一个笼统的 processing，而应该让用户知道系统卡在哪一步。

## LLM Wiki 核心能力

保存完成只是开始。Sift 的核心价值是让资料发挥作用：

- 全库 Ask：面向整个知识库提问。
- 单页 Ask：围绕当前 WikiPage 追问。
- 混合检索：关键词检索 + embedding 检索 + rerank。
- 来源引用：回答中的关键判断必须能回到 Source 或 WikiPage。
- 去重合并：重复资料不要不断生成孤立 WikiPage。
- 主题沉淀：多个 Source 应逐步沉淀到长期主题 WikiPage。

检索和分析质量是关键动作，不应只依赖模型自由发挥。

## 与外部 Agent 的关系

Sift 不重复造通用 Agent Runtime。

Sift 应提供给外部 Agent：

- MCP server
- HTTP API
- Markdown / JSON 导出
- 全库检索接口
- Source / Wiki / Citation 查询接口

外部 Agent 可以向 Sift 查询：

- 用户保存过哪些相关资料
- 某个主题有哪些来源支持
- 某个判断来自哪篇 Source
- 基于知识库生成文章、研究笔记或行动清单

Sift 负责长期记忆、知识治理和可信引用；外部 Agent 负责复杂执行。

## 下一阶段开发顺序

### P0：保存体验重构

- 保存 API 改成快速保存，不同步处理。
- Capture 支持原始附件和原始 payload。
- ProcessingJob 进入后台处理。
- UI 显示处理阶段和失败原因。

### P1：链接和文本入口

- 链接自动提取正文。
- 提取失败时保留 fallback。
- 文本粘贴保留结构。
- Capture 详情显示原始输入和提取结果。

### P2：图片和截图入口

- 支持单图和多图上传。
- 保存原始图片。
- OCR 后写入 Extracted Content。
- 多图合并为一个 Source。

### P3：全库复用能力

- 优化全局 Ask 的混合检索和 rerank。
- 展示召回片段和引用。
- 去重重复 Source。
- 提供相似 WikiPage / 合并建议。

### P4：Agent 接入

- 设计 Sift Query API。
- 提供 MCP server。
- 支持外部 Agent 拉取上下文和来源引用。

当前实现起点：

- `POST /api/agent/query`：面向外部 Agent 的全库上下文检索，返回片段、分数和引用。
- `GET /api/agent/sources/:id`：按 Source id 拉取来源正文、摘要、原始链接和关联 WikiPage。
- `GET /api/agent/wiki/:slug`：按 WikiPage slug 拉取 Markdown 内容和支撑 Sources。
- `POST /api/mcp`：无状态 MCP JSON-RPC endpoint，暴露 `sift_query`、`sift_get_source`、`sift_get_wiki_page` 三个工具。
- MCP resources：支持 `resources/list`、`resources/templates/list`、`resources/read`，提供 `sift://source/{sourceId}` 和 `sift://wiki/{slug}` 两类资源。
- `SIFT_AGENT_API_KEY`：可选的 Bearer Token，用于保护 Agent 接口。

## 当前优先判断

短期不要继续扩展通用 Agent 能力。

优先把 Capture 做顺，把原始数据保存做稳，把后台处理做成可观察、可重试、可调试。只有资料能低摩擦进入系统，后面的 LLM Wiki、全库问答和 Agent Context 才有价值。
