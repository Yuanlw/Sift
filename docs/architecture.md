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
- OCR：OpenAI Vision 起步
- AI：OpenAI API
- 部署：Vercel + Supabase

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
- `ProcessingJob`：处理任务状态

暂时不做：

- `Claim`
- `GraphEdge`
- 复杂知识图谱

这些可以等使用模式稳定后再加。

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
- 基础标题和正文搜索

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

