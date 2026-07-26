# 序幕 SEQORA

前后端分离的 AIGC 影视创作平台 Monorepo。创作端、API、共享契约和未来管理员端拥有独立边界，可以分别开发和部署。

## 快速开始

要求 Node.js 22.12+、pnpm 11+。完整成片预览还需要本机或 API 容器内可执行的 FFmpeg。

```bash
corepack enable
pnpm install
pnpm dev
# 另开一个终端启动任务 worker
pnpm --filter @seqora/api worker
```

- 创作端：[http://localhost:5173](http://localhost:5173)
- API 健康检查：[http://localhost:8787/api/v1/health](http://localhost:8787/api/v1/health)

## Provider routing

- `textProvider`: defaults to DeepSeek V3 for Chinese understanding, summaries, scripts, and asset suggestions. GPT `5.4` / `5.5` / `5.6` remain selectable fallbacks.
- `imageProvider`: uses TokenAdvent GPT Image 2 / `image2` only for image asset generation and image edits.
- `videoProvider`: uses Seedance with `tier: mini | fast | pro`; the API stores the selected tier and the Provider maps it to the configured model.
- Secrets must stay in `apps/api/.env` or deployment secrets. Do not put API keys in code, frontend env, docs, or Git.

首次启动会自动创建两个本地演示账号：

| 身份   | 邮箱                   | 密码          |
| ------ | ---------------------- | ------------- |
| 创作者 | `creator@seqora.local` | `Creator123!` |
| 管理员 | `admin@seqora.local`   | `Admin123!`   |

认证使用经 `scrypt` 哈希的密码和签名 HttpOnly 会话 Cookie。开发数据持久化在 `apps/api/data/app.json`，该文件已被 Git 忽略；删除它并重启 API 即可恢复初始数据。

已有账号登录后在“项目设置 -> 账号安全”修改密码；新密码至少 12 位。云端首次账号由服务器 `deploy/demo.env` 的 `BOOTSTRAP_*` 设置，并且只在空数据卷第一次启动时生效。不要把真实密码写进仓库。

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

| 命令                               | 说明                           |
| ---------------------------------- | ------------------------------ |
| `pnpm dev`                         | 同时启动 Web 和 API            |
| `pnpm dev:web`                     | 只启动创作端                   |
| `pnpm dev:api`                     | 只启动 API                     |
| `pnpm --filter @seqora/api worker` | 启动任务 worker                |
| `pnpm test`                        | 运行全部工作区测试             |
| `pnpm build`                       | 构建全部可部署应用             |
| `pnpm check`                       | 格式、Lint、测试和构建完整检查 |

## 外部测试部署

仓库包含 Google Compute Engine 单机 Demo 所需的 `compose.demo.yml`、API/Web Dockerfile、Caddy 自动 HTTPS 配置和无密钥环境变量模板。完整步骤、上线门槛、备份和回滚见 [外部测试部署](docs/DEPLOYMENT.md)。

该部署模式面向封闭外测：API 和 Web 同域、JSON 数据使用持久卷、媒体使用私有 GCS。正式客户商用前必须迁移 PostgreSQL、持久队列和邀请制账号体系。

封闭外测默认只开放账号密码登录，不提供注册入口。生产首次启动创建一组创作者账号和一组管理员账号，不写入演示项目；前端登录前只加载登录页，工作台页面按需下载，Compose 默认资源边界适配 2 vCPU / 4 GB 起步机器。

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
- 概览页编辑故事简介；制作级 AI 深度扩写会补齐剧情、场景、角色、动作、对白、风格、构图、光影、运镜和衔接，另有场景/角色/对白结构块与会员专业审核
- 剧本页“一键尝鲜”：自动保存当前剧本，分析 1-2 个主要人物、核心服装和核心场景，确认服务端积分与时间报价后批量创建并生成最小资产闭环
- 本地媒体导入、三张参考图、中文提示词编译，以及面部/全身定稿和单张三视图设定表
- 弦序可信人像：AI 仿真人 AIGC 入库、已授权真人 Asset ID 绑定、状态校验和视频 `asset://` 引用
- TokenAdvent 中文剧本和图片生成、分镜静帧，以及弦序 Seedance 参考资产视频生成、清晰度选择与单镜头播放
- 分镜连续性工作台：独立切镜或承接上一镜头尾帧；Aideos 完成后由 FFmpeg 提取并保存末帧，连续镜头自动等待，独立镜头仍按套餐并发
- 分镜同时支持按场次拆分、按动作节拍细拆和手动添加；动作级模式把一个场次拆为多个单动作镜头，不调用文本模型
- 图片和视频服务端质量规则编译（`quality-floor-v1`），支持人物、场景、仿真人视频、广告和自定义负面提示词
- 按分镜顺序把全部已完成的 Seedance 镜头合成为一个完整 MP4 预览，支持 `9:16`、`16:9`、`1:1` 且不重复扣除积分
- 服务端生成队列、单任务暂停/继续/软删除、免费用户单任务并发、会员三任务并发、积分扣减、失败或删除等待任务自动退款与流水
- 管理概览、用户和任务统计，以及服务端管理员权限校验

当前版本使用本地 JSON 仓储，API 进程只负责 HTTP 和业务编排，`apps/api/src/worker.ts` 负责任务执行，适合直接演示和三人团队并行开发。仓储、任务分发器和认证提供方均保留清晰接口，后续可分别替换为 PostgreSQL、Redis/消息队列和 OIDC，而不改变前端 API 契约。

## API 范围

所有业务接口位于 `/api/v1`：

- `/auth/*`：登录、退出、当前会话和修改密码
- `/projects/*`：项目、版本、剧本、资产和分镜
- `/projects/:projectId/script/review`：会员专属七维剧本专业审核
- `/projects/:projectId/media`、`/media/*`：媒体上传与读取
- `/generation/*`：生成任务创建、查询和清理
- `/projects/:projectId/film-preview`：创建或复用完整成片预览
- `/billing/*`：套餐、积分余额和账本
- `/admin/*`：仅管理员可访问的平台概览
