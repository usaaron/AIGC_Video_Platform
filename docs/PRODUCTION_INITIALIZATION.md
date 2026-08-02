# Production Initialization Runbook

本 runbook 定义新生产环境或恢复后的空账号库初始化顺序。生产 API / Worker 启动时只检查 migration 是否最新，不会自动创建账号或导入 JSON bootstrap 数据。

## 原则

- `NODE_ENV=production` 禁止 `BOOTSTRAP_ACCOUNTS_ON_START=true` 和 `BOOTSTRAP_DEMO_WORKSPACE=true`。
- 生产改库只允许显式命令：先 `db:migrate`，再按需执行 `accounts:init`。
- `accounts:init` 是幂等命令：只插入缺失的初始账号、系统组织、membership、billing account 和初始 ledger，不覆盖已有账号密码。
- `accounts:init` 在生产环境会拒绝默认开发密码、`replace-with-*` 占位密码、缺失的 bootstrap 邮箱/密码，以及重复邮箱或重复密码。
- 初始化完成后，建议把 `BOOTSTRAP_*_PASSWORD` 从长期运行的 API/Worker Secret 中移除或轮换到只给运维命令使用的 Secret。

## 新环境首次初始化

1. 准备生产环境变量。

必须设置：

- `NODE_ENV=production`
- `DATABASE_URL`
- `BOOTSTRAP_ACCOUNTS_ON_START=false`
- `BOOTSTRAP_DEMO_WORKSPACE=false`
- `BOOTSTRAP_MEMBER_EMAIL` / `BOOTSTRAP_MEMBER_PASSWORD`
- `BOOTSTRAP_OWNER_EMAIL` / `BOOTSTRAP_OWNER_PASSWORD`
- `BOOTSTRAP_SUPER_ADMIN_EMAIL` / `BOOTSTRAP_SUPER_ADMIN_PASSWORD`
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`

四个初始账号邮箱和密码都必须互不重复。不要使用 `MemberPassword123!`、`OwnerPassword123!`、`SuperAdmin123!`、`Admin123!` 或 `replace-with-*`。

2. 执行 migration。

```bash
pnpm --filter @seqora/api db:migrate
```

Docker Compose 部署：

```bash
docker compose --env-file deploy/demo.env -f compose.demo.yml run --rm api \
  node dist/scripts/dbMigrate.js
```

3. 执行账号初始化。

```bash
pnpm --filter @seqora/api accounts:init
```

Docker Compose 部署：

```bash
docker compose --env-file deploy/demo.env -f compose.demo.yml run --rm api \
  node dist/scripts/initProductionAccounts.js
```

4. 启动 API / Worker / Web。

```bash
docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --build
curl --fail https://studio.example.com/api/v1/health
```

5. 初始化后检查。

```bash
curl --fail https://studio.example.com/api/v1/health/readiness
```

用 owner 账号登录 `apps/admin`，确认：

- 只有 1 个 owner。
- super_admin 数量不超过 5。
- 初始 member、owner、super_admin、admin 均为 active。
- 系统组织标记为系统组织，不可作为普通业务组织使用。

## 升级已有生产环境

常规升级只执行 migration，然后启动新版本：

```bash
docker compose --env-file deploy/demo.env -f compose.demo.yml build api
docker compose --env-file deploy/demo.env -f compose.demo.yml run --rm api \
  node dist/scripts/dbMigrate.js
docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --build
```

不要在每次升级时依赖 API/Worker 自动 bootstrap。只有在新环境、恢复后空账号库、或确认需要补齐缺失初始账号时，才显式执行 `accounts:init`。

## 失败处理

- `BOOTSTRAP_ACCOUNTS_ON_START is forbidden in production`：生产环境错误配置了启动 bootstrap。设置为 `false`，使用本 runbook 的显式命令。
- `[accounts:init] production account initialization requires ...`：缺少生产初始化账号的邮箱或密码环境变量。
- `[accounts:init] ... must be a unique production password`：仍在使用开发默认密码或占位密码。
- `schema_migrations table is missing` 或 migration not latest：先执行 `db:migrate`，不要启动 API 绕过。

如果 `accounts:init` 执行到一半失败，Postgres transaction 会回滚。修正配置后重新运行同一命令即可。
