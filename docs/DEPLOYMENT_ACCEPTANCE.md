# 部署验收

本项目提供一套本地生产近似环境，用于在没有真实 OSS/GCS 和模型 Key 的情况下验证生产底座：

- PostgreSQL 持久化数据与 SQL migrations。
- Redis/BullMQ 拆分 API 与 Worker。
- API runtime 镜像内置 `ffmpeg`，用于成片 MP4 导出。
- `STORAGE_DRIVER=mock` 走 `ObjectStorage` 接口，使用本地卷模拟受控对象存储。
- Provider Key 留空时继续走本地 mock，便于验证任务队列和结果回写。

## 本地一键启动

```bash
pnpm deploy:local
```

服务端口：

- Web: http://localhost:8080
- API: http://localhost:8787/api/v1/health
- PostgreSQL: localhost:5432
- Redis: localhost:6379

首次启动会执行：

1. `migrations/*.sql`
2. `apps/api/data/app.json` seed 导入
3. API 服务
4. Worker 服务
5. Web 静态站点

停止环境：

```bash
pnpm deploy:local:down
```

如果需要清空本地数据卷：

```bash
docker compose down -v
```

## 本地冒烟验收

Compose 启动后执行：

```bash
pnpm deploy:smoke
```

脚本会验证：

- `/api/v1/health` 返回 `dataStore=postgres`、`taskQueue=bullmq`、`storage=mock`。
- 本地账号可以登录。
- 媒体上传和读取能通过 mock ObjectStorage 完成。
- API 创建生成任务后，Redis Worker 能消费并完成任务。

## CI 验收

GitHub Actions 的 `deployment-acceptance` job 会：

1. 启动 PostgreSQL 和 Redis service containers。
2. 安装 `ffmpeg`。
3. 校验 `docker compose config`。
4. 构建 contracts 和 API。
5. 执行 SQL migrations。
6. 导入 seed JSON。
7. 启动 API 和 Redis Worker。
8. 执行 `pnpm deploy:smoke`。

`STORAGE_DRIVER=mock` 只用于部署验收。真实生产必须使用 `STORAGE_DRIVER=gcs` 或 `STORAGE_DRIVER=oss`，并通过部署平台 Secret 注入凭据。
