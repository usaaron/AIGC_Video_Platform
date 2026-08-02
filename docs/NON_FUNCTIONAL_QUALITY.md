# 非功能质量

这份文档定义后端的生存底线：性能、混沌、安全。

## 1. 性能压测

脚本：

```bash
pnpm perf:k6:smoke
pnpm perf:k6:breakpoint
```

说明：

- `smoke` 用固定并发观察常态吞吐、P95 延迟和错误率。
- `breakpoint` 用递增到崩溃附近的方式找拐点。
- 默认压测脚本会登录一个成员账号，然后连续读取 `auth/me`、项目、账单和 readiness。

运行前准备：

- 启动 API、Postgres、Redis。
- 提供 `BASE_URL`、`EMAIL`、`PASSWORD`、`PROJECT_ID` 可覆盖默认值。

关注指标：

- `http_req_failed`
- `http_req_duration`
- API 日志里的慢 SQL
- Node 进程内存、事件循环延迟、GC 频率

## 2. 混沌工程

当前仓库提供的是 Chaos Mesh 清单模板，适合在 Kubernetes 环境里对 Redis、Postgres 做故障注入。

清单：

- `deploy/chaos/redis-network-delay.yaml`
- `deploy/chaos/redis-network-loss.yaml`
- `deploy/chaos/postgres-io-latency.yaml`

目标：

- Redis 超时、抖动、丢包
- Postgres 磁盘 IO 延迟
- 验证重试、超时和降级是否生效

建议验证点：

- `GET /api/v1/health/readiness`
- BullMQ 任务投递
- 登录后会话读取
- billing 扣费和回滚

## 3. 安全测试

可执行脚本：

```bash
pnpm security:audit
pnpm security:dependency-check
pnpm security:sonar
pnpm test:backend:security
```

说明：

- `pnpm security:audit` 负责 pnpm 依赖审计，适合 CI 快速门禁。
- `pnpm security:dependency-check` 通过 OWASP Dependency-Check 扫描依赖漏洞。
- `pnpm security:sonar` 通过 SonarQube 做静态分析。
- `pnpm test:backend:security` 覆盖 session 过期、篡改 cookie、垂直越权、水平跨组织访问。

## 4. 推荐 CI 顺序

1. 单元、契约、集成测试。
2. `pnpm security:audit`
3. `pnpm test:backend:security`
4. 周期性或手动触发 `security:dependency-check`
5. 有 Sonar token 时执行 `security:sonar`
6. 压测和混沌工程放在预发或专门环境，不放进普通 PR 流水线。
