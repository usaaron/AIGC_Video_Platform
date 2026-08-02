# 认证与权限设计

## 原则

- 认证回答“用户是谁”，授权回答“用户能做什么”。
- 前端隐藏按钮不等于授权，所有受保护 API 必须执行后端权限检查。
- 权限使用稳定的能力字符串，路由不直接判断角色名。
- 产品对外统一称为 `organization`；`tenant` 仅保留为内部物理表名、历史字段名和兼容 API 字段名。
- 数据查询同时检查权限和 `tenantId`，防止跨组织访问。

## 当前角色

| 角色                  | 用途           | 典型权限                                                  |
| --------------------- | -------------- | --------------------------------------------------------- |
| `member`              | C 端普通用户   | 项目、资产、生成、个人账单                                |
| `admin`               | 平台内部管理员 | 管理 C 端普通成员和部分后台运营事项                       |
| `organization_member` | B 端组织成员   | 使用所属组织授权的项目、资产和生成能力                    |
| `organization_admin`  | B 端组织管理员 | 只能管理自己组织内的组织成员、session、账单记录和任务排障 |
| `super_admin`         | 平台超级管理员 | 接近 owner 的全局运营权限，可管理管理员和普通用户         |
| `owner`               | 系统所有者     | 全部权限和系统配置，可任命 super_admin、管理组织负责人    |

角色与权限映射定义在 `packages/contracts/src/permissions.ts`。会员并发不是新权限，而是套餐额度策略，避免角色数量随套餐膨胀。

角色集合已冻结为这 6 种。新增能力应通过权限映射和组织边界扩展，不要再引入新的对外角色名。
详细术语冻结见 [产品词汇与权限冻结](PRODUCT_VOCABULARY.md)。
正式权限矩阵见 [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md)。

## 当前认证实现

`AUTH_MODE=local` 是当前默认路径。用户通过邮箱和密码登录，密码使用 `scrypt` 哈希，服务端签发 HttpOnly Cookie；Postgres `sessions` 表保存 session id、secret hash、过期时间、撤销时间、IP、User-Agent 和设备标签。

`AUTH_MODE=demo` 只允许开发/测试使用 header 模拟主体。生产环境禁止 `AUTH_MODE=demo`。`AUTH_MODE=oidc` 是预留方向，接入前必须完成签名、issuer、audience、过期时间和撤销策略校验。

普通注册、登录、改密和重置密码的契约下限为 8 位；生产 bootstrap 密码仍要求至少 12 位。显示名允许重复，规范化邮箱是账号唯一标识。

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

## 账号与组织边界

- 注册入口开放但必须使用组织邀请码：新邀请码固定为 8 位数字，数据库只保存哈希。用户先调用 `POST /api/v1/auth/registration-code/request` 提交邀请码和邮箱，再使用 6 位验证码调用 `POST /api/v1/auth/register`。
- 开放邀请码可在创建时不绑定邮箱，第一次成功请求验证码会原子绑定邮箱；后续换邮箱会被拒绝。验证码 10 分钟有效，存在重发冷却、错误尝试上限和 IP 频控。
- 已存在邮箱接受新组织邀请时复用原账号，不创建重复用户。注册页密码用于验证原账号；忘记密码时先完成密码重置，再返回注册流程。
- owner 可任命或移除 super_admin；owner/super_admin 可创建或移除平台 admin 和 organization_admin。
- 全平台最多只能有 1 个 active owner 账号、5 个 active super_admin 账号；数据库通过 `017_account_role_limits.sql` 的触发器兜底，API 在创建邀请、接受邀请、创建用户、添加成员和修改角色前先返回清晰的业务错误。
- 平台 admin 面向 C 端运营，可创建普通 member、修改普通 member、禁用普通 member membership 和查看自己授权范围内的 session。
- organization_admin 面向 B 端组织，只能创建 organization_member、修改 organization_member、禁用 organization_member membership 和查看当前组织 session。
- organization_admin 的管理范围以当前 `tenantId`/`organizationId` 为边界；面向 B 端客户时，为每个客户创建独立组织，避免不同组织管理员互相影响。
- owner 可以任命或撤销 super_admin；owner/super_admin 可以管理 organization_admin 和组织负责人。
- 用户不能修改自己的角色、禁用自己的当前 membership，或通过后台接口撤销自己的当前 session。
- 最后一个 active owner 不能被移除、禁用或自行退出组织。
- 组织改名允许 owner、super_admin、admin 或当前组织的 organization_admin 按范围执行；禁用组织只允许 owner；组织负责人更换只允许 owner/super_admin。

受控邀请 API 是注册准入来源。owner、super_admin、admin 或当前组织的 organization_admin 按权限创建邀请后会得到一次性 8 位邀请码；一个账号需要一个邀请码。无邀请码、过期、已使用、撤销、邮箱不匹配或 membership 已存在都会拒绝注册。历史 32 位以上 token 只保留兼容解析，不再新签发。

## 账号安全与审计

已实现：

- 登录、退出和 session 恢复。
- 自助改密，改密后撤销当前组织下已有 session。
- Resend 邮件投递：注册验证码、邮箱验证、邀请和密码重置。生产环境不在响应中返回 token 或验证码。
- 忘记密码请求和密码重置 token；请求始终返回统一成功文案，避免泄露邮箱是否存在。
- 个人 session 列表与撤销。
- 组织 session 列表与管理员踢下线。
- Admin Console session 查询和撤销。
- 审计日志：登录成功/失败、退出、改密、密码重置、成员/角色/组织/session/账单等敏感操作。

日志和审计元数据不得记录完整密码、token、第三方 Key、Cookie 或用户敏感原文。

## OIDC 接入位置

在 `apps/api/src/core/auth/provider.ts` 新增 OIDC 实现，校验签名、issuer、audience、过期时间和撤销策略。不要只解码 JWT，也不要信任前端传入的角色。

## 动态权限

当前映射适合早期固定角色。需要自定义组织角色时，将 `permissionsFor()` 背后的映射替换为策略仓储，并保留相同的 `Permission` 字符串和 `requirePermission()` 接口，路由无需变化。
