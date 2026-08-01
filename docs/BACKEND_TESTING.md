# 后端测试体系

本文定义当前 TypeScript/Fastify 后端的测试金字塔。用户提到的 Mockito/MockK、Testcontainers、Pact/Spring Cloud Contract 属于 Java 生态；本项目对应使用 Vitest、真实 Docker/Postgres/Redis fixture、BullMQ 和 `@seqora/contracts` 的 Zod schema。

## 分层目标

### 1. 单元测试

目标是覆盖工具类、领域服务、Provider 适配、队列组件和纯仓储逻辑。依赖通过 Vitest `vi.fn()`、内存 `AppStore` 或 fake provider 隔离。

运行：

```bash
pnpm test:backend:unit
```

当前重点覆盖：

- 配置解析与生产安全校验。
- 文本、图片、视频 Provider 请求归一化和错误处理。
- 任务 runner、outbox relay、资源锁、幂等重试。
- 媒体 token、影片预览、脚本/小说处理等核心领域逻辑。

### 2. 集成测试

目标是验证真实外部依赖和事务边界，不使用 H2 或内存数据库替代 Postgres。当前测试 fixture 会启动真实 Postgres 16 容器；Redis/BullMQ 测试使用真实 Redis 7。CI 的 `database` job 也会起 Postgres 和 Redis service，先执行 migration，再跑关键集成测试。

运行：

```bash
pnpm test:backend:integration
```

当前重点覆盖：

- Postgres migration、`schema_migrations`、事务包裹和 pending migration 检查。
- auth、account management、session、密码重置、邮箱验证、审计日志。
- admin console 的用户、组织、membership、账单、session、审计权限边界。
- billing ledger 扣费、退款、grant、adjustment、Stripe sandbox webhook 和对账。
- project、asset、shot、generation task 的 Postgres 持久化和跨组织隔离。
- BullMQ 通过 Redis 投递任务到 Worker。

### 3. 契约测试

目标是保证 API、Web、Admin Console 共享同一套请求/响应 schema 和角色枚举。当前没有微服务拆分，因此不引入 Pact；契约来源是 `packages/contracts`，由 Zod schema 和对应测试兜底。

运行：

```bash
pnpm test:backend:contract
```

当前重点覆盖：

- 角色权限矩阵，确认 `creator` 不再属于正式账号角色。
- 项目、资产、分镜、小说、生成、quick start 请求/响应 schema。
- admin console 聚合响应 schema，包括 users、organizations、memberships、billing、session、audit log。
- 敏感后台 mutation payload，例如管理员重置密码、强制改密、充值和调账。
- `apps/api/src/contracts/httpContract.test.ts` 这类 API 层 HTTP 契约测试，使用 `app.inject` + JSON Schema 严格校验返回字段，覆盖正常响应、必填校验、边界值、注入字符串和重复提交。

## 一键执行

后端三层测试可用：

```bash
pnpm test:backend:pyramid
```

历史综合 API 回归单独保留：

```bash
pnpm test:backend:legacy
```

完整工作区测试仍使用：

```bash
pnpm test
```

`pnpm test` 会覆盖所有 workspace 包和历史综合测试；`test:backend:pyramid` 用于后端专项回归和 CI 数据库链路。

## CI 规则

- `quality` job：格式、Lint、组织 API 废弃调用检查、完整 workspace 测试和构建。
- `database` job：启动 Postgres 16 和 Redis 7，执行 `pnpm --filter @seqora/api db:migrate`，然后运行 `pnpm --filter @seqora/api test:integration`。
- migration 文件进入主分支后只允许新增版本，不允许修改旧 migration；CI 通过 append-only 检查阻断。

## 后续优化

- `apps/api/src/app.test.ts` 仍是历史综合测试，混合了 handler、领域流程和本地 auth/Postgres 场景。后续应按模块拆到 `modules/*/routes.test.ts` 和 `core/*/*.test.ts`。
- 当前 Docker fixture 是轻量 Testcontainers-style 实现。若后续需要更强的生命周期管理、并发隔离和镜像复用，可引入 Node 生态的 `testcontainers` 包替换手写 `docker run`。
- 如果未来拆出独立微服务，应在 `packages/contracts` 之外补 Pact 或等价 consumer-driven contract，避免 provider 改动破坏 consumer。
