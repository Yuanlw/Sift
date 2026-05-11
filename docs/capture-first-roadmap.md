# Capture-first Roadmap

## 核心结论

Sift 不做通用 Agent，不从头造 Claude Code、Codex 或 pi-mono。

Sift 的目标是做 Capture-first LLM Wiki 和 Knowledge Agent Layer：

- 前端负责丝滑收集用户看到、听到、想到的一切资料，包括还没想清楚、还没命名、还没分类的半成品想法和线索。
- 后端负责极速保存原始数据，再异步提取、分析、关联、融合、检索和引用。
- Sift 作为外部 Agent 的长期知识底座，而不是替代外部 Agent 的通用执行环境。
- 复杂执行动作交给 Claude Code、Codex、pi-mono 等 Agent 工作台。

后续关于产品目标、技术路线和优先级，都应以这个边界为准。

## 产品目标

Sift 的产品目标不是让用户更努力地做知识管理，也不是把分类、打标签、归档和定期整理换一种界面重新交给用户。

Sift 的目标是让用户用最低压力保存每天遇到的有价值信息，然后由 AI 在后台完成分析、关联和融合，在用户需要写作、研究、判断、问答或调用 Agent 时，给出可直接使用、可追溯来源的内容。

用户保存时不应该被要求先回答这些问题：

- 这条资料叫什么标题？
- 应该放进哪个文件夹？
- 该打什么标签？
- 将来会用在什么地方？
- 是否已经想清楚、值得正式记录？

Sift 应该允许用户先保存粗糙、零散、不完整的材料。真正的分析、关联、融合和结构化发生在后台处理、后续回顾、主题沉淀和知识复用中。

产品表达上应避免让用户感觉“我还要整理一个知识库”。用户侧承诺应是：

> 你不用整理。Sift 会把你保存的信息，分析成以后能直接使用的内容。

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

Inbox 不是一个低价值的临时垃圾箱，而是 Sift 的第一主场。它负责接住用户的好奇心、灵感、材料和待判断线索；长期知识结构和可用内容则由 Source、WikiPage、Search、Ask 和 Agent Context 在后台慢慢生成。

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
- 隐形关系层：记录 Source / WikiPage 之间的强证据关系，用于检索扩展、推荐和洞察，而不是先做知识图谱可视化。

检索和分析质量是关键动作，不应只依赖模型自由发挥。

### P10：隐形知识关系层

- 新增 `knowledge_edges`，记录 Source / WikiPage 之间的 `source_wiki`、`related_wiki`、`duplicate_source` 等关系。
- Capture 处理完成后写入直接关系边，并复用相似 Wiki / 重复 Source 结果沉淀关系。
- Ask / Agent 混合检索在关键词和向量召回后，沿 `knowledge_edges` 做一跳关系扩展，再统一 rerank 和引用。
- 第一阶段不做图谱可视化；关系层先服务“更准的问答、更完整的 Agent 上下文、更少人工整理”。
- 第一阶段也不部署独立图数据库；先用 Postgres 承载 `knowledge_edges`，等路径查询、图算法或关系规模真正成为瓶颈时，再评估 Neo4j / Kuzu 并纳入 Docker。

### P11：Graph-aware Retrieval

P11 不再解决“有没有关系边”，而是让检索理解关系边的含义。

- 查询意图识别：普通问答默认一跳；当问题明显在问关联、来源、证据、对比、重复内容时，允许更强的关系召回。
- 关系类型加权：`source_wiki`、`related_wiki`、`duplicate_source`、`supports`、`contradicts` 不同权重，避免重复资料和弱关系放大噪音。
- 有条件二跳扩展：只在关系型、证据型、对比型问题里启用，并对二跳结果降权。
- 关系感知 rerank：最终排序同时考虑关键词、向量、标题和关系强度。
- 可解释召回：Ask / Agent 返回关系跳数、关系类型和路径，让用户知道资料为什么被带出来。
- 局部关系展示：Source / Wiki 详情页展示当前资料的一跳关系、关系类型、强度和可点击目标；先服务阅读路径，不做全库大画布。

P10/P11 完成状态（2026-05-08）：

- 新增 `knowledge_edges` 和对应迁移/schema，处理完成后写入 Source-Wiki、相似 Wiki、重复 Source 关系。
- `retrieveHybridContexts` 已在关键词/向量 seed 之后做关系扩展，并按查询意图控制一跳/二跳。
- Ask、Wiki Ask 和 Agent Query 返回关系扩展元数据，外部 Agent 可以看到关系路径。
- Source / Wiki 详情页已展示一跳关系卡片，帮助用户顺着来源和知识页阅读。
- 当前仍使用 Postgres 关系表，不引入独立图数据库。

### P12：知识融合与一键合并

P12 的目标是把 P10/P11 发现的关系转化为真正减少用户整理时间的动作。

它不要求用户手工维护图谱，也不把相似资料只停留在“看看这个也相关”的提示上，而是让 Sift 在可控范围内把新资料融合进已有长期 WikiPage。

第一版范围：

- 待处理发现中的 `related_wiki` 和 `duplicate_source` 可以生成“合并预览”。
- 合并预览由 AI 生成，但必须先给用户确认；用户可以在确认前修改标题、改动摘要和 Markdown 正文。
- 确认合并后，目标 WikiPage 被更新，被并入的临时 WikiPage 自动归档，避免默认知识页列表继续碎片化。
- 新资料 Source 会补充关联到目标 WikiPage，`source_wiki_pages` 和 `knowledge_edges` 同步写入，保证后续 Ask / Agent 能沿来源追溯。
- 合并时记录 `wiki_merge_histories`，保存目标 Wiki 合并前后的正文、被并入 Wiki、相关 Source 和摘要，作为后续回滚或审计依据。
- 目标 Wiki 的 chunks 会按合并后正文重建；embedding 失败时仍保留文本 chunks，后续兜底任务可以补写向量。

边界：

- 不做全库自动无确认合并。
- 不做复杂协同编辑和冲突解决。
- 不把被并入 Wiki 直接删除；先归档，保证可追溯。
- 回滚第一版先保留数据基础，后续再做可视化恢复入口。

P12 完成状态（2026-05-08）：

- 待处理发现中的高置信度 `related_wiki` / `duplicate_source` 已出现“预览合并”入口。
- 合并预览由模型生成；用户确认前可以编辑标题、改动摘要和合并后 Markdown。
- 确认合并后，目标 WikiPage 更新，被并入 WikiPage 归档，新 Source 关联到目标 WikiPage。
- 合并会写入 `wiki_merge_histories`，并同步维护 `source_wiki_pages`、`knowledge_edges` 和目标 Wiki chunks。
- 修复了合并候选查询按不存在字段 `source_wiki_pages.updated_at` 排序的问题，改为使用 `created_at`。
- 可视化回滚入口已在 P13 实装；回滚所需的历史数据已落库。

### P13：合并历史可视化回滚入口

P13 把 P12 预留的回滚数据基础落到产品上：

- Wiki 详情页新增"合并历史"面板，按时间倒序展示最近合并记录、改动摘要、被并入页面链接和涉及来源数。
- 最新且尚未恢复的历史提供"恢复到合并前"按钮，确认后把目标 WikiPage 的标题与正文回滚到 `wiki_merge_histories.before_*` 快照，并按新内容重建 chunks 与 embedding；旧历史和已恢复历史只展示审计信息，避免覆盖后续变更。
- 回滚为软回滚：被并入页面的 archived 状态、对应 discovery 的 ignored 状态和历史记录全部保留；这次合并产生的 `source_wiki_pages` / `knowledge_edges` 会标记为非活跃，避免被 Ask / Agent 当作当前可信关系继续使用。
- `wiki_merge_histories.metadata.last_restored_at` 记录最近一次恢复时间，并写入 `wiki.merge.restore` audit log。

P13 完成状态（2026-05-09）：

- 合并历史面板已上线 Wiki 详情页。
- 恢复只允许最新且未恢复的合并历史，避免覆盖后续变更。
- 恢复后会失活本次合并带来的活跃来源关系与图关系，Ask / Agent / 管理页默认不再把它们当当前可信关系。
- 恢复失败会写入审计日志；embedding 恢复失败会保留正文回滚并标记为降级状态。
- 默认列表不再按 `Pxx` / `SMOKE` / `TEST` / `REVIEW` / `REGRESSION` 关键词隔离资料；历史测试资料视为普通资料，需要删除时走显式删除。

### P14：个人订阅与 Sift Model Gateway

P14 的目标不是继续堆更多模型平台，而是降低个人用户的模型使用门槛。

核心商业判断：

- 普通个人用户不应该被要求理解 OpenAI、Claude、Gemini、DeepSeek、Qwen、Kimi 等模型平台和 API Key。
- 个人订阅版应默认使用 Sift 提供的模型能力，只展示智能额度、能力范围和健康状态。
- 本地运行版也可以使用 Sift Model Gateway：数据仍保存在本地数据库，但模型处理请求会按订阅授权发送到 Sift 网关。
- 高级用户、公司用户和私有部署客户仍可使用 BYOK、本地 Ollama/LM Studio/MLX/vLLM 或企业内部模型网关。

第一版产品模式：

- 省心订阅：Sift 管模型，用户按套餐获得月度智能额度。
- 本地自管：用户本地运行模型或配置本地 OpenAI-compatible 网关，Sift 不代收模型费用。
- 高级 BYOK：用户配置自己的模型 API Key 或公司网关，Sift 只调用并记录健康状态。

第一阶段实施优先级：

- 把设置页、计费页和文档中的模型表达统一成“省心订阅 / 本地自管 / 高级 BYOK”。
- 明确本地运行 + Sift Gateway 的数据边界：本地保存不等于离线模型处理。
- 将 Personal / Pro 的套餐价值锚定到智能额度和默认模型能力，而不是“支持很多 provider”。
- 在公共 SaaS 前继续保留 BYOK/local model 作为兜底，避免模型成本和供应商选择阻塞早期用户验证。

P14.1 完成状态（2026-05-09）：

- Pricing 页面改为强调“无需自己配置模型”的个人订阅价值。
- Settings 中的套餐卡片补充 Personal / Pro / Team 的适用人群和核心利益点。
- 模型配置入口改成“省心模式”和“高级模式”，降低普通用户对 API Key、provider 和 embedding 配置的感知负担。
- 计费说明明确：使用 Sift 默认模型会消耗统一智能额度；本地运行若使用 Sift Gateway，处理内容会发送到云端模型服务。

P14.2 完成状态（2026-05-09）：

- 新增 `SIFT_MODEL_GATEWAY_BASE_URL` 和 `SIFT_MODEL_GATEWAY_API_KEY`，用于本地运行版连接 Sift Model Gateway。
- Sift Gateway 授权令牌与底层模型供应商 Key 分离；用户不需要拿到 OpenAI、Claude、Gemini、DeepSeek 或 Qwen 的供应商密钥。
- 默认模型解析顺序明确为：角色级 `MODEL_*` 配置优先，其次 Sift Gateway，最后本地默认 `MODEL_BASE_URL` / `MODEL_API_KEY`。
- Settings 摘要展示当前模型通道，区分 Sift Gateway、本地默认端点和本地/BYOK。
- Local setup 和 deployment 文档补充本地运行 + Sift Gateway 的配置与数据边界。

P14.3 完成状态（2026-05-09）：

- Settings 增加 `Sift Gateway 授权` 状态卡，明确展示令牌是否已配置、令牌来源、绑定对象、额度来源和密钥边界。
- 产品表达统一为：Gateway token 由 Sift 订阅账号签发，保存在服务端环境变量里，不是底层模型供应商 Key。
- 当前阶段不新增本地签发/吊销数据库表；账号中心、设备列表、轮换和吊销属于后续云端订阅中心能力。
- 文档补充 token 生命周期：签发、绑定、服务端保存、轮换、吊销、订阅失效后的网关侧拒绝。
- 本地运行 + Sift Gateway 继续保持边界清晰：数据本地保存，但默认模型处理内容会发送到网关；完全离线必须切到自定义本地模型。

P14.4 修复状态（2026-05-09）：

- Gateway 环境变量必须成对填写；只填 `SIFT_MODEL_GATEWAY_BASE_URL` 或只填 `SIFT_MODEL_GATEWAY_API_KEY` 会报配置错误，避免 endpoint/key 混用。
- 合并历史恢复在真正写入 WikiPage 时会再次校验当前内容和最新历史，避免并发编辑或后续合并被旧恢复覆盖。
- 降级恢复文案改为“不承诺自动补齐”，避免把现有 recovery 能力说成确定的专用恢复任务。

### P15：Personal Subscription Activation MVP

P15 的目标是让个人订阅从“价格页上的概念”变成“可以运营开通、可吊销、可验证的模型授权闭环”。

商业判断：

- 是的，Sift 需要一个后台服务；但第一版应是轻量 Sift Cloud control plane，不是把本地 Sift 变成完整 SaaS。
- 本地 Sift 继续管理用户知识库、文件、Wiki、Source、Ask 和 BYOK/local model。
- Sift Cloud 只管理订阅账号、Stripe 状态、Gateway token、额度 entitlement、网关侧模型路由和吊销。
- 个人订阅卖的是“无需自己配模型也能稳定使用”，不是“给用户一堆 provider 选择”。

P15 第一版范围：

- 账号/订阅：能确认某个邮箱或账号是否有 Personal/Pro 权益。
- Token 生命周期：签发、查看状态、轮换、吊销，token 绑定账号/套餐/可选安装设备。
- Gateway 授权：网关收到请求时校验 token、订阅状态、额度和吊销状态，再转发到底层模型。
- 额度闭环：Settings 显示本地消耗；Gateway/Cloud 记录订阅额度消耗事实，后续同步或查询。
- 运维后台：至少支持人工查账号、查 token、查订阅状态、查最近网关失败和手动吊销。
- 用户路径：购买/人工开通 -> 获得 token -> 本地 `.env` 配置 -> Settings 显示已授权 -> 完成第一次整理和 Ask。

详细边界见 [Sift Cloud Control Plane](sift-cloud-control-plane.md)。

P15.1 完成状态（2026-05-09）：

- 新增 `sift_gateway_tokens` 和 `sift_gateway_usage_ledger` schema/migration，作为 Sift Cloud control plane 的最小数据底座。
- 新增 Gateway token 生命周期 API：列表、签发、吊销、服务端校验。
- Gateway token 只返回一次明文；数据库保存 token hash、可见 prefix、状态、安装标识、计划快照和吊销信息。
- `POST /api/gateway/tokens/validate` 使用 `SIFT_CLOUD_CONTROL_API_KEY` 保护，供未来 Sift Model Gateway 服务端校验 token、订阅状态和额度。
- 当前还没有用户可见的账号中心页面；签发/吊销能力先以 API 骨架落地，后续再接 Settings 或独立 Sift Cloud 管理后台。

P15.2 完成状态（2026-05-09）：

- Gateway token 校验升级为服务端强校验：状态、过期时间、Stripe 订阅状态、网关侧月度额度、单次请求额度、分钟/小时请求频率和小时额度峰值。
- 校验通过会写入 `reserved` usage ledger 并返回 `authorizationId`，让网关在调用底层模型前先预占额度，降低并发刷额度风险。
- 新增 `POST /api/gateway/usage`，由 Sift Model Gateway 在模型调用完成后把预占记录结算为 `success` 或 `failure`，并写入实际 credits、错误码和元数据。
- revoked / expired / over-quota / rate-limited 等拒绝会记录为 `rejected`，方便后续风控和客服排查。
- 本地客户端仍不能直接扣减或修改额度；所有 Gateway 额度判断都由 `SIFT_CLOUD_CONTROL_API_KEY` 保护的服务端接口完成。

### P16：Mobile Capture Retention MVP

P16 重新确认产品分层：

- 客户端产品：桌面端、本地 Web、未来手机端，负责 Capture、Inbox、Source、Wiki、Ask、本地文件和 BYOK/local model。
- 云端服务：账号、订阅、Gateway token、额度、模型网关、支付状态、吊销和风控。

商业优先级：

1. 移动端 Capture 入口是留存命门。
2. 账号体系补全是收钱的门。
3. 先找真实用户验证留存数据，再谈增长。

P16 的目标不是先做完整原生 App，而是先让手机上的真实资料更低摩擦进入 Sift。

第一版范围：

- 新增 `/capture` 手机快存入口，适合手机浏览器、书签、Shortcut、分享落地页和未来 App/WebView。
- 支持 URL / title / text 分享参数预填，减少手机复制粘贴成本。
- 支持图片上传、正文、链接和备注混合保存，继续复用 `/api/captures`。
- 保存仍然先落库，再后台处理，不让 OCR、网页提取或模型处理阻塞保存。
- Web manifest 增加 share target，为移动端分享入口和 PWA 安装做准备。
- 导航中提供“快存”入口，方便真实用户形成每天收集习惯。

P16.1 完成状态（2026-05-09）：

- 新增 `/capture` 页面，作为手机快存落地页。
- `CaptureForm` 支持初始内容、初始备注和保存后跳转，方便分享入口预填并回到今日收集。
- 新增 Web App Manifest share target，支持 `title` / `text` / `url` 参数进入 `/capture`。
- 强制登录模式下，`/capture` 会先跳转登录，并保留原始分享参数，避免手机分享内容在登录过程中丢失。
- 主导航新增“快存 / Capture”入口。

### P17：Account & Subscription Center

P17 目标是把收钱链路产品化，而不是依赖人工解释。

第一版范围：

- 云端账号身份和本地安装绑定。
- 订阅状态、套餐、额度和账单入口。
- Gateway token 列表、签发、轮换、吊销和设备标识。
- 支付失败、取消订阅、超额和 token 异常状态的用户可见提示。
- 支持运营后台查看账号、订阅、token、Gateway 失败和风控事件。

P17 在 P16 之后推进：先证明真实用户每天会把资料丢进来，再把账号中心做成收钱入口。

P17.1 完成状态（2026-05-09）：

- Settings 的 `Sift Gateway 授权` 卡从说明态升级为可操作的账号中心入口。
- 新增 Gateway token 管理组件：可刷新 token 列表、签发 token、查看状态、查看设备标识、查看最近使用时间并吊销 token。
- 新签发 token 只在签发成功后显示一次；后续只展示 token prefix，避免把完整授权长期暴露在页面上。
- 签发时可填写显示名称、设备标识和有效期，为本地桌面端、手机端或多设备安装预留绑定能力。
- 吊销操作复用 `POST /api/gateway/tokens/[id]/revoke`，写入既有审计日志；泄露、换设备、订阅取消时有第一版可执行路径。
- 当前还不是完整 Cloud 运营后台；账号/订阅中心先覆盖个人用户自助 token 生命周期，运营侧账号查询、风控队列和客服工具继续放在后续 P17.x。

P17.2 完成状态（2026-05-09）：

- Settings 顶部新增 `账号中心状态` 面板，把订阅、额度和默认模型授权聚合成三个用户可见状态。
- 订阅状态会区分本地/手动开通、Stripe 有效订阅、试用、未完成、逾期、取消和付款失败。
- 额度状态会提示账本未迁移、不限制额度、额度可用、低余额和硬限制用尽。
- 模型授权状态会区分自定义模型无需 Gateway、默认模型已配置 Gateway、默认模型未配置 Gateway token。
- 每个状态卡都指向对应处理区：套餐、账单、额度、模型配置或 Gateway 授权，减少用户不知道下一步点哪里的摩擦。
- 这一步解决个人订阅的可解释性：用户和运营都能先判断“能不能收钱、能不能扣额度、能不能交付默认模型能力”。

P17.3 完成状态（2026-05-09）：

- 新增只读运营/客服查询台 `/admin/account-support`，按邮箱查询单个用户 case。
- 后台入口由 `SIFT_ADMIN_EMAILS` 白名单保护；未登录跳转登录，非白名单访问返回 404，未配置白名单时默认关闭。
- 查询结果聚合用户身份、套餐、Stripe 订阅状态、额度账本、产品使用摘要、Gateway token 列表和最近 Gateway 拒绝/失败。
- Gateway token 只展示 prefix、状态、设备标识、过期/最近使用/吊销信息，不展示完整 token 或 token hash。
- 最近 Gateway 拒绝/失败用于客服判断订阅失效、额度不足、频率限制、token 吊销、请求过大等原因。
- P17.3 仍然是只读客服台；套餐调整、额度改动、退款、手动补偿和风控处置继续后置，避免过早扩大后台写权限。

P17.4 完成状态（2026-05-09）：

- `/admin/account-support` 从只读查询升级为可记录处理结果：客服可选择问题类型、联系状态并写入处理备注。
- 新增 `support_case_notes` 表，记录用户、管理员、问题类型、联系状态、备注和时间，便于后续客服接手。
- 支持的问题类型第一版包括 billing、refund、gateway、quota、login、product 和 other；联系状态包括未联系、已联系、等待用户、已解决。
- 客服处理记录写入独立表，并通过 `/api/admin/support-notes` 由 `SIFT_ADMIN_EMAILS` 白名单保护。

P17.5 完成状态（2026-05-09）：

- 新增人工退款工作台 `/admin/refunds`，用于登记和跟进线下退款，不调用 Stripe Refund API，不承诺原路退回。
- 新增 `manual_refunds` 表和迁移，记录用户、金额、币种、退款原因、支付线索、套餐/Stripe 快照、线下打款方式、线下凭证、状态和处理人。
- 退款状态第一版只包含 `requested`、`paid`、`cancelled`，先覆盖早期运营需要：登记退款、线下打款后标记已支付、取消误建工单。
- 退款操作接口 `/api/admin/manual-refunds` 只允许 `SIFT_ADMIN_EMAILS` 白名单管理员调用，并写入 `audit_logs`。
- `/admin/account-support` 增加跳转人工退款入口，客服从账号 case 可以直接进入该用户的退款记录。
- 退款工单新增运营 checklist：确认订阅已取消/不再续费、检查或吊销 Gateway token、检查额度/降级状态、已联系用户说明退款方式。
- P17.5 只记录线下走款和运营检查流程；真实打款、银行转账、微信/支付宝退款或财务支付仍发生在 Sift 外部。

### P18：真实用户留存观测

P18 的目标是让早期试用不靠感觉判断，而是能看到用户是否真的完成“注册 -> 保存 -> 回来 -> 生成知识 -> Ask”。

第一版范围：

- 新增 `product_events`，记录 signup、capture entry、capture created、source created、wiki created 和 Ask。
- 事件记录失败不影响主链路，尤其不能让 Capture 保存等待运营埋点。
- 新增 `/admin/retention` 留存看板，按 30 天用户查看 10 分钟激活、D1+/D7+ 回访保存、周保存天数、Source/Wiki/Ask 转化。
- D1+/D7+ 只按已经到达观察窗口的 eligible 用户计算，避免刚注册用户稀释留存。
- 后台事件分布用于确认 PWA、Shortcut、分享入口和普通网页入口是否真实流动。

P18 完成状态（2026-05-09）：

- `product_events` schema 和迁移已补齐。
- Signup、Capture、Source、Wiki、Ask 和 `/capture` 入口已接入产品事件。
- `/admin/retention` 由 `SIFT_ADMIN_EMAILS` 白名单保护，并能跳回快存入口和账号 Case。
- 当 `product_events` 尚未迁移时，看板会提示并回退到核心业务表，避免后台直接崩溃。

### P19：移动端 Capture 入口可归因

P19 不先做完整原生 App，而是把当前 `/capture` 入口做成可观察、可迭代的真实留存入口。

第一版范围：

- `/capture` 支持 `source` 参数，区分 `mobile_capture`、`pwa_share`、`ios_shortcut`、`android_share` 等入口来源。
- 登录跳转会保留 `source`、`title`、`url`、`text` 和 `note`，避免手机分享过程中丢失材料或归因。
- Capture 表单提交会把 `sourceApp` 写入 `raw_payload.sourceApp`、审计日志和 `product_events.source`。
- Web Manifest share target 继续指向 `/capture`，后续 PWA 分享可用同一条保存链路。
- 所有移动入口仍复用 `/api/captures`，不新建第二套保存或处理流程。

P19 完成状态（2026-05-09）：

- `/capture?source=...` 已接入来源归因。
- `capture.entry.viewed` 和 `capture.created` 事件可以一起判断入口曝光与保存完成。
- Capture 原始 payload、audit log 和留存看板事件分布能看到真实入口来源。

### P20：桌面/手机客户端与云端服务拆分

P20 的目标是避免把 Sift 做成一团：客户端负责每天保存和使用知识，云端负责订阅、额度、token 和模型授权。

边界文档见 [Client / Cloud Boundary](client-cloud-boundary.md)。

执行结论：

- 桌面端、本地 Web 和未来手机端属于客户端产品，核心指标是 Capture 留存和知识复用。
- Sift Cloud control plane 属于商业授权服务，负责账号、订阅、Gateway token、额度和后台运营。
- Sift Model Gateway 属于模型能力交付层，校验授权后调用底层模型供应商。
- 用户本地知识库、上传文件、Source/Wiki 和长期记忆不应被 Cloud control plane 接管。

P20 完成状态（2026-05-09）：

- 新增 `docs/client-cloud-boundary.md`，明确客户端、云端控制面、模型网关的数据与职责边界。
- Roadmap、Cloud control plane 和真实用户试运行文档统一使用这条边界，后续不再把“本地运行”和“离线模型处理”混为一谈。

### P21：真实用户试运行准备

P21 的目标是把“可以找真实用户了”变成一个可检查的门槛，而不是主观判断。

第一版范围：

- 新增真实用户试运行 checklist，覆盖试用门槛、留存指标、客服流程和退款流程。
- 新增 `npm run preflight:trial`，检查关键文件、schema、迁移、环境变量、Gateway 配对和后台配置。
- 预检脚本默认不打印 secret；带 `--db` 时可检查当前数据库是否已迁移关键表。
- 真实用户试运行以 10-20 个目标用户为单位，先观察 D1/D7 和保存习惯，再谈增长。

P21 完成状态（2026-05-09）：

- 新增 [Real User Trial Checklist](real-user-trial-checklist.md)。
- 新增 `scripts/preflight-real-user.mjs` 和 `npm run preflight:trial`。
- 试运行前置条件已覆盖移动快存、留存看板、账号客服、人工退款、订阅/Gateway 授权和 schema 迁移。

### P22：部署前提交硬化

P22 的目标是把 P13-P21 这批功能从“代码已经写完”收口到“可以讨论部署方案”。

它不新增产品能力，只解决四件事：

- 提交前静态验证：`git diff --check`、`typecheck`、`lint`、`build`。
- 真实用户试运行预检：`preflight:trial`，必要时加 `--db` 检查目标数据库迁移。
- 运行时 smoke：在模型服务、Postgres 和构建服务都可达时运行 `smoke:agent`。
- 部署入口文档：把 Docker/VPS、迁移、环境变量、后台入口和 smoke 边界写清楚。

P22 完成状态（2026-05-09）：

- 新增 [Deployment Readiness Checklist](deployment-readiness.md)。
- 新增 `npm run verify:release`，串联 typecheck、lint、build 和 trial preflight。
- 明确现阶段部署优先选择 VPS + Docker Compose + Cloudflare，暂不把 Vercel + Neon + Inngest 作为默认路线。
- 部署讨论的下一步从环境与运行方式开始，而不是继续扩功能。

### P23：轻量短记模式（后续想法）

P23 不是当前上线前任务，只是先记住一个未来方向：

- 当输入足够短时，可以只保存、不分析，仍保持可搜索。
- 这种短记录可以在按天排列的日历格里回看，更接近苹果便利贴式的随手记。
- 这类入口适合做成极低摩擦的补充记忆层，但要等上线和私测稳定后再评估。

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
- X 链接优先使用 `defuddle.md` 提取单帖 Markdown，失败后使用 `r.jina.ai` 作为通用 Markdown fallback，并保留最终失败时的原始链接。
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
- 来源资料、知识页和收集箱不再提供“测试资料”视图，避免真实资料被关键词误分流；历史测试资料按普通资料展示。
- 来源资料和知识页提供默认/已归档视图、搜索和加载更多，避免大列表一次性铺满页面。
- 来源资料和知识页详情支持归档/恢复；归档只移出默认管理流，不做永久删除。
- 来源资料和知识页列表支持多选批量归档/恢复/永久删除，方便批量移出或清理默认管理流。
- 来源资料和知识页支持直接永久删除；删除会级联清理只由该资料支撑的 Source/Wiki、检索片段、页面关系、图谱边和历史问答，避免搜索召回已删除内容。
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

### P8：模型配置、额度和 provider 演进

- 保持核心业务逻辑不绑定单一模型厂商。
- 支持 OpenAI、Anthropic、Google Gemini、阿里 Qwen、DeepSeek、豆包、智谱 AI、Kimi。
- 支持本地模型和自定义中转站模型，普通用户在设置中心配置，不直接改 `.env`。
- 允许文本、embedding、视觉 OCR 分别配置不同模型，并提供配置验证。
- 默认模型以“综合智能额度”面向用户；系统内部按 OCR、文本、embedding、Ask、检索分项记账。

P8.0 完成状态（2026-05-05）：

- 明确区分两类模型面：收集处理模型和知识复用/问答模型。
- 收集处理侧覆盖 OCR、结构化整理和写入 embedding。
- 知识复用侧覆盖全库 Ask 检索 embedding、全库回答、单页回答、管理搜索语义召回和 Agent 查询召回。
- 新增 `model_call_logs`，记录模型阶段、角色、用途、provider、model、endpoint host、耗时、成功/失败、输入/输出规模和 token usage。
- 模型调用日志不保存原始 prompt、原始资料正文、图片内容或模型输出。
- 文档化自定义模型和默认托管模型两种模式：自定义模型不对模型 token 收费；使用 Sift 默认模型时需要按 credit/quota/usage 计费。

P8.1 完成状态（2026-05-05）：

- 新增 `/settings` 设置中心，作为账号、部署、模型配置和模型消耗的管理入口。
- 设置中心展示当前用户身份来源、任务派发模式、Agent API Key 是否配置。
- 设置中心支持「使用 Sift 默认模型」和「使用自定义模型」两种模式。
- 默认模型模式只展示能力、额度、消耗和健康状态，不展示底层供应商、模型名、endpoint 或密钥。
- 自定义模型模式允许用户配置文本、embedding、视觉 OCR 的 OpenAI-compatible Base URL、模型名、API Key 和必要参数，并提供验证按钮。
- 自定义模型模式缺少必要字段时不静默回退默认模型，应提示用户补齐配置或切回默认模式。
- 设置中心汇总最近 30 天模型调用、失败数、token、字符规模、平均耗时、高频用途和最近失败。
- 设置中心补充自定义模型、自管模型、默认托管模型 credit/quota/usage 的计费边界说明。

详细规划见 [Model Strategy and Billing](model-strategy-and-billing.md)。

P8 后续增强：

- 增加 plan / credit / quota 机制。
- 再逐步增加 OpenAI、Anthropic、Gemini、Qwen、DeepSeek、Kimi 等专用 provider adapter。
- 小样本评测集、评测 runner 和模型对比报告降级为后续内部工具，不作为当前产品主线阻塞项。

P8.2 计划：

- 新增智能额度账户和额度账本。
- 单租户默认 `unlimited`，只记录额度消耗，不打断本地使用；可手动切换 `soft_limit` 或 `hard_limit`。
- SaaS 模式按 plan 配置月度额度，默认模型消耗统一智能额度。
- 自定义模型模式不扣 Sift 智能额度，只保留调用健康和失败统计。
- 默认模型成功调用后写入额度账本，按 `capture_processing`、`image_ocr`、`semantic_indexing`、`ask`、`retrieval` 分项归因。
- 设置中心展示本月额度、已用、剩余、单租户/套餐模式、分项消耗和超额策略。
- `hard_limit` 下额度耗尽时阻止新的默认模型调用，但保存原始资料仍应可用。

P8.2 完成状态（2026-05-06）：

- 新增 `smart_quota_accounts` 和 `smart_quota_ledger`。
- 默认模型成功调用后写入智能额度账本。
- 自定义模型模式不扣 Sift 智能额度。
- 额度按统一余额面向用户，内部按 `capture_processing`、`image_ocr`、`semantic_indexing`、`ask`、`retrieval` 分项。
- 单租户默认 `local / unlimited / 10000`，不硬卡本地使用，但保留用量视图。
- `hard_limit` 策略下，本月额度耗尽会阻止新的默认模型调用。
- 设置中心新增智能额度区：展示本月额度、已用、剩余、策略、套餐和分项消耗。

P8.3 计划：

- SaaS 支付使用 Stripe Checkout，不自研支付表单。
- 设置中心展示 Personal、Pro、Team 三个订阅入口。
- Stripe 未配置时，本地单租户继续正常使用，升级按钮禁用。
- 后端创建 Checkout Session，前端不接触 Stripe Secret Key。
- Stripe Webhook 校验签名后回写 `smart_quota_accounts`。
- 支付成功后套餐切换为 `stripe / hard_limit`，并写入对应月度智能额度。
- 订阅取消或不可用状态降级为小额度 free plan。

P8.3 完成状态（2026-05-06）：

- 新增 `POST /api/billing/checkout` 创建 Stripe Checkout Session。
- 新增 `POST /api/billing/stripe/webhook` 处理 Stripe Webhook。
- 新增 Stripe customer/subscription 字段和索引。
- 设置中心新增套餐与升级区。
- Stripe 配置留空时不影响本地单租户使用。
- 新增公开价格页、联系页、隐私政策、服务条款和退款政策，并在页脚暴露入口，支撑 SaaS/Stripe 审核前的网站基础要求。

P8.4 完成状态（2026-05-06）：

- 新增 `POST /api/billing/portal` 创建 Stripe Customer Portal Session。
- 设置中心「订单、发票与凭证」区新增订阅状态和“管理账单”入口。
- 订单、发票、支付方式、取消订阅和套餐变更交给 Stripe Customer Portal，Sift 只同步订阅状态和额度结果。
- Stripe Customer Portal 未配置、本地单租户或尚未产生 Stripe customer 时，账单入口保持禁用并给出产品说明。

### P9：账号体系基础

- 用真实账号替代默认单用户假身份。
- 支持本地邮箱密码注册、登录和退出。
- 使用 HttpOnly session cookie 保护核心页面和用户 API。
- 第一个注册账号自动认领 `SIFT_SINGLE_USER_ID` 旧数据。
- 设置中心展示当前账号邮箱、身份来源和退出登录入口。
- 保留 `SIFT_TRUST_USER_HEADER` 给受信网关/反向代理模式使用。
- 团队空间、邀请成员、邮箱验证、找回密码、OAuth 和 workspace 权限留到后续阶段。

P9.0 完成状态（2026-05-07）：

- 新增 `users` 和 `user_sessions`。
- 新增 `/signup`、`/login` 和 `POST /api/auth/logout`。
- 新增 `POST /api/auth/signup` 和 `POST /api/auth/login`。
- 新增 middleware，未登录访问 `/`、`/inbox`、`/sources`、`/wiki`、`/settings` 和用户 API 时跳转或返回 401。
- `getUserContext...` 优先读取登录 session，其次保留 Agent API Key、受信 Header 和可选默认用户 fallback。
- `.env.example` 和本地启动文档新增 `SIFT_REQUIRE_AUTH`、`SIFT_SESSION_SECRET`。
- 本地验证中，第一个账号已认领默认用户下的历史资料。

P9.1 完成状态（2026-05-07）：

- 新增 `POST/PATCH /api/account/profile`，支持在设置中心更新显示名称，并刷新当前 session cookie 中的账号展示信息。
- 新增 `POST /api/account/password`，修改密码时必须校验当前密码；成功后保留当前会话，并让其他未失效会话失效。
- `getUserContext...` 改为服务端校验 `user_sessions.revoked_at` 和 `expires_at`，避免只凭未过期 Cookie 判断登录态。
- Agent API / MCP 在只有一个真实账号时会自动归属到该账号；配置 `SIFT_AGENT_API_KEY` 后再由 Bearer Token 保护接口。
- 设置中心新增个人资料和修改密码表单，账号维护不再只停留在“登录/退出”。

P9.2 修复状态（2026-05-07）：

- Agent API / MCP 在 `SIFT_REQUIRE_AUTH=true` 时不再允许匿名访问；必须携带登录 session 或正确的 `SIFT_AGENT_API_KEY`。
- 多账号场景下 Agent API Key 必须通过 `SIFT_AGENT_USER_ID` 显式绑定用户，否则拒绝使用默认空用户。
- 公开注册默认只允许创建第一个账号；后续注册需要显式开启 `SIFT_ALLOW_PUBLIC_SIGNUP=true`。
- 未登录访问服务端页面时兜底跳转 `/login`，避免直接抛出 `Authentication required` 开发报错。
- `npm run smoke:agent` 已补登录流程，可在 P9 默认登录模式下验证 capture-first 与 Agent/MCP 链路。

P9.3 登录安全增强（2026-05-07）：

- 新增 `auth_rate_limits`，按邮箱和来源 IP 记录失败登录，15 分钟内失败 5 次后锁定 15 分钟。
- 登录成功后清理对应邮箱/IP 的失败记录，避免用户恢复正确密码后继续被历史失败拖住。
- 登录、注册、资料修改和改密码接口增加基础同源校验；带有跨站 `Origin` / `Referer` 的浏览器请求会被拒绝。
- 密码长度增加上限，避免异常长密码造成不必要的 hash 计算压力。

P9.4 安全和验证修复（2026-05-08）：

- 登录态写接口补齐统一同源校验，包括 Capture 创建/导入/补充/重试/忽略、Ask、Wiki Ask、发现合并/忽略、推荐隐藏、资料归档/删除、模型设置和账单入口。
- Agent/MCP、Inngest、Stripe Webhook、维护任务仍保持外部集成认证方式，不强制浏览器同源校验。
- `loadKnowledgeDiscoveries` 的 Source/Wiki join 已按 `kd.user_id` 收口，避免异常跨用户引用泄露标题或 slug。
- `npm run smoke:agent` 不再在零账号状态下直接写入 smoke 用户，避免绕过首个账号认领默认数据逻辑。
- smoke provision 会清理邮箱和默认 IP 的登录限流残留，减少本地验证被旧失败记录误伤。

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
