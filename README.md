# 序幕 SEQORA

前后端分离的 AIGC 影视创作平台 Monorepo。创作端、API、共享契约和未来管理员端拥有独立边界，可以分别开发和部署。

## 快速开始

要求 Node.js 22.13+、pnpm 11+。

```bash
corepack enable
pnpm install
pnpm dev
```

- 创作端：[http://localhost:5173](http://localhost:5173)
- API 健康检查：[http://localhost:8787/api/v1/health](http://localhost:8787/api/v1/health)

首次启动会自动创建两个本地演示账号：

| 身份   | 邮箱                   | 密码          |
| ------ | ---------------------- | ------------- |
| 创作者 | `creator@seqora.local` | `Creator123!` |
| 管理员 | `admin@seqora.local`   | `Admin123!`   |

认证使用经 `scrypt` 哈希的密码和签名 HttpOnly 会话 Cookie。开发数据持久化在 `apps/api/data/app.json`，该文件已被 Git 忽略；删除它并重启 API 即可恢复初始数据。
本地 JSON 仅用于开发和演示，生产环境需要按 [PostgreSQL 迁移方案](docs/POSTGRES_MIGRATION.md) 落库。

## 仓库结构

```text
apps/
  web/       用户创作端，React + Vite
  api/       版本化后端 API，Fastify + TypeScript
  admin/     独立管理员端预留边界
packages/
  contracts/ 前后端共享的 Zod 契约、角色和权限
docs/        架构、权限、规范和部署文档
```

## 常用命令

| 命令                    | 说明                                   |
| ----------------------- | -------------------------------------- |
| `pnpm dev`              | 同时启动 Web 和 API                    |
| `pnpm dev:web`          | 只启动创作端                           |
| `pnpm dev:api`          | 只启动 API                             |
| `pnpm test`             | 运行全部工作区测试                     |
| `pnpm build`            | 构建全部可部署应用                     |
| `pnpm build:production` | 构建 Contracts、API 和 Web 生产产物    |
| `pnpm check`            | 提交前标准：格式、Lint、生产构建和测试 |

## 架构入口

- [总体架构](docs/ARCHITECTURE.md)
- [认证与权限](docs/AUTHORIZATION.md)
- [资产生成与 Provider 接入](docs/ASSET_GENERATION.md)
- [PostgreSQL 迁移方案](docs/POSTGRES_MIGRATION.md)
- [密钥管理](docs/SECRETS.md)
- [代码规范](docs/CODE_STYLE.md)
- [部署边界](docs/DEPLOYMENT.md)
- [参与开发](CONTRIBUTING.md)
- [第三方素材说明](THIRD_PARTY_NOTICES.md)

## 已实现功能

- 登录、退出、会话恢复，以及创作者和管理员权限隔离
- 项目创建与设置、剧本编辑、人物/场景/物品/服装/音频资产管理、分镜编辑和成片版本保存
- 本地媒体导入、三张参考图、中文提示词编译，以及面部/全身定稿和单张三视图设定表
- 服务端生成队列、免费用户单任务并发、会员三任务并发、积分扣减与流水
- 管理概览、用户和任务统计，以及服务端管理员权限校验

当前版本使用本地 JSON 仓储和进程内任务执行器，适合直接演示和三人团队并行开发。JSON 只作为本地数据源保留；多人真实项目和部署环境必须迁移到 PostgreSQL，具体表结构、步骤和验收标准见 [PostgreSQL 迁移方案](docs/POSTGRES_MIGRATION.md)。任务分发器和认证提供方后续可分别替换为 Redis/消息队列和 OIDC，而不改变前端 API 契约。

## API 范围

所有业务接口位于 `/api/v1`：

- `/auth/*`：登录、退出和当前会话
- `/projects/*`：项目、版本、剧本、资产和分镜
- `/projects/:projectId/media`、`/media/*`：媒体上传与读取
- `/generation/*`：生成任务创建、查询和清理
- `/billing/*`：套餐、积分余额和账本
- `/admin/*`：仅管理员可访问的平台概览
