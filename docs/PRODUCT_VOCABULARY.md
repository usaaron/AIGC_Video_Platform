# 产品词汇与权限冻结

这份文档是当前产品对外命名和权限模型的冻结说明。

## 对外统一词汇

- `组织空间` 只用于企业或团队协作空间。
- 普通个人用户界面默认显示“当前账号数据”，不要强调“组织：个人”或“个人空间”。
- 只有用户加入多个企业/团队空间时，才显示“切换组织/空间”。
- `个人账号` 是管理后台和交付语境中的 C 端账号管理概念，不作为普通用户主界面标题。
- `workspace` 只保留为历史兼容别名，不再作为新产品概念使用。
- `tenant` 只保留为内部物理表名、历史字段名和兼容响应字段名。
- `organizationType: personal` 继续保留在后端兼容层，但不能反向决定普通用户界面文案。

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
- `member` 是 C 端普通个人账号。
- `organization_admin` 只管理自己组织空间下的成员和记录。
- `organization_member` 只使用自己组织空间授权的能力。

## 实施规则

- 新增企业/团队对外路由优先使用 `/organizations/*` 和 `/admin/organizations/*`。
- 新增前端按钮、页面标题、表格列名、空状态文案必须先判断语境：个人用户用“当前账号数据”，企业/团队用“组织空间”。
- 新增数据库迁移、仓储、审计、队列 payload 时，只有在接触历史兼容层时才使用 `tenant*`。
- 任何新的公开 API 或 UI 词汇，不要再引入 `workspace` 作为同义词。
- 如果必须保留兼容字段或兼容路由，必须在文档里明确标注 deprecated 或 compatibility。

## 参考文档

- [组织概念迁移说明](ORGANIZATION_MIGRATION.md)
- [认证与权限设计](AUTHORIZATION.md)
- [正式权限矩阵](PERMISSION_MATRIX.md)
