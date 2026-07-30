# 序幕 SEQORA

前后端分离的 AIGC 影视创作平台 Monorepo。创作端、API、共享契约和未来管理员端拥有独立边界，可以分别开发和部署。

## 快速开始

要求 Node.js 22.12+、pnpm 11+、Docker 和 Docker Compose。完整成片预览还需要本机或 API 容器内可执行的 FFmpeg。

```bash
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` 会先启动 `compose.local.yml` 中的 Postgres dev 服务，再启动 Web、API 和 Worker。开发环境未显式设置 `DATABASE_URL` 时，API 默认使用 `postgres://seqora:seqora_dev_password@127.0.0.1:5432/seqora_dev`，并在启动时自动执行未执行的 migration。

- 创作端：[http://localhost:5173](http://localhost:5173)
- API 健康检查：[http://localhost:8787/api/v1/health](http://localhost:8787/api/v1/health)

## Provider routing

- `textProvider`: defaults to Rehdasu `glm-5.2` for Chinese understanding, summaries, scripts, and asset suggestions. `kimi-k3`、`kimi-k3-thinking`、`glm-5.2-fast`、DeepSeek V3 and SEQORA 5.4/5.5/5.6 remain selectable when their providers are configured.
- `imageProvider`: uses TokenAdvent GPT Image 2 / `image2` only for image asset generation and image edits.
- `videoProvider`: uses Seedance with `tier: mini | fast | pro`; the API stores the selected tier and the Provider maps it to the configured model.
- Secrets must stay in `apps/api/.env` or deployment secrets. Do not put API keys in code, frontend env, docs, or Git.

首次启动会自动创建三个本地演示账号：

| 身份   | 邮箱                   | 密码                |
| ------ | ---------------------- | ------------------- |
| 创作者 | `creator@seqora.local` | `Creator123!`       |
| 所有者 | `owner@seqora.local`   | `OwnerPassword123!` |
| 管理员 | `admin@seqora.local`   | `Admin123!`         |

认证使用经 `scrypt` 哈希的本地账号密码和签名 HttpOnly 会话 Cookie。账号、身份、会话、租户 membership、账单账户、账单流水、密码重置 token 和审计日志写入 Postgres；项目、资产、分镜、生成任务和本地媒体索引仍由 `apps/api/data/app.json` 与对象存储承载。`app.json` 已被 Git 忽略；删除它只会重置创作 Demo 数据，Postgres 账号数据需清理数据库或重建卷。

已有账号登录后在“项目设置 -> 账号安全”修改密码；新密码至少 12 位。当前注册入口开放但必须提交租户邀请码，邮箱需与邀请绑定邮箱一致；没有邀请码不能自助注册。owner/admin 可在账号管理页创建用户、添加成员、生成邀请、调整角色、禁用 membership、查看和撤销 session，并管理 workspace。密码重置 API 已具备后端能力；生产正式开放前还需要接入邮件/短信投递与运营流程。云端首次账号由服务器 `deploy/demo.env` 的 `BOOTSTRAP_*` 设置，并且只在空数据卷第一次启动时生效。不要把真实密码写进仓库。

## 仓库结构

```text
apps/
  web/       用户创作端，React + Vite
  api/       版本化后端 API，Fastify + TypeScript
  admin/     独立管理员端预留边界
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
| `pnpm dev:api`    | 只启动 API                     |
| `pnpm dev:worker` | 只启动任务 Worker              |
| `pnpm test`       | 运行全部工作区测试             |
| `pnpm build`      | 构建全部可部署应用             |
| `pnpm check`      | 格式、Lint、测试和构建完整检查 |

## 外部测试部署

仓库包含 Google Compute Engine 单机 Demo 所需的 `compose.demo.yml`、API/Web Dockerfile、Caddy 自动 HTTPS 配置和无密钥环境变量模板。完整步骤、上线门槛、备份和回滚见 [外部测试部署](docs/DEPLOYMENT.md)。

该部署模式面向封闭外测：API 和 Web 同域，Postgres 承载账号/auth/账单账本，JSON 数据卷仍承载项目、资产、分镜和生成任务，媒体使用私有 GCS。正式商用前还必须完成持久队列、独立 Worker、支付/订阅回调、邮件投递、监控告警、数据导出/删除和备份恢复演练。

封闭外测默认开放账号密码登录和邀请码注册，不支持无邀请码自助注册。生产首次启动创建创作者、owner 和管理员账号，不写入演示项目；前端登录前只加载登录页，工作台页面按需下载，Compose 默认资源边界适配 2 vCPU / 4 GB 起步机器。

## 架构入口

- [项目交接与快速上手](docs/HANDOFF_GUIDE.md)
- [总体架构](docs/ARCHITECTURE.md)
- [开发记忆与接手手册](docs/DEVELOPMENT_MEMORY.md)
- [认证与权限](docs/AUTHORIZATION.md)
- [资产生成与 Provider 接入](docs/ASSET_GENERATION.md)
- [代码规范](docs/CODE_STYLE.md)
- [部署边界](docs/DEPLOYMENT.md)
- [CI/CD 与模块化发布](docs/CICD.md)
- [参与开发](CONTRIBUTING.md)
- [第三方素材说明](THIRD_PARTY_NOTICES.md)

## 已实现功能

- 登录、退出、会话恢复，以及创作者和管理员权限隔离
- 项目创建与设置、剧本编辑、人物/场景/物品/服装/音频资产管理、分镜编辑和成片版本保存
- 概览页编辑故事简介；制作级 AI 深度扩写会补齐剧情、场景、角色、动作、对白、风格、构图、光影、运镜和衔接，另有场景/角色/对白结构块
- 剧本页“一键尝鲜”：自动保存当前剧本，分析 1-2 个主要人物、核心服装和核心场景，确认服务端积分与时间报价后批量创建并生成最小资产闭环
- 本地媒体导入、三张参考图、中文提示词编译，以及面部/全身定稿和单张三视图设定表
- 弦序可信人像：AI 仿真人 AIGC 入库、已授权真人 Asset ID 绑定、状态校验和视频 `asset://` 引用
- TokenAdvent 中文剧本和图片生成、分镜静帧，以及弦序 Seedance 参考资产视频生成、清晰度选择与单镜头播放
- 分镜连续性工作台：独立切镜或承接上一镜头尾帧；Seedance 完成后保存末帧，连续镜头自动等待，独立镜头仍按套餐并发
- 分镜同时支持按场次拆分、按动作节拍细拆和手动添加；动作级模式把一个场次拆为多个单动作镜头，不调用文本模型
- 图片和视频服务端质量规则编译（`quality-floor-v1`），支持人物、场景、仿真人视频、广告和自定义负面提示词
- 按分镜顺序把全部已完成的 Seedance 镜头合成为一个完整 MP4 预览，支持 `9:16`、`16:9`、`1:1` 且不重复扣除积分
- 服务端生成队列、单任务暂停/继续/软删除、免费用户单任务并发、会员三任务并发、积分扣减、失败或删除等待任务自动退款与流水
- 管理概览、用户和任务统计，以及服务端管理员权限校验
- Postgres migration 体系、`schema_migrations` 执行记录、dev/test 自动迁移、production 启动只检查 migration 是否最新
- Postgres 账号体系：`users`、`auth_identities`、`sessions`、`tenant_memberships`、`billing_accounts`、密码重置 token 和审计日志
- Workspace 管理：切换、改名、禁用、转让 owner、退出 workspace
- 账号管理页：只有 owner/admin 看到管理员端入口；普通成员只看到个人资料；变更权限、禁用和踢下线操作均要求二次确认
- Admin Console API：统一查询用户、租户、membership、账单账户、账单流水、session 和审计日志；支持账号启停、管理员充值/调账、撤销 session
- DB billing ledger：幂等扣费、退款、充值和管理员调账在 Postgres 事务中完成，JSON ledger 仅保留为历史备份

当前版本是混合持久化：账号/auth/租户/账单账本已迁入 Postgres；项目、资产、分镜、生成任务和 Worker 状态仍使用本地 JSON 仓储。API 进程负责 HTTP 和业务编排，`apps/api/src/worker.ts` 负责任务执行，适合封闭外测和三人团队并行开发。下一步生产化重点是把任务队列和项目域数据继续迁入正式数据库/队列。

## API 范围

所有业务接口位于 `/api/v1`：

- `/auth/*`：登录、退出、当前会话、修改密码、忘记密码请求、密码重置、个人 session 列表和撤销
- `/auth/register`：邀请码注册，必须提交邀请 token、受邀邮箱、姓名和密码；`/auth/invitations/accept` 保留为兼容的邀请接受入口
- `/workspaces/*`：创建、切换、改名、禁用、转让 owner、退出 workspace
- `/tenants/:tenantId/*`：成员、角色、禁用 membership、创建租户用户、邀请和租户 session 管理
- `/projects/*`：项目、版本、剧本、资产和分镜
- `/projects/:projectId/script/generate`、`/script/enrich`、`/script/asset-suggestions`：剧本生成、AI 扩写和资产建议
- `/projects/:projectId/media`、`/media/*`：媒体上传与读取
- `/generation/*`：生成任务创建、查询和清理
- `/projects/:projectId/film-preview`：创建或复用完整成片预览
- `/billing/*`：套餐、积分余额、月度用量和 Postgres 账本摘要
- `/admin/*`：仅 owner/admin 可访问的平台概览、统一后台查询、账号启停、账单查询/充值/调账、session 撤销和审计日志
