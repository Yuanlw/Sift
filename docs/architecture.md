# 架构草图

## 核心模块

```text
Capture Apps
  -> Inbox API
  -> Extraction Pipeline
  -> AI Processing
  -> Knowledge Store
  -> Search / Ask / Browse
```

## Capture Apps

负责低摩擦收集。

第一版重点：

- iOS 分享扩展
- Web App
- 图片上传
- 文本快速输入
- 链接保存

## Inbox API

负责接收用户保存的原始内容。

保存内容包括：

- 原始链接
- 原始图片
- 用户附加说明
- 保存时间
- 来源平台
- 处理状态

## Extraction Pipeline

负责把原始内容变成可处理文本。

能力包括：

- 网页正文提取
- OCR
- 元数据提取
- 去重
- 语言检测

## AI Processing

负责把资料沉淀成知识。

处理结果包括：

- 来源记录
- 核心观点
- 关键词和主题
- 相关页面建议
- 新建或更新的知识页
- 冲突和开放问题

## Knowledge Store

第一版可以优先使用 Markdown 风格的数据模型。

核心对象：

- Source：来源资料
- WikiPage：主题知识页
- Link：页面关联
- Claim：可追溯观点
- Log：处理记录

## Search / Ask / Browse

用户复用知识的入口。

第一版能力：

- 全文搜索
- 主题浏览
- 来源查看
- 基于个人知识库问答
- 最近更新

