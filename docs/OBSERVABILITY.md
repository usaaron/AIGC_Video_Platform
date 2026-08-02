# Backend Observability

后端当前提供轻量、无额外基础设施依赖的观测层，目标是先覆盖生产排障最需要的字段、健康检查和任务指标。后续接入 Prometheus 或 OpenTelemetry 时，应优先复用 `apps/api/src/core/observability` 的边界。

## HTTP

- 所有请求响应头包含 `x-request-id`。
- Fastify request log 会记录 `requestId`、`tenantId`、`userId`、`taskId`、`jobId`、`projectId`、`method`、`route`、`statusCode`、`durationMs`。
- HTTP 指标记录请求量和耗时，按 method、route、状态码等级和 tenant 维度聚合。

## Health

- `GET /api/v1/health` 保留原有 `status/providers/providerNames/taskQueue` 字段，并追加 `readiness`。
- `GET /api/v1/health/readiness` 返回 readiness 快照；任一必需组件未 ready 时返回 `503`。
- DB readiness 使用 `SELECT 1`。
- BullMQ readiness 检查 Redis ping、队列 waiting/delayed/active/completed/failed counts，以及 worker heartbeat。
- `inline` 和 `none` 队列模式会显式标记 Redis/Worker 是否 disabled、ready 或 missing。

## Metrics

`GET /api/v1/observability/metrics` 需要 `admin.dashboard.read` 权限。平台管理员可看全局快照，租户管理员只看本租户日汇总和租户范围内的指标标签。

返回内容包括：

- HTTP 请求量和耗时。
- BullMQ 入队次数、队列等待时间、执行时间、失败数。
- `generation_tasks` 等待时间、执行时间、终态计数。
- `ai_jobs` 等待时间、执行时间、终态计数。
- Provider 调用耗时、失败数、最后错误码。
- 退款次数、退款积分、按租户退款计数。
- 完整成片合成执行时间和失败数。
- 当天积分消耗、generation task 成功率、AI Job 成功率、视频合成失败率。

## Current Boundaries

- 这是进程内指标聚合，不跨进程持久化；多 API/Worker 实例部署时，应把该层替换或桥接到集中式 metrics backend。
- 日汇总来自当前运行缓存/Store；Postgres 模式下 Repository 负责从 DB 刷新或镜像运行缓存。
- Worker 的外部可观测性通过 BullMQ heartbeat 暴露到 API readiness；Worker 进程本身不启动 HTTP 服务。
