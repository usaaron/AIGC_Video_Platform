# 产品词汇与权限冻结

这份文档是当前产品对外命名和权限模型的冻结说明。

## 对外统一词汇

- 对外只叫 `organization`。
- 前端文案、公开 API、对外文档都使用 `organization`。
- `workspace` 只保留为历史兼容别名，不再作为新产品概念使用。
- `tenant` 只保留为内部物理表名、历史字段名和兼容响应字段名。

## 权限模型冻结

当前权限模型固定为 6 种角色：

- `owner`
- `super_admin`
- `admin`
- `member`
- `organization_admin`
- `organization_member`

原则：

- `owner` 是全局最高控制权。
- `super_admin` 接近 `owner`，但不替代 `owner` 的最终控制权。
- `admin` 只管平台内部运营和部分 C 端成员。
- `member` 是 C 端普通用户。
- `organization_admin` 只管理自己组织下的成员和记录。
- `organization_member` 只使用自己组织授权的能力。

## 实施规则

- 新增对外路由优先使用 `/organizations/*` 和 `/admin/organizations/*`。
- 新增前端按钮、页面标题、表格列名、空状态文案优先使用 `organization`。
- 新增数据库迁移、仓储、审计、队列 payload 时，只有在接触历史兼容层时才使用 `tenant*`。
- 任何新的公开 API 或 UI 词汇，不要再引入 `workspace` 作为同义词。
- 如果必须保留兼容字段或兼容路由，必须在文档里明确标注 deprecated 或 compatibility。

## 参考文档

- [组织概念迁移说明](ORGANIZATION_MIGRATION.md)
- [认证与权限设计](AUTHORIZATION.md)
- [正式权限矩阵](PERMISSION_MATRIX.md)
