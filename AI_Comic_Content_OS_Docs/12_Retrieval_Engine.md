# 12_Retrieval_Engine

根据 ContentSpec 并行检索多个资产库。

支持：
- Tag 检索
- 向量检索
- Graph 检索

## 当前阶段接口关系

当前阶段 Retrieval Engine 的上游输入应逐步由 `OrchestrationPlan.asset_requests` 提供。

也就是说：

- `ContentSpec` 负责表达内容目标
- `Orchestrator` 负责把内容目标转成结构化资产请求
- Retrieval Engine 负责根据这些请求检索候选资产

## 当前依赖前提

当前 Retrieval Engine 的基础前提是：

- `Knowledge Base` 已先沉淀统一 `Asset`
- `Asset` 已通过受控 `TagRef` 与 Ontology 对齐
- 后续 Retrieval 再基于这些标准化资产做检索

因此，当前阶段应先稳定 `Asset` 数据契约，再实现复杂检索策略。

## 当前最小实现

当前已实现最小规则检索：

- 输入：`RetrievalResolveRequest(plan_id)`
- 中间输入：`OrchestrationPlan.asset_requests`
- 检索依据：
  - `asset_type`
  - `required_tag_ids`
  - `optional_tag_ids`
  - `applicable_platform_profile_ids`
  - `is_active`
- 输出：`RetrievalPlanResult`

## 当前不实现

当前不实现：

- 向量检索
- Graph 检索
- Embedding 排序
- 语义召回
- 自动重写检索请求
