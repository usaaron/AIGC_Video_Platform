# 认证与权限设计

## 原则

- 认证回答“用户是谁”，授权回答“用户能做什么”。
- 前端隐藏按钮不等于授权，所有受保护 API 必须执行后端权限检查。
- 权限使用稳定的能力字符串，路由不直接判断角色名。
- 数据查询同时检查权限和 `tenantId`，防止跨租户访问。

## 当前角色

| 角色      | 用途       | 典型权限                                  |
| --------- | ---------- | ----------------------------------------- |
| `creator` | 免费创作者 | 项目、资产、生成、个人账单                |
| `member`  | 订阅创作者 | 与 creator 相同，额度与并发由套餐策略决定 |
| `admin`   | 运营管理员 | 用户查询、全局账单、任务排障、管理概览    |
| `owner`   | 系统所有者 | 全部权限和系统配置                        |

角色与权限映射定义在 `packages/contracts/src/permissions.ts`。会员并发不是新权限，而是套餐额度策略，避免角色数量随套餐膨胀。

## 当前认证实现

`AUTH_MODE=local` 是当前默认路径。用户通过邮箱和密码登录，密码使用 `scrypt` 哈希，服务端签发 HttpOnly Cookie；Postgres `sessions` 表保存 session id、secret hash、过期时间、撤销时间、IP、User-Agent 和设备标签。

`AUTH_MODE=demo` 只允许开发/测试使用 header 模拟主体。生产环境禁止 `AUTH_MODE=demo`。`AUTH_MODE=oidc` 是预留方向，接入前必须完成签名、issuer、audience、过期时间和撤销策略校验。

账号相关正式表：

- `users`
- `auth_identities`
- `tenant_memberships`
- `sessions`
- `billing_accounts`
- `password_reset_tokens`
- `audit_log_entries`

## 请求流程

1. `AuthProvider` 验证 Token 并产生 `Principal`。
2. `requirePermission()` 聚合主体角色对应的权限。
3. 路由拒绝无权限请求。
4. 仓储按主体的 `tenantId` 限制数据范围。
5. 计费或敏感操作写入审计日志。

开发环境可通过 `x-demo-role`、`x-demo-user-id`、`x-demo-tenant-id` 模拟主体。生产环境禁止 `AUTH_MODE=demo`。

## 账号与租户边界

- 注册入口开放但必须使用租户邀请码：`POST /api/v1/auth/register` 要求提交邀请 token、受邀邮箱、姓名和密码；邮箱必须匹配邀请绑定邮箱。
- owner/admin 可创建租户用户、添加已有用户、修改普通成员角色、禁用 membership 和查看 tenant session。
- 只有 owner 可以添加或删除管理员、管理 owner/admin membership、转让 workspace owner、禁用 workspace 和撤销 owner/admin session。
- 用户不能修改自己的角色、禁用自己的当前 membership，或通过后台接口撤销自己的当前 session。
- 最后一个 active owner 不能被移除、禁用或自行退出 workspace。
- Workspace 改名允许 owner/admin；禁用 workspace 和转让 owner 只允许 owner。

受控邀请 API 是注册准入来源。owner/admin 创建邀请后会得到一次性 token；无 token、token 过期、已使用、撤销或邮箱不匹配都会拒绝注册。

## 账号安全与审计

已实现：

- 登录、退出和 session 恢复。
- 自助改密，改密后撤销当前租户下已有 session。
- 忘记密码请求和密码重置 token；非生产测试环境可返回 token，生产环境需要接邮件/短信投递后才能对用户开放。
- 个人 session 列表与撤销。
- tenant session 列表与管理员踢下线。
- Admin Console session 查询和撤销。
- 审计日志：登录成功/失败、退出、改密、密码重置、成员/角色/workspace/session/账单等敏感操作。

日志和审计元数据不得记录完整密码、token、第三方 Key、Cookie 或用户敏感原文。

## OIDC 接入位置

在 `apps/api/src/core/auth/provider.ts` 新增 OIDC 实现，校验签名、issuer、audience、过期时间和撤销策略。不要只解码 JWT，也不要信任前端传入的角色。

## 动态权限

当前映射适合早期固定角色。需要自定义组织角色时，将 `permissionsFor()` 背后的映射替换为策略仓储，并保留相同的 `Permission` 字符串和 `requirePermission()` 接口，路由无需变化。
