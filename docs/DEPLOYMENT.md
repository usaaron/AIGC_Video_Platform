# 外部测试部署

> 本文用于搭建新环境和检查上线门槛。当前 `zjh.ai` 的实例标识、源码包发布、日志、备份和故障命令以 [生产运维手册](OPERATIONS_RUNBOOK.md) 为准。

当前推荐把 Demo 部署到一台 Google Compute Engine VM，通过 Docker Compose 运行 Postgres、Redis、API、Worker 和 Web。Caddy 在同一域名下提供静态站点、`/api` 反向代理和自动 HTTPS，并启用 `strict_sni_host` 拒绝 TLS SNI 与 HTTP Host 不一致的域名前置请求；账号/auth/账单账本、项目、资产、分镜和生成任务写入 Postgres 持久卷，任务触发队列写入 Redis/BullMQ，媒体写入私有 GCS Bucket。API 的 `8787` 端口不对公网开放。

这套方案适合封闭客户测试和小规模并发，不是正式商用架构。正式商用前必须完成本文“生产前必须替换”的事项。

## 封闭外测登录边界

- 公网只展示登录页；除 `/api/v1/health` 和 `/api/v1/auth/login` 外，项目、媒体、任务、账单和管理 API 都要求有效账号会话。
- 当前开放邀请码注册，不支持无邀请码自助注册。首批账号由 `deploy/demo.env` 的 `BOOTSTRAP_*` 变量提供输入，并且必须在 `db:migrate` 后显式执行 `accounts:init` 创建；API/Worker 生产启动不会自动 bootstrap。后续账号可由 owner/super_admin/admin 在账号管理页按权限边界受控创建/邀请。
- 注册入口使用 8 位组织邀请码和 6 位邮箱验证码。生产已经通过 Resend 投递注册验证码、邮箱验证、邀请和密码重置邮件；仍需补投递失败告警、退信处理和运营审核。
- member 账号进入创作工作台；owner/super_admin/admin 可以看到账号管理入口，显示名由 `BOOTSTRAP_*_NAME` 设置。四类首次账号必须使用不同邮箱和强密码，不要向客户提供管理员、super_admin 或 owner 账号。
- `BOOTSTRAP_DEMO_WORKSPACE` 仅允许 dev/test 使用；生产环境会直接拒绝该配置，云端账号从空项目列表开始，不会出现本地开发的“午夜胶片”样例。
- 同一组织的多位成员会看到同一批项目和账单权益。需要客户间强隔离时，为每个客户创建独立组织；项目域数据已写入 Postgres，正式多实例商用前仍要验证所有查询的组织范围条件、Redis 队列恢复和 Worker 横向扩缩容。
- `BOOTSTRAP_*` 只供显式 `accounts:init` 使用，命令是幂等插入，不会覆盖已有账号密码。已有账号登录后可在“项目设置 -> 账号安全”修改自己的密码；忘记密码已经通过 Resend 邮件完成闭环。

## 独立部署单元

- `apps/web`：静态站点，可部署到 Vercel、Cloudflare Pages 或对象存储/CDN。
- `apps/api`：Node.js 服务，可部署到容器平台、云应用平台或虚拟机。
- `apps/api` worker：复用 API 镜像，执行 `node dist/worker.js`，消费 Redis/BullMQ 里的生成任务触发。
- `apps/admin`：独立管理员静态站点，消费 `/api/v1/admin/console`；当前生产构建在 `/admin/`，同时经过 Caddy `forward_auth` 和后端角色权限，普通用户不能直接访问。

Web 使用 `VITE_API_BASE_URL` 指向 API。API 使用 `WEB_ORIGIN` 限制跨域来源。当前生产采用同域 `https://zjh.ai` 和相对 API 前缀 `/api/v1`。

当前 Compose 使用同域部署，Web 保持默认 `VITE_API_BASE_URL=/api/v1`，浏览器 Cookie 不跨站。不要把 Web 和 API 临时部署到两个无关域名，否则登录 Cookie 在部分浏览器中会失效。

Demo 媒体存储可设置 `STORAGE_DRIVER=gcs` 和 `GCS_BUCKET`，凭据使用 Google ADC 或 `GOOGLE_APPLICATION_CREDENTIALS`。本地开发保持 `STORAGE_DRIVER=local`。迁移阿里云 OSS 时实现同一个 `ObjectStorage` 接口，禁止在业务模块直接调用云厂商 SDK。

## FFmpeg 运行时

API 进程优先读取弦序返回的尾帧，并使用 FFmpeg 合成完整成片预览。开发机和 API 镜像必须安装带 `libx264` 的 FFmpeg，并保证 `FFMPEG_PATH` 指向可执行文件；默认值为 `ffmpeg`。`FILM_PREVIEW_TIMEOUT_MS` 同时控制尾帧提取和单次合成超时，默认 10 分钟。容器部署时还要为临时视频预留磁盘空间，并保证 API 进程可写系统临时目录。

当前生成任务和成片合成由独立 Worker 进程执行。正式环境还需要按任务类型设置 CPU、内存、并发上限和告警，并为合成结果配置对象存储生命周期。预览 MP4 当前不包含音频或字幕，不应当作正式交付母版。

## Google Cloud 准备

最低起步规格：Ubuntu 24.04、2 vCPU、4GB 内存、50GB 持久磁盘和静态公网 IP；Google Cloud 可先用 `e2-medium`。需要频繁生成 1080p/4K 或同时合成长视频时建议 2 vCPU、8GB 内存，2GB 内存机器不适合在本机 Docker 构建并运行 FFmpeg。区域尽量靠近主要测试用户。创建私有 GCS Bucket，启用统一访问控制和对象版本控制；VM 使用独立 Service Account，仅授予目标 Bucket 的 `roles/storage.objectUser`。

防火墙只开放 `22`、`80`、`443`，不要开放 `8787`。把测试域名的 A/AAAA 记录指向 VM 静态 IP。Caddy 需要公网可以访问 80/443 才能自动签发证书。

服务器需要安装 Git、Docker Engine 和 Docker Compose Plugin。代码拉取后执行：

```bash
cp deploy/demo.env.example deploy/demo.env
chmod 600 deploy/demo.env
```

编辑 `deploy/demo.env`：

- `APP_ADDRESS`、`WEB_ORIGIN` 和 `PUBLIC_API_BASE_URL` 使用同一个真实 HTTPS 域名。
- `AUTH_SECRET` 使用 `openssl rand -base64 48` 生成。
- 生产固定 `EMAIL_PROVIDER=resend`，配置已验证发件域名的 `EMAIL_FROM`、`RESEND_API_KEY` 和三个 `AUTH_*_URL`；不要使用 `console` 或 `none` 绕过生产校验。
- 四组 `BOOTSTRAP_*` 邮箱和密码必须唯一：member、owner、super_admin、admin；只供显式 `accounts:init` 使用，生产启动不会自动创建账号。
- 生产环境不要启用 `BOOTSTRAP_DEMO_WORKSPACE`；客户登录后直接从空项目列表创建自己的第一个项目。
- 保持 `TASK_QUEUE_DRIVER=bullmq` 和 `REDIS_URL=redis://redis:6379`，除非已经接入托管 Redis 或云队列适配器。
- 2 vCPU / 4GB 机器先保留 `API_MEMORY_LIMIT=1536m`、`API_NODE_HEAP_MB=768`、`WORKER_MEMORY_LIMIT=1536m`、`WORKER_NODE_HEAP_MB=768`、`WEB_MEMORY_LIMIT=192m`；发生 OOM 时优先升级内存，不要移除所有上限。
- 保持 `VIDEO_PROVIDER=stringx`，填写私有 `GCS_BUCKET`、`STRINGX_API_KEY`、默认中文文本模型需要的 `REHDASU_API_KEY` 和图片生成需要的 `TOKENADVENT_API_KEY`；只有选择 DeepSeek V3 时才需要 `DEEPSEEK_API_KEY`（可复用 `STRINGX_API_KEY`）。
- 生产启动会强制检查当前视频 Provider 密钥、当前文本模型对应密钥和 TokenAdvent GPT Image 2 密钥，缺少时直接停止，不允许静默使用 Mock 结果。
- 要测试可信人像，再填写弦序 MaaS 素材库专用 `VOLC_ACCESS_KEY`、`VOLC_SECRET_KEY` 和与 StringX Token 同组织、同项目的 `VOLC_ARK_PROJECT_NAME`。StringX Bearer Token 不能代替素材库 AK/SK。
- 可选填写 `ASSET_LIBRARY_CONSOLE_URL`，人物编辑器会跳转到弦序私域素材库；不再硬编码火山控制台地址。
- `ARK_API_*` 只用于官方火山回滚，默认全弦序链路不读取这些变量。
- 不要把 `deploy/demo.env`、服务账号 JSON 或任何 Key 提交到 Git。

启动前先检查最终配置，再构建并启动：

```bash
docker compose --env-file deploy/demo.env -f compose.demo.yml config
docker compose --env-file deploy/demo.env -f compose.demo.yml build api
docker compose --env-file deploy/demo.env -f compose.demo.yml run --rm api \
  node dist/scripts/dbMigrate.js
docker compose --env-file deploy/demo.env -f compose.demo.yml run --rm api \
  node dist/scripts/initProductionAccounts.js
docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --build
docker compose --env-file deploy/demo.env -f compose.demo.yml ps
curl --fail https://zjh.ai/api/v1/health
```

Production account initialization is explicit. API and Worker startup must keep
`BOOTSTRAP_ACCOUNTS_ON_START=false`; run
`node dist/scripts/initProductionAccounts.js` only after `dbMigrate.js` on a new
environment or when intentionally repairing missing bootstrap accounts. See
[Production Initialization Runbook](PRODUCTION_INITIALIZATION.md).

Synthetic monitoring is configured separately from `deploy/demo.env`. Create
`/opt/seqora/deploy/monitoring.env` from `deploy/monitoring.env.example` and use a dedicated
synthetic monitoring account. The VM systemd timer runs the read-only probe every minute. GitHub
post-deploy gates run both the read-only probe and the write-path probe; the write-path probe
requires `SYNTHETIC_ORGANIZATION_ID` to point at a dedicated non-system synthetic organization.

`deploy/demo.env` 会完整注入 Postgres、Redis、API 和 Worker 容器；Web 容器只接收 `APP_ADDRESS`，不会获得模型密钥或数据库连接串。API 镜像内置 FFmpeg 并以非 root 用户运行，Worker 复用同一镜像执行 `dist/worker.js`。

生产部署和升级时先显式执行 migration，再启动新 API：

```bash
docker compose --env-file deploy/demo.env -f compose.demo.yml build api
docker compose --env-file deploy/demo.env -f compose.demo.yml run --rm api \
  node dist/scripts/dbMigrate.js
docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --build
```

API 在 `NODE_ENV=production` 下启动只检查 migration 是否最新，不自动改库。

Compose 默认把 API 和 Worker 分别限制为 1.5 CPU、1536MB 内存和 256 个进程，把 Caddy 限制为 0.5 CPU、192MB 内存和 128 个进程；每个容器日志最多保留 3 个 10MB 文件。前端登录前不会下载工作台代码，进入后按页面拆包；任务轮询为运行中 2.5 秒、空闲 12 秒、后台标签页 30 秒。静态资源使用长期缓存，入口 HTML 禁止缓存，更新后不需要客户手工清浏览器缓存。

## 自动更新与回滚

推荐使用按 API/Web 独立构建的 GitHub Actions 流水线。合并 `main` 后先通过完整 CI，再把 Commit SHA 镜像推送到 Artifact Registry；服务器仅重建发生变化的模块，健康检查失败自动恢复上一镜像。一次性开通、GitHub Variables/Secrets、IAM 和人工回滚见 [CI/CD 与模块化发布](CICD.md)。

尚未开通 Artifact Registry 和 Workload Identity Federation 时，可继续使用下面的人工源码更新方式。

### 人工源码更新

当前 `/opt/seqora` 不含 `.git`，不能执行 `git pull`。在本地对已提交且通过 `pnpm check` 的版本运行 `deploy/package.ps1`，通过受控 GCloud SCP 上传归档，再在服务器执行 `deploy/update-source.sh`。脚本会保留生产 `deploy/demo.env`、执行 migration、重启、健康检查并在失败时恢复上一源码目录。完整命令和实例参数见 [生产运维手册](OPERATIONS_RUNBOOK.md)。

每次发布前先执行 `deploy/backup-demo.sh`。恢复 Postgres 或 JSON 前必须停止 API 和 Worker，并保留当前数据库和文件的第二份备份。GCS Bucket 应单独启用版本控制和生命周期策略；数据库和 JSON 备份不包含 GCS 媒体对象。

## 外测上线门槛

## 预发布刷新

预发布环境用来跑全量回归、压测和脏数据兼容性验证。推荐流程是：

1. 从最新生产备份恢复数据库和对象存储快照。
2. 执行 `pnpm preprod:anonymize:check`，先验证系统组织和保留账号不会被误删。
3. 执行 `pnpm preprod:anonymize`，清掉会话、邀请、重置 token、验证 token，并把账号、组织、账单、审计、项目、资产、分镜、生成任务、媒体对象、小说摘要和 AI job 敏感字段匿名化。
4. 保留少量可控的 owner / super_admin / admin / member 登录账号，用于手工回归。
5. 跑 `pnpm test:backend:full` 和 `pnpm perf:k6:smoke`，必要时再加 `pnpm perf:k6:breakpoint`。
6. 只有预发布回归和压测都通过，才把同一批迁移和代码推到生产。

上线前逐项确认：

1. 域名 HTTPS 正常，HTTP 自动跳转 HTTPS，公网无法访问 `:8787`。
2. 默认 `MemberPassword123!`、`Admin123!` 无法登录，测试账号使用唯一强密码。
3. 登录页没有预填账号、默认密码或管理员切换入口；未登录访问项目 API 返回 `401`。
4. Provider Key 只在 `deploy/demo.env` 或 Secret Manager，Web 构建和 Git 中没有 Key。
5. GCS Bucket 非公开，上传图片和生成视频只能登录后通过 API 读取。
6. 为弦序 Seedance/MaaS、TokenAdvent 和 Google Cloud 设置预算告警与每日额度。
7. 备份和恢复至少演练一次，升级前执行 `deploy/backup-demo.sh` 并保留 Postgres、JSON 与 GCS 对象版本清单。
8. 明确告知测试者：Seedance 单镜头可能带音频，但 FFmpeg 完整预览当前会移除音轨；系统仍处封闭外测阶段，不上传敏感或未授权素材。
9. 浏览器实测登录、剧本、资产、分镜、视频、完整预览和退出登录。
10. 仿真人测试先确认面部并等待 AIGC 资源变为 Active；真人测试必须由演员本人完成认证授权，制作方接收后再绑定 Asset ID。

## 生产前必须替换

1. 禁止 Demo Header；当前 local auth 可用于封闭外测，企业 SSO 再接 OIDC/JWT。
2. 验证 Redis/BullMQ 队列在生产故障恢复、重复投递、横向扩缩容和监控告警下的行为。
3. 持续审计项目、资产、分镜和生成任务查询的组织范围条件，并保留 JSON 备份到 Postgres 的回滚方案。
4. 支付和订阅只能由服务端回调改变权益；前端不得自助伪造套餐和积分。
5. 为已接入的 Resend 注册、验证、邀请和密码重置邮件补充退信、投递失败告警与运营可见状态。
6. 增加监控、告警、备份恢复演练、密钥轮换和数据导出/删除流程。
7. 将密钥放入部署平台 Secret，不使用 `VITE_` 变量保存服务端密钥。

## CI

GitHub Actions 在每个 PR 执行 `CI / quality`，并通过 `CI / database` 起 Postgres、执行 `pnpm --filter @seqora/api db:migrate`、跑 migration/auth/account/billing 集成测试；Container Images workflow 构建 API/Web 容器但不推送。合并 `main` 后，CI 产生经过验证的模块发布清单，生产发布只使用该清单和对应 Commit SHA。建议保护 `main`：要求 `CI / quality`、`CI / database`、至少一位 Review、禁止强制推送，并为 `production` Environment 配置审批规则。
