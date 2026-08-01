# 组织概念迁移说明

## 当前口径

产品和前端对用户统一使用“组织”。组织用于表达一个创作团队、B 端客户、企业客户或内部测试空间的隔离边界。

底层数据库和部分兼容 API 仍保留 `tenant` 命名：

- `tenants`
- `tenant_memberships`
- `tenant_invitations`
- 请求主体中的 `tenantId`
- 项目、任务、账单、审计中的 `tenant_id`

这些字段暂时不做物理重命名，原因是它们已经进入 Postgres migration、队列 payload、审计日志、项目域外键和测试数据。直接改名会牵动线上迁移、队列兼容和历史数据解析。

## 本阶段 API 兼容规则

- 新增 `/api/v1/organizations/*`，作为 `/api/v1/workspaces/*` 和 `/api/v1/tenants/:tenantId/*` 的产品化入口。
- 新增 `/api/v1/admin/organizations/*`，作为 `/api/v1/admin/tenants/*` 的后台入口。
- 响应新增 `organizationId`、`organizationName`、`organizationStatus` 和 `organization` 字段。
- 旧字段 `tenantId`、`tenantName`、`tenantStatus`、`workspace`、`tenants` 继续返回，避免打断现有前端、测试、同事分支和历史脚本。
- 新代码优先使用 organization 路径和 organization 字段；底层仓储、权限过滤和数据库查询仍使用 `tenantId`。

## 后续物理迁移计划

1. 观察一个版本周期，确认前端和 admin console 都已切到 organization 路径。
2. 为 SDK、脚本和测试增加弃用扫描，禁止新增业务代码直接调用 `/tenants/*` 和 `/workspaces/*`。
3. 新增 migration 创建 organization 命名视图或兼容函数，先不改原表。
4. 如果确实需要物理表重命名，再单独做停机或双写迁移：
   - `tenants` -> `organizations`
   - `tenant_memberships` -> `organization_memberships`
   - `tenant_invitations` -> `organization_invitations`
   - 所有关联外键和索引改名
   - 队列 worker 兼容旧 `tenantId` payload
   - 审计日志和历史 JSON 导入脚本保留旧字段解析
5. 完成后再移除旧 API 字段和旧路由，移除前必须发布 breaking change 说明。

## 命名约定

- 用户可见：组织、管理员、普通成员、组织管理员、组织成员。
- API 新入口：`/organizations`、`/admin/organizations`。
- API 兼容字段：同时返回 `organization*` 和 `tenant*`。
- 数据库当前事实：继续使用 `tenant*` 表和列，直到单独物理迁移完成。
