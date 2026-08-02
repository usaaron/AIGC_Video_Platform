# JSON / AppStore Retirement Inventory

本清单是后端 JSON Store 退休的执行台账。目标不是一次性删除 `AppStore`，而是先让每个使用点都有明确处置结论，再按批次迁移、验证、提交。

## 状态定义

| 状态 | 含义                                                                    | 处理规则                                           |
| ---- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| 保留 | 只允许作为历史 JSON 导入、备份读取、测试夹具或短期 runtime cache 使用。 | 新业务不能依赖它作为事实来源；保留原因必须写清楚。 |
| 迁移 | 需要改为 Postgres、ObjectStorage、Repository 或领域 Service。           | 每批迁移必须有集成测试，迁移后更新本清单。         |
| 删除 | 对应 JSON fallback、demo bootstrap 或旧兼容路径应移除。                 | 先确认已有替代路径，再删除代码和测试假设。         |

## 数据域结论

| AppState 数据 | 当前事实来源                                                                                  | 清单结论 | 目标                                                                           |
| ------------- | --------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `users`       | Postgres 已承担账号、身份、session 和 membership；JSON 仍有 fallback / runtime mirror。       | 删除     | 生产只允许 Postgres；JSON 用户只保留历史导入和测试夹具。                       |
| `ledger`      | Postgres `billing_ledger_entries` 已承担新流水；JSON 仍有导入和 fallback。                    | 删除     | `CreditLedger` 不再读写 JSON ledger；历史 JSON 只作为一次性导入输入。          |
| `projects`    | Postgres 已有 `projects`；JSON 仍有 fallback、runtime cache 和部分读路径。                    | 迁移     | 创作项目读写全部走 `ProjectRepository` 的 Postgres 路径。                      |
| `assets`      | Postgres 已有 `assets`；JSON 仍有 fallback、runtime cache、trusted asset 更新和 worker 写回。 | 迁移     | 资产状态、图片 URL、可信肖像标记全部由 Postgres 持久化。                       |
| `shots`       | Postgres 已有 `shots`；JSON 仍有 fallback、runtime cache 和 worker 写回。                     | 迁移     | 分镜和生成结果写回全部由 Postgres 持久化。                                     |
| `tasks`       | Postgres 已有 `generation_tasks`；JSON 仍有 runner cache、inline worker 写回和 fallback。     | 迁移     | Worker 只 claim / heartbeat / complete / fail Postgres 任务。                  |
| `aiJobs`      | Postgres 已有 `ai_jobs`；JSON 仍有 fallback 和 runtime cache。                                | 迁移     | 通用 AI job 生命周期只由 Postgres 管理。                                       |
| `media`       | 仍主要由 JSON Store 存媒体索引。                                                              | 迁移     | 建立并使用 `media_objects` repository，ObjectStorage 只存对象。                |
| `novel*`      | Postgres 已有小说元数据表；JSON 仍有 fallback 和导入输入。                                    | 迁移     | 小说元数据、队列、摘要和 story bible 只走 Postgres；正文继续走 ObjectStorage。 |

## 生产代码使用点

| 使用点                                              | 边界                              | 当前用途                                                           | 结论 | 批次  |
| --------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------ | ---- | ----- |
| `apps/api/src/infra/store.ts`                       | Infra                             | `AppStore` 实现、JSON 读写、runtime cache、legacy seed。           | 保留 | R6    |
| `apps/api/src/runtime/database.ts`                  | Runtime/Ops                       | 启动时创建并初始化 `AppStore`。                                    | 迁移 | R6    |
| `apps/api/src/app.ts`                               | Runtime/Ops                       | 测试和启动装配允许传入 `AppStore` override。                       | 迁移 | R6    |
| `apps/api/src/worker.ts`                            | Jobs/Workers                      | Worker 进程直接创建 `AppStore`。                                   | 迁移 | R2    |
| `apps/api/src/runtime/services.ts`                  | Runtime/Ops                       | 把 `AppStore` 注入多个 repository / service。                      | 迁移 | R2-R6 |
| `apps/api/src/runtime/routes.ts`                    | Runtime/Ops                       | 把 `AppStore` 注入 observability 和 admin overview fallback。      | 迁移 | R5    |
| `apps/api/src/runtime/queues.ts`                    | Jobs/Workers                      | inline runner 依赖 `AppStore` 和 cache flush。                     | 迁移 | R2    |
| `apps/api/src/scripts/importJsonToPostgres.ts`      | Ops/Migration                     | 一次性 JSON -> Postgres 导入入口。                                 | 保留 | R0    |
| `apps/api/src/modules/users/repository.ts`          | Identity & Access                 | 无 Postgres 时的 JSON 用户仓储 fallback。                          | 删除 | R5    |
| `apps/api/src/modules/accountManagement/service.ts` | Organizations                     | Postgres 写入后同步 `users/ledger` runtime cache。                 | 删除 | R5    |
| `apps/api/src/modules/billing/creditLedger.ts`      | Billing                           | JSON ledger 导入、余额/流水 fallback、兼容镜像。                   | 删除 | R5    |
| `apps/api/src/modules/admin/routes.ts`              | Admin Console                     | 路由装配仍要求传入 `AppStore`。                                    | 迁移 | R5    |
| `apps/api/src/modules/admin/routeContext.ts`        | Admin Console                     | `overview` 在无 repository / ledger 时回读 JSON。                  | 删除 | R5    |
| `apps/api/src/modules/projects/repository.ts`       | Creative Projects                 | JSON 项目/资产/分镜导入、fallback、Postgres runtime cache mirror。 | 迁移 | R3    |
| `apps/api/src/modules/novels/repository.ts`         | Creative Projects                 | 小说 JSON 导入、fallback、跨项目权限通过 `state.projects` 查。     | 迁移 | R4    |
| `apps/api/src/modules/generation/repository.ts`     | Jobs/Workers                      | 任务导入、fallback、runtime cache、项目/资产/分镜辅助读取。        | 迁移 | R2    |
| `apps/api/src/modules/aiJobs/repository.ts`         | Jobs/Workers                      | AI Job fallback、runtime cache、JSON 扣费/退款路径。               | 迁移 | R2    |
| `apps/api/src/core/jobs/taskRunnerComponents.ts`    | Jobs/Workers                      | runner 直接读写 `tasks/users/ledger/projects/assets/shots/media`。 | 迁移 | R2    |
| `apps/api/src/core/jobs/taskWriteback.ts`           | Jobs/Workers                      | 生成结果直接写回 JSON `tasks/assets/shots`。                       | 迁移 | R2    |
| `apps/api/src/core/jobs/taskCompletion.ts`          | Jobs/Workers                      | 自动合片前读取用户、分镜和任务完成状态。                           | 迁移 | R2    |
| `apps/api/src/core/jobs/taskDispatcher.ts`          | Jobs/Workers                      | inline dispatcher 用 `state.tasks` 判断活跃任务。                  | 迁移 | R2    |
| `apps/api/src/core/film/filmPreviewComposer.ts`     | Jobs/Workers                      | 合片预览任务直接读写 JSON `tasks`。                                | 迁移 | R2    |
| `apps/api/src/modules/media/repository.ts`          | Media Storage                     | 媒体索引仍写 JSON `media`，并通过 `state.projects` 验权。          | 迁移 | R1    |
| `apps/api/src/modules/trustedAssets/service.ts`     | Media Storage / Creative Projects | 可信资产流程读 `projects/assets/media/tasks`，并写回 asset 标记。  | 迁移 | R1    |
| `apps/api/src/modules/quickStart/service.ts`        | Creative Projects / Jobs          | 快速开始仍在一个 JSON mutation 里读写项目、资产、任务和 ledger。   | 迁移 | R3    |
| `apps/api/src/core/observability/routes.ts`         | Observability/Ops                 | 指标路由接收 `AppStore`。                                          | 迁移 | R5    |
| `apps/api/src/core/observability/metrics.ts`        | Observability/Ops                 | 日运营摘要从 JSON `tasks/aiJobs/ledger` 汇总。                     | 迁移 | R5    |

## 测试使用点

这些不是生产事实来源，但迁移时要同步替换测试夹具，避免测试继续强化 JSON 语义。

| 使用点                                               | 当前用途                                             | 结论 | 替代方向                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `apps/api/src/app.test.ts`                           | 大量 legacy API / inline worker 测试夹具。           | 迁移 | 拆成 Postgres integration tests；保留极少数 JSON legacy 测试直到 fallback 删除。 |
| `apps/api/src/contracts/httpContract.test.ts`        | 构建测试 app 时注入内存 `AppStore`。                 | 迁移 | 使用 Postgres fixture 或领域 test factory。                                      |
| `apps/api/src/infra/store.test.ts`                   | `AppStore` 自身读写和锁测试。                        | 保留 | R6 前保留；最终删除 `AppStore` 时一起删除。                                      |
| `apps/api/src/core/film/filmPreviewComposer.test.ts` | 合片预览任务状态测试。                               | 迁移 | 改为 `GenerationTaskRepository` / DB fixture。                                   |
| `apps/api/src/core/jobs/aiJobRunner.test.ts`         | AI Job runner 失败退款和状态测试。                   | 迁移 | 改为 Postgres `ai_jobs` + billing ledger fixture。                               |
| `apps/api/src/core/jobs/taskDispatcher.test.ts`      | inline generation runner 大量状态写回测试。          | 迁移 | 改为 Postgres `generation_tasks` + worker runner fixture。                       |
| `apps/api/src/modules/aiJobs/repository.test.ts`     | repository JSON fallback 测试。                      | 删除 | 删除 fallback 后只保留 Postgres repository tests。                               |
| `apps/api/src/modules/billing/creditLedger.test.ts`  | JSON ledger mirror / fallback 断言。                 | 删除 | 只断言 DB ledger、幂等 reference、退款、调账。                                   |
| `apps/api/src/modules/generation/repository.test.ts` | generation repository fallback / cache 测试。        | 迁移 | 只保留 Postgres lifecycle / outbox tests。                                       |
| `apps/api/src/modules/generation/routes.test.ts`     | 通过内存 store 搭建任务和资产状态。                  | 迁移 | 使用项目域和任务域数据工厂。                                                     |
| `apps/api/src/modules/projects/routes.test.ts`       | 项目 JSON 导入和 fallback 测试。                     | 迁移 | 保留导入测试，删除 fallback 读写测试。                                           |
| `apps/api/src/modules/trustedAssets/service.test.ts` | trusted asset 依赖 JSON assets/media/tasks fixture。 | 迁移 | 改为 Postgres assets + media_objects fixture。                                   |

## 批次计划

### R0: 建清单和门禁

目标：不改业务行为，只建立可执行台账。

验收：

- 本文档列出所有生产 `AppStore` 使用点。
- 新增或修改 `AppStore` 使用时，必须同步更新本清单。
- 每批迁移单独 commit / PR，不和前端或后台功能混提交。

### R1: Media Storage 先迁出 JSON

范围：

- `apps/api/src/modules/media/repository.ts`
- `apps/api/src/modules/trustedAssets/service.ts`
- `apps/api/src/core/jobs/taskRunnerComponents.ts` 中读取 `state.media` 的 helper。

目标：

- 建立正式 `MediaObjectRepository`，读写 `media_objects`。
- 媒体验权通过 Project / Organization 边界，不再直接扫 `state.projects`。
- trusted portrait / asset library 流程不再依赖 JSON `media`。

验收：

- 上传、读取、trusted asset 校验和生成引用均走 Postgres。
- `rg "state\\.media|StoredMedia" apps/api/src --glob "!**/*.test.ts"` 只剩迁移导入或测试夹具。

### R2: Worker 写回彻底数据库化

范围：

- `core/jobs/taskRunnerComponents.ts`
- `core/jobs/taskWriteback.ts`
- `core/jobs/taskCompletion.ts`
- `core/jobs/taskDispatcher.ts`
- `core/film/filmPreviewComposer.ts`
- `modules/generation/repository.ts`
- `modules/aiJobs/repository.ts`
- `runtime/queues.ts`
- `worker.ts`

目标：

- Runner 不再直接 mutate `state.tasks/assets/shots/users/ledger`。
- 生成任务结果通过 `GenerationTaskRepository`、`ProjectRepository`、`CreditLedger` 写入 Postgres。
- AI Job 成功/失败/退款只走 `ai_jobs` 和 DB ledger。

验收：

- Worker 重启恢复、幂等提交、任务锁测试全绿。
- `generation_tasks` / `ai_jobs` 生命周期测试覆盖 claim、heartbeat、complete、fail、refund。

### R3: Creative Projects 删除 runtime cache mirror

范围：

- `modules/projects/repository.ts`
- `modules/quickStart/service.ts`

目标：

- 项目、资产、分镜的读写和快速开始流程全部由 Postgres repository 编排。
- 删除 `replaceProjectWorkspaceRuntimeCache` 和 `mutateProjectWorkspaceRuntimeCache` 的生产调用。

验收：

- 创建项目、保存剧本、创建资产、创建/更新分镜、软删除、跨组织拦截测试走 Postgres。
- `state.projects/assets/shots` 在生产代码中不再作为业务读写来源。

### R4: Novel fallback 收口

范围：

- `modules/novels/repository.ts`

目标：

- 小说元数据只走 Postgres；正文继续 ObjectStorage。
- 项目可写/可读判断委托 `ProjectRepository` 或显式项目访问服务，不再 `state.projects`。
- JSON novel 数据只作为 `importJsonToPostgres` 输入。

验收：

- 小说导入、边界检测、摘要队列、story bible 生成集成测试全部使用 DB fixture。
- 删除运行时 JSON novel fallback。

### R5: Identity / Billing / Admin / Observability fallback 删除

范围：

- `modules/users/repository.ts`
- `modules/accountManagement/service.ts`
- `modules/billing/creditLedger.ts`
- `modules/admin/routes.ts`
- `modules/admin/routeContext.ts`
- `core/observability/*`
- `runtime/routes.ts`

目标：

- 删除 JSON auth / billing fallback。
- Admin overview 和 observability summary 从 repository / DB 汇总。
- 生产启动不再需要账号/账单 runtime mirror。

验收：

- 无 `DATABASE_URL` 时 API 只允许明确 demo/test 模式，不提供商用 fallback。
- auth、billing、admin console、observability 集成测试走 Postgres。

### R6: Runtime / Infra 收尾

范围：

- `infra/store.ts`
- `runtime/database.ts`
- `runtime/services.ts`
- `app.ts`
- `worker.ts`
- `scripts/importJsonToPostgres.ts`

目标：

- `AppStore` 从 API / Worker 正常启动路径移除。
- 历史 JSON 读取改成独立 `JsonArchiveReader` 或只留迁移脚本私有实现。
- demo bootstrap 和生产账号初始化彻底分离。

验收：

- `rg "\\bAppStore\\b|store\\.read|store\\.mutate|state\\.(users|ledger|projects|assets|shots|tasks|aiJobs|media|novel)" apps/api/src --glob "!**/*.test.ts"` 不再命中生产业务代码。
- `AppStore` 测试删除或移动为历史迁移脚本测试。

## 提交规则

- 每个批次必须单独提交，建议提交名：
  - `docs(api): add json retirement inventory`
  - `feat(api): move media objects off json store`
  - `refactor(api): move worker writeback to postgres repositories`
  - `refactor(api): remove project runtime cache mirror`
  - `refactor(api): remove novel json runtime fallback`
  - `refactor(api): remove auth billing json fallbacks`
  - `refactor(api): remove appstore from runtime startup`
- 每批完成后先更新本清单，再提交代码。
- 旧 JSON 文件只作为历史备份和一次性导入输入，不能作为新业务事实来源。
