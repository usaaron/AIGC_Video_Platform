# 序幕TV

前后端分离的 AIGC 影视创作平台 Monorepo。创作端、独立管理员端、API 和共享契约拥有独立边界，可以分别开发和部署。

当前功能、占位能力和生产状态以 [当前状态](docs/CURRENT_STATE.md) 为准。代码 Agent 进入仓库后先读 [AGENTS.md](AGENTS.md)。

## 快速开始

要求 Node.js 22.12+、pnpm 11+。完整功能推荐 Docker 和 Docker Compose；完整成片预览还需要本机或 API 容器内可执行的 FFmpeg。

```bash
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` 会检测 Docker。Docker 可用时启动 `compose.local.yml` 中的 Postgres/Redis，再启动 Web、Admin、API 和独立 Worker；Docker 不可用且没有外部数据库时自动回退到 JSON Store 和 API 内联队列，此时登录与一般开发可用，但邀请码注册和完整 Postgres 业务不可用。开发环境使用 Postgres 时会自动执行未执行的 migration。

- 创作端：[http://localhost:5173](http://localhost:5173)
- 管理员端：[http://localhost:5174](http://localhost:5174)
- API 健康检查：[http://localhost:8787/api/v1/health](http://localhost:8787/api/v1/health)

## Provider routing

- `textProvider`: defaults to Rehdasu `glm-5.2` for Chinese understanding, scripts, summaries, and asset suggestions. GLM/Kimi use `REHDASU_API_KEY`, GPT uses `TOKENADVENT_API_KEY`, DeepSeek V3 uses `DEEPSEEK_API_KEY`, and DeepSeek V4 Flash uses its independent `DEEPSEEK_V4_API_KEY`; a model is only usable when its route is configured.
- `imageProvider`: uses TokenAdvent GPT Image 2 / `image2` only for image asset generation and image edits.
- `videoProvider`: uses Seedance with `tier: mini | fast | pro`; the API stores the selected tier and the Provider maps it to the configured model.
- Secrets must stay in `apps/api/.env` or deployment secrets. Do not put API keys in code, frontend env, docs, or Git.

首次启动会自动创建四个本地演示账号：

| 身份       | 邮箱                      | 密码                 |
| ---------- | ------------------------- | -------------------- |
| 普通成员   | `member@seqora.local`     | `MemberPassword123!` |
| 所有者     | `owner@seqora.local`      | `OwnerPassword123!`  |
| 超级管理员 | `superadmin@seqora.local` | `SuperAdmin123!`     |
| 管理员     | `admin@seqora.local`      | `Admin123!`          |

认证使用经 `scrypt` 哈希的本地账号密码和签名 HttpOnly 会话 Cookie。产品上统一称为“组织”；底层 Postgres 仍以 `tenants`、`tenant_memberships` 等表承载组织边界。账号、身份、会话、组织 membership、账单账户、账单流水、密码重置 token、审计日志、项目、资产、分镜和生成任务写入 Postgres；任务触发队列使用 BullMQ/Redis；本地媒体索引仍由 `apps/api/data/app.json` 与对象存储承载。`app.json` 已被 Git 忽略；删除它只会重置本地 Demo/兼容备份数据，Postgres 账号和项目域数据需清理数据库或重建卷。

已有账号可在“项目设置 -> 账号安全”修改密码；用户密码最少 8 位，生产 bootstrap 配置仍要求至少 12 位。注册必须提交 8 位组织邀请码，先用 6 位邮箱验证码确认邮箱，再创建账号或把已有账号加入新组织。已有邮箱接受新邀请时必须输入原账号密码，忘记时先走密码重置。生产邮件已经通过 Resend 投递注册验证码、邮箱验证、邀请和密码重置。正式身份为 owner、super_admin、admin、member、organization_admin、organization_member。云端首次账号由服务器 `deploy/demo.env` 的 `BOOTSTRAP_*` 提供输入，但必须在 `db:migrate` 后显式执行 `accounts:init`；API/Worker 不会在生产自动创建账号。不要把真实密码写进仓库。

## 仓库结构

```text
apps/
  web/       用户创作端，React + Vite
  api/       版本化后端 API，Fastify + TypeScript
  admin/     独立管理员端，集中承载平台和组织后台能力
packages/
  contracts/ 前后端共享的 Zod 契约、角色和权限
docs/        架构、权限、规范和部署文档
deploy/      API/Web 容器、Caddy 配置和外测环境变量模板
```

## 常用命令

| 命令              | 说明                           |
| ----------------- | ------------------------------ |
| `pnpm dev`        | 同时启动 Web、API 和 Worker    |
| `pnpm dev:web`    | 只启动创作端                   |
| `pnpm dev:admin`  | 只启动独立管理员端             |
| `pnpm dev:api`    | 只启动 API                     |
| `pnpm dev:worker` | 只启动任务 Worker              |
| `pnpm test`       | 运行全部工作区测试             |
| `pnpm build`      | 构建全部可部署应用             |
| `pnpm check`      | 格式、Lint、测试和构建完整检查 |

## 外部测试部署

仓库包含 Google Compute Engine 单机 Demo 所需的 `compose.demo.yml`、API/Web Dockerfile、Caddy 自动 HTTPS 配置和无密钥环境变量模板。完整步骤、上线门槛、备份和回滚见 [外部测试部署](docs/DEPLOYMENT.md) 与 [备份与恢复流程](docs/BACKUP_RESTORE.md)。

该部署模式面向封闭外测：API 和 Web 同域，Postgres 承载账号/auth/账单账本和项目域数据，Redis/BullMQ 承载生成任务触发队列，媒体使用私有 GCS。Stripe test mode 支付沙箱已接入；正式商用前还必须完成正式价格/webhook endpoint、税务发票、邮件退信与投递失败告警、监控告警、数据导出/删除和备份恢复演练。

封闭外测默认开放账号密码登录和邀请码注册，不支持无邀请码自助注册。生产初始化按 `db:migrate -> accounts:init -> start` 创建 member、owner、super_admin 和 admin 账号，不写入演示项目；前端登录前只加载登录页，工作台页面按需下载，Compose 默认资源边界适配 2 vCPU / 4 GB 起步机器。

## 架构入口

- [文档索引](docs/README.md)
- [当前功能与生产状态](docs/CURRENT_STATE.md)
- [项目交接与快速上手](docs/HANDOFF_GUIDE.md)
- [总体架构](docs/ARCHITECTURE.md)
- [开发记忆与接手手册](docs/DEVELOPMENT_MEMORY.md)
- [认证与权限](docs/AUTHORIZATION.md)
- [正式权限矩阵](docs/PERMISSION_MATRIX.md)
- [资产生成与 Provider 接入](docs/ASSET_GENERATION.md)
- [代码规范](docs/CODE_STYLE.md)
- [部署边界](docs/DEPLOYMENT.md)
- [生产初始化 Runbook](docs/PRODUCTION_INITIALIZATION.md)
- [备份与恢复流程](docs/BACKUP_RESTORE.md)
- [支付沙箱与账单闭环](docs/BILLING_PAYMENTS.md)
- [组织概念迁移说明](docs/ORGANIZATION_MIGRATION.md)
- [CI/CD 与模块化发布](docs/CICD.md)
- [生产运维 Runbook](docs/OPERATIONS_RUNBOOK.md)
- [参与开发](CONTRIBUTING.md)
- [第三方素材说明](THIRD_PARTY_NOTICES.md)

## 已实现功能

- 登录、退出、会话恢复，以及普通用户和管理员权限隔离
- 项目创建与设置、剧本编辑、人物/场景/物品/服装/音频资产管理、分镜编辑和成片版本保存
- 概览页编辑故事简介；剧本后台智能生成会同时补齐剧情、场次动作、对白/画外音/独白、构图、光影、运镜与衔接，不再提供独立视觉补齐或场景/角色/对白结构块按钮
- 剧本后台重新生成、按意见改写、续写下一段/集和后台资产建议；完成或失败后通过消息中心提示
- 本地媒体导入、三张参考图、中文提示词编译，以及面部/全身定稿和单张三视图设定表
- 弦序可信人像：AI 仿真人 AIGC 入库、已授权真人 Asset ID 绑定、状态校验和视频 `asset://` 引用
- Rehdasu GLM/Kimi 与 TokenAdvent GPT 文本路由、TokenAdvent GPT Image 2 图片/分镜静帧，以及弦序 Seedance 参考资产视频生成、清晰度选择与单镜头播放
- 分镜连续性工作台：独立切镜或承接上一镜头尾帧；Seedance 完成后保存末帧，连续镜头自动等待，独立镜头仍按套餐并发
- 分镜默认按场次一场一镜，保持 4 到 15 秒时长预算；只有用户主动选择高级动作细拆时，才把明确标记的动作节拍拆为多个镜头，且不会按逗号制造重复镜头
- 图片和视频服务端质量规则编译（`quality-floor-v1`），支持人物、场景、仿真人视频、广告和自定义负面提示词
- 按分镜顺序把全部已完成的 Seedance 镜头合成为一个完整 MP4 预览，支持 `9:16`、`16:9`、`1:1` 且不重复扣除积分
- 服务端生成队列、单任务暂停/继续/软删除、免费用户单任务并发、会员三任务并发、积分扣减、失败或删除等待任务自动退款与流水
- 管理概览、用户和任务统计，以及服务端管理员权限校验
- Postgres migration 体系、`schema_migrations` 执行记录、dev/test 自动迁移、production 启动只检查 migration 是否最新
- Postgres 账号体系：`users`、`auth_identities`、`sessions`、`tenant_memberships`、`billing_accounts`、密码重置 token 和审计日志；`tenant*` 是当前数据库兼容命名，对外产品概念统一为组织
- 组织管理：切换、改名、禁用、更换组织负责人、退出组织
- 账号管理页：只有 owner/super_admin/admin/organization_admin 看到管理员端入口；普通成员和组织成员只看到个人资料；变更权限、禁用和踢下线操作均要求二次确认
- 独立 `apps/admin` 管理员端：通过 `/api/v1/auth/me` 鉴权，首屏消费 `/api/v1/admin/console`，展示用户、组织、membership、账单、session 和审计日志
- 生产 Web 镜像同时发布管理员端到 `/admin/`，Caddy `forward_auth` 与 API 权限双重保护；普通账号不能直接访问
- Admin Console API：统一查询用户、组织、membership、账单账户、账单流水、session 和审计日志；支持账号启停、管理员充值/调账、撤销 session
- DB billing ledger：幂等扣费、退款、充值和管理员调账在 Postgres 事务中完成，JSON ledger 仅保留为历史备份

当前版本已将账号/auth/组织边界/账单账本、项目、资产、分镜和生成任务迁入 Postgres；API 进程负责 HTTP 和业务编排，任务触发通过 BullMQ/Redis 进入 `apps/api/src/worker.ts` 执行。JSON store 仅保留本地媒体索引、Demo 兼容和迁移备份用途。下一步生产化重点是正式 Stripe 价格与 webhook endpoint、税务/发票/通知、监控告警和 Worker 横向扩缩容验证。

项目库“对话一句成片 / 图片大师 / 剧本大师”、小说上传与章节、长剧本创作目前在 UI 中明确标记开发中。后端存在 quick-start 和小说实验接口不代表客户入口已交付。Seedance 单镜头请求会启用音频，但 FFmpeg 完整成片当前会移除音轨，完整预览仍是无声工作版。

## API 范围

所有业务接口位于 `/api/v1`：

- `/auth/*`：登录、退出、当前会话、修改密码、忘记密码请求、密码重置、个人 session 列表和撤销
- `/auth/registration-code/request`、`/auth/register`：8 位邀请码、受邀邮箱、6 位邮箱验证码、姓名和密码注册；`/auth/invitations/accept` 保留为兼容入口
- `/organizations/*`：创建、切换、改名、禁用、更换组织负责人、退出组织
- `/organizations/:organizationId/*`：成员、角色、禁用 membership、创建组织用户、组织负责人更换、邀请和组织 session 管理
- `/workspaces/*`、`/tenants/:tenantId/*`：旧兼容入口并返回 `Deprecation: true`，新代码必须使用 `/organizations/*`
- `/projects/*`：项目、版本、剧本、资产和分镜
- `/projects/:projectId/script/generate`、`/script/enrich`、`/script/asset-suggestions`：兼容的同步 Service 入口；正式 UI 通过 `/generation/tasks` 创建后台 `text` 任务
- `/projects/:projectId/media`、`/media/*`：媒体上传与读取
- `/generation/*`：生成任务创建、查询和清理
- `/projects/:projectId/film-preview`：创建或复用完整成片预览
- `/billing/*`：套餐、积分余额、月度用量、Postgres 账本摘要、Stripe checkout、支付 webhook 和禁止前端自助改套餐的兼容拦截
- `/admin/*`：仅 owner、super_admin、admin、organization_admin 按权限边界访问的平台/组织后台；提供统一后台查询、账号启停、账单查询/充值/调账、支付对账、session 撤销和审计日志；组织管理新入口为 `/admin/organizations/*`，`/admin/tenants/*` 保留兼容并返回 `Deprecation: true`
