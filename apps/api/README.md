# API

Fastify + TypeScript 后端，默认监听 `http://127.0.0.1:8787`，所有业务接口使用 `/api/v1` 前缀。

## 本地启动

推荐从仓库根目录启动完整开发环境：

```bash
pnpm dev
```

单独启动 API 时先准备 Postgres，并确保共享包已构建：

```bash
pnpm dev:db
pnpm build:shared
pnpm --filter @seqora/api dev
```

开发环境未显式设置 `DATABASE_URL` 时，`loadConfig()` 默认使用 `postgres://seqora:seqora_dev_password@127.0.0.1:5432/seqora_dev`。生产环境必须在部署 Secret 或 `deploy/demo.env` 中显式设置 `DATABASE_URL`。

## 数据边界

- Postgres：账号、身份、session、租户、membership、账单账户、账单流水、密码重置 token、审计日志。
- JSON `DATA_FILE`：项目、资产、分镜、生成任务、本地 Demo 状态和兼容备份。
- ObjectStorage：上传媒体、生成图片、生成视频、尾帧和完整成片预览。

`NODE_ENV=development` 和 `test` 下 API 启动会自动执行未执行 migration。`NODE_ENV=production` 下 API 启动只检查 migration 是否最新；部署前必须显式执行：

```bash
pnpm --filter @seqora/api db:migrate
```

Migration 文件位于 `src/infra/migrations`。进入主分支后只能新增下一个版本，不能修改或删除旧 migration；每个 migration 文件由 `AccountDatabase` 单独包裹事务，并写入 `schema_migrations`。

## 模块边界

模块通过 `src/app.ts` 装配依赖。新增业务时创建独立 `modules/<name>`，保持：

```text
Route -> Service -> Repository / Provider -> Database / Store / External API
```

- `modules/auth`：登录、退出、会话解析、自助改密、忘记密码和密码重置。
- `modules/accountManagement`：邀请码注册、受控邀请、workspace、成员、角色、membership、tenant session。
- `modules/admin`：统一 Admin Console API、用户/租户/membership/账单/session/审计查询、账号启停、后台充值/调账。
- `modules/billing`：Postgres billing ledger，幂等扣费、退款、grant 和 adjustment。
- `modules/generation`：任务创建、查询、暂停、恢复、删除、输出读取。
- `core/jobs`：任务依赖、并发、Provider 轮询、失败退款和写回。
- `core/film`：FFmpeg 完整成片合成。

所有外部输入优先在 `@seqora/contracts` 定义 Zod Schema；路由只做协议、权限和 HTTP 映射，业务规则放 Service，数据库并发和事务放 Repository。

## 关键 API

- `POST /auth/login`、`POST /auth/logout`、`GET /auth/me`
- `POST /auth/register`、`POST /auth/invitations/accept`
- `PUT /auth/password`、`POST /auth/password/reset-request`、`POST /auth/password/reset`
- `GET /auth/sessions`、`DELETE /auth/sessions/:sessionId`
- `POST /workspaces`、`POST /workspaces/:tenantId/switch`
- `PATCH /workspaces/:tenantId`、`DELETE /workspaces/:tenantId`
- `POST /workspaces/:tenantId/owner-transfer`、`POST /workspaces/:tenantId/leave`
- `GET /tenants/:tenantId/members`、`POST /tenants/:tenantId/users`
- `PATCH /tenants/:tenantId/members/:userId/roles`、`DELETE /tenants/:tenantId/members/:userId`
- `GET /billing/summary`、`PUT /billing/plan`
- `GET /admin/console`、`GET /admin/users`、`GET /admin/tenants`、`GET /admin/memberships`
- `GET /admin/billing/accounts`、`GET /admin/billing/ledger`
- `GET /admin/sessions`、`DELETE /admin/sessions/:sessionId`
- `GET /admin/audit-logs`

## 测试

```bash
pnpm --filter @seqora/api test
pnpm --filter @seqora/api exec vitest run src/infra/postgres.test.ts src/modules/auth/routes.test.ts src/modules/accountManagement/routes.test.ts src/modules/billing/creditLedger.test.ts
```

第二条命令等价于 CI database job 的核心测试范围：起 Postgres、跑 migration、验证 auth/account/billing 集成行为。
