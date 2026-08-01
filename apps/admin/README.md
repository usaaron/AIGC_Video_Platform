# 管理员端

管理员端是独立 Vite/React 应用，不与创作端共享页面路由或构建产物。当前首屏消费 `GET /api/v1/admin/console`，统一展示 overview、用户、组织、membership、账单账户、账单流水、session 和审计日志。

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
- 首屏优先消费 `GET /api/v1/admin/console`，它统一返回 overview、用户、组织、membership、账单账户、账单流水、session 和审计日志。
- 高风险操作必须二次确认：账号启停、组织禁用、owner 转让、角色变更、membership 禁用、session 撤销、充值和调账。
- 不提供任意 SQL、任意 JSON 编辑或绕过 Service 的数据库操作。

当前页面：

- 用户与账号状态。
- 组织和 membership。
- 账单流水查询。
- 账单调账页面：选择目标 membership、预览调账后余额、提交调账、查看最近充值/调账流水。
- Session 设备信息和踢下线。
- Session 风险视图：按高权限账号、多活跃 session、缺少设备/IP 和长期未活跃做风险分级。
- 审计日志页面：按 action 和 resourceType 筛选，展示事件流、操作者、目标用户、IP 和 metadata。
