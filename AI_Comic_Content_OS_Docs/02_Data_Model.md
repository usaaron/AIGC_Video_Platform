# 02_Data_Model

## 目的
定义系统所有核心数据对象及其关系。

## 核心对象
- ContentSpec（系统唯一中间对象）
- Asset（所有资产统一模型）
- Tag（统一标签）
- OntologyNode（标签节点）
- RawContentRecord
- AnalysisResult
- ContentSpecDraft
- DataIngestionJob
- DataIngestionRunHistory
- TrendSnapshot
- PlatformProfile（平台画像）
- CreativeBrief
- CreativeIntentInput（Phase 1 最小上游创作输入）
- CharacterContext
- ResolvedCreativeContext
- CreativeIntentResolutionResult
- CreativeBriefInput（完整能力的文档级上游契约）
- CreativeBriefResolutionResult（完整能力的文档级解析结果）
- PromptLibraryItem
- ScriptIndustryKnowledge
- GenerationStrategy
- PromptRetrievalResult
- PromptBuildResult
- ScriptGenerationRequest
- ScriptGenerationRequestMapper
- ScriptGenerationDraftRun
- ScriptGenerationResult
- ScriptGenerationWorkflowService
- StoryboardHandoffMapper
- VoiceHandoffMapper
- AnimationHandoffMapper
- VideoGenerationHandoffMapper
- DraftMasterScript
- MasterScriptFinalizationResult
- BenchmarkRunResult
- StoryQCReport
- BilingualScriptView
- MasterScript
- FeedbackRecord

## 当前实现状态

V0.1 已实现：

- `Asset` 的 Pydantic 数据模型
- `Asset` 的基础 API 输入输出契约
- `ContentSpec` 的 Pydantic 数据模型
- `ContentSpec` 的基础 API 输入输出契约
- `TagRef` 作为 `ContentSpec.tags` 的统一引用结构
- `CreativeBrief` 作为 `ContentSpec` 的内嵌结构
- `CreativeIntentInput` 的 Phase 1 Pydantic 输入契约
- `CharacterContext` 与字段级 `user_provided` / `ai_inferred` provenance
- `ResolvedCreativeContext` 的独立生成上下文契约
- `CreativeIntentResolutionResult` 的 API 输出契约
- `PlatformGoal` 作为 `ContentSpec` 的平台目标结构
- `PlatformProfile` 的 Pydantic 数据模型
- `PlatformProfile` 的基础 API 输入输出契约
- `OntologyNode` 的 Pydantic 数据模型
- `OntologyNode` 的基础 API 输入输出契约
- `RawContentRecord` 的 Pydantic 数据模型
- `AnalysisResult` 的 Pydantic 数据模型
- `BenchmarkRunResult` 的 Pydantic 数据模型
- `ContentSpecDraft` 的 Pydantic 数据模型
- `MasterScript` 的 Pydantic 数据模型
- `DraftMasterScript` 的 Pydantic 数据模型
- `MasterScript` 的基础 API 输入输出契约
- `MasterScriptFinalizationResult` 的基础 API 输入输出契约
- `OrchestrationPlan` 的 Pydantic 数据模型
- `OrchestrationPlan` 的基础 API 输入输出契约
- `RetrievalResolveRequest` 的 Pydantic 数据模型
- `RetrievalPlanResult` 的 Pydantic 数据模型
- `DataIngestionJob` 的 Pydantic 数据模型
- `DataIngestionRunHistory` 的 Pydantic 数据模型
- `TrendSnapshot` 的 Pydantic 数据模型
- `DataIngestionRunResult` 的 Pydantic 数据模型
- Script Engine 基础占位对象：
  - `PromptLibraryItem`
  - `GenerationStrategy`
  - `PromptRetrievalRequest`
  - `PromptRetrievalResult`
  - `PromptBuildContext`
  - `PromptBuildResult`
  - `StoryQCReport`
  - `LLMModelInfo`
- `PromptLibraryItem` 的基础 API 输入输出契约
- `GenerationStrategy` 的基础 API 输入输出契约
- `PromptRetrievalResult` 的基础 API 输入输出契约
- `ScriptGenerationDraftRun` 的基础 API 输入输出契约
- Data Intelligence 手工导入与分析链路
- Scheduled Data Ingestion 基础 Job 与去重链路

当前设计预留，尚未实现正式代码模型：

- `ScriptIndustryKnowledge`
- `BilingualScriptView`
- 完整版 `CreativeBriefInput` / `CreativeBriefResolutionResult` 中尚未进入 Phase 1 的推荐标签、alias、unresolved tag 与用户确认能力
- `ScriptGenerationRequest`
- `ScriptGenerationResult`
- `ScriptGenerationRequestMapper`
- `ScriptGenerationWorkflowService`
- `StoryboardHandoffMapper`
- `VoiceHandoffMapper`
- `AnimationHandoffMapper`
- `VideoGenerationHandoffMapper`

它们当前先作为文档级数据契约和后续实现边界，不进入本轮主链路改造。

## Creative Intent Input Phase 1 当前契约

Phase 1 已实现以下最小运行时对象：

- `CreativeIntentInput`
  - `schema_version`
  - `title`
  - `audience_goal`
  - `commercial_goal`
  - `platform_goal`
  - `free_creative_prompt`
  - `quality_level`
  - `budget_level`
  - `selected_tag_ids`
  - `added_tag_ids`
  - `excluded_tag_ids`
  - `excluded_patterns`
  - `creative_brief`
  - `character_contexts`
  - `request_metadata`
- `CharacterContext`
  - 当前聚焦 name、role、description、motivation、desire、fear、belief、contradiction、decision pattern 与 moral boundaries
  - `locked_fields` 保存用户锁定字段
  - `field_sources` 对每个已提供字段保存 `user_provided` 或 `ai_inferred`
  - Phase 1 不调用 LLM 自动补全角色
- `ResolvedCreativeContext`
  - 通过 `content_spec_id` 与标准化 ContentSpec 对齐
  - 独立保存 Character Context、排除标签、排除模式和解析 warning
  - 不写入 `ContentSpec.metadata`
- `CreativeIntentResolutionResult`
  - 返回已保存 ContentSpec、解析后上下文、`TagRef`、mapping trace 与请求追踪信息

兼容规则：

- 现有 ContentSpec payload 不变
- `ScriptGenerationDraftRequest.resolved_creative_context` 为 optional
- 旧生成请求可以完全省略新上下文
- raw Creative Intent 不直接进入 Prompt Builder
- selected / added tag 必须精确引用现有 active `OntologyNode`
- selected 与 excluded 冲突时解析失败，不静默选择
- 当前 `free_creative_prompt` 被限制为 240 字符以内的已归一化故事方向，并确定性映射到 `ContentSpec.story_goal`

## CreativeBriefInput 完整能力文档级建议契约

`CreativeBriefInput` 继续描述 Phase 1 之后的完整 authoring contract，不替代当前已实现的最小 `CreativeIntentInput`，也不替代内嵌 `CreativeBrief`。

建议字段：

- `schema_version`
- `recommendation_context`
- `recommendation_policy`
- `recommended_tags`
- `selected_tag_ids`
- `added_tag_ids`
- `excluded_tag_ids`
- `excluded_patterns`
- `user_creative_prompt`
- `generation_constraints`
- `request_metadata`

### RecommendedTag 建议字段

- `tag_id`：必须引用现有 `OntologyNode.id`
- `category`：必须与 Ontology 节点分类一致
- `confidence`：Data Intelligence 建议置信度
- `source_refs`：`AnalysisResult`、Raw Record 或聚合证据引用
- `recommendation_reason`：面向用户的简短推荐原因

Recommended Tag 只代表数据建议。未被用户接受的推荐不得自动成为最终生成指令。

`recommendation_policy` 建议默认使用 `suggest_only`。未来如需无人值守 batch fallback，必须由请求显式开启并进入 mapping trace，不允许通过静默默认自动采用推荐标签。

### Selected / Added / Excluded Tag 语义

- `selected_tag_ids`：用户从推荐结果或受控标签列表中明确接受的节点
- `added_tag_ids`：用户主动补充、但仍必须存在于统一 Ontology 中的节点
- `excluded_tag_ids`：用户明确禁止进入最终创作规范的节点
- `excluded_patterns`：无法由单一标签充分表达的禁用 trope、关系模式、表达方式或内容模式

用户输入自由标签文本时，未来 resolver 只能：

- 解析为现有节点或 alias
- 标记为 unresolved 并请求确认

不得自动创建新的 `OntologyNode`，也不得把自由文本伪装成 `TagRef`。

### GenerationConstraints 建议字段

- `output_language`
- `target_duration_seconds`
- `desired_scene_count`
- `platform_profile_id`
- `content_rating`

其中平台与安全限制必须由 `PlatformProfile` 校验。用户输入可以收紧硬约束，但不能绕过或放宽平台与安全要求。

### CreativeBriefResolutionResult 建议字段

- `schema_version`
- `input_snapshot`
- `resolved_tag_refs`
- `resolved_creative_brief`
- `resolved_story_goal`
- `resolved_generation_constraints`
- `unresolved_tag_inputs`
- `deferred_recommendations`
- `conflict_warnings`
- `requires_user_resolution`
- `mapping_trace`
- `content_spec_draft_id`
- `content_spec_id`

当前建议的确定性优先级：

1. Platform / Safety Hard Constraints
2. User Excluded Tags / Patterns
3. Explicit User Prompt Constraints
4. User Selected / Added Tags
5. Data Intelligence Recommended Tags
6. Traceable System Defaults

重大冲突不得静默解决。硬约束冲突应阻止解析；用户 Prompt 自相矛盾或与排除项冲突时应设置 `requires_user_resolution=true`。结构化 `generation_constraints` 与自由 Prompt 对同一字段冲突时，以结构化字段为准并产生 warning。

第 5 级只适用于显式允许 recommendation fallback 的请求。默认 `suggest_only` 下，只有进入 `selected_tag_ids` 的推荐节点才会成为 resolved tag。

### Active Tag Boundary

- Phase 1 `CreativeIntentInput` 当前限制 `max_active_tags=12`；该限制位于上游输入模型，不写入 Script Engine 生成逻辑
- 当前 `ContentSpec.tags` 仍保持最多 20 个的既有技术契约
- 用户明确选择优先于 Data Intelligence 推荐
- 超出解析上限时应返回 deferred tags 与原因，不得只按置信度静默截断

### 现有 Ontology 分类映射建议

| 创作维度 | 现有 Ontology 分类 / 处理方式 |
|---|---|
| genre | `Genre` |
| audience | `Audience` |
| tone | 当前优先映射到 `CreativeBrief.tone`；不擅自新增 Tone 分类 |
| emotional promise | `Emotion` |
| protagonist archetype | `Character` |
| relationship dynamic | `Relationship` |
| conflict mechanism | `Conflict` |
| hook type | `Hook` |
| pacing | `Pace` |
| ending function | `Cliffhanger` 或 `Twist` |
| avoid pattern | 已知节点使用 `excluded_tag_ids`；自由模式使用 `excluded_patterns` |
| content rating | `GenerationConstraints` / `PlatformProfile`，不作为创作标签 |

该设计复用当前 Ontology，不创建第二套 Tag System。若未来确需新增一级分类，仍必须先经过 Ontology 变更评审。

### 到 ContentSpec 的映射边界

- resolved tag IDs → `ContentSpec.tags`
- audience / commercial / platform 结果 → 对应 Goal 结构
- hook / tone / pacing / target emotion → `ContentSpec.creative_brief`
- 其余明确创作意图 → `story_goal` 或受控 `generation_notes`
- generation constraints → `platform_goal` 与未来 Script Generation output requirements
- excluded patterns 当前可映射为受控 negative generation notes；如果长期稳定，应再提议正式可版本化字段，不能永久堆入任意 metadata

原始 `user_creative_prompt` 不应原样成为 Master Prompt。解析后的 `ContentSpec` 才能进入现有 Script Generation pipeline。

`input_snapshot` 或其稳定引用必须保留 recommended、selected、added、excluded、原始 Prompt 和 generation constraints，以支持后续从生成结果回溯到创作选择。

## PromptRetrievalResult 当前字段

`PromptRetrievalResult` 当前包含：

- `generation_strategy_id`
- `strategy_name`
- `prompt_ids`
- `prompts`
- `retrieval_mode`
- `notes`
- `resolved_at`

其中：

- `PromptRetrievalResult` 是当前 Prompt Retrieval 阶段的标准结构化输出
- `prompts` 当前保存按 `GenerationStrategy.prompt_ids` 精确读取的 `PromptLibraryItem`
- `retrieval_mode` 当前固定为 `exact_ids`，为后续扩展规则检索预留位置

## PromptRetrievalResult 当前校验规则

- `prompt_ids` 至少 1 个，最多 20 个
- `prompts` 至少 1 个，最多 20 个
- `prompt_ids` 与 `notes` 不可重复

## ScriptIndustryKnowledge 当前建议字段

`ScriptIndustryKnowledge` 当前建议包含：

- `knowledge_id`
- `knowledge_type`
- `title`
- `description`
- `source_type`
- `source_reference`
- `applicable_platforms`
- `applicable_culture_clusters`
- `applicable_genres`
- `applicable_audiences`
- `constraints`
- `version`
- `status`
- `created_at`
- `updated_at`

其中：

- 它用于沉淀专业剧作知识，而不是替代正式剧本对象
- 它应通过 `Knowledge Base`、Retriever、`Prompt Library`、`GenerationStrategy` 等标准机制进入生成与评估流程
- 它必须声明适用范围，避免被当作全局默认规则

## ScriptGenerationRequest 当前建议字段

`ScriptGenerationRequest` 当前建议包含：

- `schema_version`
- `content_spec_id`
- `content_spec`
- `generation_strategy_id`
- `output_requirements`
- `retrieved_asset_refs`
- `retrieval_context`
- `knowledge_refs`
- `platform_context`
- `developer_options`
- `extensions`
- `request_metadata`

其中：

- 它是未来 Script Generation Box 的统一入口对象
- `content_spec_id` 与 `content_spec` 应至少提供一个
- 它必须是结构化、版本化请求对象，不应退化为任意字典
- `extensions` 仅用于实验性或短期兼容字段
- 稳定扩展字段后续必须升级为正式字段

## ScriptGenerationRequestMapper 当前职责

`ScriptGenerationRequestMapper` 当前文档层职责是：

- 将上游对象映射为稳定的 `ScriptGenerationRequest`
- 隔离上游输入格式变化
- 避免 `AnalysisResult`、`ContentSpecDraft`、`PlatformProfile`、RetrievedAssets 等对象直接侵入 `Script Engine` 内核

当前后续可映射输入包括：

- `AnalysisResult`
- `ContentSpecDraft`
- `ContentSpec`
- `PlatformProfile`
- Retrieved Assets
- `ScriptIndustryKnowledge`

## DraftMasterScript 当前字段

`DraftMasterScript` 当前包含：

- `id`
- `content_spec_id`
- `generation_strategy_id`
- `title`
- `logline`
- `language`
- `target_audience`
- `target_platform`
- `tone`
- `hook`
- `synopsis`
- `episode_goal`
- `target_duration_seconds`
- `characters`
- `scenes`
- `next_episode_question`
- `qa_notes`
- `llm_metadata`
- `created_at`
- `updated_at`

其中：

- `DraftMasterScript` 是当前 Script Engine 在进入 Final `MasterScript` 前的标准结构化中间产物
- `scenes` 当前使用 `DraftSceneCard`，保存 `setting_hint`、`dialogue_prompts`、`dialogues`、`character_actions`、`turning_point`、`scene_causality`、`supporting_asset_ids` 等草稿级字段
- `llm_metadata` 当前用于记录 `llm_provider`、`llm_model_name`、Prompt 版本、策略版本与修订信号等可追踪元信息，不直接替代正式剧本内容

## SceneCausality 当前字段

`Initial Generation Quality Improvement v1 Step 1` 为 `DraftSceneCard` 与 `SceneCard` 增加兼容式 `scene_causality`：

- `goal`：本场焦点角色试图达成的即时目标
- `conflict`：阻止目标或提高行动代价的具体阻力
- `outcome`：本场结束时发生的状态变化，不得只是复述 `goal`
- `caused_by_scene_number`：当前场景由哪一个更早场景的结果触发
- `causal_link`：说明更早结果如何迫使或允许当前场景发生

兼容规则：

- 旧 `DraftMasterScript` / `MasterScript` payload 可以完全省略 `scene_causality`
- 新的真实 LLM 结构化输出必须为每个场景提供 `scene_causality`
- 第一场的 `caused_by_scene_number` 与 `causal_link` 必须为空
- 后续场景必须引用已经出现的场景编号
- 如果任一场景提供 `scene_causality`，同一剧本的所有场景都必须提供，避免部分链路
- `Finalization Mapper` 只透传该字段，不改变 Finalization Gate

## ScriptGenerationResult 当前建议字段

`ScriptGenerationResult` 当前建议包含：

- `schema_version`
- `final_master_script`
- `quality_report`
- `revision_summary`
- `production_handoff`
- `lineage`
- `warnings`
- `generated_artifacts`
- `result_metadata`
- `extensions`

其中：

- 它是未来 Script Generation Box 的统一出口对象
- 它不应只是纯文本，也不应只返回 Final `MasterScript`
- `generated_artifacts` 允许引用 `BilingualScriptView`、Prompt Snapshot、Evaluation Report、Developer Markdown 等 Developer Artifact
- `generated_artifacts` 不得污染正式生产字段

## ScriptGenerationWorkflowService 当前定位

`ScriptGenerationWorkflowService` 当前作为未来 facade / workflow service 的文档预留概念。

当前定位：

- 对外暴露统一 `generate_script()` 或等价入口
- 在内部编排 Draft、QC、Revision、Finalize
- 不要求当前立刻实现正式代码

## Production Handoff Mapper 当前定位

当前文档层预留以下 mapper：

- `StoryboardHandoffMapper`
- `VoiceHandoffMapper`
- `AnimationHandoffMapper`
- `VideoGenerationHandoffMapper`

其中：

- 它们应消费 `ScriptGenerationResult`
- 它们的职责是把标准化剧本生成结果映射为各下游模块需要的请求对象
- 它们不应反向污染 Final `MasterScript` 数据结构

## DraftMasterScript 当前校验规则

- `generation_strategy_id` 必须保留来源策略引用
- `scenes` 至少 1 个，最多 20 个
- `scenes[].scene_number` 不可重复
- 最后一场 `cliffhanger` 必须为 `true`
- `qa_notes`、`dialogue_prompts`、`supporting_asset_ids` 不可重复

## BilingualScriptView 当前实现字段

Frontend MVP 已实现 presentation-only `BilingualScriptView`：

- `view_version`
- `source_draft_master_script_id`
- `source_language`
- `target_language`
- `items[]`
  - `path`
  - `source_text`
  - `translated_text`
- `llm_model_info`
- `warnings`

其中：

- 它是 Developer Artifact，不是 Production Artifact
- 它必须保留原始英文 Draft / `MasterScript` 内容，不允许用中文译文覆盖正式生产字段
- 当前前端按 `source_draft_master_script_id` 缓存视图；中文界面查看英文稿时展示逐文本块中文对照，英文界面不展示
- `items.path` 必须与源剧本字段一一对齐，缺失、重复或新增路径均视为无效翻译输出

## FinalMasterScriptLineage 当前关键字段

当前 Final `MasterScript.lineage` 至少记录：

- `content_spec_id`
- `platform_profile_id`
- `generation_strategy_id`
- `generation_strategy_version`
- `selected_prompt_ids`
- `selected_prompt_versions`
- `prompt_builder_version`
- `llm_provider`
- `llm_model_name`
- `original_draft_master_script_id`
- `original_story_qc_score`
- `revision_plan_created_at`
- `revision_action_ids`
- `revised_draft_master_script_id`
- `re_qc_score`
- `minimum_re_qc_score_required`
- `finalization_policy_id`
- `finalization_version`
- `draft_generated_at`
- `revision_generated_at`
- `finalized_at`

## StoryQCReport 当前字段

`StoryQCReport` 当前包含：

- `overall_score`
- `status`
- `checks`
- `recommended_actions`
- `rubric_overall_score`
- `rubric_categories`
- `report_version`
- `explainability_status`
- `dimension_evaluations`
- `evidence_summary`
- `knowledge_refs`
- `created_at`

其中：

- `checks` 保存当前轻量 QC 检查结果
- `rubric_categories` 保存按 `Story Quality Rubric` 展开的扣分原因与修改建议
- `report_version` 用于标记当前报告结构版本
- `explainability_status` 用于标记当前解释能力所处阶段
- `dimension_evaluations` 当前保存 5 个核心维度的 explainability 结果
- `evidence_summary` 当前用于汇总主要证据线索
- `knowledge_refs` 当前作为未来知识体系的兼容引用字段，可为空
- `StoryQCReport` 是 `RevisionPlan` 的直接输入之一

## PromptEvaluationVariantResult 当前补充字段

`PromptEvaluationVariantResult` 当前额外包含：

- `story_qc_dimension_scores`
- `story_qc_dimension_summaries`
- `story_qc_deduction_reasons`
- `story_qc_evidence`
- `story_qc_revision_signals`
- `story_qc_scene_refs`

其中：

- `story_qc_dimension_scores` 当前保存按 dimension 聚合后的平均分
- `story_qc_dimension_summaries` 当前保存每个 dimension 的简要判断
- `story_qc_deduction_reasons` 当前保存每个 dimension 的主要扣分原因
- `story_qc_evidence` 当前保存维度级证据摘要
- `story_qc_revision_signals` 当前保存可供评估层复用的修订信号
- `story_qc_scene_refs` 当前保存维度问题关联到的主要场景编号

## PromptEvaluationVariantExplainability 当前补充字段

`PromptEvaluationVariantExplainability` 当前额外包含：

- `dimension_deltas`
- `improvements`
- `regressions`
- `unchanged_dimensions`
- `strongest_improvement`
- `largest_regression`
- `comparison_summary`
- `recommended_variant`
- `recommendation_reason`
- `confidence_note`

其中：

- `dimension_deltas` 当前用于保存 baseline / candidate 的维度级差异
- `improvements` 与 `regressions` 当前用于输出结构化质量变化解释
- `comparison_summary` 当前用于汇总这次 variant comparison 的核心结论
- `recommended_variant` 当前只表示评估层推荐，不影响业务主链路
- `confidence_note` 当前用于标记接近分数、维度缺失或 placeholder 信号带来的解释边界

## RevisionPlan 当前字段

`RevisionPlan` 当前包含：

- `draft_master_script_id`
- `content_spec_id`
- `generation_strategy_id`
- `story_qc_status`
- `overall_priority`
- `focus_summary`
- `revision_decision`（optional，兼容旧 payload）
- `revision_strategies`（默认空列表）
- `actions`
- `must_re_qc`
- `notes`
- `created_at`

其中：

- `actions` 当前由结构化 `RevisionAction` 组成
- 每个 `RevisionAction` 必须说明目标类型、优先级、影响场次、修改指令与预期收益
- `revision_decision` 与 `revision_strategies` 用于无损保留 Planner 的决策与策略意图
- `RevisionPlan` 当前只负责表达修订计划，不直接改写剧本

## Revision Quality Improvement v1 当前数据模型

以下对象已经实现为兼容的 Python / Pydantic model。`RevisionDecision` 与 `RevisionStrategy` 已进入 Planner 和受控 Executor；`RevisionPolicy` 已由 Acceptance Evaluator 作为 shadow 阈值配置消费；`AcceptanceDecision` 已在 Re-QC 后生成并保存到 `ScriptRevisionRun`。现有 API 与 Finalization Gate 行为保持不变。

### RevisionDecision 当前字段

- `revision_required`
- `decision_reason`
- `selected_dimensions`
- `deferred_dimensions`
- `protected_dimensions`
- `primary_scene_refs`
- `confidence`

职责：根据 `StoryQCReport` 决定是否修订、优先处理哪些维度、延后哪些问题，以及保护哪些已有优势。当前 Revision Planner 已生成该对象，并且每轮最多选择 1 至 2 个高影响、有场景证据的维度。

### RevisionStrategy 当前字段

- `target_dimension`
- `problem_type`
- `problem_reason`
- `revision_goal`
- `revision_method`
- `expected_effect`
- `priority`
- `confidence`
- `scene_refs`
- `do_not_touch`
- `knowledge_refs`

职责：把维度级问题、场景证据和扣分原因转换为有目标、有范围、有预期效果的修订策略。当前 Revision Planner 已生成该对象并映射为兼容的 `RevisionPlan.actions`；`knowledge_refs` 仍只是兼容字段，不表示知识驱动修订已经实现。

### RevisionPolicy 当前字段

- `max_revision_rounds`
- `minimum_improvement_threshold`
- `acceptance_threshold`
- `regression_limit`
- `dimension_regression_tolerance`

职责：集中声明修订轮数、最低有效改善、shadow 修订有效性阈值、允许回退数量和维度回退容差。当前 `revision_acceptance_shadow_policy.v1` 已由 `RevisionAcceptanceEvaluator` 消费；它不负责启动多轮循环，也不被 Finalization Gate 消费。未来增加轮数或启用 enforcement 必须先通过固定 Benchmark 校准。

### AcceptanceDecision 当前字段

- `accepted`
- `acceptance_reason`
- `targeted_dimension_improvement`
- `regression_count`
- `protected_dimension_stability`
- `stop_reason`
- `decision_version`
- `policy_version`
- `revision_round`
- `scene_alignment_rate`
- `revision_effectiveness`
- `regressed_dimensions`

职责：在 Re-QC 后判断本次修订是否解决了选中问题。当前由确定性、无状态的 `RevisionAcceptanceEvaluator` 生成，并以 shadow mode 保存；该对象不负责创建 Final `MasterScript`，不阻断当前流程，也不取代 Finalization Gate。

### Revision / Acceptance 当前实现状态

- Phase 1 已完成：四个 Pydantic model 与兼容性测试
- Phase 2 已完成：Revision Planner 生成 `RevisionDecision` 与 `RevisionStrategy`
- Phase 3 已完成：`RevisionPlan` 保留 Decision / Strategy，`RuleBasedRevisionExecutor` 执行场景范围和保护维度控制，并输出 `RevisionExecutionTrace`
- Phase 4.1 已完成：Re-QC 后生成 `AcceptanceDecision` 并保存到 `ScriptRevisionRun` runtime lineage
- 当前尚未实现 `RevisionPolicy` 多轮 runtime enforcement
- 当前尚未将 Acceptance 作为 Finalization 条件
- 当前尚未实现数据库级 Revision lineage 持久化和跨 Benchmark 聚合报告

### 兼容性原则

- 现有 `RevisionPlan` 与 `ScriptRevisionRun` 保留，避免重构稳定主链路
- `RevisionDecision` / `RevisionStrategy` 当前作为 `RevisionPlan` 上游的决策与策略信息，不复制 `RevisionPlan` 职责
- `AcceptanceDecision` 是 Re-QC 后的 shadow 修订有效性判断，不得绕过或替代 Finalization Gate
- 阈值必须来自可追踪、可版本化的 `RevisionPolicy`，不允许散落静默默认值

## ScriptRevisionRun 当前字段

`ScriptRevisionRun` 当前包含：

- `original_draft_master_script`
- `revision_plan`
- `revised_draft_master_script`
- `original_story_qc_report`
- `revised_story_qc_report`
- `applied_action_ids`
- `execution_trace`（optional）
- `acceptance_decision`（optional）
- `improvement_summary`
- `improved`
- `generated_at`

其中：

- `revised_draft_master_script` 仍然是 `DraftMasterScript`，不是 Final `MasterScript`
- `original_story_qc_report` 与 `revised_story_qc_report` 用于直接比较修订前后质量变化
- `execution_trace` 保存 executor 版本、执行模式、应用/跳过动作、修改场景、保护范围检查和 Strategy 上下文
- `improved` 是旧版兼容信号，仅表示 Re-QC `overall_score` 是否不低于原始 Draft
- `acceptance_decision` 是新 shadow 信号，衡量目标维度改善、回退安全、场景对齐与修订有效性
- 两个信号暂时并存但不等价；旧 RevisionPlan 仍允许 `execution_trace` / `acceptance_decision` 为空

## BenchmarkRunResult 当前补充摘要字段

当前 `BenchmarkRunResult` 还包含：

- `score_summary`
- `revision_summary`
- `highlights`

其中：

- `score_summary` 用于汇总 Draft、Revised Draft、Final 的关键分数与增量
- `revision_summary` 用于概览修订动作数量、目标类型与修订是否生效
- `highlights` 用于提供当前 Benchmark 结果的快速判读结论

## MasterScriptFinalizationResult 当前字段

`MasterScriptFinalizationResult` 当前包含：

- `master_script`
- `source_draft_id`
- `mapping_notes`

其中：

- `master_script` 是当前最终保存的结构化 `MasterScript`
- `source_draft_id` 当前用于追踪 Final `MasterScript` 来源于哪个 `RevisedDraftMasterScript`
- `mapping_notes` 用于记录当前 Finalization Gate 的行为说明

## ContentSpec 当前字段

`ContentSpec` 当前包含：

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

其中：

- `platform_goal.platform_profile_id` 只保存平台画像引用，不在核心模型中硬编码 TikTok 规则
- `tags` 必须引用统一 Ontology 节点，不允许自由散乱标签
- `creative_brief` 作为内容生成约束，不直接替代 `ContentSpec`

## 当前校验规则

- `tags` 至少 1 个，最多 20 个
- 同一 `category + ontology_node_id` 不可重复
- `quality_level=premium` 不能与 `budget_level=low` 组合
- `platform_goal.platform_profile_id` 必须引用已存在的 `PlatformProfile`
- `tags[].ontology_node_id` 必须引用已存在的 `OntologyNode`
- `tags[].label/category` 必须与被引用的 `OntologyNode` 定义一致
- 所有子结构默认 `extra=forbid`，禁止随意扩展未声明字段

## 当前实现边界

当前版本尚未实现：

- `FeedbackRecord`
- PostgreSQL / SQLModel 持久化映射
- 生命周期版本管理
- 自动爬虫与复杂机器学习分析链路
- 真实 LLM 提供商接入
- Prompt 检索 API
- Story QC 复杂评估逻辑

## Asset 当前字段

`Asset` 当前包含：

- `id`
- `asset_type`
- `title`
- `summary`
- `tags`
- `content`
- `applicable_platform_profile_ids`
- `metadata`
- `is_active`
- `created_at`
- `updated_at`

其中：

- `Asset` 是当前 `Knowledge Base` 的最小统一对象
- 不同资产通过 `asset_type` 区分，而不是拆成完全独立的数据结构
- `tags` 必须引用已存在的 `OntologyNode`
- `content` 当前采用统一 `text + payload` 结构，便于后续扩展检索与脚本调用

## Asset 当前校验规则

- `id` 必须使用稳定可引用标识
- `tags` 至少 1 个，最多 20 个
- 同一 `category + ontology_node_id` 不可重复
- `applicable_platform_profile_ids` 不可重复
- `tags[].ontology_node_id` 必须引用已存在的 `OntologyNode`
- `tags[].label/category` 必须与被引用的 `OntologyNode` 定义一致
- `applicable_platform_profile_ids` 如提供，必须引用已存在的 `PlatformProfile`

## PlatformProfile 当前字段

`PlatformProfile` 当前包含：

- `id`
- `platform_name`
- `version`
- `content_mode`
- `primary_regions`
- `supported_aspect_ratios`
- `recommendation_rules`
- `creator_rewards`
- `ai_policies`
- `community_guidelines`
- `best_practices`
- `publishing_strategy`
- `metadata`
- `created_at`
- `updated_at`

其中：

- `id` 是稳定的 profile 标识，可被 `ContentSpec.platform_goal.platform_profile_id` 引用
- 平台规则作为独立对象存在，不进入 `ContentSpec` 核心模型

## PlatformProfile 当前校验规则

- `id` 与 `ProfileRule.code` 使用稳定、可引用的 snake_case 风格标识
- 每个规则分组至少包含 1 条规则
- 同一规则分组中的 `code` 不可重复
- `supported_aspect_ratios`、`primary_regions`、`preferred_time_windows` 不可重复
- 所有子结构默认 `extra=forbid`

## OntologyNode 当前字段

`OntologyNode` 当前包含：

- `id`
- `label`
- `category`
- `description`
- `aliases`
- `is_active`
- `created_at`
- `updated_at`

其中：

- `id` 使用稳定、可引用的节点标识，例如 `genre.romance`
- `category` 必须属于受控一级分类
- `ContentSpec.tags` 应引用这些受控节点，而不是自由文本标签

## OntologyNode 当前校验规则

- `id` 必须是 `category.slug` 形式
- `id` 前缀必须与 `category` 一致
- `aliases` 不可重复
- 所有子结构默认 `extra=forbid`

## RawContentRecord 当前字段

`RawContentRecord` 当前包含：

- `id`
- `source_name`
- `source_item_id`
- `platform`
- `source_url`
- `title`
- `body_text`
- `author_handle`
- `language`
- `region`

## AnalysisResult 当前补充字段

当前 `AnalysisResult` 已增加能力验证和可解释性字段：

- `topic_labels`
- `keyword_evidence`
- `preference_score_breakdown`
- `commercial_score_breakdown`
- `platform_fit_score_breakdown`
- `audience_signal_summary`
- `commercial_signal_summary`
- `recommended_hook_type`
- `recommended_cliffhanger_type`
- `explanation_notes`

这些字段用于：

- 解释标签来源
- 解释分数来源
- 支撑 Benchmark Ground Truth 对比
- 支撑后续 `ContentSpec` 和 Script 评估
- `published_at`
- `engagement`
- `metadata`
- `imported_at`

## AnalysisResult 当前字段

`AnalysisResult` 当前包含：

- `id`
- `raw_content_record_id`
- `extracted_features`
- `mapped_tags`
- `preference_score`
- `commercial_score`
- `platform_fit_score`
- `summary`

## ContentSpecDraft 当前字段

`ContentSpecDraft` 当前包含：

- `id`
- `platform_profile_id`
- `title`
- `audience_goal_summary`
- `commercial_goal_summary`
- `platform_goal_objective`
- `target_duration_seconds`
- `story_goal`
- `tags`
- `creative_brief`
- `quality_level`
- `budget_level`
- `rationale`
- `created_at`

其中：

- `ContentSpecDraft` 是 `ContentSpec` 之前的中间草稿对象
- `ContentSpec` 仍然是唯一标准对象（Single Source of Truth）

## PromptLibraryItem 当前字段

`PromptLibraryItem` 当前包含：

- `id`
- `name`
- `prompt_type`
- `target_module`
- `applicable_tags`
- `target_platform`
- `target_audience`
- `version`
- `prompt_template`
- `input_variables`
- `output_schema`
- `evaluation_notes`
- `created_at`
- `updated_at`

其中：

- `PromptLibraryItem` 属于 `Knowledge Base` 的一部分
- `prompt_template` 是结构化 Prompt 资产，不应散落在业务代码中
- `applicable_tags` 当前使用受控标签 ID 字符串引用适用范围

## GenerationStrategy 当前字段

`GenerationStrategy` 当前包含：

- `id`
- `name`
- `target_platform`
- `target_content_type`
- `applicable_tags`
- `model_provider`
- `model_name`
- `temperature`
- `top_p`
- `max_tokens`
- `workflow_steps`
- `prompt_ids`
- `draft_knowledge_bundle_id`（optional）
- `deepening_mode`（`disabled` 或 `shadow`，默认 `disabled`）
- `deepening_prompt_ids`
- `deepening_knowledge_bundle_id`（optional）
- `deepening_max_tokens`（optional）
- `deepening_max_expressive_growth_ratio`
- `qc_enabled`
- `self_check_enabled`
- `human_review_required`
- `output_schema`
- `version`
- `status`

其中：

- `GenerationStrategy` 表示一次剧本生成任务采用的完整生成方案
- `model_provider` 与 `model_name` 当前只作为策略声明，不代表真实绑定某个厂商 SDK
- `prompt_ids` 引用 `PromptLibraryItem.id`
- `draft_knowledge_bundle_id` 只允许引用受治理静态目录中的 Draft bundle；省略时保持原生成行为
- `deepening_prompt_ids` 与 Draft Prompt 必须分离；只有 `shadow` 策略需要声明
- Deepening 当前没有 `apply` 模式，候选结果不能替换正式 Draft

## Static Creative Knowledge 当前契约

当前 Draft Generation 已实现最小静态知识契约：

- `StaticKnowledgeItem`：保存 `knowledge_id`、版本、类别、原则、应用规则、限制、反模式和来源引用的运行时最小投影
- `KnowledgeBundle`：保存 `bundle_id`、版本、`knowledge_ids`、适用条件、来源引用和目标阶段
- `KnowledgeApplicabilityConditions`：当前可按 tag ID、tag label、目标平台或 PlatformProfile 做确定性适用性校验
- `KnowledgeSelectionTrace`：记录 selector 版本、请求/选中 bundle、知识引用、选择原因和 warning

边界：

- bundle 最多包含 8 条知识；已实现的 TikTok Dark Romance Draft / Deepening bundle 随 `overseas_tiktok` 默认关闭，中国大陆 bundle 尚未进入 runtime
- `Research/Knowledge_Items/` 是知识来源与治理资产，runtime 不解析 Research Markdown
- runtime 静态目录只复制 Prompt 所需的最小原则、限制和反模式，并保留来源引用
- 当前没有 RAG、向量检索、语义排名、自动学习或 Knowledge Agent

## ScriptGenerationDraftRun 当前字段

`ScriptGenerationDraftRun` 当前包含：

- `content_spec_id`
- `generation_strategy_id`
- `generation_strategy_version`
- `orchestration_plan`
- `retrieval_result`
- `prompt_retrieval_result`
- `selected_prompt_ids`
- `prompt_build_result`
- `llm_model_info`
- `llm_raw_output`
- `resolved_creative_context`（optional）
- `knowledge_bundle`（optional）
- `knowledge_selection_trace`（optional）
- `creative_deepening_run`（optional）
- `draft_master_script`
- `story_qc_report`
- `revision_plan`
- `generated_at`

## Creative Deepening Shadow v1 当前契约

当前已实现以下兼容模型：

- `CreativeDeepeningRequest`：接收 source Draft、可选 `ResolvedCreativeContext`、独立 Deepening Knowledge Bundle 及表达增长上限
- `CreativeDeepeningRun`：记录候选稿、Prompt trace、模型信息、延迟、token、change trace、preservation checks、候选 QC 与比较元数据
- `CreativeDeepeningChange`：区分 dialogue、emotion、visual action、scene intensity、character expression 与 forbidden change
- `CreativeDeepeningPreservationCheck`：记录故事、角色、场景因果、结尾目的和增长预算是否保持
- `CreativeDeepeningQCComparison`：使用同一 Story QC 对 source/candidate 输出观察性总分和维度差异

兼容边界：

- `ScriptGenerationDraftRun.creative_deepening_run` 为 optional，旧 payload 保持有效
- `draft_master_script` 在 shadow mode 中始终是原始 Draft；候选只保存在 Deepening lineage
- Deepening Knowledge Bundle 必须以 `creative_deepening` 为目标阶段，不能复用 Draft bundle
- 当前没有数据库迁移、`FinalMasterScript` schema 变化或 Deepening apply contract

其中：

- 当前对象用于验证主链路从 `ContentSpec` 到 Draft 生成阶段是否可联调
- `generation_strategy_version` 用于把 Draft 运行结果与策略版本绑定
- `resolved_creative_context` 只保存解析后的 Character / exclusion 输入及 provenance，不包含 raw authoring payload
- `knowledge_bundle` 与 `knowledge_selection_trace` 只在策略显式启用且适用条件通过时存在
- 当前并不等同于 Final `MasterScript`

## PromptBuildResult 当前字段

`PromptBuildResult` 当前包含：

- `prompt_text`
- `rendered_variables`
- `trace`
- `created_at`

其中：

- `trace` 当前至少记录：
  - `generation_strategy_id`
  - `prompt_ids`
  - `builder_version`
- 该对象用于保证最终送入 LLM 的 Prompt 可追踪、可复盘

## DataIngestionJob 当前字段

`DataIngestionJob` 当前包含：

- `id`
- `title`
- `adapter_type`
- `schedule_type`
- `cron_expression`
- `platform_profile_id`
- `audience_hint`
- `commercial_objective`
- `manual_json_records`
- `manual_csv_content`
- `source_config`
- `is_active`
- `last_run_at`
- `next_run_at`
- `run_status`
- `error_message`
- `created_at`
- `updated_at`

其中：

- 每个 Job 绑定一个 `DataSourceAdapter`
- 当前可运行适配器仅包括 `manual_json` 与 `manual_csv`
- 其他 adapter 当前只保留 placeholder

## DataIngestionJob 当前校验规则

- `id` 必须使用稳定可引用标识
- `schedule_type=custom_cron` 时必须提供 `cron_expression`
- `adapter_type=manual_json` 时必须提供 `manual_json_records`
- `adapter_type=manual_csv` 时必须提供 `manual_csv_content`
- `platform_profile_id` 必须引用已存在的 `PlatformProfile`

## DataIngestionRunResult 当前字段

`DataIngestionRunResult` 当前包含：

- `job`
- `run_history`
- `raw_content_records`
- `analysis_results`
- `content_spec_draft`
- `content_spec`
- `imported_record_count`
- `skipped_duplicate_count`
- `skipped_duplicate_keys`
- `notes`

## DataIngestionRunHistory 当前字段

`DataIngestionRunHistory` 当前包含：

- `id`
- `job_id`
- `adapter_type`
- `schedule_type`
- `platform_profile_id`
- `started_at`
- `completed_at`
- `run_status`
- `error_message`
- `imported_record_count`
- `skipped_duplicate_count`
- `skipped_duplicate_keys`
- `raw_content_record_ids`
- `analysis_result_ids`
- `mapped_tag_ids`
- `content_spec_tag_ids`
- `average_preference_score`
- `average_commercial_score`
- `average_platform_fit_score`
- `content_spec_draft_id`
- `content_spec_id`
- `notes`

## TrendSnapshot 当前字段

`TrendSnapshot` 当前包含：

- `id`
- `job_id`
- `platform_profile_id`
- `run_history_ids`
- `lookback_runs`
- `successful_run_count`
- `skipped_run_count`
- `failed_run_count`
- `total_imported_records`
- `total_duplicate_skips`
- `average_preference_score`
- `average_commercial_score`
- `average_platform_fit_score`
- `top_mapped_tags`
- `top_content_spec_tags`
- `generated_at`
- `metadata`
- `notes`

## MasterScript 当前字段

`MasterScript` 当前包含：

- `id`
- `content_spec_id`
- `version`
- `title`
- `language`
- `tone`
- `hook`
- `synopsis`
- `episode_goal`
- `target_duration_seconds`
- `scenes`
- `qa_notes`
- `lineage`
- `created_at`
- `updated_at`

其中：

- `content_spec_id` 必须引用已存在的 `ContentSpec`
- `scenes` 作为结构化场景单元承载当前阶段的剧本主内容
- `version` 当前由 Finalization Policy 统一控制
- `lineage` 当前保存 Final `MasterScript` 的完整来源链路与版本信息
- 当前 `MasterScript` 被视为 MVP 阶段最终产物

## MasterScript 当前校验规则

- `content_spec_id` 必须引用已存在的 `ContentSpec`
- `scene_number` 不可重复
- 每个场景至少包含 1 条对话
- 最终场景必须以 cliffhanger 结束
- 新生成剧本的每个场景必须包含 Goal / Conflict / Outcome 因果语义；旧 payload 可整体省略
- `qa_notes` 不可重复
- Final `MasterScript` 不允许绕过受控 Finalization Gate 直接创建
- 所有子结构默认 `extra=forbid`

## FinalMasterScriptLineage 当前字段

`FinalMasterScriptLineage` 当前包含：

- `content_spec_id`
- `platform_profile_id`
- `generation_strategy_id`
- `generation_strategy_version`
- `selected_prompt_ids`
- `prompt_builder_version`
- `llm_provider`
- `llm_model_name`
- `original_draft_master_script_id`
- `original_story_qc_score`
- `original_story_qc_status`
- `revision_plan_created_at`
- `revision_action_ids`
- `revised_draft_master_script_id`
- `re_qc_score`
- `re_qc_status`
- `minimum_re_qc_score_required`
- `dialogue_line_count_per_scene`
- `speaker_name_cycle`
- `finalization_policy_id`
- `finalization_version`
- `draft_generated_at`
- `revision_generated_at`
- `finalized_at`

其中：

- 当前 `lineage` 是 Final `MasterScript` 的最小可追踪来源记录
- `minimum_re_qc_score_required` 用于记录 Finalization 时实际执行的阈值
- `speaker_name_cycle` 与 `dialogue_line_count_per_scene` 用于记录 Finalization 请求参数
- `finalization_policy_id` 与 `finalization_version` 用于记录当前受控 Finalization Policy

## MasterScriptFinalizeRequest 当前字段

`MasterScriptFinalizeRequest` 当前包含：

- `script_generation_draft_run`
- `script_revision_run`
- `dialogue_line_count_per_scene`
- `speaker_name_cycle`
- `minimum_re_qc_score_override`

其中：

- 当前 Finalize 请求必须同时携带 Draft 运行结果与 Revision 运行结果
- `minimum_re_qc_score_override` 仅用于覆盖集中 Finalization Policy 阈值
- 未提供 override 时，应回落到集中 Policy，并在 lineage 中记录最终阈值

## Frontend Episode Authoring Contracts

当前分集创作工作区在浏览器项目对象中保存 `episodes[]`。每个 `EpisodeWorkspace` 独立记录：

- `episodeNumber` 与 `status`
- `generationRun`
- `workingDraftJson` / `confirmedDraftJson`
- optional AI modification candidate
- optional Creative Deepening candidate
- optional Revision / Finalization result
- continuation instruction 与本地时间信息

后端 `ScriptGenerationDraftRequest` 的 optional `episode_context` 包含 generation mode、当前/总集数、上一集摘要、上一集未决问题、optional 本集指令和 optional `project_continuity_summary`。省略时保持旧单集行为。

`episode_context` 现可选携带 `GenerationBatchContext`：

- `batch_number`
- `start_episode`
- `end_episode`
- `batch_instruction`（optional）

该对象只记录一次有界阶段生成的范围和创作补充，不承担 Story Blueprint、热点检索或后台任务调度。旧 payload 不包含 `batch_context` 时继续有效。当前集数上限扩展到 2000，用于表达长篇项目规划范围；这不表示系统会在单次操作中生成 2000 集。

Frontend 本地 `GenerationSettings` 还保存：集数规划方式、目标总字数、偏好单集时长、内容密度、总集数和单批生成集数。系统推荐值是透明的 authoring estimate，不是平台规则；使用者可以切换为手动总集数。每次完成或部分完成的批次保存为 `GenerationBatchRecord`，记录范围、指令、进度与时间。

`ScriptDraftReviewRequest` 用于对用户编辑后的结构化 Draft 重新执行现有 Story QC 与 RevisionPlan；`ScriptDraftModificationRequest` 生成不覆盖原稿的 AI 修改候选；`ScriptCreativeDeepeningRequest` 主动调用现有受保护的 Deepening 能力。以上对象不改变 `DraftMasterScript` / `FinalMasterScript` schema。

Frontend 本地 `ScriptProject` 还保存项目级连续性视图：

- `storyLines[]`：主线、支线、角色成长线及各集推进
- `characterRelationships[]`：角色关系、当前状态及各集变化

这些字段由当前分集和角色确定性整理、允许用户编辑并保存在 IndexedDB。后续分集生成时，前端将其压缩为 bounded `project_continuity_summary` 注入 `episode_context`；它约束后续集延续已有故事线和关系状态，但不会改写已经生成的分集。它们不是 `MasterScript` 正式字段，也不代表 Story Planning runtime 已实现。已有分集项目禁止在项目设定页直接重新生成覆盖；重新生成通过复制新的本地项目版本完成。

## Long-Story Planning Contracts v1

当前已在 `script_engine/long_story_models.py` 实现长篇核心的版本化 Pydantic 契约。Project / Story Bible / Stage / Episode Plan 已接入持久化 Application Service 与版本化资源 API；它们仍未接入 Prompt Builder、自动规划或生成运行时。

### `StoryProject`

整部长篇作品的聚合入口，当前包含：

- `schema_version`
- `project_id`
- optimistic concurrency `revision`
- `title`
- `content_spec_id`
- `output_language`
- `target_total_characters`
- `planned_episode_count`
- `default_batch_size`
- `status`
- optional `active_story_bible_id` + `active_story_bible_version`
- 创建与更新时间

默认目标字数为 600,000、默认批次为 5 集，但二者是产品默认值而非行业硬规则。批次大小不得超过计划总集数。

### `StoryBible`

`StoryBible` 是经过人工审阅的长篇事实源，不包含场景正文、对白或镜头指令。当前包含：

- 核心前提、系列目标、主题、核心冲突和结局方向
- 世界规则、角色引用和 `CharacterArcTarget`
- `StoryBibleRelationship`
- 主线、支线和人物弧 `StoryLinePlan`
- 重大 Setup / Payoff 引用
- locked facts 与 avoid patterns
- version、draft / approved / superseded 状态及批准时间

所有人物弧、关系和故事线必须引用已声明角色；approved 状态必须有 `approved_at`。

### `StoryStagePlan`

故事阶段只负责把长篇方向分解为可管理的集数区间，并不改变最终按“集”交付的产品形式。它包含：

- 阶段编号与起止集数
- 阶段目标、入口状态、核心冲突和关键转折
- 人物弧移动
- Setup / Payoff 引用
- 出口状态与人工批准状态

### `EpisodePlan`

`EpisodePlan` 回答“这一集为什么存在”，而不是提前写正文。当前要求：

- episode goal
- entry state
- central conflict
- protagonist decision
- optional reveal
- emotional movement
- setup / payoff refs
- exit state
- cliffhanger
- character refs 与 continuity requirements

`entry_state → protagonist_decision → exit_state` 为后续连续性验证提供结构化依据。

### `ContinuityLedger`

`ContinuityLedger` 保存截至某一集的紧凑当前状态，不复制全部历史正文。它包含：

- 人物当前目标、情绪、已知信息与约束
- 人物关系当前状态
- 各故事线当前状态
- canonical facts 与 lock
- `SetupPayoffRecord` 生命周期
- 时间线事件
- 最近分集的 entry / exit / consequences 摘要
- 连续性警告

账本中的已发生事件不得晚于 `through_episode_number`；同类 ID 必须唯一；已回收伏笔必须具有合法的建立集和回收集。

### Batch And Checkpoint

- `GenerationBatchPlan`：保存一次有界批次的集数范围、对应 Episode Plan、阶段引用、补充指令和状态。
- `GenerationJobCheckpoint`：保存 queued / running / paused / completed / partial / failed 技术状态、已完成集、失败集、尝试次数和最后错误。

`StoryProject`、`GenerationBatchPlan` 和 `GenerationJobCheckpoint` 使用单调递增 `revision` 防止 stale write。completed 状态不可倒退；已完成集数不可从 Job checkpoint 中删除。

这些对象只定义未来可恢复执行的数据边界。当前 Frontend `GenerationBatchRecord` 和 `GenerationBatchContext` 继续工作，旧请求不需要提供任何新对象。

### PostgreSQL Persistence Foundation

当前已实现 SQLModel / PostgreSQL 持久化映射和首个 Alembic migration：

- `story_projects`
- `story_bible_versions`
- `story_stage_plan_versions`
- `episode_plan_versions`
- `continuity_ledger_versions`
- `generation_batches`
- `generation_job_checkpoints`

设计采用关系索引字段 + JSONB immutable snapshot：

- ID、FK、version / revision、status、集数范围和时间用于查询、唯一性与数据库约束。
- 完整 Pydantic payload 保存为 JSONB，保证契约版本可以完整复原和审计。
- Story Bible、Stage、Episode Plan 与 Ledger 使用复合版本主键，已有版本写入后不可覆盖。
- Project、Batch 与 Job 允许受控更新，但 Repository 要求 revision 连续增长并校验状态迁移。
- PostgreSQL 使用 JSONB；SQLite 测试使用 JSON compatibility variant。
- 时间列使用 timezone-aware 类型。

当前持久化已完成 schema、migration、Repository，以及 Project / Story Bible / Stage / Episode Plan 的 Application Service 与资源 API。尚未连接 Frontend、Draft / Final episode artifacts、Continuity 自动更新或后台 worker。

### Compatibility Boundary

- 未修改 `ContentSpec`、`DraftMasterScript`、Final `MasterScript` 或现有生成步骤 API contract。
- 未启用 Story Planning LLM call、Continuity 自动抽取或生成运行时 persistence integration。
- `StoryBible` / `StoryStagePlan` / `EpisodePlan` 进入生成上下文前，仍需后续 mapper 和固定样本验证。
- 新契约不代表完整 60 万字 runtime 已经完成。

## OrchestrationPlan 当前字段

`OrchestrationPlan` 当前包含：

- `id`
- `content_spec_id`
- `platform_profile_id`
- `title`
- `creative_hook`
- `episode_goal`
- `target_duration_seconds`
- `desired_scene_count`
- `asset_requests`
- `script_constraints`
- `scene_blueprints`
- `status`
- `blocking_issues`
- `created_at`
- `updated_at`

其中：

- `content_spec_id` 必须引用已存在的 `ContentSpec`
- `platform_profile_id` 从对应 `ContentSpec` 推导
- `asset_requests` 用于给 Retrieval / Asset 模块提供受控输入
- `scene_blueprints` 用于给 Script Engine 提供受控剧本骨架

## RetrievalPlanResult 当前字段

`RetrievalPlanResult` 当前包含：

- `plan_id`
- `content_spec_id`
- `platform_profile_id`
- `status`
- `resolved_requests`
- `unresolved_request_ids`
- `notes`
- `generated_at`

其中：

- `resolved_requests` 当前逐项对应 `OrchestrationPlan.asset_requests`
- 每项候选资产都包含匹配标签、分数与原因
- 当前检索结果是规则检索结果，不是向量或语义召回结果

## OrchestrationPlan 当前校验规则

- `desired_scene_count` 当前限制在 2 到 8 之间
- `scene_blueprints.scene_number` 不可重复
- 所有子结构默认 `extra=forbid`

## 后续内容

下一步建议继续补齐：

- JSON Schema 文档化
- 数据库映射
- 对象生命周期
- 版本管理策略
