# SEQORA Agent 接手规则

本文是代码 Agent、自动化开发工具和新工程师进入仓库后的第一入口。目标是让接手者在不依赖聊天上下文的情况下，能够安全地开发新模块、修改现有模块并处理生产运维。

## 开始前必读

按顺序阅读：

1. `docs/CURRENT_STATE.md`：当前真正开放的功能、占位功能、生产状态和已知风险。
2. `docs/HANDOFF_GUIDE.md`：产品流程、技术栈和核心链路。
3. `docs/README.md`：按任务选择专项文档。
4. 目标模块的 contracts、Service、Repository、页面和测试。
5. `docs/DEVELOPMENT_MEMORY.md`：只在需要历史决策和事故背景时查阅。

文档冲突时，事实优先级是：

```text
共享 contracts / migration
  -> 后端 Service 与 Repository
  -> 前端真实可交互入口
  -> docs/CURRENT_STATE.md
  -> 专项设计文档
  -> DEVELOPMENT_MEMORY 历史记录
```

发现冲突时不要沿用旧文档猜测实现，应核对代码并在同一改动中修正文档。

## 产品边界

SEQORA 是面向网剧、广告和短片的 AIGC 视频制作 Agent。当前主流程是：

```text
邀请码注册/登录 -> 项目库 -> 剧本 -> 资产 -> 分镜/分集 -> 生成队列 -> 成片预览
```

产品目标是让非专业用户按场次完成影片，不是复制专业剪辑软件。界面应降低选择成本，同时保留可追溯的资产、提示词、任务、积分和版本。

以下入口当前只是 UI 或实验能力，不得写成已交付：

- 项目库“对话一句成片 / 图片大师 / 剧本大师”功能栈。
- 剧本页“小说上传与章节”“长剧本创作”正式用户流程。
- 音频资产 AI 生成、配音、字幕、混音和正式交付导出。
- Nano Banana 图片 Provider。
- 正式商用支付、发票、税务和用户数据导出/删除。

## 仓库与模块

```text
apps/web/       React 19 + Vite 8 创作端
apps/admin/     独立 React 管理端，生产挂载在 /admin/
apps/api/       Fastify 5 API、Worker、migration 和 Provider
packages/contracts/  前后端共享 Zod 契约、角色和权限
packages/prompting/  图片/视频提示词与质量规则
docs/           当前状态、架构、专项设计与运维
deploy/         Docker、Caddy、GCE、发布和回滚脚本
scripts/        开发、监控、压测和安全工具
```

后端正式边界只有八个：Identity & Access、Organizations、Billing、Creative Projects、Jobs/Workers、Media Storage、Admin Console、Observability/Ops。详细归属见 `docs/BACKEND_BOUNDARIES.md`。

新增接口的顺序：

1. 修改 `packages/contracts` Schema 和测试。
2. 修改目标模块 Repository/Service。
3. 在 Route 中只做输入校验、权限和 HTTP 映射。
4. 修改 `apps/web/src/services/apiClient.js` 或管理员端客户端。
5. 接入页面状态和失败路径。
6. 补对应层级测试和文档。

禁止在 Web 中直接调用第三方 Provider。密钥、权限、积分、任务状态、并发和组织隔离都由 API/Worker 决定。

## 关键不变量

- 对外叫“组织”，数据库兼容字段仍可能叫 `tenantId`；所有项目、媒体、任务和账单查询必须保留组织过滤。
- 业务数据以 Postgres 为准；JSON Store 只承载本地兼容、媒体索引和历史迁移输入。
- migration 只能新增，不能修改或删除已提交 migration。
- 任务状态固定为 `queued | paused | running | completed | failed | cancelled`。
- 结束任务的“清理”写 `queueHiddenAt`，不能物理删除输出依赖。
- 只有等待任务可以本地暂停；运行中的 StringX 视频必须远端取消成功后才能取消和退款。
- `local-compose` 不扣积分，不占 Seedance 并发。
- 当前有效并发是免费 1、会员 3；演示不限并发环境变量尚未接入账单摘要，不得假设有效。
- 分镜图片不是视频前置条件；已有匹配图片时可以作为参考，没有图片时直接使用资产或纯文本。
- 网剧镜头按 3 到 15 秒规范化，其他内容按 4 到 15 秒规范化；单集目标时长是 30 到 300 秒。
- Seedance 单镜头请求启用音频，但 FFmpeg 完整成片合成当前使用 `-an`，所以完整预览仍是无声版本。
- 图片 Provider 当前只有 TokenAdvent GPT Image 2；Nano Banana 选择项处于未配置禁用状态。
- 用户密码契约最少 8 位；生产 bootstrap 密码配置仍要求至少 12 位。
- 新注册使用 8 位数字邀请码和 6 位邮箱验证码。已有账号接受新组织邀请时，密码栏必须输入原账号密码；忘记时先重置密码。
- 管理员页面必须同时经过 Caddy `/admin/` 的 `forward_auth` 和后端 `/api/v1/admin/*` 权限检查。

## 本地运行

要求 Node.js 22.12+、pnpm 11+。完整环境推荐 Docker Desktop；完整成片还需要 FFmpeg。

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会自动判断环境：

- Docker 可用：启动 Postgres、Redis、Web、Admin、API 和独立 Worker。
- Docker 不可用且没有外部数据库：使用 JSON Store 和 API 内联队列；登录与生成开发可用，但邀请码注册和完整 Postgres 业务不可用。

本地地址：创作端 `http://localhost:5173`，管理员端 `http://localhost:5174`，API `http://localhost:8787/api/v1`。

## 修改前后检查

开始时：

```powershell
git status --short --branch
git log -5 --oneline
```

不要覆盖未提交改动，不要读取或输出 `apps/api/.env`、`deploy/demo.env`、Cookie、Provider Key 或用户媒体。

最小验证矩阵：

| 改动                   | 必须验证                                                               |
| ---------------------- | ---------------------------------------------------------------------- |
| Web 页面               | 对应 Vitest、`pnpm --filter @seqora/web lint`、Web build、桌面和移动端 |
| Admin                  | Admin test/lint/build，普通用户不能进入 `/admin/`                      |
| Contracts              | contracts test/build，并同步 API/Web 调用方                            |
| API 业务               | 对应单元/集成测试、lint、build                                         |
| migration/auth/billing | Postgres 集成测试和安全测试                                            |
| Worker/队列            | 任务幂等、退款、恢复、依赖和 BullMQ 测试                               |
| Provider               | 使用测试替身；真实付费调用必须由用户明确批准                           |
| 部署                   | migration、readiness、未登录 401、Admin 防护和业务冒烟                 |

提交前完整检查：

```powershell
pnpm check
git diff --check
```

## 生产规则

当前生产域名是 `https://zjh.ai`，运行在 GCE 单机 Docker Compose。安全的实例、路径、发布和故障处理命令见 `docs/OPERATIONS_RUNBOOK.md`。

- `/opt/seqora` 当前是源码包部署目录，不包含 `.git`；不要在服务器执行 `git pull`。
- 优先使用验证后的 CI/CD 镜像发布；人工回退使用 `deploy/package.ps1`、GCloud SCP 和 `deploy/update-source.sh`。
- 更新 API 前必须先执行 migration。生产进程只检查 migration，不自动改库。
- 更新前备份；健康检查失败必须回滚，不允许带病继续。
- 不打印 `deploy/demo.env`，不把真实密钥写进文档、Git、镜像或前端变量。
- 不直接改 Postgres 用户、积分或任务状态；使用管理 API、Service 或受审计脚本。

## 完成定义

任务完成必须同时满足：行为已实现、失败与空状态可用、权限和组织隔离未绕过、测试通过、文档同步、没有密钥和运行数据进入 Git。涉及用户流程时，应说明哪些是已开放、实验或待开发，不能用 UI 占位冒充闭环。
