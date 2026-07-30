# 管理员端预留目录

管理员端将作为独立应用部署，不与创作端共享页面路由或构建产物。当前正式的后台后端能力已经位于 `/api/v1/admin/*`，创作端内也有一个临时账号管理/管理员端入口用于测试账号、workspace、membership 和 session 管理。

独立 `apps/admin` 启动开发前，应先复用现有 Admin Console API，不要重新定义一套后台协议。

约束：

- 复用 `@seqora/contracts` 中的角色、权限和响应结构。
- 通过 `/api/v1/auth/me` 获取当前主体与权限，按权限展示菜单。
- 页面隐藏只改善体验，所有管理 API 仍必须在后端执行 `requirePermission`。
- 首屏优先消费 `GET /api/v1/admin/console`，它统一返回 overview、用户、租户、membership、账单账户、账单流水、session 和审计日志。
- 高风险操作必须二次确认：账号启停、workspace 禁用、owner 转让、角色变更、membership 禁用、session 撤销、充值和调账。
- 不提供任意 SQL、任意 JSON 编辑或绕过 Service 的数据库操作。

首批独立页面建议：

- 用户与账号状态。
- 租户/workspace 和 membership。
- 账单账户、ledger、充值和调账。
- Session 设备信息和踢下线。
- 审计日志查询。
