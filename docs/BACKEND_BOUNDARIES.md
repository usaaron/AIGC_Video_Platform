# 后端边界

本文是后端业务边界的正式来源。当前仍是一个 Fastify API 进程和一个独立 Worker 进程，但代码、契约、数据和测试必须按下面 8 个边界组织。

## 总规则

- 新功能先归入一个主边界，再决定需要调用哪些跨边界接口。
- Route 只处理协议、校验和权限；业务规则放在本边界 Service。
- Repository 只读写本边界拥有的数据表；跨边界查询优先通过 Service 或明确的 Repository 接口。
- Admin Console 是管理视图和操作入口，不拥有其他边界的核心业务规则。
- Billing 是积分、套餐、支付、退款和调账的唯一写入边界。
- Organizations 是所有用户数据隔离的边界；对外叫 `organization`，DB 当前仍保留 `tenant*` 物理命名。
- Jobs/Workers 只拥有异步任务生命周期和执行锁；项目、资产、账单、媒体等业务事实仍由各自边界拥有。
- Observability/Ops 只能采集、展示、告警和巡检，不直接改变业务状态。

## 边界地图

| 边界              | 拥有内容                                                  | 当前主要代码                                                                                   | 主要数据                                                        |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Identity & Access | 账号、登录、session、密码、邮箱验证、权限主体             | `core/auth`、`core/email`、`modules/auth`、`modules/users`                                     | `users`、`auth_identities`、`sessions`、`password_reset_tokens` |
| Organizations     | 组织、membership、邀请、组织切换、组织成员权限            | `modules/accountManagement`                                                                    | `tenants`、`tenant_memberships`、`tenant_invitations`           |
| Billing           | 套餐、余额、ledger、扣费、退款、充值、支付和对账          | `modules/billing`                                                                              | `billing_accounts`、`billing_ledger_entries`、payment/recon 表  |
| Creative Projects | 项目、版本、剧本、资产、分镜、小说元数据和创作流          | `modules/projects`、`modules/novels`、`modules/quickStart`、`modules/trustedAssets`            | `projects`、`project_versions`、`assets`、`shots`、novel 相关表 |
| Jobs/Workers      | 异步任务、任务锁、Outbox、Redis/BullMQ、Provider 执行     | `core/jobs`、`modules/generation`、`modules/aiJobs`、`runtime/queues.ts`、`worker.ts`          | `generation_tasks`、`ai_jobs`、`outbox_events`                  |
| Media Storage     | 上传、生成媒体对象、对象存储 key、代理和本地/GCS 适配     | `infra/objectStorage.ts`、`modules/media`、`core/media`、`runtime/storage.ts`                  | `media_objects`、本地 uploads、GCS 对象                         |
| Admin Console     | 后台聚合查询、账号启停、组织/账单/session/审计操作入口    | `modules/admin`、`apps/admin`、`packages/contracts/src/admin.ts`                               | 读取多边界数据，管理操作必须委托对应边界                        |
| Observability/Ops | 健康检查、日志、traceId、指标、拨测、CI/CD 门禁和运维文档 | `core/observability`、`runtime/routes.ts`、`.github/workflows`、`scripts/monitoring`、`deploy` | metrics 内存快照、`audit_log_entries`、部署和巡检配置           |

## Identity & Access

职责：

- 认证当前用户是谁。
- 维护本地账号身份、密码哈希、邮箱验证、密码重置、session 生命周期和设备信息。
- 生成 `Principal`，提供 `userId`、当前 `tenantId`、`organizationId` 兼容字段、角色和权限。
- 拒绝未登录、session 失效、强制改密、未验证邮箱等账号安全状态。

不负责：

- 不创建业务组织结构，组织 membership 属于 Organizations。
- 不修改积分、套餐和账单。
- 不决定项目、资产、分镜是否可访问；只提供主体，具体数据边界由目标边界校验。

公开入口：

- `/api/v1/auth/*`

## Organizations

职责：

- 维护组织、membership、角色、邀请、组织切换和组织成员 session 管理。
- 对外统一使用 `/organizations/*` 和 `organization*` 字段。
- 旧 `/workspaces/*`、`/tenants/*` 只作为兼容入口，必须返回 `Deprecation: true` 和 successor `Link`。
- 执行 `owner`、`super_admin`、`admin`、`member`、`organization_admin`、`organization_member` 的组织范围规则。

不负责：

- 不做账号密码验证，交给 Identity & Access。
- 不直接改账单余额，交给 Billing。
- 不保存项目内容，交给 Creative Projects。

公开入口：

- `/api/v1/organizations/*`
- deprecated: `/api/v1/workspaces/*`、`/api/v1/tenants/*`

## Billing

职责：

- 维护套餐、余额、账单流水、幂等扣费 reference、退款、管理员充值和调账。
- 对支付 Provider webhook 做幂等处理、ledger 写入和对账告警。
- 提供 `reserveCredits`、`refundCredits`、`grantCredits`、`adjustCredits`、`billingSummary` 等能力。
- 所有余额变更必须在数据库事务里锁定 `billing_accounts` 并插入 ledger。

不负责：

- 不决定任务是否应该执行；只回答额度和流水。
- 不接受前端直接修改套餐权益。
- 不把账单流水写回 JSON 作为业务来源。

公开入口：

- `/api/v1/billing/*`
- Admin Console 中的账单查询和调账必须委托 Billing。

## Creative Projects

职责：

- 维护项目、项目版本、剧本、资产、分镜、小说文档、章节、摘要和故事圣经。
- 所有项目域查询必须带 `tenantId`/`organizationId` 和 `userId` 范围。
- 负责把用户创作意图整理成可提交给 Jobs/Workers 的任务请求。
- 负责资产和分镜的业务状态，不负责异步 Provider 执行锁。
- `modules/quickStart` 仍使用 AppStore 聚合写入，是当前 UI 未开放的遗留实验；新模块不能复用该写法，应走 Postgres Repository、Outbox 和后台任务。

不负责：

- 不直接预扣或退还积分，调用 Billing。
- 不直接轮询第三方生成 Provider，交给 Jobs/Workers。
- 不拥有媒体二进制对象，只保存 Media Storage 返回的 key 或 URL。

公开入口：

- `/api/v1/projects/*`
- `/api/v1/projects/:projectId/novels/*`
- `/api/v1/trusted-assets/*`

## Jobs/Workers

职责：

- 维护 `generation_tasks` 和 `ai_jobs` 的生命周期、幂等 client request、依赖、lease、heartbeat、重试、失败和完成。
- 通过事务 Outbox 把任务触发投递到 Redis/BullMQ。
- Worker 从 DB claim 任务，调用 Provider，写回结果，并按失败策略请求 Billing 退款。
- 长耗时 AI 工作统一走 `Route -> create job/task -> reserve credits -> outbox -> Worker -> write back`。

不负责：

- 不绕过 Creative Projects 直接信任前端传入的项目、资产或分镜数据。
- 不直接修改组织角色或账号状态。
- 不自己维护余额，必须通过 Billing。

公开入口：

- `/api/v1/generation/tasks/*`
- `/api/v1/ai-jobs/*`

## Media Storage

职责：

- 统一本地文件和 GCS 的对象存储接口。
- 管理上传、生成图片、视频、尾帧、完整成片预览和小说正文等对象。
- 维护媒体对象索引、内容类型、哈希、大小和访问代理。

不负责：

- 不判断用户是否能看某个项目，调用方必须先完成项目或组织边界校验。
- 不保存资产、分镜或任务的业务状态。
- 不把对象公开为长期匿名 URL，除非对应业务明确授权。

公开入口：

- `/api/v1/projects/:projectId/media`
- `/api/v1/media/*`

## Admin Console

职责：

- 提供独立后台 `apps/admin` 消费的统一聚合接口和分项管理接口。
- 聚合用户、组织、membership、账单、session、审计、支付对账和风险视图。
- 执行后台操作前声明明确权限，并委托 Identity & Access、Organizations、Billing 等边界完成业务写入。

不负责：

- 不复制其他边界的核心业务规则。
- 不让创作端重新承载后台功能。
- 不绕过组织范围或平台角色限制。

公开入口：

- `/api/v1/admin/*`

## Observability/Ops

职责：

- 健康检查、readiness、结构化日志、traceId、Prometheus 指标、错误计数和请求耗时。
- CI 门禁、覆盖率基线、部署后拨测、每分钟巡检和告警 webhook。
- 备份、恢复、迁移、生产演练和运维文档。
- 展示或查询审计日志，但审计事件由各业务边界在敏感操作时写入。

不负责：

- 不改变账号、组织、账单或项目状态。
- 不作为业务兜底重试器；业务重试属于 Jobs/Workers 或对应边界。

公开入口：

- `/api/v1/health`
- `/api/v1/health/readiness`
- `/api/v1/observability/*`

## 新功能归属判断

| 新需求                         | 默认归属          |
| ------------------------------ | ----------------- |
| 登录、注册、改密、邮箱验证     | Identity & Access |
| 创建组织、邀请成员、修改角色   | Organizations     |
| 充值、扣费、退款、支付 webhook | Billing           |
| 项目字段、资产字段、分镜字段   | Creative Projects |
| 生成任务、小说摘要队列、重试   | Jobs/Workers      |
| 上传、下载、GCS、本地文件      | Media Storage     |
| 后台列表、后台操作入口         | Admin Console     |
| 日志、指标、拨测、部署门禁     | Observability/Ops |

如果一个需求跨多个边界，提交时拆成多个 commit 或 PR，先改源边界，再改调用边界，最后改 UI。
