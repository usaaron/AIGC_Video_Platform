# API

Fastify + TypeScript 后端，默认监听 `http://127.0.0.1:8787`，所有业务接口使用 `/api/v1` 前缀。

## 本地启动

推荐从仓库根目录启动完整开发环境：

```bash
pnpm dev
```

单独启动 API 时先准备 Postgres 和 Redis，并确保共享包已构建：

```bash
pnpm dev:db
pnpm build:shared
pnpm --filter @seqora/api dev
```

开发环境未显式设置 `DATABASE_URL` 时，`loadConfig()` 默认使用 `postgres://seqora:seqora_dev_password@127.0.0.1:5432/seqora_dev`；未显式设置 `REDIS_URL` 时，任务队列默认使用 `redis://127.0.0.1:6379`。生产环境必须在部署 Secret 或 `deploy/demo.env` 中显式设置 `DATABASE_URL`，并提供可用 Redis/BullMQ 队列。

## 数据边界

- Postgres：账号、身份、session、组织 membership、账单账户、账单流水、密码重置 token、审计日志、项目、资产、分镜、图片/视频生成任务、通用 AI Job，以及小说文档/章节索引、边界检查、摘要队列、章节摘要和故事圣经。当前数据库表仍保留 `tenant*` 兼容命名，对外产品概念统一为组织。
- Outbox：`outbox_events` 与任务记录、扣费写入同一个 Postgres 事务；relay 投递 BullMQ，成功后标记 `sent`，失败按 `next_attempt_at` 退避重试，避免 DB 成功但 Redis 入队失败。
- Redis/BullMQ：任务触发队列；生产路径由 Outbox relay 入队，`src/worker.ts` 作为独立消费者执行。视频/图片生成使用 `generation_tasks`，小说/剧本/资产建议等长耗时文本或工作流使用 `ai_jobs`。
- JSON `DATA_FILE`：本地媒体索引、Demo 兼容状态、历史小说数据和迁移备份。配置 DB + ObjectStorage 后，小说域不再把 JSON Store 作为写入源。
- ObjectStorage：上传媒体、生成图片、生成视频、尾帧、完整成片预览和小说正文；Postgres 只保存正文的 storage key、SHA-256、offset 与章节元数据。

从旧 JSON Store 迁移到 Postgres/ObjectStorage：

```bash
pnpm --filter @seqora/api db:import-json
```

Postgres 模式下，Repository 写入必须先落 Postgres，大文件由 ObjectStorage 承载，`AppStore`
只做本地兼容/Demo Store 和显式 runtime 镜像。Runtime cache 只能由 DB refresh 或 DB 写后的
Repository mirror 替换；普通 `store.mutate()` 不会把项目、任务或 AI Job 事实反写回 Postgres。

脚本会先创建带时间戳的 JSON 备份，再导入小说元数据、队列和摘要，并把小说正文写入对象存储。

`NODE_ENV=development` 和 `test` 下 API 启动会自动执行未执行 migration。`NODE_ENV=production` 下 API 启动只检查 migration 是否最新；部署前必须显式执行：

```bash
pnpm --filter @seqora/api db:migrate
```

首次初始化生产账号时，必须在 `db:migrate` 成功后显式执行：

```bash
pnpm --filter @seqora/api accounts:init
```

生产环境禁止 `BOOTSTRAP_ACCOUNTS_ON_START=true` 和 `BOOTSTRAP_DEMO_WORKSPACE=true`，API/Worker 启动不会自动创建账号或演示项目。

Migration 文件位于 `src/infra/migrations`。进入主分支后只能新增下一个版本，不能修改或删除旧 migration；每个 migration 文件由 `AccountDatabase` 单独包裹事务，并写入 `schema_migrations`。

## 模块边界

模块通过 `src/app.ts` 装配依赖。新增业务时创建独立 `modules/<name>`，保持：

```text
Route -> Service -> Repository / Provider -> Database / Store / External API
```

- `modules/auth`：登录、退出、会话解析、自助改密、忘记密码和密码重置。
- `modules/accountManagement`：邀请码注册、受控邀请、组织、成员、角色、membership、组织 session。
- `modules/admin`：统一 Admin Console API、用户/组织/membership/账单/session/审计查询、账号启停、后台充值/调账。
- `modules/billing`：Postgres billing ledger，幂等扣费、退款、grant 和 adjustment。
- `modules/generation`：任务创建、查询、暂停、恢复、删除、输出读取。
- `modules/aiJobs`：通用 AI Job 查询和仓储；`ai_jobs` 保存 `kind`、`input`、`output`、`provider`、`cost_credits`、状态、lease 和幂等 `client_request_id`。
- `modules/novels`：小说导入、章节索引、边界检查、摘要队列、章节摘要和故事圣经；Postgres/ObjectStorage 是主路径，JSON Store 只做本地兼容回退。摘要队列批处理已通过 `ai_jobs.kind = novel.summaryQueueBatch` 接入 Worker。
- `core/jobs`：事务 Outbox、BullMQ 任务分发、任务依赖、并发、Provider 轮询、AI Job handler、失败退款和写回。
- `core/film`：FFmpeg 完整成片合成。
- `runtime/database`、`runtime/storage`、`runtime/providers`、`runtime/services`、`runtime/queues`、`runtime/routes`：应用启动装配层。`app.ts` 只保留 Fastify 生命周期、插件注册和 runtime 工厂调用；不要把新 repository/service/provider 直接塞回 `app.ts`。

所有外部输入优先在 `@seqora/contracts` 定义 Zod Schema；路由只做协议、权限和 HTTP 映射，业务规则放 Service，数据库并发和事务放 Repository。

## 关键 API

- `POST /auth/login`、`POST /auth/logout`、`GET /auth/me`
- `POST /auth/register`、`POST /auth/invitations/accept`
- `PUT /auth/password`、`POST /auth/password/reset-request`、`POST /auth/password/reset`
- `GET /auth/sessions`、`DELETE /auth/sessions/:sessionId`
- `POST /organizations`、`POST /organizations/:organizationId/switch`
- `PATCH /organizations/:organizationId`、`DELETE /organizations/:organizationId`
- `POST /organizations/:organizationId/admin-transfer`、`POST /organizations/:organizationId/leave`
- 旧 `organization-admin-transfer` 路径仅保留兼容并返回 `Deprecation: true`，不再新增业务调用
- `GET /organizations/:organizationId/members`、`POST /organizations/:organizationId/users`
- `PATCH /organizations/:organizationId/members/:userId/roles`、`DELETE /organizations/:organizationId/members/:userId`
- `/workspaces/*`、`/tenants/:tenantId/*` 保留为兼容入口并返回 `Deprecation: true`，新代码必须使用 `/organizations/*`
- `GET /billing/summary`、`GET /billing/payment/configuration`、`POST /billing/checkout/subscription`、`POST /billing/checkout/credits`、`POST /billing/webhooks/stripe`；`PUT /billing/plan` 仅保留为禁止前端自助改套餐的兼容拦截，`POST /billing/webhooks/:provider` 仅保留为内部兼容入口
- `GET /admin/console`、`GET /admin/users`、`GET /admin/organizations`、`GET /admin/memberships`
- `/admin/tenants/*` 保留为兼容入口并返回 `Deprecation: true`，新代码必须使用 `/admin/organizations/*`
- `GET /admin/billing/accounts`、`GET /admin/billing/ledger`、`GET /admin/billing/reconciliation`
- `GET /admin/sessions`、`DELETE /admin/sessions/:sessionId`
- `GET /admin/audit-logs`
- `GET /projects/:projectId/ai-jobs`、`GET /ai-jobs/:jobId`

## 测试

```bash
pnpm --filter @seqora/api test
pnpm --filter @seqora/api exec vitest run src/infra/postgres.test.ts src/modules/auth/routes.test.ts src/modules/accountManagement/routes.test.ts src/modules/billing/creditLedger.test.ts src/config.test.ts src/core/jobs/bullMqQueue.test.ts
```

第二条命令等价于 CI database job 的核心测试范围：起 Postgres 和 Redis、跑 migration、验证 auth/account/billing 集成行为以及 BullMQ 任务分发。
