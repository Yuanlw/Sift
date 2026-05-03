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
- `note`
- `status`
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
5. 在高置信度场景自动更新，低置信度场景等待用户确认。

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
- `error_message`
- `started_at`
- `finished_at`
- `created_at`

## 暂缓模型

以下模型暂时不进入 MVP：

- `Claim`
- `GraphEdge`
- `Topic`
- `Collection`

原因：这些模型有长期价值，但会让 MVP 过早进入知识图谱复杂度。第一版应该先验证“内容进来，知识出去”的闭环。

## 数据库选择

这些模型只要求 Postgres + pgvector，不绑定 Supabase。

本地开发可以使用 Docker：

```text
postgres://sift:sift@localhost:5432/sift
```

未来生产环境可以切换到 Supabase、Neon、RDS 或其他 Postgres 服务。
