# 管理员端

管理员端是独立 Vite/React 应用，不与创作端共享页面路由或构建产物。当前首屏消费 `GET /api/v1/admin/console`，统一展示 overview、用户、租户、membership、账单账户、账单流水、session 和审计日志。

## 本地运行

先启动 API：

```bash
pnpm dev:api
```

再启动管理员端：

```bash
pnpm dev:admin
```

默认地址是 [http://localhost:5174](http://localhost:5174)。Vite 会把 `/api` 代理到 `http://127.0.0.1:8787`，登录 Cookie 保持同源。

约束：

- 复用 `@seqora/contracts` 中的角色、权限和响应结构。
- 通过 `/api/v1/auth/me` 获取当前主体与权限，按权限展示菜单。
- 页面隐藏只改善体验，所有管理 API 仍必须在后端执行 `requirePermission`。
- 首屏优先消费 `GET /api/v1/admin/console`，它统一返回 overview、用户、租户、membership、账单账户、账单流水、session 和审计日志。
- 高风险操作必须二次确认：账号启停、workspace 禁用、owner 转让、角色变更、membership 禁用、session 撤销、充值和调账。
- 不提供任意 SQL、任意 JSON 编辑或绕过 Service 的数据库操作。

当前页面：

- 用户与账号状态。
- 租户/workspace 和 membership。
- 账单账户、ledger、充值和调账。
- Session 设备信息和踢下线。
- 审计日志查询。
