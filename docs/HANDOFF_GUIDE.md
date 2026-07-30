# SEQORA 项目交接与快速上手

这份文档是新开发者的第一入口。目标是在 30 分钟内理解产品、启动项目、找到关键代码，并知道哪些边界不能随意修改。

## 1. 项目是什么

SEQORA 是面向漫剧、短剧和动画短片团队的一站式 AIGC 视频生成工作台。它不是专业剪辑软件，而是把复杂能力收敛成固定流程，让普通测试者按照页面顺序完成：

```text
登录 -> 项目与比例 -> 剧本 -> 资产 -> 分镜 -> 视频队列 -> 完整成片
```

当前 Demo 已跑通除音频外的主要闭环：

- 中文剧本快速生成、主动补齐制作视觉维度、结构块插入和资产建议。
- 人物、场景、物品和服装资产；人物包含面部、全身、腿部优化和三视图流程。
- TokenAdvent 文本与图片生成。
- 弦序 Seedance 2.0 视频生成、任务轮询、取消、失败退款和可信人像素材库。
- 分镜按场次或动作拆分、资产匹配、尾帧承接和会员三路并发。
- FFmpeg 按分镜顺序合成无声完整 MP4 预览。

尚未完成正式音频、支付、邮件/短信投递、项目域数据全面数据库化、持久消息队列和正式商用监控。账号/auth、租户 membership、session、账单账户、账单流水、密码重置 token 和审计日志已经迁入 Postgres；项目、资产、分镜、生成任务和 Worker 状态仍是 JSON + 单实例进程内调度。当前定位是封闭客户测试和小团队联合开发。

## 2. 收到压缩包后先做什么

1. 将压缩包解压到一个不含同步盘冲突的本地目录。
2. 安装 Node.js `>=22.12`、pnpm `>=11` 和带 `libx264` 的 FFmpeg。
3. 在项目根目录运行 `pnpm install --frozen-lockfile`。
4. 运行 `pnpm check`，确认格式、Lint、测试和生产构建全部通过。
5. 运行 `pnpm dev`，打开 `http://localhost:5173`。
6. 阅读本文件后，再读 `docs/DEVELOPMENT_MEMORY.md` 和目标模块源码。

常用命令：

| 命令              | 用途                        |
| ----------------- | --------------------------- |
| `pnpm dev`        | 同时启动 Web、API 和 Worker |
| `pnpm dev:web`    | 仅启动 Vite Web             |
| `pnpm dev:api`    | 构建共享包并启动 API        |
| `pnpm dev:worker` | 构建共享包并启动 Worker     |
| `pnpm test`       | 运行全部测试                |
| `pnpm build`      | 构建全部工作区              |
| `pnpm check`      | 提交前完整检查              |

本地端口：Web `5173`，API `8787`。Vite 将 `/api` 代理到本地 API。

## 3. 交接包中的敏感内容

可信交接完整版可能包含以下 Git 忽略文件：

- `apps/api/.env`：本地 Provider 密钥和运行配置。
- `deploy/demo.env`：云端域名、部署账号和生产 Provider 配置。
- `apps/api/data/app.json`：本地账号哈希、项目、资产、任务和积分账本。
- `apps/api/data/uploads/`：用户上传和本地生成媒体。

这些文件用于在受信任人员之间恢复当前状态，**绝不能提交到 Git、上传公开网盘或转发给无关人员**。接收方应限制文件权限，使用结束后轮换 API Key 和账号密码。`.env.example` 与 `deploy/demo.env.example` 才是可提交模板。

`BOOTSTRAP_*` 只在 `app.json` 不存在时创建账号。修改环境变量不会修改已有数据中的密码；已有账号需要在“项目设置 -> 账号安全”修改。

## 4. Monorepo 结构

```text
apps/
  web/        React 19 + Vite 8 创作端
  api/        Fastify 5 + TypeScript API 与进程内 Worker
  admin/      未来独立管理员端边界占位；当前后台入口临时在 Web 内
packages/
  contracts/  前后端共享 Zod Schema、实体、角色和权限
  prompting/  图片/视频提示词与质量规则编译
docs/         架构、Provider、部署、规范和长期开发记忆
deploy/       Dockerfile、Caddy、GCE 和更新脚本
```

依赖方向应保持为：

```text
apps/web -----> packages/contracts <----- apps/api
    |                   ^                    |
    +-----> packages/prompting <-------------+
```

Web 不直接访问第三方 Provider。API Key、积分、权限、并发和真实任务状态都由服务端控制。

## 5. 后端分层

API 入口是 `apps/api/src/app.ts`，配置入口是 `apps/api/src/config.ts`。

每个业务模块遵守以下分层：

```text
Route -> Service -> Repository / Provider -> AppStore / 外部 API
```

- `routes.ts`：Zod 输入校验、权限和 HTTP 映射。
- `service.ts`：业务编排，不直接依赖页面。
- `repository.ts`：带用户、租户和项目边界的数据读写。
- `core/generation/`：TokenAdvent、弦序、官方方舟等 Provider 适配器。
- `core/jobs/taskDispatcher.ts`：任务依赖、套餐并发、提交、轮询、失败和退款。
- `core/film/`：下载分镜视频并调用 FFmpeg 合成完整预览。
- `infra/postgres.ts`：Postgres migration、`schema_migrations` 和事务工具。
- `infra/store.ts`：项目、资产、分镜、生成任务和兼容备份的 JSON 状态仓储。
- `infra/objectStorage.ts`：本地文件或 GCS 的统一对象存储接口。
- `modules/accountManagement`：邀请码注册、workspace、成员、角色、tenant session 和受控邀请。
- `modules/admin`：统一后台查询、账号启停、账单、session 和审计日志。
- `modules/billing`：Postgres ledger，扣费、退款、充值和管理员调账。

新增接口时，先修改 `packages/contracts` 的 Schema，再改 API 和 Web。不要在两端复制枚举或手写不一致的请求类型。

## 6. 前端结构

`apps/web/src/App.jsx` 是当前流程编排层，负责加载项目、任务和账单，并把 API 操作传给各页面。

- `pages/`：项目概览、剧本、资产、分镜、队列、成片、账单和设置。
- `features/assets/`：资产草稿、结构化字段、提示词和人物阶段工作流。
- `features/storyboard/`：资产参考选择和批量视频链路规划。
- `features/film/`：完整成片与单镜头选择逻辑。
- `services/apiClient.js`：唯一的前端 API 客户端。
- `components/AuthProvider.jsx`：会话恢复、登录、退出和 `401` 处理。

页面保持中文、清晰和低学习成本。不要把专业剪辑软件的复杂轨道、面板和术语直接搬进来。UI 修改至少验证桌面和 `390px` 移动宽度，无横向溢出和内容遮挡。

## 7. 核心数据模型

当前状态分为 Postgres、JSON 和对象存储三类。

Postgres：

- `users` / `auth_identities`：账号和本地登录身份。
- `sessions`：HttpOnly Cookie 对应的服务端 session、设备信息、撤销状态和过期时间。
- `tenants` / `tenant_memberships`：workspace、角色、状态和主 workspace。
- `billing_accounts` / `billing_ledger_entries`：套餐、余额、幂等扣费、退款、充值和调账流水。
- `password_reset_tokens`：忘记密码 token。
- `audit_log_entries`：账号、成员、workspace、session、账单等敏感操作审计。

JSON `apps/api/data/app.json`：

- `Project`：名称、内容类型、比例、简介、剧本和版本。
- `Asset`：人物、场景、物品、服装或音频及其结构化属性。
- `Shot`：顺序、景别、时长、提示词、分镜图和连续模式。
- `GenerationTask`：Provider、模型、依赖、状态、积分、输出和错误。
- `Media`：上传文件元数据和对象存储位置。
- 兼容镜像：账号和 ledger 的历史 JSON 备份，不再作为 Postgres 账号/账本业务来源。

任务状态包括 `queued`、`paused`、`running`、`completed`、`failed` 和 `cancelled`。任务归档只写 `queueHiddenAt`，不能物理删除已完成任务，否则资产和视频输出 URL 会失效。

## 8. 真实生成链路

### 文本和图片

剧本和 Img2 图片默认调用 TokenAdvent。图片结果写入对象存储，完成后同步更新对应 `asset.imageUrl` 或 `shot.imageUrl`。

### 视频

视频默认调用弦序 StringX Seedance 2.0：

1. Web 根据项目、当前镜头和匹配资产编译提示词。
2. API 创建任务、幂等预扣积分并记录依赖。
3. Worker 再按服务端真实项目数据编译一次提示词和负面质量规则。
4. Worker 按套餐槽位向弦序提交，保存 `providerTaskId`。
5. 后续 tick 轮询状态，完成后代理视频并保存末帧。
6. 失败任务自动创建幂等退款流水。

官方方舟保留为显式回滚 Provider；当前视频主链路使用弦序 StringX Seedance。

### 连续性与三路并发

- `independent`：独立切镜，不依赖上一任务。
- `continue`：等待上一视频完成并使用其 `last-frame` 约束下一镜头。
- 免费账号最多 1 个远端运行任务，会员最多 3 个。
- “并发优先”把长连续链均衡拆为最多 3 条链，链内仍按尾帧顺序生成。
- “连续优先”保留现有镜头依赖，不为了并发破坏衔接。

批量规划位于 `apps/web/src/features/storyboard/videoBatchPlanner.js`。后端最终限制位于 `apps/api/src/core/jobs/taskDispatcher.ts`。不要在前端循环里无条件把每个任务依赖到前一个任务，否则会让会员三并发重新退化为单路。

## 9. 完整成片

每个分镜必须有一个真实完成的视频任务。`FilmPreviewComposer` 按镜头顺序下载视频，统一比例、尺寸、帧率和 H.264 编码，再拼成一个无声 MP4。`local-compose` 不扣积分，也不占 Seedance 并发。

当前成片是测试预览，不包含配音、背景音乐、字幕、响度、正式码率和交付封装，不能当作商用母版。

## 10. 如何修改常见功能

| 需求                   | 优先查看                                                                |
| ---------------------- | ----------------------------------------------------------------------- |
| 新增项目/资产/分镜字段 | `packages/contracts/src/project.ts`、项目 Repository、对应页面          |
| 修改登录和账号         | `modules/auth/`、`AuthProvider.jsx`、`LoginPage.jsx`                    |
| 修改积分、套餐或退款   | `modules/billing/`、`modules/generation/`、`taskDispatcher.ts`          |
| 修改图片生成           | `core/generation/tokenAdventImageProvider.ts`、资产功能目录             |
| 修改视频请求           | `stringXSeedanceProvider.ts`、`taskDispatcher.ts`、`packages/prompting` |
| 修改分镜拆分           | `modules/projects/service.ts`、`StoryboardPage.jsx`                     |
| 修改三路并发           | `videoBatchPlanner.js`、`taskDispatcher.ts`，两端测试必须同时更新       |
| 修改完整成片           | `core/film/`、`FilmPage.jsx`、`features/film/`                          |
| 修改 workspace/session | `modules/accountManagement/`、`AccountManagementPage.jsx`               |
| 修改后台管理           | `modules/admin/`、`packages/contracts/src/admin.ts`                     |
| 修改部署               | `compose.demo.yml`、`deploy/`、`docs/DEPLOYMENT.md`                     |

## 11. 测试和代码规范

- 手工改文件后运行 Prettier，不手工争论格式。
- Route 只做验证和 HTTP 映射，业务规则放 Service。
- 所有外部输入经过共享 Zod Schema。
- 领域计算优先写纯函数和 Vitest 测试。
- 不提交真实 `.env`、运行数据、生成媒体或服务账号文件。
- 不使用 `git reset --hard` 或覆盖其他人的未提交工作。

当前完整检查命令是：

```bash
pnpm check
```

它依次运行 Prettier 检查、Oxlint、全部 Vitest 和生产构建。Provider 测试使用测试替身，不应在 CI 中产生真实费用。

账号和账单改动还应单独跑 CI database job 的核心范围：

```bash
pnpm --filter @seqora/api exec vitest run src/infra/postgres.test.ts src/modules/auth/routes.test.ts src/modules/accountManagement/routes.test.ts src/modules/billing/creditLedger.test.ts
```

## 12. 部署

封闭外测推荐 Google Compute Engine + Docker Compose + Caddy：

```bash
docker compose --env-file deploy/demo.env -f compose.demo.yml config
docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --build
docker compose --env-file deploy/demo.env -f compose.demo.yml ps
```

生产 Web 与 API 同域，Caddy 处理 HTTPS 和 `/api` 代理。Compose 同时运行 Postgres；API 使用 Docker 持久卷保存 `app.json`，媒体推荐私有 GCS。完整部署、备份、回滚和 CI/CD 步骤见 `docs/DEPLOYMENT.md` 与 `docs/CICD.md`。

复制本地 `apps/api/data/` 不能直接覆盖正在运行的云端数据卷。恢复前必须停止 API、备份服务器当前 Postgres、JSON 和 GCS 对象，并确认对象存储中的媒体与 JSON 记录一致。

## 13. 当前必须知道的限制

1. 项目/任务 JSON Store 和进程内 Worker 只适合单 API 实例；多实例会产生状态竞争和重复调度风险。
2. 任务轮询与调度依赖 API 进程存活，尚未接入持久消息队列。
3. 账号和 workspace 已具备租户边界，但项目域数据还没全面数据库化，商用多实例前仍需迁移。
4. 音频、支付、邮件/短信投递和用户协议/隐私/数据删除流程尚未实现。
5. 第三方生成质量不稳定，提示词和负面规则只能提高下限，仍需人工验收。
6. 上游额度、并发池、素材审核和安全策略会导致平台外部错误，不能用本地假状态掩盖。

## 14. 推荐阅读顺序

1. `README.md`：启动、命令和功能概览。
2. `docs/HANDOFF_GUIDE.md`：当前文件，建立整体地图。
3. `docs/DEVELOPMENT_MEMORY.md`：完整历史、产品决策、验收记录和已知风险。
4. `docs/ARCHITECTURE.md`：模块边界和演进方向。
5. `docs/ASSET_GENERATION.md`：资产、可信人像、分镜和 Provider 细节。
6. `docs/DEPLOYMENT.md` 与 `docs/CICD.md`：云端运行与发布。
7. `docs/CODE_STYLE.md` 与 `CONTRIBUTING.md`：协作约束。

接手第一天不要急着重构。先运行当前流程、阅读一个真实任务的 `metadata`、执行 `pnpm check`，再从一个有测试覆盖的窄功能开始修改。
