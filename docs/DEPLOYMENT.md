# 部署边界

本地生产近似环境与 CI 部署验收流程见 [DEPLOYMENT_ACCEPTANCE.md](DEPLOYMENT_ACCEPTANCE.md)。

## 独立部署单元

- `apps/web`：静态站点，可部署到 Vercel、Cloudflare Pages 或对象存储/CDN。
- `apps/api`：Node.js 服务，可部署到容器平台、云应用平台或虚拟机。
- `apps/admin`：未来独立静态站点，建议使用单独域名并限制访问来源。

Web 使用 `VITE_API_BASE_URL` 指向 API。API 使用 `WEB_ORIGIN` 限制跨域来源。生产中两者可以使用 `studio.example.com` 和 `api.example.com`。

媒体上传通过 `ObjectStorage` 接口写入后端配置的对象存储。生产环境禁止 `STORAGE_DRIVER=local`；可选 `STORAGE_DRIVER=gcs` 搭配 `GCS_BUCKET` 和 Google ADC / `GOOGLE_APPLICATION_CREDENTIALS`，或 `STORAGE_DRIVER=oss` 搭配 `OSS_REGION`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID` 和 `OSS_ACCESS_KEY_SECRET`。业务模块禁止直接调用云厂商 SDK。

所有 API Key、对象存储凭据、数据库连接串和会话签名密钥只允许通过环境变量或部署平台 Secret Manager 注入，规则见 [密钥管理](SECRETS.md)。服务端密钥不能使用 `VITE_*` 前缀，也不能注入 Web 静态站点。

## 生产构建

本地或 CI 中使用固定 Node.js 22.13+ 和 pnpm 11+：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build:production
```

构建产物：

- `packages/contracts/dist`：运行时 Zod schema、权限常量和类型声明。
- `apps/api/dist`：Fastify API，可用 `pnpm --filter @seqora/api start` 启动。
- `apps/web/dist`：Vite 静态产物，可部署到 CDN、对象存储或 Nginx。

生产 API 启动前必须提供环境变量，不从 Git 中读取真实 `.env`：

```bash
NODE_ENV=production
API_HOST=0.0.0.0
API_PORT=8787
WEB_ORIGIN=https://studio.example.com
AUTH_MODE=local
STORAGE_DRIVER=oss
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=seqora-media

# 由 Secret Manager 注入，示例不写实际值。
AUTH_SECRET=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
SEEDANCE_API_KEY=
```

生产数据存储必须使用 PostgreSQL：

```bash
DATA_STORE=postgres
DATABASE_URL=postgres://seqora:seqora@127.0.0.1:5432/seqora
pnpm --filter @seqora/api db:migrate
pnpm --filter @seqora/api db:import-json -- --file apps/api/data/app.json
```

`db:migrate` 可以重复执行，只会应用未执行的 SQL migration。`db:import-json` 用于一次性把本地 JSON 状态导入 PostgreSQL，导入完成后生产环境不再依赖 `DATA_FILE`。

生产任务执行必须拆成 API 和 Worker 两个进程，并通过 Redis/BullMQ 连接：

```bash
TASK_QUEUE_DRIVER=bullmq
REDIS_URL=redis://redis:6379
TASK_WORKER_CONCURRENCY=4
TASK_QUEUE_TICK_INTERVAL_MS=1000
pnpm --filter @seqora/api start
pnpm --filter @seqora/api start:worker
```

API 进程只创建任务和写入 BullMQ 队列；Worker 进程消费队列并定时触发生成任务 tick。免费版单路、会员三路并发限制在任务 claim 事务中执行，PostgreSQL 使用用户行锁和任务 `FOR UPDATE SKIP LOCKED` 串行化选择；BullMQ 负责进程间分发、重试和任务锁。

成片 MP4 导出在 Worker 中调用 `ffmpeg` 拼接已完成的单镜头视频，并把结果写回 OSS/GCS。部署镜像或主机必须安装 ffmpeg，或通过 `FILM_EXPORT_FFMPEG_PATH` 指向可执行文件；音频 Provider 可用 `AUDIO_API_KEY` 单独配置，也可留空复用 `SEEDANCE_API_KEY`。

部署后检查：

```bash
curl https://api.example.com/api/v1/health
```

健康检查只返回服务状态、Provider 配置状态和存储驱动名称，不返回密钥。

## 容器镜像

API 镜像：

```bash
docker build -f apps/api/Dockerfile -t seqora-api:local .
docker run --rm --env-file apps/api/.env -p 8787:8787 seqora-api:local
```

Web 镜像：

```bash
docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=https://api.example.com/api/v1 -t seqora-web:local .
docker run --rm -p 8080:80 seqora-web:local
```

如果 Web 和 API 同域部署，`VITE_API_BASE_URL` 可保持默认 `/api/v1`，由网关把 `/api/*` 转发到 API 服务。

## 生产前必须替换

1. 使用 OIDC/JWT `AuthProvider`，禁止 Demo Header。
2. 使用持久化任务仓储，并为所有查询增加租户条件。
3. 使用原子积分账本，创建任务与扣费保证幂等。
4. 使用真实队列和 Worker 执行模型任务。
5. 使用 GCS 或 OSS 保存上传媒体，禁止生产环境写本地上传目录。
6. 增加结构化审计日志、速率限制、监控和告警。
7. 将密钥放入部署平台 Secret，不使用 `VITE_` 变量保存服务端密钥。

## CI

GitHub Actions 配置在 `.github/workflows/ci.yml`，对 `main`、`feat/seedance-image-providers` 的 push 和所有 PR 执行：

1. 安装 Node.js 22.13.0 和 pnpm 11.7.0。
2. `pnpm install --frozen-lockfile`。
3. `pnpm check`，与本地提交前标准一致，覆盖格式检查、Lint、生产构建、单元测试。

建议保护 `main`：要求 CI 通过、至少一位 Review、禁止强制推送，并分别配置 Web/API 部署环境与审批规则。
