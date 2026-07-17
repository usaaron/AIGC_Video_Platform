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
- `ScriptGenerationRequest`
- `ScriptGenerationResult`
- `ScriptGenerationRequestMapper`
- `ScriptGenerationWorkflowService`
- `StoryboardHandoffMapper`
- `VoiceHandoffMapper`
- `AnimationHandoffMapper`
- `VideoGenerationHandoffMapper`

它们当前先作为文档级数据契约和后续实现边界，不进入本轮主链路改造。

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
- `scenes` 当前使用 `DraftSceneCard`，保存 `setting_hint`、`dialogue_prompts`、`dialogues`、`character_actions`、`turning_point`、`supporting_asset_ids` 等草稿级字段
- `llm_metadata` 当前用于记录 `llm_provider`、`llm_model_name`、Prompt 版本、策略版本与修订信号等可追踪元信息，不直接替代正式剧本内容

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

## BilingualScriptView 当前建议字段

`BilingualScriptView` 当前建议包含：

- `source_master_script_id`
- `source_language`
- `developer_language`
- `translation_provider`
- `translation_model`
- `translation_version`
- `generated_at`
- `scenes`
- `dialogue_pairs`
- `action_translation`
- `scene_summary_translation`
- `translator_notes`
- `unresolved_terms`

其中：

- 它是 Developer Artifact，不是 Production Artifact
- 它必须保留原始英文 `MasterScript` 内容，不允许用中文译文覆盖正式生产字段
- 它用于研发评审、Prompt 调优、Story QC 复核和人工打磨沟通

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
- `created_at`

其中：

- `checks` 保存当前轻量 QC 检查结果
- `rubric_categories` 保存按 `Story Quality Rubric` 展开的扣分原因与修改建议
- `StoryQCReport` 是 `RevisionPlan` 的直接输入之一

## RevisionPlan 当前字段

`RevisionPlan` 当前包含：

- `draft_master_script_id`
- `content_spec_id`
- `generation_strategy_id`
- `story_qc_status`
- `overall_priority`
- `focus_summary`
- `actions`
- `must_re_qc`
- `notes`
- `created_at`

其中：

- `actions` 当前由结构化 `RevisionAction` 组成
- 每个 `RevisionAction` 必须说明目标类型、优先级、影响场次、修改指令与预期收益
- `RevisionPlan` 当前只负责给出修订建议，不直接改写剧本

## ScriptRevisionRun 当前字段

`ScriptRevisionRun` 当前包含：

- `original_draft_master_script`
- `revision_plan`
- `revised_draft_master_script`
- `original_story_qc_report`
- `revised_story_qc_report`
- `applied_action_ids`
- `improvement_summary`
- `improved`
- `generated_at`

其中：

- `revised_draft_master_script` 仍然是 `DraftMasterScript`，不是 Final `MasterScript`
- `original_story_qc_report` 与 `revised_story_qc_report` 用于直接比较修订前后质量变化
- `improved` 当前用于标记占位修订执行后 Re-QC 是否至少不低于原始 Draft

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
- `draft_master_script`
- `story_qc_report`
- `revision_plan`
- `generated_at`

其中：

- 当前对象用于验证主链路从 `ContentSpec` 到 Draft 生成阶段是否可联调
- `generation_strategy_version` 用于把 Draft 运行结果与策略版本绑定
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
