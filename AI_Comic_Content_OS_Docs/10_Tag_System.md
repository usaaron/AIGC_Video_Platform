# 10_Tag_System

说明：
Tag负责资产检索。
所有Asset必须绑定Tag。
Tag遵循Ontology。

## 当前实现约束

当前 `TagRef` 不是自由标签，而是对 `OntologyNode` 的受控引用。

最小规则：

- `TagRef.ontology_node_id` 必须存在
- `TagRef.label` 必须与引用节点一致
- `TagRef.category` 必须与引用节点一致
- 不允许仅凭自由文本创建新标签
- `Asset.tags` 与 `ContentSpec.tags` 当前统一复用 `TagRef`
