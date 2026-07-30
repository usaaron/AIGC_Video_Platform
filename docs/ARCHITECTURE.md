# 总体架构

## 目标

架构面向当前三人团队，优先保证边界清楚和修改成本低。前后端独立部署，共享契约但不共享业务实现；管理员能力、认证、计费和异步任务都有替换接口，不提前引入微服务复杂度。

```mermaid
flowchart LR
  Web["apps/web 创作端"] --> API["apps/api /api/v1"]
  Admin["apps/admin 管理端"] --> API
  Web -. schema .-> Contracts["packages/contracts"]
  Admin -. schema .-> Contracts
  API -. schema .-> Contracts
  API --> Auth["AuthProvider"]
  API --> Ledger["CreditLedger"]
  API --> AccountDb["Postgres account/auth/billing"]
  API --> Store["JSON project/task store"]
  API --> Repo["TaskRepository"]
  API -. enqueue .-> Queue["TaskDispatcher"]
  Worker["apps/api/src/worker.ts 任务 worker"] --> Queue
```

## 边界

### 创作端

只负责交互、编辑状态和展示。它可以根据 `/auth/me` 返回的权限改善界面，但不能决定用户是否真的有权限或积分。

### API

所有外部接口使用 `/api/v1` 前缀。模块拥有自己的路由、服务和仓储接口；路由只处理协议与校验，服务编排业务，适配器处理数据库和外部系统。

```text
apps/api/src/
  core/          认证、错误、任务分发等跨模块能力
  modules/       auth、generation、billing、admin 等业务模块
  infra/         Postgres migration、JSON Store、对象存储
  app.ts         依赖装配与路由注册
  server.ts      进程启动和优雅退出
```

### 共享契约

`packages/contracts` 是角色、权限、请求和响应结构的唯一来源。它不能依赖任何 UI 或服务端框架，也不能包含数据库实体。

### 管理员端

管理员端保留为独立应用，未来可使用不同域名、发布节奏和安全策略。它只复用契约与设计令牌，不复用创作端页面；后端管理接口统一位于 `/api/v1/admin/*`。

当前独立 `apps/admin` 仍是预留边界；创作端内已提供临时账号管理入口，用于测试 workspace、membership、session 和管理员操作。独立管理员端应优先消费 `GET /api/v1/admin/console` 聚合接口，再按需要调用用户、租户、账单、session 和审计子接口。

## 多租户

认证主体始终包含 `userId`、`tenantId` 和 `roles`。仓储查询必须显式带入主体并按 `tenantId` 过滤。客户端传入的租户 ID 不可信，不能用于数据隔离。

当前账号与租户边界由 Postgres 中的 `users`、`auth_identities`、`tenant_memberships`、`sessions`、`billing_accounts` 和 `billing_ledger_entries` 承载。项目、资产、分镜和生成任务仍在 JSON Store 中按 `tenantId` 过滤；迁移这些领域数据前不能多实例运行 API/Worker。

## 数据持久化

- Postgres：账号、身份、session、workspace/tenant、membership、账单账户、账单流水、密码重置 token 和审计日志。
- JSON Store：项目、资产、分镜、生成任务、历史兼容数据和本地 Demo 状态。
- ObjectStorage：上传文件、生成图片、视频、尾帧和完整成片预览。

Migration 文件位于 `apps/api/src/infra/migrations`。dev/test 启动时可以自动迁移；production 启动只检查是否最新，部署前必须运行 `pnpm --filter @seqora/api db:migrate`。

## 可替换端口

- `AuthProvider`：当前生产路径为本地账号 + 签名 HttpOnly Cookie + Postgres session；`demo` header 只允许开发/测试。企业 SSO 可替换为 OIDC/JWT。
- `GenerationTaskRepository`：当前 JSON Store，未来替换为 PostgreSQL。
- `CreditLedger`：当前已支持 Postgres billing ledger，扣费、退款、grant 和 adjustment 在数据库事务中完成。
- `TaskDispatcher`：API 侧默认 no-op；worker 进程里的 `GenerationTaskRunner` 负责执行，未来可替换 Redis、SQS 或 RabbitMQ。

业务服务只依赖这些接口，因此替换基础设施时不需要修改路由或前端。

## 暂不拆微服务

用户、项目、资产、计费和生成模块先保留在一个 API 进程中。只有出现独立扩缩容、独立故障域或团队所有权边界后再拆服务，拆分时继续沿用现有模块与契约边界。
