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

### P5：手机优先收集体验（已完成）

- 移动端 `/inbox` 优化，打开就是快速保存。
- Capture 支持链接、文本、图片和备注混合输入。
- Inbox 默认按天分组：今天、昨天、本周、更早。
- 支持多图截图作为同一条资料保存。
- 支持稍后补备注和失败资料重试。
- 不把按天分组当作最终知识结构；时间只用于 Inbox 管理，长期知识仍由 Source / Wiki / Search 承担。

完成状态（2026-05-05）：

- `/inbox` 已从传统表单改为 Capture Composer，支持链接、文本、图片和首次备注混合保存。
- Inbox 已按天分组，并提供今日收集、处理中、失败、待补备注、已忽略和全部最近视图。
- 详情页已支持补备注、补充资料后重新处理、失败重试和忽略。
- 处理失败或忽略不会丢失原始资料；重试、补充和忽略会清理旧步骤状态，避免残留误导。
- 已忽略资料默认移出日常整理流，只在“已忽略”视图中展示。

详细规划见 [Mobile-first Capture Roadmap](mobile-capture-roadmap.md)。

### P6：外部收藏池导入和同步（第一版已完成）

- 浏览器书签 HTML 导入。
- URL 批量粘贴。
- 相册截图批量上传，并按拍摄或导入日期归组。
- Markdown / 文本文件导入。
- 后续再考虑浏览器插件、iOS Shortcut、Android 分享入口、微信收藏半自动导入和稍后读工具 API。

第一版完成状态（2026-05-05）：

- `/inbox` 已提供外部收藏导入面板，支持批量 URL 粘贴和浏览器书签 HTML 导入。
- 新增 `POST /api/captures/import`，导入项仍走 Capture 快速保存、ProcessingJob 和后台处理链路。
- 导入时会做同批 URL 去重和已有 Capture 去重，避免重复导入同一个链接。
- 导入批次信息、原书签标题、导入来源和原始时间会写入 `raw_payload`，后续可用于回溯和同步增强。
- 支持相册截图批量导入；每张截图拆成一条 Capture，保留文件名、导入批次和图片时间元数据，继续走私有上传和 OCR 处理链路。

后续增强：

- Markdown / 文本文件导入。
- 浏览器插件、iOS Shortcut、Android 分享入口、微信收藏半自动导入和稍后读工具 API。

### P7：主动整理发现（小闭环收敛中）

目标：让 Sift 不只“存起来等用户问”，而是在新内容处理完成后主动给出可追溯、可处理的整理发现。

第一版完成状态（2026-05-05）：

- 新增 `knowledge_discoveries`，记录系统生成的整理发现。
- Capture 后台处理完成后，会基于新 Source / WikiPage 和已有相似/重复判断生成发现。
- 展示层已从“新资料动态流”收敛为“待处理发现”，只显示可更新知识页、疑似重复旧资料等可处理项。
- 每条发现都保留新资料、相关旧资料或相关知识页链接，避免黑盒推荐。
- 首页展示“近期回顾”和最近待处理发现；没有高质量发现时显示安静的空状态。
- 收集箱恢复为“今日收集”，只展示收集/处理状态，并提供待处理发现计数入口。
- “值得回看”已改为持久化推荐；支持对单条推荐执行“暂不看”，不删除来源资料。
- 来源资料、知识页和收集箱默认隔离 P5/P6 smoke、test、review 等低信号测试资料，并提供“测试资料”视图找回。
- 来源资料和知识页提供默认/已归档/测试资料视图、搜索和加载更多，避免大列表一次性铺满页面。
- 来源资料和知识页详情支持归档/恢复；归档只移出默认管理流，不做永久删除。
- 来源资料和知识页列表支持多选批量归档/恢复，方便清理测试资料或批量移出默认管理流。
- 来源资料和知识页支持已归档后的永久删除；删除会清理关联检索片段、页面关系和对应历史记录，避免搜索召回已删除内容。
- 来源资料和知识页管理搜索已升级为全文检索排序优先、向量/混合召回补充、包含匹配兜底；新增数据库索引用于支撑长列表搜索。

设计边界：

- 待处理发现不是“新增资料日志”，不为每条资料刷存在感。
- 不把“建议追问”作为兜底内容；没有关联或重复时宁可安静。
- 收集箱不承载完整知识回顾；首页负责回答“知识库今天发生了什么变化”。
- 第一版优先使用可解释规则和已有相似/重复判断，不让模型生成不可追溯的推荐。
- 事实依据仍来自 Source / Wiki / Chunk；历史问答和整理发现只作为使用线索，不替代来源引用。

后续增强：

- 支持忽略、已读和稍后处理整理发现。
- 为“可能更新”提供一键合并到知识页。
- 按主题聚合一组发现，形成“本周知识回顾”。
- 将用户历史问答作为意图线索，用于排序推荐，但不作为事实依据。
- 将资料管理搜索进一步接入主题聚合。

### P8：模型 provider 和评测

- 保持核心业务逻辑不绑定单一模型厂商。
- 支持 OpenAI、Anthropic、Google Gemini、阿里 Qwen、DeepSeek、豆包、智谱 AI、Kimi。
- 支持本地模型和自定义中转站模型。
- 允许文本、embedding、视觉 OCR 分别配置不同模型。
- 建立提取、总结、问答和 OCR 的小样本评测集，用结果决定默认推荐模型。

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
