# 序幕TV 文档索引

本目录按“当前事实、开发边界、专项能力、质量、运维、历史”组织。新 Agent 先读根目录 `AGENTS.md`，再读 `CURRENT_STATE.md`。工程化升级前的全量审查见 [ENGINEERING_AUDIT.md](ENGINEERING_AUDIT.md)。

## 当前事实

| 文档                                                   | 用途                                 | 状态                        |
| ------------------------------------------------------ | ------------------------------------ | --------------------------- |
| [CURRENT_STATE.md](CURRENT_STATE.md)                   | 当前功能矩阵、生产状态、限制和优先级 | 当前事实源，2026-08-03 核对 |
| [HANDOFF_GUIDE.md](HANDOFF_GUIDE.md)                   | 30 分钟项目总览和代码地图            | 当前交接入口                |
| [DEVELOPMENT_MEMORY.md](DEVELOPMENT_MEMORY.md)         | 历史决策、事故、验收和迁移记录       | 历史日志，顶部当前快照优先  |
| [PRODUCT_VOCABULARY.md](PRODUCT_VOCABULARY.md)         | 产品词汇和角色冻结                   | 有效                        |
| [ACCOUNT_DELIVERY_GUIDE.md](ACCOUNT_DELIVERY_GUIDE.md) | 公账付款后的 C 端/B 端账号交付 SOP   | 有效                        |

## 架构与开发

| 文档                                                   | 用途                                 |
| ------------------------------------------------------ | ------------------------------------ |
| [ARCHITECTURE.md](ARCHITECTURE.md)                     | 总体运行架构和持久化边界             |
| [BACKEND_BOUNDARIES.md](BACKEND_BOUNDARIES.md)         | 八个后端业务边界和跨边界规则         |
| [AUTHORIZATION.md](AUTHORIZATION.md)                   | 登录、注册、邮箱验证、角色与组织权限 |
| [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md)           | 正式权限矩阵和高权限限制             |
| [ORGANIZATION_MIGRATION.md](ORGANIZATION_MIGRATION.md) | organization/tenant 兼容策略         |
| [CODE_STYLE.md](CODE_STYLE.md)                         | React、TypeScript、样式和自动化规范  |
| [JSON_RETIREMENT.md](JSON_RETIREMENT.md)               | JSON Store 退出计划与剩余使用点      |

## 产品与 Provider

| 文档                                                     | 用途                                   | 当前阶段                    |
| -------------------------------------------------------- | -------------------------------------- | --------------------------- |
| [ASSET_GENERATION.md](ASSET_GENERATION.md)               | 资产、可信人像、图片、视频、分镜和成片 | 主流程有效                  |
| [DIRECTOR_PIPELINE_AUDIT.md](DIRECTOR_PIPELINE_AUDIT.md) | 剧本到有声粗剪的链路审计与升级方案     | 2026-08-04 调研结论         |
| [NOVEL_TO_VIDEO_AGENT.md](NOVEL_TO_VIDEO_AGENT.md)       | 长篇小说到视频的阶段方案               | 后端实验，前端开发中        |
| [NOVEL_REGRESSION.md](NOVEL_REGRESSION.md)               | 小说真实样本回归                       | 手工显式执行                |
| [SCENE_MASTER_EXPERIMENT.md](SCENE_MASTER_EXPERIMENT.md) | 按场次母带成片实验                     | 实验脚本，不是产品入口      |
| [BILLING_PAYMENTS.md](BILLING_PAYMENTS.md)               | 积分、Stripe 沙箱与正式支付缺口        | Ledger 可用，正式支付未上线 |

## 测试与质量

| 文档                                                   | 用途                                       |
| ------------------------------------------------------ | ------------------------------------------ |
| [BACKEND_TESTING.md](BACKEND_TESTING.md)               | 单元、契约、集成和安全测试分层             |
| [NON_FUNCTIONAL_QUALITY.md](NON_FUNCTIONAL_QUALITY.md) | k6、混沌和安全测试计划                     |
| [RELIABILITY_GATES.md](RELIABILITY_GATES.md)           | CI 与生产拨测门禁                          |
| [OBSERVABILITY.md](OBSERVABILITY.md)                   | 日志、健康、readiness、指标和 trace        |
| [USAGE_METRICS.md](USAGE_METRICS.md)                   | 用量指标名称、时间窗口、计数规则和可见范围 |

## 部署与运维

| 文档                                                         | 用途                                           |
| ------------------------------------------------------------ | ---------------------------------------------- |
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md)               | 当前生产实例、巡检、发布、故障和账号运维       |
| [DEPLOYMENT.md](DEPLOYMENT.md)                               | 新环境部署和上线门槛                           |
| [PRODUCTION_INITIALIZATION.md](PRODUCTION_INITIALIZATION.md) | migration 与首次账号初始化                     |
| [CICD.md](CICD.md)                                           | GitHub Actions、Artifact Registry 和模块化发布 |
| [BACKUP_RESTORE.md](BACKUP_RESTORE.md)                       | Postgres、JSON 和 GCS 备份恢复                 |
| [ENVIRONMENT_STRATEGY.md](ENVIRONMENT_STRATEGY.md)           | 本地、CI、预发布和生产数据策略                 |

## 维护规则

- 当前行为变化：更新 `CURRENT_STATE.md` 和对应专项文档。
- 部署、域名、实例或发布方式变化：更新 `OPERATIONS_RUNBOOK.md`、`DEPLOYMENT.md` 和 `DEVELOPMENT_MEMORY.md`。
- 契约、状态枚举或角色变化：更新 contracts、测试、`AGENTS.md`、权限文档和交接指南。
- 新增文档后把它登记在本索引，不让孤立文档成为隐性事实源。
- 历史记录可以保留当时状态，但必须注明日期，不能覆盖当前事实。
- 文档不得包含真实密码、邀请码、邮箱验证码、API Key、Cookie 或用户上传内容。
