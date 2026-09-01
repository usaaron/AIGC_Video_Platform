# Admin Console Context

The admin console is the operator-facing surface for platform accounts, organization spaces, plans, credits, sessions, audit records and compliance review.

## Language

**个人账号**:
管理后台中的 C 端普通用户账号记录，用于管理积分、状态、登录、套餐和资产。
_Avoid_: 个人组织、普通用户组织

**组织空间**:
企业或团队协作空间。
_Avoid_: 个人空间、个人组织

**成员**:
加入某个组织空间的用户。
_Avoid_: 平台管理员、个人账号

**套餐**:
账号或 membership 对应的付费档位和积分配置。
_Avoid_: 身份、角色

**合规审查**:
运营人员对提示词、生成输入和账号风险的人工审查区域。
_Avoid_: 自动封禁、内容分类器

**风险标签**:
合规审查中展示的风险分类和命中说明。
_Avoid_: 审查动作

**审查动作**:
运营人员对一条合规记录做出的人工处理结果。
_Avoid_: 风险标签
