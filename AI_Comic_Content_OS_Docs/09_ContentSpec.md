# 09_ContentSpec

ContentSpec 是系统唯一中间对象。

## 设计目标

`ContentSpec` 用于承接：

数据分析
→ 内容决策
→ 资产检索
→ 编排
→ 剧本生成

系统中的其他模块应尽量读取、更新或生成 `ContentSpec`，而不是私下传递松散数据。

## 当前字段

- `id`
- `title`
- `status`
- `audience_goal`
- `commercial_goal`
- `platform_goal`
- `story_goal`
- `quality_level`
- `budget_level`
- `tags`
- `creative_brief`
- `metadata`
- `created_at`
- `updated_at`

## 子结构

### Audience Goal / Commercial Goal

统一使用 `TargetGoal` 结构：

- `summary`
- `priority`
- `success_metric`

### Platform Goal

当前使用 `PlatformGoal`：

- `platform_profile_id`
- `objective`
- `target_duration_seconds`
- `target_aspect_ratio`

说明：

- `platform_profile_id` 只表示引用哪个平台画像
- 当前已可引用独立 `PlatformProfile.id`，例如 `tiktok_v1`
- TikTok 的推荐、收益、政策、发布时间策略不属于 `ContentSpec` 本体字段

### Tags

当前使用 `TagRef`：

- `ontology_node_id`
- `label`
- `category`
- `confidence`

约束：

- 必须引用统一 Ontology 节点
- 同一标签不可重复

### Creative Brief

当前包含：

- `hook`
- `tone`
- `pacing`
- `target_emotion`
- `asset_constraints`
- `generation_notes`

## 当前校验规则

- `tags` 至少 1 个
- 所有模型 `extra=forbid`
- `quality_level=premium` 不能和 `budget_level=low` 组合
- `platform_profile_id` 必须引用已存在的 `PlatformProfile`
- `tags` 必须引用已存在的 `OntologyNode`
- `TagRef.label/category` 必须与被引用的 `OntologyNode` 定义一致

## 当前实现状态

已实现：

- Pydantic 模型
- FastAPI API
- 内存仓储
- 单元测试
- API 测试

未实现：

- 版本历史
- 审批流转
- 数据库存储
- 与 Asset Retrieval / Orchestrator / Script Engine 的联动
