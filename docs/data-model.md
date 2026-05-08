# 数据模型

## 核心边界

Sift 的核心对象边界必须清楚，否则后续 RAG、合并和问答都会变复杂。

## Capture

`Capture` 是用户的一次保存动作。

例子：

- 用户保存了一个链接
- 用户上传了一张截图
- 用户输入了一段想法
- 用户粘贴了一段文章

Capture 记录的是“用户保存了什么”，不负责表达整理后的知识。

关键字段：

- `id`
- `user_id`
- `type`
- `raw_url`
- `raw_text`
- `file_url`
- `raw_payload`
- `raw_attachments`
- `note`
- `status`
- `created_at`

`raw_payload` 保留本次保存动作的原始结构化输入；`raw_attachments` 保留图片、音频或文件等原始附件引用。后台提取失败时，这两项仍然是可追溯的原始证据。

## ExtractedContent

`ExtractedContent` 是从 Capture 中提取出的可读内容。

它位于 Raw Capture 和 Source 之间，用来保证“保存成功”和“智能整理成功”解耦。链接抓取失败、封闭平台无法读取正文、图片 OCR 尚未完成时，也应该写入一条 fallback 提取结果，方便用户补充资料或稍后重试。

关键字段：

- `id`
- `capture_id`
- `user_id`
- `title`
- `content_text`
- `content_format`
- `extraction_method`
- `status`
- `metadata`
- `error_message`
- `created_at`

## Source

`Source` 是清理后的单份来源资料。

一个 Capture 通常生成一个 Source。

Source 记录的是“这份资料讲了什么”，并保留可追溯来源。

关键字段：

- `id`
- `capture_id`
- `user_id`
- `title`
- `source_type`
- `original_url`
- `extracted_text`
- `summary`
- `metadata`
- `created_at`

## WikiPage

`WikiPage` 是长期沉淀的主题知识页。

一个 WikiPage 可以来自多个 Source。一个 Source 也可能关联多个 WikiPage。

WikiPage 记录的是“这些资料共同沉淀出了什么知识”。

关键字段：

- `id`
- `user_id`
- `title`
- `slug`
- `content_markdown`
- `status`
- `created_at`
- `updated_at`

## Source 与 WikiPage 的关系

关系是多对多：

```text
Source <-> WikiPage
```

通过 `source_wiki_pages` 关联表记录：

- `source_id`
- `wiki_page_id`
- `relation_type`
- `confidence`
- `created_at`

`source_wiki_pages` 是最直接的归属关系：哪份 Source 支撑哪篇 WikiPage。

## KnowledgeEdge

`KnowledgeEdge` 是 Source / WikiPage 之间的隐形知识关系边，用于检索扩展、推荐、发现和合并候选。

它不要求用户手工维护知识图谱，也不等于全库图谱画布。第一版优先记录强证据关系：

- `source_wiki`：Source 支撑 WikiPage。
- `related_wiki`：两个 WikiPage 主题相关，可用于阅读和召回扩展。
- `duplicate_source`：两份 Source 疑似重复。
- `supports` / `contradicts`：预留给后续更细的证据关系。

关键字段：

- `id`
- `user_id`
- `from_type`
- `from_id`
- `to_type`
- `to_id`
- `edge_type`
- `weight`
- `confidence`
- `evidence`
- `dedupe_key`
- `created_at`
- `updated_at`

所有读写都必须带 `user_id` 过滤。关系层当前由 Postgres 承载，不引入独立图数据库。

## KnowledgeDiscovery

`KnowledgeDiscovery` 是系统生成的待处理发现。

它记录“这条新资料可能更新某篇 WikiPage”“这条资料可能和旧资料重复”等可解释线索。发现不是事实来源本身，事实仍来自 Source、WikiPage 和 Chunk。

关键字段：

- `id`
- `user_id`
- `discovery_type`
- `title`
- `body`
- `source_id`
- `wiki_page_id`
- `related_source_id`
- `related_wiki_page_id`
- `suggested_question`
- `status`
- `metadata`
- `dedupe_key`
- `created_at`
- `updated_at`

发现列表查询必须按 `kd.user_id` 收口，并且关联 Source / WikiPage 时也要同时匹配同一 `user_id`，避免异常跨用户引用暴露标题或 slug。

## WikiMergeHistory

`WikiMergeHistory` 记录用户确认的一键合并。

合并不是自动覆盖。系统先生成合并预览，用户确认或修改后才更新目标 WikiPage。

关键字段：

- `id`
- `user_id`
- `target_wiki_page_id`
- `merged_wiki_page_id`
- `discovery_id`
- `before_title`
- `before_content_markdown`
- `after_title`
- `after_content_markdown`
- `merged_source_ids`
- `summary`
- `metadata`
- `created_at`

当前合并策略：

- 更新目标 WikiPage。
- 将被并入的临时 WikiPage 归档。
- 将新 Source 关联到目标 WikiPage。
- 同步维护 `source_wiki_pages` 和 `knowledge_edges`。
- 重建目标 Wiki 的 chunks；embedding 失败时保留纯文本 chunks。
- 回滚第一版先保留数据基础，后续再做可视化恢复入口。

## Prototype 阶段的降级规则

Prototype 阶段不做复杂合并。

规则：

```text
每个 Source 默认生成一个 draft WikiPage。
```

AI 可以建议相关主题，但不自动大规模修改旧 WikiPage。

## Validated MVP 阶段的合并规则

当新 Source 进入时：

1. 为 Source 生成 embedding。
2. 检索相似 WikiPage。
3. AI 判断应该新建还是更新。
4. 给出合并建议。
5. 在高置信度场景给出合并预览，等待用户确认或编辑后再更新。

## Chunk

`Chunk` 是用于搜索和问答的文本片段。

Chunk 可以来自 Source，也可以来自 WikiPage。

关键字段：

- `id`
- `user_id`
- `parent_type`
- `parent_id`
- `content`
- `embedding`
- `token_count`
- `created_at`

## ProcessingJob

`ProcessingJob` 记录后台任务状态。

关键字段：

- `id`
- `capture_id`
- `user_id`
- `job_type`
- `status`
- `current_step`
- `step_status`
- `error_message`
- `started_at`
- `finished_at`
- `created_at`

`current_step` 用于快速展示任务卡在哪一步；`step_status` 记录每个处理步骤的运行状态和时间点。Prototype 阶段先覆盖：

- `fetch_link`
- `extracting`
- `structuring`
- `create_source`
- `create_wiki_page`
- `create_embeddings`
- `create_chunks`

## AuditLog

`AuditLog` 记录关键 API 和 Agent/MCP 访问行为。

关键字段：

- `id`
- `user_id`
- `action`
- `resource_type`
- `resource_id`
- `status`
- `metadata`
- `ip_address`
- `user_agent`
- `created_at`

Prototype 阶段先记录：

- Capture 创建和重试
- 全库 Ask
- WikiPage Ask
- Agent Query
- Agent Source / Wiki 读取
- MCP tool 和 resource 读取

审计日志不是业务权限本身，但它能帮助定位外部 Agent 读取了哪些上下文和来源。

## 暂缓模型

以下模型暂时不进入 MVP：

- `Claim`
- `Topic`
- `Collection`

原因：这些模型有长期价值，但会让 MVP 过早进入知识治理复杂度。第一版关系层只保留轻量 `KnowledgeEdge`，服务召回、推荐和可控合并。

## 数据库选择

这些模型只要求 Postgres + pgvector，不绑定 Supabase。

本地开发可以使用 Docker：

```text
postgres://sift:sift@localhost:5432/sift
```

未来生产环境可以切换到 Supabase、Neon、RDS 或其他 Postgres 服务。
