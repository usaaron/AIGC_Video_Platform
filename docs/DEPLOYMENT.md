# 部署边界

## 独立部署单元

- `apps/web`：静态站点，可部署到 Vercel、Cloudflare Pages 或对象存储/CDN。
- `apps/api`：Node.js 服务，可部署到容器平台、云应用平台或虚拟机。
- `apps/admin`：未来独立静态站点，建议使用单独域名并限制访问来源。

Web 使用 `VITE_API_BASE_URL` 指向 API。API 使用 `WEB_ORIGIN` 限制跨域来源。生产中两者可以使用 `studio.example.com` 和 `api.example.com`。

## 生产前必须替换

1. 使用 OIDC/JWT `AuthProvider`，禁止 Demo Header。
2. 使用持久化任务仓储，并为所有查询增加租户条件。
3. 使用原子积分账本，创建任务与扣费保证幂等。
4. 使用真实队列和 Worker 执行模型任务。
5. 增加结构化审计日志、速率限制、监控和告警。
6. 将密钥放入部署平台 Secret，不使用 `VITE_` 变量保存服务端密钥。

## CI

GitHub Actions 在每个 PR 执行 `pnpm check`。建议保护 `main`：要求 CI 通过、至少一位 Review、禁止强制推送，并分别配置 Web/API 部署环境与审批规则。
