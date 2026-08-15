# Tag Context Library v1 Architecture

## Purpose

本文定义中国大陆长篇漫剧创作中标签系统的长期目标。它属于 Research / Contract Direction，不批准新的 runtime、RAG、自动爬虫或动态建库实现。

状态说明（2026-08-05）：Story Bible、可变深度递归 StoryPlanNode、EpisodePlan 及人工批准界面已经形成最小 runtime slice；本文仍未批准的是 Tag Evidence、Tag Knowledge Profile、动态 Tag Context Retrieval、自定义标签即时语义库和实时热门接入。

标签系统的产品价值不是“给 Prompt 多塞几个词”，而是让创作者通过一个简短标签，安全地引用一组有来源、可解释、可版本化的创作上下文，用于更准确地形成故事梗概和剧情大方向。

目标链路分为两个阶段：

```text
阶段一：创作方向形成

User Prompt + Selected Tags + Optional Character Input
→ Tag Context Resolution
→ Creative Intent Resolution
→ Story Synopsis / Story Direction / Story Bible Root

阶段二：长篇内容展开

Confirmed Story Direction
→ Recursive Story Plan Nodes
→ Episode Plans
→ Episode Script Generation
→ Cumulative Long-form Story Body
```

标签主要服务阶段一。它不直接承担 60 万字扩写，也不能替代 Story Bible、递归规划、Episode Plan 和连续性控制。

## Four Different Concepts

### Ontology Tag

稳定概念身份，例如 `theme.rebirth`。它回答“这是什么概念”，负责 ID、分类、别名和生命周期，不保存大量来源内容，也不保存实时热度。

### Tag Evidence Library

保存该标签从哪些内容、数据分析结果或受治理资料中提取而来。它回答“为什么系统认为这个标签有这些含义”。

建议保留：

- `tag_id`
- `source_refs`
- `analysis_result_refs`
- `extracted_pattern_refs`
- `market_profile`
- `observation_window`
- `license_or_usage_status`
- `extraction_method`
- `confidence`
- `version`

来源内容应优先保存引用和可治理摘要，不应因为建立标签库而复制未授权的完整作品。

### Tag Knowledge Profile

把多个来源证据聚合为可供创作使用的结构化画像。它回答“选中该标签时，哪些信息有助于形成故事梗概”。候选信息包括：

- 概念定义与适用边界
- 常见受众期待与情绪承诺
- 可用的故事驱动力与冲突机制
- 常见人物关系和角色目标
- 常见开局、转折、升级与结局功能
- 容易重复、陈旧或冲突的反模式
- 适用市场、题材和人群
- 来源引用、置信度和版本

它不是固定剧情模板，也不能把某部热门作品的具体人物和情节复制到新故事。

### Trend Signal

实时热度是标签在特定市场和时间窗口下的动态信号，不是标签身份本身。候选字段包括：

- `tag_id`
- `market_profile`
- `window_start / window_end`
- `popularity_score`
- `growth_rate`
- `sample_size`
- `source_refs`
- `calculated_at`
- `confidence`

未来由 Data Intelligence 的 `TrendSnapshot / AnalysisResult` 提供。当前前端“灵感推荐”只是静态策划建议，不得标记为实时热门。

## Regular Tag Lifecycle

```text
Licensed / Permitted Content References
→ RawContentRecord / AnalysisResult
→ Tag Extraction Evidence
→ Existing Ontology Match or Governed Candidate
→ Tag Evidence Library
→ Versioned Tag Knowledge Profile
→ Bounded Tag Context Bundle
```

用户选择常规标签时，系统未来应检索有界上下文，而不是把该标签关联的全部内容直接放入 Prompt。检索结果必须保留来源、版本、采用原因和未采用原因。

### Tag Combination Control

创作价值通常来自标签组合，例如“现代言情 + 重生 + 家族冲突 + 爽感”，但不能为所有排列组合预建独立知识库。未来 Resolver 应：

1. 区分 primary genre、core story elements、relationship/conflict、emotional promise 和 audience role。
2. 分别检索各标签的有限画像，再合成为一个 bounded bundle。
3. 检测相互强化、重复和冲突的原则。
4. 向用户展示主要采用方向和冲突警告。
5. 不因标签数量增加而线性拼接全部知识文本。

当前最多选择 12 个标签只是安全上限，不是推荐填满。产品层更适合引导用户选择一个主要题材、少量核心元素、一到两个情绪方向和必要受众信号。

## Custom Tag Lifecycle

自定义标签不能只凭标签名称自动成为公共知识，也不能凭模型常识伪造“来源库”。推荐采用两级生命周期。

### Immediate Project Scope

用户创建新标签后，先形成项目私有 `CustomTagContext`：

- 原始标签名称
- 用户补充定义（可选）
- 当前 Creative Prompt 和故事目标
- 用户提供的参考资料（可选）
- 与现有 Ontology / Knowledge 的相似候选
- 系统生成的暂定解释与明确标注的 AI inference
- 冲突、歧义和缺少来源警告
- 用户确认状态
- project scope、version 和 provenance

如果只有一个陌生词且没有任何定义或来源，系统应要求用户确认解释，不能静默生成一套权威知识。

### Governed Promotion

项目私有标签只有在满足以下条件后，才可进入公共候选目录：

- 有多个可验证来源或明确用户授权资料
- 与现有标签完成去重和 alias 检查
- 分类、适用范围、反模式和置信度明确
- 经过治理审核
- 版本与来源可追踪

多数一次性自定义标签无需提升为公共 Ontology 节点。这样既支持即时创作，又避免标签爆炸和全局知识污染。

## Input Acceptance Rule

目标产品规则：

- `Creative Prompt` 和已选择标签不能同时为空，至少提供一个。
- 系统标签和已确认的项目私有自定义标签都可满足“标签已提供”。
- Character 输入全部 optional；未提供时由后续故事方向和人物设计过程补充，但必须记录 AI inferred provenance。
- 只有 Prompt：允许进入解析；系统可推荐候选标签，但未经用户确认不得自动选择。
- 只有常规标签：允许用标签上下文形成梗概候选，并在生成长篇规划前展示给用户确认。
- 只有自定义标签：必须先完成项目级语义解释确认，才能形成梗概候选。
- Prompt 与标签都存在：Prompt 表达具体创意，标签提供来源化上下文；冲突不能静默解决。

当前实现已支持 Prompt-only 与受控 Ontology Tag-only。Tag-only 的故事方向由后端透明派生并记录 provenance，不通过隐藏合成文本伪装为用户输入。confirmed CustomTagContext-only 仍待未来 Creative Intent Contract 升级。

## Story Synopsis Boundary

标签上下文的直接产物应是可审阅的故事方向，而不是 60 万字正文。建议至少能帮助形成：

- 核心设定与一句话 premise
- 主要类型和情绪承诺
- 主冲突与长期故事发动机
- 主角初始目标和关键阻力
- 差异化卖点
- 大致结局方向
- 与用户输入的映射说明
- 被采用的 tag / source / knowledge refs
- 冲突与不确定性警告

该产物未来可进入 `StoryBible` 根方向和递归 `StoryPlanNode`，但不把整套标签证据复制进 `ContentSpec` 或 `MasterScript`。

## Recommended Minimal Contracts

以下是文档级候选，不是本轮 Pydantic、API 或数据库实现承诺。

### `TagContextReference`

- `tag_id`
- `tag_version`
- `profile_version`
- `evidence_refs`
- `trend_snapshot_ref`（optional）
- `selection_source`
- `selection_reason`
- `confidence`

### `CustomTagContext`

- `custom_tag_id`
- `project_id`
- `label`
- `user_definition`
- `inferred_interpretation`
- `field_sources`
- `related_tag_ids`
- `source_refs`
- `confidence`
- `confirmation_status`
- `warnings`
- `version`

### `ResolvedTagContextBundle`

- `bundle_id`
- `market_profile`
- `selected_context_refs`
- `custom_context_refs`
- `principle_summaries`
- `conflicts`
- `excluded_patterns`
- `source_lineage`
- `version`

## Current Gap Assessment

| Capability | Current state | Target gap |
|---|---|---|
| Controlled tag identity and categories | Implemented | Continue governance and aliases |
| China mainland static catalog | Implemented | Coverage and evidence quality need validation |
| User selection and removal | Implemented | Add source/explanation preview |
| Project custom tag keyword | Implemented locally | No confirmed semantic context or source-backed library |
| Tag-backed content/evidence library | Partial foundations through Asset / Knowledge concepts | No tag profile aggregation or runtime retrieval |
| Static Knowledge Bundle | Limited implementation | Not dynamically selected from all active tags |
| Real-time popular tags | Not implemented | Data Intelligence ingestion, trend snapshot and recommendation UI required |
| Prompt-or-tag acceptance | Partially implemented | Prompt-only and controlled Ontology Tag-only work; confirmed CustomTagContext-only is pending |
| Tag context to synopsis | Partial indirect Prompt influence | No explicit reviewable Story Synopsis / Story Direction result |
| Synopsis to 600K expansion | Human-reviewed Story Bible, recursive planning and EpisodePlan runtime slice implemented | Planning quality/capacity gates, continuity automation and durable background jobs pending |

## Recommended Implementation Sequence

1. Extend the implemented Prompt-only / regular-tag-only validation with confirmed-custom-tag-only input.
2. Add a reviewable Story Synopsis / Story Direction result before long-form expansion.
3. Build a small source-grounded Tag Knowledge Profile pilot for 10-20 high-use mainland tags and compare synopsis quality.
4. Add project-scoped `CustomTagContext` with explicit user confirmation; do not promote it globally.
5. Connect selected tag contexts to Story Bible root and recursive planning lineage.
6. After Data Intelligence is ready, add versioned Trend Signals and real-time recommendations.

Do not begin with a broad vector database, automatic web scraping, global custom-tag promotion or thousands of unvalidated tag profiles.

## Status

- Classification: architecture research and future contract direction
- Runtime change: none
- Schema/API change: none
- Current roadmap priority: still China mainland long-form planning foundation
- Future backlog: Tag Evidence Library, Tag Knowledge Profile, CustomTagContext, Trend Signal integration, confirmed-custom-tag-only input
