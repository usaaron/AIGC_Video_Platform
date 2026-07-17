# 序幕 SEQORA

前后端分离的 AIGC 影视创作平台 Monorepo。创作端、API、共享契约和未来管理员端拥有独立边界，可以分别开发和部署。

## 快速开始

要求 Node.js 22.12+、pnpm 11+。

```bash
corepack enable
pnpm install
pnpm dev
```

- 创作端：[http://localhost:5173](http://localhost:5173)
- API 健康检查：[http://localhost:8787/api/v1/health](http://localhost:8787/api/v1/health)

开发环境默认使用 Demo 认证。生产环境会拒绝以 Demo 认证启动。

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

| 命令           | 说明                           |
| -------------- | ------------------------------ |
| `pnpm dev`     | 同时启动 Web 和 API            |
| `pnpm dev:web` | 只启动创作端                   |
| `pnpm dev:api` | 只启动 API                     |
| `pnpm test`    | 运行全部工作区测试             |
| `pnpm build`   | 构建全部可部署应用             |
| `pnpm check`   | 格式、Lint、测试和构建完整检查 |

## 架构入口

- [总体架构](docs/ARCHITECTURE.md)
- [认证与权限](docs/AUTHORIZATION.md)
- [代码规范](docs/CODE_STYLE.md)
- [部署边界](docs/DEPLOYMENT.md)
- [参与开发](CONTRIBUTING.md)
- [第三方素材说明](THIRD_PARTY_NOTICES.md)

任务、积分和媒体结果目前仍使用 Demo 适配器。仓储、积分账本、任务分发器和认证提供方均已定义接口，可分别替换为 PostgreSQL、Redis/消息队列和 OIDC 实现。
