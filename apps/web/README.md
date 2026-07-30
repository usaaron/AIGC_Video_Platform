# Web

React + Vite 创作端，默认监听 `http://localhost:5173`，开发服务器将 `/api` 代理到本地 API。

```bash
cp .env.example .env.local
pnpm --filter @seqora/web dev
```

## 边界

页面不能直接实现权限、积分或跨租户规则；这些规则由 API 负责。前端只能根据 `/api/v1/auth/me` 返回的主体、角色和权限改善显示状态，不能把隐藏按钮当成授权。

`src/services/apiClient.js` 是唯一的 API 客户端入口。新增后端接口时，先更新 `@seqora/contracts` 和 API，再把调用封装到 `apiClient`，最后在页面中消费。

## 当前主要页面

- 登录页：处理账号密码登录和邀请码注册；注册必须提交受邀邮箱、姓名、密码和邀请 token。
- 创作工作台：概览、剧本、资产、分镜、生成队列、完整成片、账单和设置。
- 账号安全：自助改密、当前登录 session 列表、撤销指定 session。
- 账号管理/管理员端：owner/admin 可见；普通成员只看到个人资料提示。

账号管理页已接入：

- workspace 切换、改名、禁用、转让 owner、退出 workspace。
- 成员列表、创建租户用户、添加已有用户、角色修改、禁用 membership。
- tenant session 列表和踢下线。

所有会改变权限、成员状态、workspace 状态或 session 状态的操作必须弹出二次确认。owner 才能添加/删除管理员、转让 owner 和禁用 workspace；admin 只能管理普通成员。

## 验证

```bash
pnpm --filter @seqora/web lint
pnpm --filter @seqora/web test
pnpm --filter @seqora/web build
```

UI 变更至少检查桌面宽度和 `390px` 移动宽度，确保没有横向溢出、按钮文字截断或内容遮挡。
