# 上线安全能力

## OIDC / JWT

生产环境建议使用 `AUTH_MODE=oidc`。API 只接受 `Authorization: Bearer <jwt>`，本地密码登录接口会返回 `OIDC_LOGIN_DISABLED`，避免 OIDC 接管后仍能绕回本地账号密码。

必填配置：

```bash
AUTH_MODE=oidc
OIDC_ISSUER_URL=https://issuer.example.com
OIDC_AUDIENCE=seqora-api
# 可选；为空时 API 会读取 OIDC discovery 中的 jwks_uri。
OIDC_JWKS_URL=https://issuer.example.com/jwks
```

JWT 校验项：

- `RS256` 签名，基于 JWKS 公钥校验。
- `iss` 必须匹配 `OIDC_ISSUER_URL`。
- `aud` 必须包含 `OIDC_AUDIENCE`。
- `exp`、`nbf`、`iat` 使用 `OIDC_CLOCK_TOLERANCE_SECONDS` 容忍时钟漂移。
- token 只证明“这个人是谁”；租户、角色、积分和计划仍从本地 `users` 表读取。

默认用 `email` claim 查找本地用户；找不到时再用 `sub` 查找本地用户 ID。可通过 `OIDC_EMAIL_CLAIM` 和 `OIDC_SUBJECT_CLAIM` 调整。

## 审计日志

API 会为非健康检查、非 metrics 的请求写入审计日志。记录内容包括：

- `requestId`、`traceId`
- `tenantId`、`userId`、`roles`
- HTTP method、route pattern、path、status code、outcome
- IP、User-Agent、路由参数和耗时

不记录请求 body、密码、API key、prompt 原文或上传文件内容。PostgreSQL 使用 `audit_logs` 表；本地 JSON 模式写入 `auditLogs`。管理员可通过：

```http
GET /api/v1/admin/audit-logs?limit=50
```

读取当前租户最近审计记录。

## 限流

当前限流窗口为 60 秒：

| Scope              | 默认限制 | Key               |
| ------------------ | -------: | ----------------- |
| `auth.login`       |       10 | IP                |
| `generation.tasks` |       30 | `tenantId:userId` |
| `media.upload`     |       15 | `tenantId:userId` |

配置项：

```bash
AUTH_LOGIN_RATE_LIMIT=10
TASK_CREATE_RATE_LIMIT=30
MEDIA_UPLOAD_RATE_LIMIT=15
```

有 `REDIS_URL` 时限流计数写入 Redis；没有 Redis 时回退进程内计数，适合本地开发。被限流时返回 `429 RATE_LIMITED`，并带 `Retry-After`、`x-rate-limit-limit`、`x-rate-limit-remaining`、`x-rate-limit-reset`。

## 监控和 Tracing

基础端点：

```http
GET /api/v1/health
GET /api/v1/health/ready
GET /api/v1/metrics
```

- `/health` 返回服务、存储、队列、Provider 配置状态，不暴露密钥。
- `/health/ready` 会探测 PostgreSQL 和队列 `ping`。
- `/metrics` 输出 Prometheus text format，包含 HTTP 请求数、耗时、限流命中和审计写入计数。

每个请求都会返回：

```http
x-request-id: <trace-id>
traceparent: 00-<trace-id>-<span-id>-01
```

如果上游传入合法 `traceparent`，API 会沿用 trace id 并生成新的 span id。

## 密钥管理

所有敏感变量仍只允许来自本地未提交 `.env`、部署环境变量或 secret manager。API 支持 Docker / Kubernetes 常见的 `*_FILE` 注入：

```bash
AUTH_SECRET_FILE=/run/secrets/seqora_auth_secret
SEEDANCE_API_KEY_FILE=/run/secrets/seedance_api_key
OSS_ACCESS_KEY_SECRET_FILE=/run/secrets/oss_access_key_secret
DATABASE_URL_FILE=/run/secrets/database_url
```

如果原变量已经存在，`*_FILE` 不覆盖原变量。不要把 secret 文件、真实 `.env`、测试快照或日志提交到 Git。

## 验收

提交前仍以根目录执行：

```bash
pnpm check
```

本轮新增测试覆盖：

- OIDC bearer JWT 校验和本地用户映射。
- OIDC 模式禁用本地密码登录。
- 跨租户项目和任务访问拒绝。
- 审计日志、request id、traceparent、readiness、metrics。
- 登录、生成任务和上传限流。
