# SEQORA 生产运维手册

> 最新应用发布：2026-09-21 01:01:02（上海时间），主站 Web `seqora-web:2cc67d2b591b`、剧本 API / Web `e71ee9874823` 已上线；主站 API / Worker 保留 `seqora-api:ebb55fa3c7a9`。两个 PostgreSQL 与 Redis 容器 ID 未变。发布目录 `/opt/seqora-releases/script-fix-20260921`，双库、配置和源码备份 `/opt/seqora-backups/script-fix-20260920T170045Z`；readiness 与生产样本冒烟通过。修复新网剧快速入口和 PostgreSQL 生成保存误报冲突，未执行付费生成。当前版本、验证边界及应用回退镜像见 [剧本修复发布记录](QUICK_SCRIPT_ENTRY_FIX_2026-09-21.md#生产修复发布)。

> 上一应用发布：2026-09-21 00:29，主站 `ebb55fa` 与剧本 `5f41a27` 配套上线。双库及媒体备份、生产冒烟和回退说明见 [快速剧本融合版发布记录](QUICK_SCRIPT_DEPLOYMENT_2026-09-21.md)。下方历史版本不代表当前运行镜像。

> 核对日期：2026-09-04。本手册只记录安全的基础设施标识和操作步骤，不记录密码、邀请码、API Key、Cookie 或用户数据。

## 生产清单

| 项目            | 当前值                                       |
| --------------- | -------------------------------------------- |
| 站点            | `https://xumutv.com`                         |
| 健康检查        | `https://xumutv.com/api/v1/health`           |
| Readiness       | `https://xumutv.com/api/v1/health/readiness` |
| 云平台          | 阿里云 ECS                                   |
| 公网地址        | `123.57.14.233`                              |
| 部署根目录      | `/opt/seqora`                                |
| Compose Project | `seqora-demo`                                |
| 服务            | `postgres`、`redis`、`api`、`worker`、`web`  |

生产密钥位于服务器 `/opt/seqora/deploy/demo.env`，权限应为 `600`。不要执行会把该文件内容输出到终端、聊天、CI 日志或文档的命令。

### 2026-09-17 10:34 分镜提示词与资产交互发布

- 分支 `codex/script-master-refresh-20260916`，应用提交 `123a7fd57c1861d80180bf30b4b0eefa83d882c2`；API/Worker 为 `seqora-api:123a7fd57c18`，Web 为 `seqora-web:123a7fd57c18`。发布内容包括提示词精简、具体动作保留、旧分镜清理、资产卡片去重与参考图高亮，以及没有手动参考图时的自动引用兼容处理。
- 数据备份 `/opt/seqora-backups/manual/20260917T023114Z`：Postgres dump 6,519,042 字节，本地上传归档 1,726,696,746 字节。源码回退目录 `/opt/seqora-backups/source-20260917-023318`；发布日志 `/var/tmp/seqora-deploy-123a7fd.log`，退出码 0。源码包 SHA-256：`d3fc8555549dfb8f11b1577408aa19a54617ba49203bfe8a93cc84fe67e7ec6e`。
- 迁移已是最新；生产 `demo.env` 发布前后哈希一致，视频仍为 `dora-router-seedance`、素材库为 `volc-ark-material`。独立剧本大师三个容器保持原镜像运行。运行容器确认提示词版本 `seedance-storyboard-v17`，旧模板清理验证通过。
- Health/readiness、数据库、Redis、Worker 心跳和队列均正常。首页及登录页可加载；未登录的账号接口、Admin、剧本大师入口返回 401。普通测试账号登录、读取会话和项目库、读取剧本大师配置及打开 `/script-master` 均为 200，访问 Admin 为 403；验证后已退出测试会话。环境中的 bootstrap 管理员凭据登录返回 401，未修改密码，因此本次未验证管理员登录后的页面。
- 本次重新运行：Web 276 项、API 单元命令 187 项、分镜与参考图专项 119 项、提示词 35 项、contracts 68 项、Admin 19 项通过（不同命令的覆盖有重叠，不能求和作为唯一测试数）。Web/Admin/API 构建、格式、架构、安全配置检查及 lint 通过。`pnpm check` 在 Docker 数据库预检处中断；此前扩展旧 API 资产建议 5 项失败仍未解决，不得称为全量测试通过。本次未调用付费生成。
- 备份恢复阶段，旧脚本的 `up -d api worker` 同时重建了 Postgres 容器，原数据卷保留；恢复后 readiness、登录与项目读取正常。后续维护备份脚本时应让恢复应用的命令使用 `--no-deps`，避免无关的数据容器重建。

### 2026-09-17 本地视频通道配置纠正

- 本地失败请求 `seedance_req_01a0acac-2725-70b4-adc2-01db92ea49d9` 的任务记录为 `stringx-seedance`；本地 `.env` 仍显式选择 StringX 且没有 Dora 配置。线上 health 同时为 `dora-router-seedance`，不是线上回退或错误文案误标。`api key credit quota exceeded` 表示该上游密钥额度不足，不能仅按普通 429 频率限制处理，也不是站内积分余额不足。
- 仅将本地 API 的四个视频设置对齐线上现用配置，密钥未输出或提交；素材库显式使用本地已有 VolcArk 凭据，避免视频切换后误启用不存在的 Dora 素材接口。线上配置和历史任务不改动。
- 重启后本地 health：视频 `dora-router-seedance`、素材库 `volc-ark-material`、队列 `inline`。Dora `/v1/models` 返回 200 且列出所选模型；Provider 选择与 Dora 适配器 25 项测试通过。未执行付费生成，模型目录鉴权不代表生成额度或出片效果已验证。
- 排查此类问题先比对失败任务的 `metadata.providerName`、当前 `/api/v1/health` 与环境选择器；历史错误不会随通道切换改写，新建任务才使用当前通道。

### 2026-09-15 加白素材接口恢复

后续于 22:27（北京时间）发布人物身份约束与确认后自动加白修复 `8caa3f2`；API/Worker 镜像 `seqora-api:8caa3f2c3e41-identity`，Web 镜像 `seqora-web:8caa3f2c3e41-identity`，备份 `/opt/seqora-backups/portrait-identity-20260915T142716Z`。环境配置和独立剧本大师保留；迁移、readiness、权限保护与线上 Active 人像重复确认不扣费验证通过。详见 [本次验收](CHARACTER_IDENTITY_AND_AUTO_PORTRAIT_2026-09-15.md#生产发布)。

- 15:03（北京时间）核对并修复：DoraRouter 视频入口可达，但 `/v1/material?Action=ListAssetGroups&Version=2024-01-01` 返回 `404 Invalid URL (POST /v1/material)`。其公开文档未提供素材库接口；不能将视频接入成功推断为素材库可用。
- 使用服务器已有弦序素材库 AK/SK，先只读验证 `ListAssetGroups` / `ListAssets` / `GetAsset`，再将 `ASSET_LIBRARY_PROVIDER` 单独改为 `volc-ark`。源环境文件对比仅该一项变化；API/Worker 同步重建，继续使用 `seqora-api:2f8058164f8a`，DoraRouter 视频地址/模型/密钥及剧本大师配置保留。
- 发布前无 queued/running 生成任务。备份 `/opt/seqora-backups/material-provider-20260915T070312Z` 包含原环境、镜像版本文件、Compose 文件、5,077,486 字节数据库 dump；私密备份和环境文件权限 600。使用两个 env 文件核对镜像后，仅重建 API/Worker。
- 验证：health/readiness 200 且 `ready=true`；`providerNames.assetLibrary=volc-ark-material`；未登录素材查询 401；测试账号的 AIGC、LivenessFace 列表均为 200；上游返回 87 条 AI 素材，抽样详情为 `active`。普通测试账号看不到未绑定的 AI 素材，空列表符合现有隔离逻辑。独立剧本大师服务保持 healthy。
- 此次是配置修复，未更新业务镜像、未上传人物、未调用付费模型；不代表弦序素材与 DoraRouter 视频跨线路兼容性已验收。当前素材 Provider 不实现新建真人 H5 认证，配置返回 `realValidationReady=false`，已有真人素材查询/绑定仍可用。
- 本地定向回归 33 项通过：VolcArk 素材 Provider、Provider 选择、可信素材 Service。环境模板已显式选择 `volc-ark`，减少新部署再次将素材库指向无效 DoraRouter 路径的风险。
- 验证摘要保存在备份目录 `verification.json`。如需回退，将备份 `demo.env` 恢复至 `deploy/demo.env`，使用下方两个 env 文件的命令重建 API/Worker；回退会恢复原先不可用的 DoraRouter 素材接口。

### 2026-09-15 合并分支主项目发布

- 13:33（北京时间）通过源码包发布 `codex/script-master-merged-20260914` 的提交 `2f8058164f8a4ed6a8e0b81d996358a183f4cfbd`。API/Worker 镜像为 `seqora-api:2f8058164f8a`，Web 为 `seqora-web:2f8058164f8a`。
- 数据备份：`/opt/seqora-backups/manual/20260915T052431Z`；上一源码及配置：`/opt/seqora-backups/source-20260915-053217`；发布日志：`/var/tmp/seqora-deploy-2f80581.log`，退出码 `0`。备份脚本按现有流程短暂停止应用并恢复；GCS 未配置，跳过对象版本清单。
- 源码包 SHA-256 为 `c0327e6bed7d2cb9a6c70667eebf948ccadd19e283c0bdf164642324568cc7df`，仅含 Git 跟踪文件；生产环境变量与密钥已对比确认保留，权限仍为 `600`。
- 服务器 API/Web 构建与迁移通过；只读查询确认 `041_script_master_deliveries.sql` 已执行。公网页面与新容器 HTML 一致，支付占位图片可访问；health/readiness、Worker 心跳正常，未登录 `/auth/me`、剧本大师配置接口、`/admin/` 均返回 `401`。运行镜像的质量规则确认为 `quality-floor-v2`，人类约束与动物豁免均生效。
- 此包只发布主项目及剧本大师接入代码；独立 `project111-final2` 服务尚未部署，服务器没有配置启动地址和共享密钥，入口显示未配置。充值/会员页面仍是模拟支付，素材库 `404` 未在此发布中修复。未创建付费生成任务，也未完成登录后的人工全流程验收。
- 发布前已有相关 112 项测试、前后端构建和 lint 通过；全量检查仍受 `App.jsx` 与 `app.test.ts` 的既有行数超限阻断，不能将本次部署成功等同于全量测试通过。

### 2026-09-15 Seedance 配置更新

- `VIDEO_PROVIDER=dora-router`，显式设置 `DORA_ROUTER_BASE_URL=https://www.dorarouter.com`、`DORA_ROUTER_VIDEO_MODEL=doubao-seedance-2-0-260128`，并更新服务器端 `DORA_ROUTER_API_KEY`。
- API/Worker 继续使用 `seqora-api:aeb0051ed306`。这是环境配置更新，未发布本地合并分支代码。原环境文件备份为服务器上的 `deploy/demo.env.bak-dorarouter-20260915-044453`，权限为 `600`。
- 从实际 Node.js API 容器查询 `/v1/models` 返回 `200`，模型列表包含指定模型；查询虚构视频任务返回 `task_not_exist`。旧密钥查询同一视频接口返回 `401 Invalid token`。未创建付费任务，不代表已验证实际生成和计费。
- `/v1/material?Action=ListAssetGroups` 用新旧密钥均返回 `404 Invalid URL`；可信人像/加白接口仍需单独核对，健康接口的 `configured` 不能当作上游功能验收。
- 本次首次重建遗漏 `release.env`，误选旧 `seqora-api:local` 导致服务约 7 分钟不可用；加载版本文件恢复原镜像后，health/readiness、Worker 心跳均正常。后续必须按下面的配置更新命令加载两个环境文件。

### 已部署实例仅更新环境配置

先保留权限为 `600` 的环境文件备份，核对当前镜像和运行任务，再修改目标配置。重建应用时必须同时加载 `deploy/release.env`，以免 Compose 回退到 `local` 镜像：

```bash
cd /opt/seqora
docker compose --env-file deploy/demo.env --env-file deploy/release.env -f compose.demo.yml config --quiet
docker compose --env-file deploy/demo.env --env-file deploy/release.env -f compose.demo.yml up -d --no-build --no-deps --force-recreate api worker
```

随后检查容器镜像标签、health/readiness、Worker 心跳和上游只读接口。失败时先恢复环境文件备份，再用同一固定镜像重建。不要输出完整 Compose 配置或容器环境变量。

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
ssh root@123.57.14.233
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
ssh root@123.57.14.233 "bash /opt/seqora/deploy/backup-demo.sh"
```

生成不含运行数据的源码包：

```powershell
$releaseRoot = Join-Path $env:TEMP 'seqora-release'
.\deploy\package.ps1 -OutputRoot $releaseRoot
```

源码包只包含 Git 已跟踪文件，不包含被忽略的 `deploy/demo.env`、`release.env` 或运行数据。服务器更新脚本会保留生产自己的环境文件并覆盖回新目录。

上传并更新：

```powershell
scp "$releaseRoot\seqora-source.tgz" root@123.57.14.233:/tmp/seqora-source.tgz

ssh root@123.57.14.233 "bash /opt/seqora/deploy/update-source.sh /tmp/seqora-source.tgz"
```

必须使用 `bash` 调用，因为 Windows 打包后的脚本执行位可能不会保留。`update-source.sh` 会保留生产 `demo.env` 与 `release.env`、根据 `DEPLOY_BUILD.txt` 的提交 SHA 把不可变 API/Web 镜像标签写入独立的 `release.env`、替换源码、构建、执行 migration、只重建应用容器并检查健康；Postgres/Redis 不会因应用发布而重建，失败时也只恢复上一源码目录和应用镜像。

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

## 2026-09-15 AI 人物视频联调发布

当前主站 API/Worker 使用 `seqora-api:1d64262-portrait`，Web 使用 `seqora-web:ed6c7b5-portrait`。源码归档和摘要位于 `/opt/seqora-releases/portrait-1d64262`，在线目录有 `PORTRAIT_HOTFIX_RELEASE.json`。独立剧本大师镜像保持 `f3d62e11f9a8`。

最终发布前备份 `/opt/seqora-backups/portrait-worker-20260915T082128Z`（数据库 5,089,906 字节），已先执行迁移再发布并验证 readiness。完整发布链、所有退款和成功样片证据见 [人物视频联调](PORTRAIT_VIDEO_VALIDATION_2026-09-15.md)。回滚必须同时使用两个 env 文件，且不要回滚素材库/视频密钥配置。旧镜像存在本记录所述人物视频缺陷，回滚后不得继续对外宣称该链路可用。

## 安全红线

- 不开放公网 `8787`、Postgres 或 Redis。
- 不关闭 `/admin/` 的 Caddy `forward_auth`，也不只依赖前端隐藏。
- 不关闭 Caddy `strict_sni_host`；TLS SNI 与 HTTP Host 不一致的请求必须返回 `421`，不能提供创作端或管理员端内容。
- 不把 GCS Bucket 改成公开。
- 不在 `VITE_*`、源码、文档或 GitHub Artifact 中放服务端密钥。
- 不删除生产卷、不运行 `down -v`、不直接覆盖生产数据库。
- 不把真实用户数据复制到开发环境；预发布恢复后先匿名化。
- 密钥疑似泄露时立即轮换，并检查审计、Provider 和云账单。
