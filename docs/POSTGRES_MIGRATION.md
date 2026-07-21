# PostgreSQL 迁移方案

## 结论

当前 `AppStore` 使用 `DATA_FILE` 指向的本地 JSON 文件保存全部业务状态，只适合本地开发、演示和短期联调。生产环境和多人真实项目必须迁移到 PostgreSQL；JSON 文件在迁移完成后只保留为本地 Demo 模式或一次性导入来源。

迁移目标：

- PostgreSQL 成为 `users`、`projects`、`assets`、`shots`、`generation_tasks`、`ledger_entries` 和 `media` 的唯一事实来源。
- 所有查询显式携带 `tenantId`、`userId` 或管理员权限上下文，继续满足多租户隔离要求。
- 保留前端 `/api/v1` 契约不变，先替换服务端仓储适配器。
- 生成任务、积分扣减和结果回写必须在数据库事务中保持一致。

## 当前 JSON 范围

`apps/api/src/infra/store.ts` 当前维护一个完整 `AppState`：

| JSON 字段  | 当前用途                                 | PostgreSQL 目标表  |
| ---------- | ---------------------------------------- | ------------------ |
| `users`    | 本地账号、密码哈希、角色、套餐和积分余额 | `users`            |
| `projects` | 项目基础信息、剧本和版本                 | `projects`         |
| `assets`   | 角色、场景、道具、服装、音频资产         | `assets`           |
| `shots`    | 分镜列表                                 | `shots`            |
| `tasks`    | 文生图、图生视频等生成任务               | `generation_tasks` |
| `ledger`   | 积分流水                                 | `ledger_entries`   |
| `media`    | 上传媒体元数据                           | `media`            |

当前这些模块直接或间接依赖 `AppStore`：

- `modules/users/repository.ts`
- `modules/projects/repository.ts`
- `modules/generation/repository.ts`
- `modules/media/repository.ts`
- `modules/billing/creditLedger.ts`
- `modules/admin/routes.ts`
- `core/jobs/taskDispatcher.ts`

因此不建议一次性硬切所有 JSON 读写；应先抽出仓储端口，再按模块替换为 SQL 实现。

## 环境变量

第一阶段保持现有 `DATA_FILE` 可用，同时新增计划中的数据库开关：

```env
DATA_STORE=json
DATA_FILE=./data/app.json

# DATA_STORE=postgres
# DATABASE_URL=postgres://seqora:seqora@127.0.0.1:5432/seqora
```

规则：

- `DATA_STORE=json`：本地演示模式，继续使用 `AppStore`。
- `DATA_STORE=postgres`：生产和真实联调模式，必须提供 `DATABASE_URL`。
- `NODE_ENV=production` 时禁止 `DATA_STORE=json`。
- `.env` 和部署平台 Secret 保存真实连接串，不提交 Git。

## 表结构草案

第一版使用 SQL migration 管理表结构。推荐先使用 `node-postgres` + SQL migrations 或 Kysely，避免过早引入重 ORM。枚举可先使用 `text` + `check`，后续稳定后再改 PostgreSQL enum。

如果使用 `citext` 保存邮箱，首个 migration 需要执行 `create extension if not exists citext;`。无法启用扩展的环境可改用 `lower(email)` 唯一索引。

### tenants

| 字段         | 类型                   | 说明     |
| ------------ | ---------------------- | -------- |
| `id`         | `text primary key`     | 租户 ID  |
| `name`       | `text not null`        | 租户名称 |
| `created_at` | `timestamptz not null` | 创建时间 |
| `updated_at` | `timestamptz not null` | 更新时间 |

### users

| 字段            | 类型                                   | 说明               |
| --------------- | -------------------------------------- | ------------------ |
| `id`            | `text primary key`                     | 用户 ID            |
| `tenant_id`     | `text not null references tenants(id)` | 租户 ID            |
| `email`         | `citext not null`                      | 登录邮箱           |
| `name`          | `text not null`                        | 展示名             |
| `password_hash` | `text not null`                        | `scrypt` 哈希      |
| `roles`         | `text[] not null`                      | 角色列表           |
| `plan`          | `text not null`                        | `free` 或 `member` |
| `credits`       | `integer not null default 0`           | 当前积分余额       |
| `created_at`    | `timestamptz not null`                 | 创建时间           |
| `updated_at`    | `timestamptz not null`                 | 更新时间           |

约束：

- `unique (tenant_id, email)`
- `check (credits >= 0)`
- `check (plan in ('free', 'member'))`

### projects

| 字段           | 类型                                   | 说明                    |
| -------------- | -------------------------------------- | ----------------------- |
| `id`           | `text primary key`                     | 项目 ID                 |
| `tenant_id`    | `text not null references tenants(id)` | 租户 ID                 |
| `owner_id`     | `text not null references users(id)`   | 创建者                  |
| `name`         | `text not null`                        | 项目名                  |
| `content_type` | `text not null`                        | 短剧、广告或动画        |
| `aspect_ratio` | `text not null`                        | `9:16`、`16:9` 或 `1:1` |
| `status`       | `text not null`                        | 项目状态                |
| `synopsis`     | `text not null default ''`             | 梗概                    |
| `script`       | `text not null default ''`             | 剧本正文                |
| `version`      | `integer not null default 1`           | 项目版本                |
| `created_at`   | `timestamptz not null`                 | 创建时间                |
| `updated_at`   | `timestamptz not null`                 | 更新时间                |

索引：

- `projects_tenant_updated_idx (tenant_id, updated_at desc)`
- `projects_owner_idx (owner_id)`

### assets

| 字段                 | 类型                                                      | 说明                                             |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| `id`                 | `text primary key`                                        | 资产 ID                                          |
| `project_id`         | `text not null references projects(id) on delete cascade` | 项目 ID                                          |
| `tenant_id`          | `text not null references tenants(id)`                    | 租户 ID                                          |
| `kind`               | `text not null`                                           | `character`、`scene`、`prop`、`costume`、`audio` |
| `source_mode`        | `text not null`                                           | `import` 或 `generate`                           |
| `name`               | `text not null`                                           | 资产名                                           |
| `description`        | `text not null default ''`                                | 描述                                             |
| `prompt`             | `text not null default ''`                                | 标准提示词                                       |
| `prompt_mode`        | `text not null`                                           | `standard` 或 `advanced`                         |
| `custom_prompt_mode` | `text not null`                                           | `append` 或 `replace`                            |
| `custom_prompt`      | `text not null default ''`                                | 自定义提示词                                     |
| `negative_prompt`    | `text not null default ''`                                | 反向提示词                                       |
| `references`         | `jsonb not null default '[]'`                             | 最多三张参考图                                   |
| `attributes`         | `jsonb not null`                                          | 分类型属性                                       |
| `image_url`          | `text`                                                    | 主预览图                                         |
| `status`             | `text not null`                                           | `draft` 或 `confirmed`                           |
| `created_at`         | `timestamptz not null`                                    | 创建时间                                         |
| `updated_at`         | `timestamptz not null`                                    | 更新时间                                         |

索引：

- `assets_project_kind_idx (project_id, kind, updated_at desc)`
- `assets_tenant_idx (tenant_id)`
- 可选：`assets_attributes_gin_idx using gin (attributes)`，用于后续按属性筛选。

三视图规则：

- `attributes.turnaroundReferences` 保留 `front`、`side`、`back` 三张源图。
- `image_url` 只保存主预览图或首张结果，不把三视图拼成唯一资产结果。
- 任务结果仍写入 `generation_tasks.outputs`，资产同步写入 `assets.attributes`，二者都在同一事务内完成。

### shots

| 字段          | 类型                                                      | 说明       |
| ------------- | --------------------------------------------------------- | ---------- |
| `id`          | `text primary key`                                        | 分镜 ID    |
| `project_id`  | `text not null references projects(id) on delete cascade` | 项目 ID    |
| `tenant_id`   | `text not null references tenants(id)`                    | 租户 ID    |
| `order_index` | `integer not null`                                        | 展示顺序   |
| `title`       | `text not null`                                           | 镜头标题   |
| `framing`     | `text not null`                                           | 景别       |
| `duration`    | `integer not null`                                        | 秒数       |
| `prompt`      | `text not null default ''`                                | 镜头提示词 |
| `image_url`   | `text`                                                    | 预览图     |
| `created_at`  | `timestamptz not null`                                    | 创建时间   |
| `updated_at`  | `timestamptz not null`                                    | 更新时间   |

约束与索引：

- `unique (project_id, order_index)`
- `shots_project_order_idx (project_id, order_index)`

### generation_tasks

| 字段                | 类型                                                      | 说明                                  |
| ------------------- | --------------------------------------------------------- | ------------------------------------- |
| `id`                | `text primary key`                                        | 任务 ID                               |
| `client_request_id` | `text not null`                                           | 前端幂等 ID                           |
| `project_id`        | `text not null references projects(id) on delete cascade` | 项目 ID                               |
| `tenant_id`         | `text not null references tenants(id)`                    | 租户 ID                               |
| `user_id`           | `text not null references users(id)`                      | 发起用户                              |
| `kind`              | `text not null`                                           | `text`、`image`、`video`、`audio`     |
| `label`             | `text not null`                                           | 任务标题                              |
| `prompt`            | `text not null default ''`                                | 正向提示词                            |
| `negative_prompt`   | `text not null default ''`                                | 反向提示词                            |
| `provider`          | `text not null`                                           | `local`、`seedance`、`aideos-img2` 等 |
| `model`             | `text`                                                    | 模型名                                |
| `metadata`          | `jsonb not null default '{}'`                             | Provider、资产和镜头上下文            |
| `status`            | `text not null`                                           | 队列状态                              |
| `progress`          | `integer not null default 0`                              | 0 到 100                              |
| `estimated_credits` | `integer not null default 0`                              | 预估消耗                              |
| `result_url`        | `text`                                                    | 兼容单结果                            |
| `outputs`           | `jsonb not null default '[]'`                             | 图片、视频、音频输出                  |
| `error`             | `text`                                                    | 失败原因                              |
| `created_at`        | `timestamptz not null`                                    | 创建时间                              |
| `updated_at`        | `timestamptz not null`                                    | 更新时间                              |

约束与索引：

- `unique (user_id, client_request_id)`
- `generation_tasks_project_idx (project_id, created_at desc)`
- `generation_tasks_tenant_status_idx (tenant_id, status, created_at)`
- `generation_tasks_running_user_idx (user_id, status)`，用于校验免费单路、会员三路并发。

### ledger_entries

| 字段          | 类型                                   | 说明                                |
| ------------- | -------------------------------------- | ----------------------------------- |
| `id`          | `text primary key`                     | 流水 ID                             |
| `user_id`     | `text not null references users(id)`   | 用户 ID                             |
| `tenant_id`   | `text not null references tenants(id)` | 租户 ID                             |
| `amount`      | `integer not null`                     | 正数发放，负数扣减                  |
| `balance`     | `integer not null`                     | 记账后余额                          |
| `type`        | `text not null`                        | `grant`、`generation`、`adjustment` |
| `description` | `text not null`                        | 描述                                |
| `created_at`  | `timestamptz not null`                 | 创建时间                            |

积分扣减必须在事务内执行：

1. `select ... from users where id = $1 for update`
2. 校验余额和套餐并发限制
3. 写入 `ledger_entries`
4. 更新 `users.credits`
5. 创建或推进 `generation_tasks`

### media

| 字段           | 类型                                                      | 说明               |
| -------------- | --------------------------------------------------------- | ------------------ |
| `id`           | `text primary key`                                        | 媒体 ID            |
| `project_id`   | `text not null references projects(id) on delete cascade` | 项目 ID            |
| `tenant_id`    | `text not null references tenants(id)`                    | 租户 ID            |
| `kind`         | `text not null`                                           | `image` 或 `audio` |
| `name`         | `text not null`                                           | 文件名             |
| `content_type` | `text not null`                                           | MIME 类型          |
| `size`         | `integer not null`                                        | 文件大小           |
| `storage_key`  | `text not null`                                           | 本地或对象存储 Key |
| `created_at`   | `timestamptz not null`                                    | 创建时间           |

索引：

- `media_project_idx (project_id, created_at desc)`
- `media_tenant_idx (tenant_id)`

## 迁移步骤

### 阶段 1：准备端口和配置

- 在 `config.ts` 增加 `DATA_STORE=json|postgres` 和 `DATABASE_URL` 校验。
- 把 `AppStore` 依赖从 Service/Dispatcher 中收敛到 Repository 接口。
- 为用户、项目、生成任务、媒体、积分分别定义仓储端口。
- 保持 `AppStore` 实现作为 `Json*Repository`，现有测试先不大面积改动。

交付标准：

- `pnpm check` 通过。
- 本地 `DATA_STORE=json` 行为和现状一致。
- `NODE_ENV=production` 且 `DATA_STORE=json` 会启动失败。

### 阶段 2：建立 PostgreSQL 基础设施

- 新增 `apps/api/src/infra/postgres/`，集中管理连接池、事务和 migration runner。
- 新增 `apps/api/migrations/*.sql`，按上面的表结构建表、约束和索引。
- 新增本地 `docker-compose.postgres.yml` 或 README 命令，提供开发数据库。
- 新增测试数据库配置，集成测试每个用例清库或使用事务回滚。

交付标准：

- 空库可一键 migrate。
- 本地 seed 能创建演示租户、用户和项目。
- PostgreSQL 测试夹具不依赖 `apps/api/data/app.json`。

### 阶段 3：模块级替换

按风险从低到高替换：

1. `media`：只保存元数据，最容易验证。
2. `projects`：项目、资产、分镜读写。
3. `users`：登录、会话恢复、套餐更新。
4. `generation_tasks`：任务创建、轮询、失败、结果输出。
5. `ledger_entries`：积分流水、余额扣减和并发限制。
6. `admin`：统计查询改成 SQL 聚合。

每个模块都需要同时保留 JSON 和 PostgreSQL 测试，直到切换完成。

### 阶段 4：JSON 数据导入

新增一次性导入命令：

```bash
pnpm --filter @seqora/api migrate:json -- --file apps/api/seed/app.json
```

导入规则：

- 先校验 JSON 是否符合当前 Zod 契约。
- 以 `tenantId` 为单位导入，缺失租户时创建默认租户。
- 先导入用户，再导入项目、资产、分镜、媒体、任务和流水。
- 对 `clientRequestId`、`email`、`order` 等唯一约束冲突给出明确错误，不静默覆盖。
- 导入完成后输出记录数和失败原因，不打印密钥或完整连接串。

### 阶段 5：灰度切换和清理

- 开发环境默认 `DATA_STORE=json`，真实联调和部署使用 `DATA_STORE=postgres`。
- 一个版本周期内保留 JSON 导出和导入脚本，便于回滚。
- PostgreSQL 路径稳定后，删除业务代码对 `AppStore` 的直接依赖。
- 最后只保留 JSON seed 作为测试 fixture 或本地 Demo 数据。

## 回滚方案

- 切换前备份 PostgreSQL：`pg_dump --format=custom`。
- 导入前保留原始 `apps/api/seed/app.json`。
- 一个版本周期内支持 `DATA_STORE=json|postgres` 双路径启动。
- 如果 PostgreSQL 路径出现阻断问题，回滚环境变量到 `DATA_STORE=json`，并用导出脚本恢复最近一次 JSON 快照。

## 验收清单

- `pnpm check` 通过。
- PostgreSQL migration 可从空库重复跑到最新版本。
- JSON 导入脚本能完整迁移本地演示数据。
- 所有业务查询都带 `tenantId` 或管理员权限上下文。
- 免费用户单路、会员三路并发在数据库事务下仍成立。
- 生成失败、重试、轮询、结果播放和下载状态可持久化。
- 图片生成结果能同时写回 `generation_tasks.outputs` 和对应 `assets`。
- 三视图输出保留 `front`、`side`、`back` 三张源图，前端只负责组合预览。
- 账本流水和用户余额在并发扣减下不会出现负数或重复扣费。
