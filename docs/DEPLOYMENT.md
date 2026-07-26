# 外部测试部署

当前推荐把 Demo 部署到一台 Google Compute Engine VM，通过 Docker Compose 运行 API 和 Web。Caddy 在同一域名下提供静态站点、`/api` 反向代理和自动 HTTPS；API 数据写入 Docker 持久卷，媒体写入私有 GCS Bucket。API 的 `8787` 端口不对公网开放。

这套方案适合封闭客户测试和小规模并发，不是正式商用架构。正式商用前必须完成本文“生产前必须替换”的事项。

## 封闭外测登录边界

- 公网只展示登录页；除 `/api/v1/health` 和 `/api/v1/auth/login` 外，项目、媒体、任务、账单和管理 API 都要求有效账号会话。
- 当前不提供注册、找回密码或公开邀请码。账号只从 `deploy/demo.env` 的 `BOOTSTRAP_*` 变量在空数据卷首次启动时创建。
- 创作者账号进入创作工作台；管理员账号只进入管理概览，显示名由 `BOOTSTRAP_*_NAME` 设置，两者必须使用不同邮箱和强密码。不要向客户提供管理员账号。
- `BOOTSTRAP_DEMO_WORKSPACE=false` 时新云端账号从空项目列表开始，不会出现本地开发的“午夜胶片”样例。
- 多位测试者共用一个创作者账号时会看到同一批项目和积分。需要客户间数据隔离时，应暂时为每个客户部署独立实例；正式多客户版本必须先完成租户级账号管理。
- `BOOTSTRAP_*` 只在数据文件不存在时生效，修改环境变量不会改掉已有账号密码。已有账号登录后可在“项目设置 -> 账号安全”修改自己的密码；当前仍没有忘记密码或管理员重置功能，因此首次密码必须妥善保存。

## 独立部署单元

- `apps/web`：静态站点，可部署到 Vercel、Cloudflare Pages 或对象存储/CDN。
- `apps/api`：Node.js 服务，可部署到容器平台、云应用平台或虚拟机。
- `apps/admin`：未来独立静态站点，建议使用单独域名并限制访问来源。

Web 使用 `VITE_API_BASE_URL` 指向 API。API 使用 `WEB_ORIGIN` 限制跨域来源。生产中两者可以使用 `studio.example.com` 和 `api.example.com`。

当前 Compose 使用同域部署，Web 保持默认 `VITE_API_BASE_URL=/api/v1`，浏览器 Cookie 不跨站。不要把 Web 和 API 临时部署到两个无关域名，否则登录 Cookie 在部分浏览器中会失效。

Demo 媒体存储可设置 `STORAGE_DRIVER=gcs` 和 `GCS_BUCKET`，凭据使用 Google ADC 或 `GOOGLE_APPLICATION_CREDENTIALS`。本地开发保持 `STORAGE_DRIVER=local`。迁移阿里云 OSS 时实现同一个 `ObjectStorage` 接口，禁止在业务模块直接调用云厂商 SDK。

## FFmpeg 运行时

API 进程优先读取弦序返回的尾帧，并使用 FFmpeg 合成完整成片预览。开发机和 API 镜像必须安装带 `libx264` 的 FFmpeg，并保证 `FFMPEG_PATH` 指向可执行文件；默认值为 `ffmpeg`。`FILM_PREVIEW_TIMEOUT_MS` 同时控制尾帧提取和单次合成超时，默认 10 分钟。容器部署时还要为临时视频预留磁盘空间，并保证 API 进程可写系统临时目录。

当前实现适合 Demo 的单实例 API。正式环境应把合成工作迁移到独立持久 Worker，设置 CPU、内存和并发上限，并为合成结果配置对象存储生命周期。预览 MP4 当前不包含音频或字幕，不应当作正式交付母版。

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
- 两组 `BOOTSTRAP_*` 邮箱和密码必须唯一；只在空数据卷首次启动时生效。
- 保持 `BOOTSTRAP_DEMO_WORKSPACE=false`，让客户登录后创建自己的第一个项目。
- 2 vCPU / 4GB 机器先保留 `API_MEMORY_LIMIT=1536m`、`API_NODE_HEAP_MB=768`、`WEB_MEMORY_LIMIT=192m`；发生 OOM 时优先升级内存，不要移除所有上限。
- 保持 `VIDEO_PROVIDER=stringx`，填写私有 `GCS_BUCKET`、`STRINGX_API_KEY`、`DEEPSEEK_API_KEY`（可复用 `STRINGX_API_KEY`）和 `TOKENADVENT_API_KEY`。
- 生产启动会强制检查当前视频 Provider 密钥、DeepSeek 文本密钥和 TokenAdvent GPT Image 2 密钥，缺少时直接停止，不允许静默使用 Mock 结果。
- 要测试可信人像，再填写弦序 MaaS 素材库专用 `VOLC_ACCESS_KEY`、`VOLC_SECRET_KEY` 和与 StringX Token 同租户、同项目的 `VOLC_ARK_PROJECT_NAME`。StringX Bearer Token 不能代替素材库 AK/SK。
- 可选填写 `ASSET_LIBRARY_CONSOLE_URL`，人物编辑器会跳转到弦序私域素材库；不再硬编码火山控制台地址。
- `AIDEOS_*` 和 `ARK_API_*` 只用于显式回滚，默认全弦序链路不读取这些变量。
- 不要把 `deploy/demo.env`、服务账号 JSON 或任何 Key 提交到 Git。

启动前先检查最终配置，再构建并启动：

```bash
docker compose --env-file deploy/demo.env -f compose.demo.yml config
docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --build
docker compose --env-file deploy/demo.env -f compose.demo.yml ps
curl --fail https://studio.example.com/api/v1/health
```

`deploy/demo.env` 会完整注入 API 容器；Web 容器只接收 `APP_ADDRESS`，不会获得模型密钥。API 镜像内置 FFmpeg 并以非 root 用户运行。

Compose 默认把 API 限制为 1.5 CPU、1536MB 内存和 256 个进程，把 Caddy 限制为 0.5 CPU、192MB 内存和 128 个进程；每个容器日志最多保留 3 个 10MB 文件。前端登录前不会下载工作台代码，进入后按页面拆包；任务轮询为运行中 2.5 秒、空闲 12 秒、后台标签页 30 秒。静态资源使用长期缓存，入口 HTML 禁止缓存，更新后不需要客户手工清浏览器缓存。

## 自动更新与回滚

推荐使用按 API/Web 独立构建的 GitHub Actions 流水线。合并 `main` 后先通过完整 CI，再把 Commit SHA 镜像推送到 Artifact Registry；服务器仅重建发生变化的模块，健康检查失败自动恢复上一镜像。一次性开通、GitHub Variables/Secrets、IAM 和人工回滚见 [CI/CD 与模块化发布](CICD.md)。

尚未开通 Artifact Registry 和 Workload Identity Federation 时，可继续使用下面的人工源码更新方式。

### 人工源码更新

每次更新先备份数据，再拉取已通过 CI 的提交：

```bash
mkdir -p backups
docker compose --env-file deploy/demo.env -f compose.demo.yml exec -T api \
  sh -c 'cat /var/lib/seqora/app.json' > "backups/app-$(date +%Y%m%d-%H%M%S).json"
git pull --ff-only
docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --build
curl --fail https://studio.example.com/api/v1/health
```

回滚时切回上一个已知正常的 Git Tag/Commit 并重新构建。恢复 JSON 前必须停止 API，并保留当前文件的第二份备份。GCS Bucket 应单独启用版本控制和生命周期策略；JSON 备份不包含 GCS 媒体对象。

## 外测上线门槛

上线前逐项确认：

1. 域名 HTTPS 正常，HTTP 自动跳转 HTTPS，公网无法访问 `:8787`。
2. 默认 `Creator123!`、`Admin123!` 无法登录，测试账号使用唯一强密码。
3. 登录页没有预填账号、默认密码或管理员切换入口；未登录访问项目 API 返回 `401`。
4. Provider Key 只在 `deploy/demo.env` 或 Secret Manager，Web 构建和 Git 中没有 Key。
5. GCS Bucket 非公开，上传图片和生成视频只能登录后通过 API 读取。
6. 为弦序 Seedance/MaaS、TokenAdvent 和 Google Cloud 设置预算告警与每日额度。
7. 备份和恢复至少演练一次，升级前保留 JSON 与 GCS 对象版本。
8. 明确告知测试者：当前无音频、共享单租户、任务不可跨实例恢复，不上传敏感或未授权素材。
9. 浏览器实测登录、剧本、资产、分镜、视频、完整预览和退出登录。
10. 仿真人测试先确认面部并等待 AIGC 资源变为 Active；真人测试必须由演员本人完成认证授权，制作方接收后再绑定 Asset ID。

## 生产前必须替换

1. 使用 OIDC/JWT `AuthProvider`，禁止 Demo Header。
2. 使用持久化任务仓储，并为所有查询增加租户条件。
3. 使用原子积分账本，创建任务与扣费保证幂等。
4. 使用真实队列和 Worker 执行模型任务。
5. 增加结构化审计日志、速率限制、监控和告警。
6. 将密钥放入部署平台 Secret，不使用 `VITE_` 变量保存服务端密钥。
7. 增加邀请制账号管理、客户级租户隔离、数据导出与删除流程。

## CI

GitHub Actions 在每个 PR 执行 `pnpm check`，并构建 API/Web 容器但不推送。合并 `main` 后，CI 产生经过验证的模块发布清单，生产发布只使用该清单和对应 Commit SHA。建议保护 `main`：要求 CI 通过、至少一位 Review、禁止强制推送，并为 `production` Environment 配置审批规则。
