# 序幕TV 项目全量交接手册

> 文档版本：2026-09-09
> 代码与预发验收快照：2026-09-08
> 适用范围：产品、前端、后端、AI Provider、部署和日常运维

这份文档是接手项目的总入口。它描述当前代码、数据边界、用户流程、异步任务、供应商、部署和已知风险。它不保存任何 API Key、密码、Cookie、验证码、用户上传内容或完整环境变量值。

## 1. 先看结论

### 1.1 项目是什么

序幕TV（内部代码名 SEQORA）是面向网剧、广告和短片的 AIGC 视频制作工作台。核心目标是把用户的一句话或一段剧本转成可按场次执行的内容：

```text
登录/注册
  -> 项目库
  -> 剧本生成、改写、续写、按集保存
  -> 资产建议与人物/场景/物品/服装定稿
  -> 分镜与镜头承接
  -> 图片/视频异步生成队列
  -> 分集或全片工作预览
```

项目不是专业非编软件。正式配音、字幕、混音、音乐编排、专业时间线和商业交付编码仍不属于已完成范围。

### 1.2 最重要的架构判断

- 前后端分离：apps/web、apps/admin 是独立前端，apps/api 是独立 Fastify 服务。
- API 和 Worker 使用同一套后端代码和镜像，但运行在不同进程/容器。
- Postgres 是账号、组织、项目、任务和账单的业务事实源。
- Redis/BullMQ 只负责任务触发和消费，不是业务数据源。
- Outbox 保证“数据库记录、扣费、队列触发”不会因为 Redis 短暂失败而分裂。
- 所有第三方模型调用只能从 API/Worker 发出；浏览器不能拿 Provider Key，也不能决定权限、积分或最终任务状态。
- 组织隔离是硬规则。对外叫 organization，数据库历史表仍可能叫 tenant。
- 当前先保持单体 API + 独立 Worker，不要为了“工程化”直接拆成微服务。

### 1.3 当前发布快照

| 项目                          | 当前事实                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| 当前代码分支                  | codex/demo-reliability-ui                                                                                |
| 当前 HEAD                     | aeb0051 fix: unblock storyboard batch video submission                                                   |
| origin/main                   | d6d2988 chore: format release changes                                                                    |
| Git 差异                      | 当前 HEAD 相对 origin/main 为 0 behind / 1 ahead；工作区仍有较多未提交修改，接手时不得 reset/stash/clean |
| Stage 主机                    | 47.113.221.232                                                                                           |
| Stage 目录                    | /opt/seqora-preprod                                                                                      |
| Stage 候选源码                | /opt/seqora-preprod/candidate-aeb0051-20260908                                                           |
| Stage API 镜像                | seqora-preprod-api:aeb0051-candidate                                                                     |
| Stage Web 镜像                | seqora-preprod-web:aeb0051-candidate                                                                     |
| Stage Compose 项目            | seqora-preprod                                                                                           |
| 生产域名                      | https://xumutv.com                                                                                       |
| 生产形态                      | 阿里云 ECS 单机 Docker Compose；发布前必须重新核对实例、目录和镜像                                       |
| 生产是否被本次 Stage 切换修改 | 没有；本次只切换 Stage                                                                                   |

Stage 最近一次验收结果：API、Worker、Web、Postgres、Redis 均运行且零重启；migration head 为 040_trusted_validation_sessions.sql；队列无 waiting/active 任务；近 15 分钟无致命日志。Stage 从外部访问 80/443 曾超时，但服务器内部访问正常，优先检查阿里云安全组而不是直接修改应用。

Stage 仍有两个不能忽略的状态：

1. 自动化只读登录探针使用的测试账号密码与当前数据库不一致，不能擅自重置已有账号；应建立专用 synthetic 账号并通过 Secret 注入。
2. PostgreSQL 集成测试的清理阶段仍会出现 57P01 terminating connection by administrator command，业务断言已通过，但测试进程可能以 1 退出；修复测试 fixture 后才能把完整门禁标为通过。

## 2. 阅读顺序与事实优先级

### 2.1 新同事第一天

1. 本文：了解全局架构、当前状态和交接任务。
2. AGENTS.md：开发红线和修改顺序。
3. CURRENT_STATE.md：功能矩阵和产品限制。
4. ARCHITECTURE.md：长期架构边界。
5. OPERATIONS_RUNBOOK.md：发布、巡检、备份和故障处理。
6. 目标模块的 contracts -> Route -> Service -> Repository/Provider -> Worker -> 前端真实调用链。
7. DEVELOPMENT_MEMORY.md：只在需要历史事故和决策背景时阅读。

### 2.2 文档冲突时

```text
共享 contracts 和 migration
  > 当前后端 Service/Repository/Provider
  > 前端真实调用和可交互页面
  > CURRENT_STATE.md
  > 专项设计文档
  > DEVELOPMENT_MEMORY.md 的历史记录
```

发现冲突时先查代码，再在同一个变更中修正文档。历史文档可能描述旧 Provider、旧部署地址或旧 UI，不可以直接照抄。

## 3. 仓库结构

```text
.
├─ apps/
│  ├─ web/                  React 创作端，Vite 构建
│  ├─ admin/                独立管理员端，生产挂载 /admin/
│  ├─ api/                  Fastify API、Worker、Provider、migration
│  └─ e2e/                  Playwright 端到端测试
├─ packages/
│  ├─ contracts/            前后端共享 Zod 契约、实体、角色、权限
│  └─ prompting/            图片/视频提示词编译和质量规则
├─ deploy/                  Dockerfile、Caddy、发布、备份、恢复、拨测
├─ scripts/                 开发、架构检查、压测、安全、监控
├─ docs/                    架构、产品、Provider、测试、运维和历史
├─ compose.local.yml        本地 dev/test Postgres 和 Redis
└─ compose.demo.yml         单机预发/生产 Compose 基线
```

依赖方向：

```text
apps/web  -----> packages/contracts <----- apps/api
apps/admin -----> packages/contracts <----- apps/api
apps/web  -----> packages/prompting  <----- apps/api
```

packages/contracts 不依赖 UI、Fastify 或数据库；它是请求、响应、枚举和权限的公共协议层。

### 3.1 关键入口

| 目标                 | 代码位置                                                 |
| -------------------- | -------------------------------------------------------- |
| API 装配             | apps/api/src/app.ts                                      |
| API 启动和优雅退出   | apps/api/src/server.ts                                   |
| Worker 启动          | apps/api/src/worker.ts                                   |
| 环境配置校验         | apps/api/src/config.ts                                   |
| Provider 工厂        | apps/api/src/runtime/providers.ts                        |
| 数据库/服务/队列装配 | apps/api/src/runtime/database.ts、services.ts、queues.ts |
| 路由注册             | apps/api/src/runtime/routes.ts                           |
| 前端总编排           | apps/web/src/App.jsx                                     |
| 前端 API 客户端      | apps/web/src/services/apiClient.js                       |
| 前端会话             | apps/web/src/components/AuthProvider.jsx                 |
| 管理端入口           | apps/admin/src/App.jsx                                   |
| 共享契约             | packages/contracts/src/                                  |
| 提示词编译           | packages/prompting/src/                                  |

## 4. 运行时拓扑

```text
浏览器创作端/管理端
  -> Caddy HTTPS、/api 代理、/admin 保护
  -> Fastify API
       -> Postgres
       -> Outbox
       -> ObjectStorage
       -> Resend
  -> Redis/BullMQ
       -> 独立 Worker
            -> Postgres 写回
            -> 文本/图片/视频/资产 Provider
```

### 4.1 进程职责

**Web/Caddy**

- 提供创作端静态资源和 /admin/ 静态资源。
- 处理 HTTPS、同域 /api 代理和管理员路径的额外保护。
- 不执行 Provider 调用，不保存业务事实。

**API**

- 处理认证、权限、组织边界、业务 CRUD、任务创建、查询和媒体代理。
- 长耗时工作只创建数据库任务并返回，不在 HTTP 请求内等待模型完成。
- 负责 readiness、HTTP 日志、API 错误映射和 Outbox relay。

**Worker**

- 消费 BullMQ 触发消息，从 Postgres claim 任务。
- 执行文本、图片、视频和 Agent/AI Job。
- 负责 lease、heartbeat、Provider 轮询、结果写回、失败处理和退款。
- Worker 自身不提供公网 HTTP 服务；API readiness 通过 Redis heartbeat 判断 Worker 是否存活。

**Postgres**

- 保存账号、组织、账单、项目、剧本、资产、分镜、任务、AI Job、审计和小说元数据。
- migration 采用 append-only 规则，只能新增版本，不能修改或删除已使用的 migration。

**Redis/BullMQ**

- 只保存触发队列、repeat poll job 和 Worker heartbeat。
- Redis 状态不能覆盖 Postgres 的任务终态；Redis 丢失时应通过 Outbox/任务表恢复。

## 5. 后端边界

后端当前仍是一个 API 进程，但逻辑按八个边界组织。详细规则见 BACKEND_BOUNDARIES.md。

| 边界              | 主要职责                                             | 主要代码/数据                                                                        |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Identity & Access | 登录、注册、session、密码、邮箱验证、密码重置        | core/auth、core/email、modules/auth、modules/users；users、auth_identities、sessions |
| Organizations     | 组织、成员、邀请、组织切换和组织角色                 | modules/accountManagement；tenants、tenant_memberships、tenant_invitations           |
| Billing           | 余额、积分流水、套餐、扣费、退款、充值、支付和对账   | modules/billing；billing_accounts、billing_ledger_entries                            |
| Creative Projects | 项目、版本、剧本、分集、资产、分镜、小说和可信人像   | modules/projects、novels、trustedAssets                                              |
| Jobs/Workers      | 异步任务、锁、lease、Outbox、BullMQ、Provider 执行   | core/jobs、modules/generation、modules/aiJobs                                        |
| Media Storage     | 上传、生成媒体、对象 key、媒体代理和访问控制         | infra/objectStorage.ts、modules/media、core/media                                    |
| Admin Console     | 管理端聚合查询、账号/组织/账单/session/审计操作      | modules/admin、apps/admin                                                            |
| Observability/Ops | 健康、readiness、日志、trace、指标、拨测、发布和备份 | core/observability、deploy、scripts/monitoring                                       |

固定调用顺序：

```text
Route -> Service -> Repository/Provider -> Postgres/ObjectStorage/第三方系统
```

新增后端能力时先修改共享 contract 和测试，再修改 Repository/Service，Route 只做输入校验、权限和 HTTP 映射，最后补前端和 E2E。

## 6. 前端架构

### 6.1 创作端

apps/web/src/App.jsx 是工作区状态编排层，负责：

- 恢复 session、加载项目列表、当前项目、账单和健康状态。
- 切换工作区阶段：概览、剧本、资产、分镜、生成队列、成片、设置等。
- 统一注入 workspace、tasks、billing 和操作命令给页面。
- 使用缓存和轮询恢复长任务状态，避免切项目或刷新后出现白屏。

页面与功能目录：

| 功能               | 入口                                                       |
| ------------------ | ---------------------------------------------------------- |
| 项目概览/工作台    | pages/OverviewPage.jsx、ProjectHomePage.jsx                |
| 剧本/分集/资产建议 | pages/ScriptPage.jsx、features/script/                     |
| 资产与人物         | pages/AssetsPage.jsx、features/assets/                     |
| 全局资产库         | pages/AssetLibraryPage.jsx                                 |
| 分镜               | pages/StoryboardPage.jsx、features/storyboard/             |
| 生成队列           | pages/GenerationPage.jsx、features/generation/             |
| 成片预览           | pages/FilmPage.jsx、features/film/                         |
| 一句成片 Agent     | pages/FunctionStackPage.jsx、features/functionStack/       |
| 账号/组织/账单     | pages/SettingsPage.jsx、BillingPage.jsx、features/account/ |

工作区页面使用 lazy loading，兼容旧版本 chunk 失败；不要在页面中直接 fetch 第三方 Provider。

### 6.2 任务刷新和缓存

- useWorkspacePolling.js：有活动任务时约 2.5 秒刷新，空闲约 12 秒，页面隐藏时约 30 秒。
- 任务轮询优先使用压缩响应和 ETag；只有终态变化或工作区版本变化时才拉取完整数据。
- workspaceCacheRef 保存当前会话内最近有效的项目数据，临时请求失败时先保留旧内容，避免白屏。
- projectTaskCache.js 使用 sessionStorage 保存有限任务快照，仅用于刷新后的快速显示，不是业务事实源。
- warmAssetPreviewCache 和 warmVideoPlaybackCache 只做浏览器预热，不改变业务状态。

### 6.3 管理端

apps/admin 是独立 React 应用，不与创作端页面复用。生产静态入口为 /admin/；访问必须同时满足 Caddy 路径保护和 API 管理权限。管理端主要覆盖：账号、组织、成员、账单、用量、session、安全审计、支付/对账和运维视图。

## 7. 数据模型与数据归属

### 7.1 Postgres 业务表

| 数据域    | 关键表/说明                                                                        |
| --------- | ---------------------------------------------------------------------------------- |
| 身份      | users、auth_identities、sessions、password_reset_tokens                            |
| 组织      | tenants、tenant_memberships、tenant_invitations；对外统一叫 organization           |
| 账单      | billing_accounts、billing_ledger_entries、支付和 reconciliation 表                 |
| 项目      | projects、project_versions                                                         |
| 创作      | assets、shots、script_episodes                                                     |
| 任务      | generation_tasks、ai_jobs、outbox_events                                           |
| 小说      | novel_documents、novel_chapters、novel_boundaries、摘要队列、章节摘要、story bible |
| 审计/用量 | audit_log_entries、用量相关表/快照                                                 |
| 可信人像  | 验证 session 和人物资产关联字段，详见 migration 040 和 modules/trustedAssets       |

### 7.2 JSON Store 的剩余职责

apps/api/src/infra/store.ts 对应 AppStore，目前只应承担：

- 本地开发无 Postgres 时的兼容运行。
- 本地媒体索引和历史迁移输入。
- 运行态镜像/cache 和旧 JSON 备份。

在 Postgres 模式下，项目、资产、分镜、任务、AI Job、账号和账单不能新增 JSON 事实。不要用 store.mutate() 绕过对应 Repository。

### 7.3 ObjectStorage

统一接口位于 infra/objectStorage.ts，实现可以是本地文件或 GCS。对象包括：

- 用户上传图片/视频。
- 生成图片、视频、视频尾帧。
- 完整成片工作预览。
- 长剧本文本正文。

小说正文主要保存对象 key、SHA-256、offset 和章节元数据，不能把几十万字全文塞入普通项目行或每次请求全部传回。

## 8. 认证、组织和权限

正式角色固定为：

| 角色                | 范围                                    |
| ------------------- | --------------------------------------- |
| owner               | 全平台最终控制权，最多一个 active owner |
| super_admin         | 全平台高权限运维，不可替代 owner        |
| admin               | 平台内部运营和受限管理范围              |
| member              | C 端个人创作者                          |
| organization_admin  | 自己组织的负责人                        |
| organization_member | 自己组织的成员                          |

认证当前是本地账号 + scrypt 密码哈希 + Postgres session + HttpOnly Cookie。生产禁止 API 启动时自动创建账号；migration 后显式执行账号初始化。新注册通常需要 8 位数字邀请码和邮箱验证码，具体校验以 contracts 为准。

必须遵守：

- 所有项目、资产、分镜、媒体、任务、AI Job 和账单查询都要从 Principal 取得组织/用户范围，不能信任客户端传入的组织 ID。
- 前端隐藏按钮不等于权限控制；服务端必须再次授权。
- admin 页面和 /api/v1/admin/* 都要做管理员权限检查。
- 对外新接口使用 /organizations/*；workspace、tenant 只用于历史兼容入口或内部表名。
- 敏感账号、角色、积分、session 和审计操作必须留审计记录。

完整矩阵见 PERMISSION_MATRIX.md。

## 9. 剧本、分集和分镜业务

### 9.1 网剧分集

- 网剧使用 script_episodes；广告和短片仍使用单一 projects.script。
- content 是已保存正式稿；draft_content 是生成、改写或续写候选稿。
- 模型任务完成只写草稿，不自动进入资产和分镜正式链路。
- 用户点击“保存本集”后才更新正式稿；projects.script 只由已保存剧集按集号聚合，集间使用兼容分隔符。
- 改写只针对当前打开剧集；没有打开时页面使用最近编辑的剧集。
- 续写以最后一集全文 + 更早剧集摘要为上下文，不把全剧全文无上限塞进单次请求。
- 当前只允许删除最后一集；中间集需要从末集依次删除，或使用清空全部。运行任务存在时服务端拒绝危险删除。
- 分镜通过 shots.script_episode_id 关联正式剧集，指定集重生不应覆盖其他集。

### 9.2 剧本质量和分镜规划

当前使用确定性解析，不新增导演模型调用：

1. screenplayParsing.ts 解析自然正文中的场次、动作、对白和声音顺序。
2. directorShotPlanning.ts / shotPlanning.ts 按叙事单元和表演负载规划镜头。
3. 每镜只保留自己的动作、对白和声音；场尾结果只放在末镜，避免相邻镜头重复对白。
4. 有明确时长时按时长约束规划，网剧镜头通常规范为 3 到 15 秒，其他内容为 4 到 15 秒。
5. 不把逗号直接当切镜点；只有明确拍点或用户要求动作细拆时才进一步拆分。
6. independent 镜头独立生成；continue 镜头等待上一镜完成并提交上一镜尾帧，必要时再和当前首帧配对。

这套逻辑解决了“每个镜头重复整段剧情”的问题，但它不是完整语义导演、连续性账本或生成后质量检查。人物站位、服装、光线、物件状态、长对白可表演性仍需人工审阅。

### 9.3 资产建议

资产建议是剧本进入正式生产前的结构化辅助层：

- 从正文提取人物、场景、物品、服装等实体。
- 人物可包含年龄段、年龄、性别、身份、通用外观/服装特征。
- 场景和物品可包含外观、材质、状态、时代、氛围和使用信息。
- 卡片展示给用户确认；确认后写入项目资产或等待生成。
- 纯正则/确定性抽取适合快速取名和格式字段，但不能完全理解隐含关系；高精度描述仍依赖剧本写作规则和人工确认。

相关代码：assetSuggestionExtraction.ts、assetSuggestions.ts、assetSuggestionProvider.ts、AssetSuggestionsPanel.jsx。

## 10. 一句成片 Agent

主实现位于 apps/api/src/modules/agent/，包括 planner.ts、service.ts、runner.ts、repository.ts 和 referenceSelector.ts；前端入口在 FunctionStackPage.jsx。

目标用户流程：

```text
输入一句话
  -> 识别时长/类型/比例/风格/题材等
  -> 只询问缺失或有歧义的关键信息
  -> 展示计划、预计时长、预计成本和阶段
  -> 用户确认一次
  -> 创建 Agent run
  -> 剧本 -> 资产建议/资产 -> 可信人像（需要时） -> 分镜 -> 视频 -> 分集/全片预览
```

Agent run 是可恢复的阶段编排，不应把整个流程放在一次 HTTP 请求中。每个阶段必须可查看状态、失败、重试、暂停或继续；实际 Provider 任务仍由统一 generation_tasks/ai_jobs 执行。

当前边界：

- planner 可以生成结构化制作计划，但不是无限长剧本生产器。
- 长剧本/小说生产仍有外部“剧本大师”方向，不能把几十万字全文直接作为单次视频生成输入。
- 阶段审核、质量门禁、人工接管和复杂长剧本全自动闭环仍需继续产品化。
- modules/quickStart 是历史实验实现；新功能不要复用其 AppStore 聚合写法。

## 11. 异步任务、队列和并发

### 11.1 两种任务表

generation_tasks：图片、视频、剧本生成/改写/续写、资产建议等需要统一展示在生成队列的任务。

ai_jobs：小说摘要等通用长耗时 AI 工作流。新增长工作流优先选择它；需要复用媒体生成 UI、Provider 轮询和现有任务依赖时使用 generation_tasks。

两者都遵循：

```text
Route
  -> 校验、组织授权、幂等 key、预扣积分
  -> Postgres 写 task/job + outbox（一个事务）
  -> Outbox relay 投递 Redis/BullMQ
  -> Worker claim + lease
  -> Provider 执行/轮询
  -> Postgres 写回结果
  -> 失败按规则退款
```

### 11.2 状态与恢复

任务状态：queued | paused | running | completed | failed | cancelled。

- clientRequestId 用于幂等创建，重复提交不应重复扣费或重复生成。
- Worker 使用数据库 lease、heartbeat 和跨进程任务锁，避免 API 与 Worker 重复执行同一任务。
- 任务完成后的队列清理通过 queueHiddenAt 软隐藏；不要物理删除仍被媒体、资产或依赖引用的任务。
- 等待中的任务可以暂停；正在运行的视频只有 Provider 支持远程取消时才调用取消，否则安全标记并跳过重复取消。
- 远端视频轮询默认有并发上限、状态超时和无进度 stall timeout；不能写无限重试循环。
- 失败退款必须使用幂等 ledger reference，不能简单把余额字段加回去。

### 11.3 并发和“卡住”排查

- 当前有效媒体并发：免费账号 1，会员账号 3；文本任务保留独立槽位，不能让视频任务堵住剧本任务。
- 生成任务 runner 默认每约 900ms tick 一次；Provider 视频轮询由单独维护队列控制，默认轮询并发约 6。
- BullMQ 触发 job 默认最多 3 次指数退避；这不等于 Provider 业务任务可以无限重试。
- 前端活动任务约 2.5 秒轮询，不能因为“刷新页面”重复创建任务。
- 看到 generation-task-poll 持续增长不代表视频重复提交；它是 repeat poll 触发 job。要同时检查 generation_tasks 是否有 active 任务、Provider task ID 是否重复和 Worker 日志。

排查顺序：

1. /api/v1/health/readiness：Postgres、Redis、queue、Worker heartbeat。
2. 任务表：状态、updated_at、lease、providerTaskId、error。
3. Outbox：pending/processing/failed、attempts、next attempt。
4. BullMQ：waiting/active/delayed/failed 以及是否存在重复 job ID。
5. Provider 调用日志：requestId、traceId、taskId、provider、耗时和错误码。
6. 前端 Network：是否只是轮询超时，还是 API 真正返回 5xx。

## 12. Provider 和模型

所有 Provider 都由 apps/api/src/runtime/providers.ts 工厂创建，配置只进入 API/Worker 环境。

| 能力              | 当前适配器                                                    | 关键配置组                           | 说明                                      |
| ----------------- | ------------------------------------------------------------- | ------------------------------------ | ----------------------------------------- |
| 文本 DeepSeek V4  | OpenAIChatTextProvider                                        | DASHSCOPE_* 优先，DEEPSEEK_V4_* 回退 | 百炼兼容接口优先；可选 Flash/Pro          |
| 文本 DeepSeek V3  | DeepSeekTextProvider                                          | DEEPSEEK_*                           | 旧兼容入口                                |
| 文本 GLM/Kimi     | RehdasuTextProvider                                           | REHDASU_*                            | 具体可用模型以 API Key 对应上游返回为准   |
| 文本 GPT/序幕-5.6 | TokenAdventTextProvider                                       | TOKENADVENT_* / TEXT_MODEL           | 前端展示名和内部模型名分离                |
| 图片/序幕 image2  | TokenAdventImageProvider                                      | SEQORA_IMAGE2_*                      | 当前图片主实现；浏览器不直接接上游        |
| 视频 Seedance     | DoraRouterSeedanceProvider                                    | DORA_ROUTER_*                        | 当前默认视频路径；以部署 env 为准         |
| 视频旧回退        | StringXSeedanceProvider、VolcArkSeedanceProvider              | STRINGX__、ARK__                     | 只有明确配置/切换时使用                   |
| 可信人像/资产库   | DoraRouterAssetLibraryProvider 或 VolcArkAssetLibraryProvider | DORA_ROUTER_* 或 VOLC_*              | 与视频 token 是否共用取决于 Provider 配置 |
| 邮件              | Resend                                                        | EMAIL_PROVIDER、RESEND_API_KEY 等    | 验证码、验证邮件、邀请、重置密码          |

### 12.1 当前 Stage Provider 快照

最近一次 Stage /api/v1/health 返回：

- 视频：local-mock，不是可用于真实成片演示的远端视频链路。
- 图片：已配置，显示为“生图大师/序幕 image2”路径。
- 文本：已配置，当前显示 deepseek-v4-flash。
- 脚本模型：deepseek-v4-flash 可用、deepseek-v4-pro 可用、glm-5.2 不可用、gpt-5.6-sol 可用。
- 资产库：不可用。

因此同事在 Stage 上做真实全流程演示前，必须先确认视频 Provider 和资产库不是 mock/unavailable。健康接口只能说明“配置存在”，不能证明上游余额、模型权限、并发额度和返回格式一定可用。

### 12.2 Provider 安全与失败处理

- 不把密钥写入 Web 环境变量、Git、镜像层、任务 metadata、日志或 Markdown。
- Provider 超时、403 配额、502 网关、格式异常要保留脱敏错误码和 traceId。
- 不要用换 Provider 的方式掩盖业务数据错误；先确认请求体、模型名、参考图 URL、比例和账户额度。
- 真实付费 Provider 联调必须明确控制任务时长、分辨率、数量和预算。

## 13. 媒体、参考图和成片

### 13.1 图片/人物资产

图片输入可能来自：用户上传、资产库、已生成图片或普通公网参考图。服务端会对本站存储引用按组织/项目校验并读取，再内联提交给上游；引用失效、越权或为空时应在调用上游前失败。

可信人像流程大致是：

```text
上传/生成人物面部基准图
  -> 创建可信验证 session
  -> 上游注册/加白
  -> 轮询并确认 provider asset id
  -> 绑定项目人物资产
  -> 后续视频任务使用可信人物引用
```

“面部基准图片已失效”“加白失败”要先检查存储对象和验证 session，而不是只刷新页面。

### 13.2 视频镜头

视频任务由 API 从项目、分镜和资产重新编译提示词，Worker 执行时再从服务端数据复核一次。镜头参考图不是视频硬前置；有匹配图就作为参考，没有图也可走资产或纯文本。

连续性：

- independent：每镜独立，速度较快但不保证前后帧连续。
- continue：依赖上一镜完成后的尾帧，链内串行。
- “并发优先”：连续链拆为多个连续子链，链之间并发，链内不破坏顺序。
- “连续优先”：保留完整依赖链，速度较慢。

### 13.3 完整成片

apps/api/src/core/film/filmPreviewComposer.ts 负责把完成镜头下载到临时目录并调用 FFmpeg：

- 按镜头顺序合成。
- 统一目标比例、尺寸、帧率和 H.264 编码。
- 保留上游源音轨，统一到 48kHz 双声道。
- 无音轨镜头补静音，有音轨镜头按镜头时长补齐或裁剪。
- 完整预览仍是工作预览，不等于专业后期母版。

合成失败重点检查：镜头任务是否真的为 completed、对象存储是否可读、FFmpeg 是否存在、临时磁盘空间、源文件编码和合成超时。不要让前端重复点击产生多个合成请求；合成任务必须使用幂等 key/当前范围版本判断。

## 14. API 路由速查

所有接口前缀为 /api/v1，完整输入输出以 packages/contracts 和各 routes 文件为准。

| 路由组                      | 作用                                                   |
| --------------------------- | ------------------------------------------------------ |
| /auth/*                     | 登录、退出、当前 session、邮箱验证、密码修改/重置      |
| /organizations/*            | 组织、成员、邀请、切换；旧 workspace/tenant 路由仅兼容 |
| /projects/*                 | 项目、版本、剧本、分集、资产、分镜、项目媒体、成片     |
| /projects/:id/novels/*      | 小说文档、章节、摘要、改编脚本等长文本实验能力         |
| /projects/:id/quick-start/* | 历史 Quick Start 兼容/实验入口，不作为新实现模板       |
| /agent/*                    | 一句成片 plan/run、阶段查询和执行控制                  |
| /trusted-assets/*           | 可信人像、资产库验证配置和验证 session                 |
| /library/*                  | 全局资产库、版本、去重、导入/恢复/删除                 |
| /media/*                    | 媒体读取、代理和访问控制                               |
| /generation/tasks/*         | 生成任务创建、查询、暂停、恢复、删除/隐藏              |
| /ai-jobs/*                  | 通用 AI Job 查询和控制                                 |
| /image2/*                   | 序幕 image2 图片批次                                   |
| /billing/*                  | 余额、套餐、支付 checkout、webhook                     |
| /admin/*                    | 后台聚合、用户、组织、账单、session、审计和用量        |
| /health、/health/readiness  | 运行状态和可用性门禁                                   |
| /observability/*            | 管理员可见指标、Provider/队列/任务统计                 |

## 15. 本地开发

要求 Node.js >=22.12、pnpm >=11，完整生成和合成需要 FFmpeg；推荐 Docker Desktop。

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

常用命令：

```powershell
pnpm build:shared
pnpm build
pnpm lint
pnpm format:check
pnpm test
pnpm check
pnpm dev:db
pnpm dev:test-db
pnpm --filter @seqora/api db:migrate
pnpm test:e2e
```

本地默认地址：

| 服务          | 地址                         |
| ------------- | ---------------------------- |
| 创作端        | http://localhost:5173        |
| 管理端        | http://localhost:5174        |
| API           | http://localhost:8787/api/v1 |
| 本地 Postgres | Compose 暴露的 5432          |
| 测试 Postgres | Compose 暴露的 5433          |
| 本地 Redis    | Compose 暴露的 6379          |
| 测试 Redis    | Compose 暴露的 6380          |

Docker 不可用时，开发脚本可退回 JSON Store + inline queue；这适合 UI 联调，不等价于生产的 Postgres + BullMQ 能力。

## 16. 测试体系与当前结果

### 16.1 测试分层

- Shared contracts：Zod schema、角色、权限、任务和响应契约。
- Prompting：质量规则、图片/视频提示词和内容提取。
- API unit：纯业务函数、Repository 逻辑、任务 runner、Provider 测试替身。
- API integration：Postgres migration、认证、组织、账单、项目、任务、BullMQ。
- E2E：Playwright 创作端和管理员端真实页面流程。
- Security：HTTP 安全、生产配置、权限边界、依赖审计。
- Performance/chaos：k6、Redis/Postgres 故障实验，目前是工程化准备能力。

### 16.2 最近一次候选验证

已通过：

- pnpm build
- pnpm format:check
- pnpm lint
- contracts：56 tests
- prompting：17 tests
- admin：19 tests
- web：242 tests
- API unit：381 tests

预发隔离 integration 的业务断言已通过 65 项，但进程最后因 Postgres fixture 清理的 57P01 事件退出 1。接手后第一优先级之一是修复 apps/api/src/testing/postgresAuth.ts 的连接关闭/事件处理，再重新跑完整门禁。

提交前最低要求：

```powershell
git diff --check
pnpm format:check
pnpm lint
pnpm test
pnpm build
```

涉及账号、账单、migration、队列或权限时，必须追加 API integration、contract 和 security 测试。

## 17. 部署、预发和生产

### 17.1 环境原则

| 环境          | 目的                 | 数据和 Provider                                               |
| ------------- | -------------------- | ------------------------------------------------------------- |
| Local         | 开发和 UI 联调       | 可用本地 JSON/inline；不产生真实费用                          |
| CI            | 自动门禁             | 独立 Postgres/Redis、Provider test doubles                    |
| Stage/Preprod | 接近生产的验收和演示 | 独立 Compose、独立数据卷，真实 Provider 需显式配置            |
| Production    | xumutv.com 正式服务  | 不允许演示 bootstrap；发布需 migration、备份、readiness、拨测 |

### 17.2 Stage 当前拓扑

Stage 使用：

- /opt/seqora-preprod/compose.preprod.yml 覆盖配置。
- /opt/seqora-preprod/deploy/demo.env，权限应限制为 600，不要打印。
- seqora-preprod-api、seqora-preprod-worker、seqora-preprod-web 候选镜像。
- 原有 Postgres/Redis 持久卷保持不重建。
- 隔离测试 Compose 已清理，不要把测试容器计入 Stage 健康状态。

预发切换原则：先备份 -> 迁移 -> API/Worker -> readiness -> Web -> 页面验收。不要通过 down -v 清理主 Stage 数据服务。

### 17.3 生产发布原则

生产单机 Compose 常规服务为：Postgres、Redis、API、Worker、Web/Caddy。生产发布前：

1. 确认 commit、镜像 digest 和变更范围。
2. 通过 CI 门禁和 migration 检查。
3. 备份 Postgres、JSON 兼容数据和 GCS 对象清单。
4. 先执行 migration，再切 API/Worker，再切 Web。
5. 检查 /api/v1/health/readiness、登录、项目加载、任务查询和媒体 Range 请求。
6. 失败立即按 release.env/镜像记录回滚，不在带病服务上继续叠加变更。

生产首选 CI/CD；人工脚本包括：

- deploy/update-release.sh：按 api/web/all 更新镜像，带发布锁、旧 manifest、migration 和失败回滚。
- deploy/update-source.sh：源码包方式更新，生产不要直接在无 .git 目录执行 git pull。
- deploy/backup-demo.sh：Postgres、JSON、GCS 元数据备份。
- deploy/restore-demo.sh：恢复数据库和运行数据，恢复前必须确认代码版本。

不要在本次交接阶段直接把 Stage 候选发布到生产。生产发布必须在本文的“当前状态”重新核对后再单独审批。

## 18. 运维检查和常见故障

### 18.1 快速健康检查

```bash
curl -fsS https://xumutv.com/api/v1/health
curl -fsS https://xumutv.com/api/v1/health/readiness
docker compose --env-file deploy/demo.env --env-file deploy/release.env -f compose.demo.yml ps
docker logs --since 10m <container>
```

不要把真实环境文件、登录 Cookie、完整 Provider 响应或用户内容贴到群聊/工单。

### 18.2 项目打开白屏/慢

优先确认：

- /projects 是否快速返回。
- 当前项目详情和任务轮询是否并发；一个任务轮询失败不应阻塞工作区详情。
- 是否是前端 lazy chunk 旧缓存；chunk recovery 和强刷新只能作为最后一步。
- workspace cache 是否有旧快照；有快照时应保留页面，不要清空。
- API 是否 5xx、数据库连接池是否耗尽、Postgres 是否锁等待。

### 18.3 长时间排队

先分清四个时间：前端轮询、自己的 DB/BullMQ 队列、Worker claim、上游 Provider 排队/生成。只看页面“排队”文案不能判断根因。读取任务 createdAt/updatedAt、queue wait metric、Provider task ID 和 readiness。

### 18.4 上游反复请求/白屏

确认：

- API 是否重复创建相同 clientRequestId。
- Worker 是否有重复 lease 或多个实例使用同一队列。
- BullMQ repeat job 是否只有一个 generation-task-poll。
- 同一任务是否已经保存 providerTaskId。
- 取消/失败后的维护队列是否被重复加入。

### 18.5 合成失败

确认所有源视频均为 completed 且对象可读；检查 FFmpeg、磁盘、权限、临时目录、编解码、音轨和范围版本。合成范围应优先按“当集全集”，而不是让用户理解“已完成片段/当前范围”。

### 18.6 可信人像/资产库失败

检查顺序：人物基准图对象 -> validation session 状态 -> Provider asset ID -> 资产绑定关系 -> 上游权限/配额/接口返回。不要只重复点击刷新，避免创建重复注册任务。

## 19. 安全红线

- 交接文档、Git、镜像和前端构建产物不能出现真实密钥、密码、Cookie、验证码或用户媒体。
- 此前曾在聊天中传递过的 Provider Key 和服务器密码都应视为已暴露，接手时安排轮换；新密码通过密码管理器或其他受控渠道交接。
- 生产 BOOTSTRAP_ACCOUNTS_ON_START=false，不能通过启动自动创建账号。
- 不用前端传入的 estimatedCredits 作为最终计费依据；正式商用前需要服务端定价表/报价确认。
- 不直接修改 Postgres 余额、角色或任务状态；使用 Service、管理 API 或有审计的运维脚本。
- 不在生产执行 docker compose down -v、git reset --hard、git clean 或覆盖式复制运行数据。
- 不把公网开放、SSH 密码登录、Caddy 管理端口和数据库端口当作默认安全方案。

## 20. 接手后的优先级

### P0：先让测试和演示可控

1. 修复 postgresAuth.ts 的 57P01 测试清理问题，恢复完整 CI 门禁的可信状态。
2. 为 Stage 配置专用 synthetic 账号、只读拨测和写路径拨测，校验密码不与业务 owner/member 账号混用。
3. 在阿里云安全组限制性开放 Stage 80/443，SSH 只允许办公 IP/堡垒机，确认 HTTPS 域名和证书策略。
4. 配置真实 Stage 视频 Provider、资产库和测试额度；保留 local-mock 作为低成本单测/演示降级，但页面必须清楚标识。
5. 用一条短单集走完整链路：剧本 -> 资产建议 -> 人物确认/可信人像 -> 2~3 个分镜 -> 视频 -> 当集全集合成。

### P1：再处理上线前工程化

1. 完善 Provider 成本、延迟、配额、错误码和按用户/组织的观测。
2. 把任务、媒体和合成的状态恢复/回滚做成定期演练。
3. 补齐正式音频、字幕、配音、混音、质量门禁和交付编码。
4. 收紧服务端定价、积分预扣和真实上游配额管理。
5. 明确用户协议、隐私、版权授权、数据导出和删除流程。

### P2：规模化

1. Worker 按任务类型横向扩容，独立视频轮询和 FFmpeg 合成资源。
2. 托管 Postgres/Redis、CDN、对象生命周期、异地备份和灾备演练。
3. Agent 增加阶段审核、人工接管、质量门禁和可恢复分集交付。
4. 长剧本接入 Story Bible、分集批处理、单集重生和断点续传，而不是把几十万字一次性塞进单次模型请求。

## 21. 新功能修改模板

开始前：

```powershell
git status --short --branch
git log -5 --oneline
```

实现顺序：

1. 明确业务边界和数据 owner。
2. 更新 packages/contracts schema/枚举/测试。
3. 更新 Repository 和 Service。
4. 更新 Route、API client 和前端状态。
5. 对异步能力创建 task/job，绝不在 HTTP 内等待长任务。
6. 补空状态、失败、重试、权限、组织隔离和移动端表现。
7. 更新对应文档和当前状态。
8. 运行测试、构建和部署验收。

常见需求定位：

| 需求                | 优先阅读                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- |
| 剧本/资产建议/分集  | modules/projects/service.ts、scriptTaskHandler.ts、screenplayParsing.ts、ScriptPage.jsx |
| 分镜拆分/承接       | directorShotPlanning.ts、shotPlanning.ts、StoryboardPage.jsx                            |
| 图片/人物/可信人像  | core/generation、modules/trustedAssets、features/assets                                 |
| 视频/并发/重试/退款 | taskDispatcher.ts、taskRunnerComponents.ts、generation、videoBatchPlanner.js            |
| 成片合成            | core/film/filmPreviewComposer.ts、FilmPage.jsx                                          |
| 一句成片            | modules/agent、packages/contracts/src/agent.ts、FunctionStackPage.jsx                   |
| 登录/组织/角色      | core/auth、modules/accountManagement、permissions.ts                                    |
| 后台/用量           | modules/admin、apps/admin、USAGE_METRICS.md                                             |
| 发布/备份/回滚      | deploy/、OPERATIONS_RUNBOOK.md、CICD.md                                                 |

## 22. 交接清单

### 原负责人需要交付

- [ ] 通过受控渠道交付服务器登录方式、云控制台权限、域名/DNS 权限和 GitHub 权限。
- [ ] 通过 Secret 管理器交付环境变量，不在聊天或文档粘贴明文。
- [ ] 说明每个 Provider 的账户主体、计费方式、余额、并发和模型白名单。
- [ ] 建立并验证 Stage synthetic 账号、专用组织和告警 webhook。
- [ ] 说明当前生产是否有运行中任务、未结算积分、待处理账单和重要项目。
- [ ] 轮换历史上已在聊天中暴露的服务器密码和 API Key。

### 接手同事需要完成

- [ ] 本地 pnpm install --frozen-lockfile、pnpm check。
- [ ] 登录本地并跑通项目 -> 剧本 -> 资产 -> 分镜 -> 队列页面。
- [ ] 读取一次任务完整 metadata，理解幂等、lease、依赖、退款和软隐藏。
- [ ] 在 Stage 做 readiness、登录、项目切换、任务轮询、媒体 Range 和移动端验收。
- [ ] 修复并验证 Postgres test fixture cleanup。
- [ ] 建立发布前备份、发布后拨测和回滚演练记录。
- [ ] 在生产变更前单独更新本文第 1.3 节的快照，不把历史状态当当前状态。

## 23. 相关文档

- CURRENT_STATE.md
- HANDOFF_GUIDE.md
- ARCHITECTURE.md
- BACKEND_BOUNDARIES.md
- AUTHORIZATION.md
- ASSET_GENERATION.md
- DIRECTOR_PIPELINE_AUDIT.md
- BACKEND_TESTING.md
- RELIABILITY_GATES.md
- OBSERVABILITY.md
- OPERATIONS_RUNBOOK.md
- DEPLOYMENT.md
- CICD.md
- BACKUP_RESTORE.md
- ENVIRONMENT_STRATEGY.md
- LONG_SCRIPT_PRODUCTION_PROTOCOL.md

## 24. 文档维护规则

- 代码、配置、部署或 Provider 变化后，同一提交同步更新本文和对应专项文档。
- 当前状态必须带日期；历史事实移入 DEVELOPMENT_MEMORY.md，不能覆盖当前事实。
- 任何新路由、状态枚举、角色、migration、环境变量或外部服务都要登记。
- 不把“Provider 配置存在”写成“真实调用已成功”，不把“页面有按钮”写成“完整闭环已交付”。
- 交接文档只写变量名、目录、命令和验证方式，不写 Secret 值。
