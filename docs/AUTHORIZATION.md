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

## 请求流程

1. `AuthProvider` 验证 Token 并产生 `Principal`。
2. `requirePermission()` 聚合主体角色对应的权限。
3. 路由拒绝无权限请求。
4. 仓储按主体的 `tenantId` 限制数据范围。
5. 计费或敏感操作写入审计日志。

开发环境可通过 `x-demo-role`、`x-demo-user-id`、`x-demo-tenant-id` 模拟主体。生产环境禁止 `AUTH_MODE=demo`。

## OIDC 接入位置

在 `apps/api/src/core/auth/provider.ts` 新增 OIDC 实现，校验签名、issuer、audience、过期时间和撤销策略。不要只解码 JWT，也不要信任前端传入的角色。

## 动态权限

当前映射适合早期固定角色。需要自定义组织角色时，将 `permissionsFor()` 背后的映射替换为策略仓储，并保留相同的 `Permission` 字符串和 `requirePermission()` 接口，路由无需变化。
