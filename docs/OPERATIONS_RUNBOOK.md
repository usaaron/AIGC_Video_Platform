# SEQORA 生产运维手册

> 核对日期：2026-08-27。本手册只记录安全的基础设施标识和操作步骤，不记录密码、邀请码、API Key、Cookie 或用户数据。

## 生产清单

| 项目            | 当前值                                       |
| --------------- | -------------------------------------------- |
| 站点            | `https://xumutv.com`                         |
| 健康检查        | `https://xumutv.com/api/v1/health`           |
| Readiness       | `https://xumutv.com/api/v1/health/readiness` |
| GCP Project     | `project-b3b9bf9e-3c8b-4fbc-9cc`             |
| GCE Instance    | `instance-20260726-112218`                   |
| Zone            | `asia-east2-b`                               |
| 部署根目录      | `/opt/seqora`                                |
| Compose Project | `seqora-demo`                                |
| 服务            | `postgres`、`redis`、`api`、`worker`、`web`  |

生产密钥位于服务器 `/opt/seqora/deploy/demo.env`，权限应为 `600`。不要执行会把该文件内容输出到终端、聊天、CI 日志或文档的命令。

## 日常健康检查

公网检查：

```powershell
Invoke-RestMethod https://xumutv.com/api/v1/health
Invoke-WebRequest -UseBasicParsing https://xumutv.com/api/v1/health/readiness
```

`health` 需要关注：

- `status=ok`
- `readiness.ready=true`
- `database.status=ready`
- `redis.status=ready`
- `queue.status=ready`
- `worker.status=ready` 且 heartbeat 没有持续变旧
- Provider 为 `configured`
- queue 的 `waiting/active/failed/paused` 是否异常增长

SSH：

```powershell
gcloud compute ssh instance-20260726-112218 `
  --project=project-b3b9bf9e-3c8b-4fbc-9cc `
  --zone=asia-east2-b `
  --tunnel-through-iap
```

容器和磁盘：

```bash
cd /opt/seqora
sudo docker compose --env-file deploy/demo.env -f compose.demo.yml ps
df -h /
sudo docker system df
```

不要直接执行 `docker compose down -v`，它会删除数据库、Redis 和运行数据卷。

## 日志排查

最近日志：

```bash
cd /opt/seqora
sudo docker compose --env-file deploy/demo.env -f compose.demo.yml logs --since=15m api worker web
```

持续跟踪单服务：

```bash
sudo docker compose --env-file deploy/demo.env -f compose.demo.yml logs -f --tail=200 api
sudo docker compose --env-file deploy/demo.env -f compose.demo.yml logs -f --tail=200 worker
```

日志中可以记录 requestId、taskId、providerTaskId、状态和错误码，但不得记录完整密码、验证码、邀请 token、邮件 token、Authorization、Cookie 或 Provider Key。

## 发布方式

### 首选：CI/CD 镜像发布

`main` Push 后，`.github/workflows/ci.yml` 先执行格式、Lint、测试、构建、migration 门禁和数据库测试；成功后 `.github/workflows/deploy.yml` 根据文件变化只发布 API 或 Web。镜像使用 Commit SHA，服务器调用 `deploy/update-release.sh`，健康失败自动恢复上一镜像。

在 GitHub Actions 没有成功记录、production Environment 未配置或 WIF/Artifact Registry 不可用时，不要假设自动发布成功，改用下面已验证的源码包发布。

### 回退：Windows 本机源码包发布

发布前保证工作树已提交、检查通过，并先执行备份：

```powershell
pnpm check
git status --short
```

在服务器备份：

```powershell
gcloud compute ssh instance-20260726-112218 `
  --project=project-b3b9bf9e-3c8b-4fbc-9cc `
  --zone=asia-east2-b `
  --tunnel-through-iap `
  --command="sudo bash /opt/seqora/deploy/backup-demo.sh"
```

生成不含运行数据的源码包：

```powershell
$releaseRoot = Join-Path $env:TEMP 'seqora-release'
.\deploy\package.ps1 -OutputRoot $releaseRoot
```

该脚本要求本地存在被 Git 忽略的 `deploy/demo.env`，归档会临时包含它；只能通过受控 SSH/SCP 传输，不能上传公开网盘。服务器更新脚本会保留并覆盖回生产自己的 `demo.env`。

上传并更新：

```powershell
gcloud compute scp "$releaseRoot\seqora-source.tgz" `
  instance-20260726-112218:/tmp/seqora-source.tgz `
  --project=project-b3b9bf9e-3c8b-4fbc-9cc `
  --zone=asia-east2-b `
  --tunnel-through-iap

gcloud compute ssh instance-20260726-112218 `
  --project=project-b3b9bf9e-3c8b-4fbc-9cc `
  --zone=asia-east2-b `
  --tunnel-through-iap `
  --command="sudo bash /opt/seqora/deploy/update-source.sh /tmp/seqora-source.tgz"
```

必须使用 `bash` 调用，因为 Windows 打包后的脚本执行位可能不会保留。`update-source.sh` 会保留生产 env、根据 `DEPLOY_BUILD.txt` 的提交 SHA 写入不可变 API/Web 镜像标签、替换源码、构建、执行 migration、重启并检查健康；失败会恢复上一源码目录及其镜像标签。

`/opt/seqora` 是源码包目录，不含 `.git`，禁止使用 `git pull` 作为当前服务器更新方案。

## 发布后验证

最少验证：

```powershell
$health = Invoke-RestMethod https://xumutv.com/api/v1/health
$health.status
$health.readiness.ready

try {
  Invoke-WebRequest -UseBasicParsing https://xumutv.com/api/v1/auth/me
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

预期未登录 `/auth/me` 返回 `401`。再人工验证：

1. 首页和登录页加载。
2. 普通账号登录并读取项目库。
3. 普通账号访问 `/admin/` 被拒绝。
4. 管理员可进入 `/admin/`。
5. 剧本或一个零费用/受控测试任务可以进入后台队列。
6. Worker heartbeat 更新，任务状态会自动刷新。
7. 媒体 Range 播放可用。

不要在常规发布冒烟中自动创建付费图片或视频任务。

## 数据库与 migration

Migration 位于 `apps/api/src/infra/migrations`，只能追加。生产 API/Worker 不会自动执行 migration。

人工执行：

```bash
cd /opt/seqora
sudo docker compose --env-file deploy/demo.env -f compose.demo.yml run --rm --no-deps api \
  node dist/scripts/dbMigrate.js
```

首次空环境才运行账号初始化：

```bash
sudo docker compose --env-file deploy/demo.env -f compose.demo.yml run --rm api \
  node dist/scripts/initProductionAccounts.js
```

不要在常规升级中重复依赖 `accounts:init` 修改密码，它只做幂等补齐，不覆盖已有账号。

## 账号、邀请和邮件

### 创建邀请

使用管理员端组织邀请功能。新开放邀请码是 8 位数字，一次使用；不要在 Git、工单截图或公共聊天长期保存。需要多个注册账号时创建多个邀请码。

注册流程：

```text
输入邀请码和邮箱 -> 发送 6 位验证码 -> 填写验证码、显示名和密码 -> 注册/加入组织
```

显示名允许重复，邮箱唯一。已有邮箱接受邀请时必须输入原账号密码。错误码 `INVITATION_ACCOUNT_PASSWORD_INVALID` 不是验证码错误，处理方式是先从登录页重置原账号密码，再返回注册页继续。

### 邮件故障

生产强制 `EMAIL_PROVIDER=resend`。检查 API 日志中的 requestId 和 Resend HTTP 状态，不输出 API Key。确认发件域名 DNS、Resend sender 状态、收件人拼写、垃圾箱、频控和退信。注册验证码接口每 IP 10 分钟最多 5 次，同邀请码/邮箱还有重发冷却。

### 持续加载项目

先检查 `/health` readiness，再看浏览器项目请求和 API requestId。常见原因：session 已失效、账号 email 未验证、membership 被禁用、migration 未执行、Postgres 不可用。不要通过前端跳过 `401/403`。

## 队列故障

### 一直排队

1. 检查 health 中 Redis、queue 和 worker heartbeat。
2. 查看 worker 日志是否有 Provider 额度、可信人像、依赖尾帧或资源锁错误。
3. 查看是否有 `paused` 任务；暂停任务本身不应占运行槽，但镜头依赖可能等待其上游。
4. 检查同项目同镜头是否已有活跃任务，前端会阻止切换批量策略。
5. 不直接在数据库把任务改成 completed；先判断远端是否真实完成。

### 任务取消与退款

- `queued`：可暂停、继续、删除；删除会幂等退款。
- `running` StringX 视频：调用远端 cancel 成功后才能取消和退款。
- 其他第三方运行任务：没有可验证取消能力时不能伪暂停。
- `completed/failed/cancelled`：归档只写 `queueHiddenAt`，输出仍保留。

### Worker 重启

```bash
cd /opt/seqora
sudo docker compose --env-file deploy/demo.env -f compose.demo.yml restart worker
```

重启后必须确认 heartbeat 恢复，并观察 interrupted/lease 任务被安全接管。不要同时启动第二套未使用相同 Postgres advisory lock 的 Worker。

## 备份与回滚

完整流程见 `BACKUP_RESTORE.md`。备份必须覆盖：

- Postgres dump。
- JSON/media 索引与本地 uploads（如有）。
- GCS 对象版本清单。
- 生产 env 的哈希，不是明文。
- 当前镜像或源码版本标识。

源码包发布失败时 `update-source.sh` 自动恢复 `/opt/seqora-backups/source-*`。镜像发布失败时 `update-release.sh` 恢复 `release.env`。数据库 migration 通常不能通过切回代码自动回退；破坏性变更必须预先设计向后兼容 migration 和恢复步骤。

## 安全红线

- 不开放公网 `8787`、Postgres 或 Redis。
- 不关闭 `/admin/` 的 Caddy `forward_auth`，也不只依赖前端隐藏。
- 不关闭 Caddy `strict_sni_host`；TLS SNI 与 HTTP Host 不一致的请求必须返回 `421`，不能提供创作端或管理员端内容。
- 不把 GCS Bucket 改成公开。
- 不在 `VITE_*`、源码、文档或 GitHub Artifact 中放服务端密钥。
- 不删除生产卷、不运行 `down -v`、不直接覆盖生产数据库。
- 不把真实用户数据复制到开发环境；预发布恢复后先匿名化。
- 密钥疑似泄露时立即轮换，并检查审计、Provider 和云账单。
