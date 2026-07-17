# 05_API_Design

## 主要接口

- ContentSpec API
- Asset API
- Retrieval API
- Platform API
- Script API
- Feedback API

## 当前已实现接口

当前 `Script Engine` 的公共 API 仍以内部步骤为主，而不是最终盒子化契约。

当前状态判断：

- 已具备盒子化基础
- 但尚未完成单入口、单出口的正式外部契约收口

当前原因：

- `generate-draft`
- `build-revision-plan`
- `revise-draft`
- `finalize`

这些接口仍要求外部调用方理解 Draft、Revision、Finalize 等内部阶段。

当前最小迁移方向：

- 保留现有稳定 API
- 未来新增统一入口，例如 `POST /script-generation/run`
- 当前步骤 API 逐步转为内部步骤 API / 调试 API / 评估 API

当前 Script Generation Strategy 相关对象中，以下能力仍仅提供内部代码占位，尚未暴露正式外部 API：

- `Prompt Builder`
- `LLMAdapter`
- `Story QC`

原因：

- 当前 MVP 先稳定结构化对象与工作流边界
- 避免在策略尚未稳定前过早暴露外部接口
- 当前真实模型能力只用于能力验证和手动 integration，不作为供应商绑定的业务契约

当前 LLM 状态：

- 保留 `MockLLMAdapter`
- 已支持一个 OpenAI-compatible `RealLLMAdapter`
- 真实模型当前只用于能力验证和手动 integration
- 业务层仍然只依赖 `LLMAdapter` 抽象
- 不允许绑定单一供应商

当前已新增 `Prompt Library` 基础 API，用于沉淀和读取结构化 Prompt 资产。

### 0. POST `/prompt-library`

用途：

- 向 `Knowledge Base` 创建 `PromptLibraryItem`

输入：

- `PromptLibraryItemCreate`

输出：

- `PromptLibraryItemResponse`

错误处理：

- `404` 引用的 `OntologyNode` 不存在
- `409` PromptLibraryItem ID 已存在
- `422` 请求体校验失败

### 0.1 GET `/prompt-library`

用途：

- 查询当前 Prompt Library 条目列表

输出：

- `PromptLibraryItemListResponse`

### 0.2 GET `/prompt-library/{item_id}`

用途：

- 根据 ID 获取单个 Prompt Library 条目

输出：

- `PromptLibraryItemResponse`

错误处理：

- `404` 对应对象不存在

当前已新增 `Generation Strategy` 基础 API，用于声明和读取结构化剧本生成策略。

### 0.3 POST `/generation-strategies`

用途：

- 创建 `GenerationStrategy`

输入：

- `GenerationStrategyCreate`

输出：

- `GenerationStrategyResponse`

错误处理：

- `404` 引用的 `OntologyNode` 不存在
- `404` 引用的 `PromptLibraryItem` 不存在
- `409` GenerationStrategy ID 已存在
- `422` 请求体校验失败

### 0.4 GET `/generation-strategies`

用途：

- 查询当前 Generation Strategy 列表

输出：

- `GenerationStrategyListResponse`

### 0.5 GET `/generation-strategies/{item_id}`

用途：

- 根据 ID 获取单个 Generation Strategy

输出：

- `GenerationStrategyResponse`

错误处理：

- `404` 对应对象不存在

当前已新增 `Prompt Retrieval` 基础 API，用于把 `GenerationStrategy.prompt_ids` 解析为标准 Prompt 资产集合。

### 0.6 POST `/prompt-retrieval/resolve`

用途：

- 根据 `generation_strategy_id` 解析当前应使用的 Prompt 资产

输入：

- `PromptRetrievalRequest`

输出：

- `PromptRetrievalResponse`

当前说明：

- 当前 MVP 仅支持 `exact_ids` 模式
- 当前解析规则为精确读取 `GenerationStrategy.prompt_ids`

错误处理：

- `404` 引用的 `GenerationStrategy` 不存在
- `404` 引用的 `PromptLibraryItem` 不存在
- `422` 请求体校验失败

### 0.7 POST `/script-generation/generate-draft`

用途：

- 运行一次最小 Script Generation Draft 联调流程

输入：

- `ScriptGenerationDraftRequest`

当前关键输入要求：

- `output_language` 必须显式提供
- 不允许由 Script Engine 对输出语言做静默默认

输出：

- `ScriptGenerationDraftResponse`

当前返回重点字段：

- `orchestration_plan`
- `retrieval_result`
- `prompt_retrieval_result`
- `prompt_build_result`
- `llm_model_info`
- `llm_raw_output`
- `draft_master_script`
- `story_qc_report`

当前说明：

- `draft_master_script` 是当前联调链路的标准结构化草稿对象
- `llm_raw_output` 仅用于追踪和调试，不应视为最终业务对象
- `prompt_build_result.prompt_text` 当前可直接用于追踪真实模型的最终输入 Prompt
- `llm_model_info` 当前应反映 Mock / Real Adapter 的实际切换结果
- 该接口当前更适合作为内部步骤 API，而不是未来长期稳定的唯一外部契约

错误处理：

- `404` 引用的 `ContentSpec` 不存在
- `404` 引用的 `GenerationStrategy` 不存在
- `404` 引用的 `PromptLibraryItem` 不存在
- `404` `ContentSpec` 关联的 `PlatformProfile` 不存在
- `422` 缺少可追踪场景来源，例如既没有 `RetrievedAssets.scene` 也没有显式场景配置
- `422` 真实 LLM 配置缺失或结构化输出无法校验为 `DraftMasterScript`
- `503` 真实 LLM 请求失败或超时重试后仍失败
- `422` 请求体校验失败

### 0.8 POST `/script-generation/build-revision-plan`

用途：

- 根据当前 `StoryQCReport` 生成结构化 `RevisionPlan`

输入：

- `ScriptRevisionPlanRequest`

输出：

- `ScriptRevisionPlanResponse`

当前说明：

- 该接口当前属于内部步骤 API
- 长期应作为统一 `ScriptGenerationWorkflowService` 的内部组成步骤

### 0.9 POST `/script-generation/revise-draft`

用途：

- 根据 `RevisionPlan` 与原始 Draft 执行一次受控修订

输入：

- `ScriptRevisionRequest`

输出：

- `ScriptRevisionResponse`

当前说明：

- 该接口当前属于内部步骤 API
- 其返回对象主要服务于联调、Benchmark、Prompt Evaluation 和可解释性验证
- 长期不建议要求普通上游调用方直接理解和编排该步骤

### 1. POST `/assets`

用途：

- 向当前 `Knowledge Base` 创建统一 `Asset`

输入：

- `AssetCreate`

输出：

- `AssetResponse`

错误处理：

- `404` 引用的 `OntologyNode` 不存在
- `404` 引用的 `PlatformProfile` 不存在
- `409` Asset ID 已存在
- `409` Tag 引用与 OntologyNode 定义不一致
- `422` 请求体校验失败

### 1.1 POST `/master-scripts/from-draft`

用途：

- 已弃用入口，不再允许直接把 `DraftMasterScript` 转换为 Final `MasterScript`

输入：

- 任意请求体都会返回弃用错误

输出：

- `410 Gone`

当前说明：

- 该入口仅保留兼容性提示
- 新的 Finalization 必须使用受控链路入口 `POST /master-scripts/finalize`

错误处理：

- `410` 直接 `from-draft` Finalize 已弃用

### 1.2 POST `/master-scripts/finalize`

用途：

- 仅允许通过受控链路将 `RevisedDraftMasterScript` Finalize 为 Final `MasterScript`

输入：

- `MasterScriptFinalizeRequest`

当前关键输入要求：

- 必须提供 `script_generation_draft_run`
- 必须提供 `script_revision_run`
- 必须提供 `dialogue_line_count_per_scene`
- 必须提供 `speaker_name_cycle`
- 可选提供 `minimum_re_qc_score_override`

输出：

- `MasterScriptFinalizationResponse`

当前说明：

- Finalize 只接受完整链路：
  - `DraftMasterScript`
  - `StoryQCReport`
  - `RevisionPlan`
  - `RevisedDraftMasterScript`
  - `ReQCReport`
  - Final `MasterScript`
- Final `MasterScript` 会保存完整 lineage 与版本信息
- Finalization 阈值默认来自集中 Policy，也可通过 override 显式覆盖
- 该接口当前属于内部步骤 API / 受控 Finalization API

错误处理：

- `404` 引用的 `ContentSpec` 不存在
- `422` Draft / Revision 链路不一致
- `422` 缺少 QC、`RevisionPlan`、Revised Draft 或 Re-QC
- `422` Re-QC 分数低于 Finalization Threshold
- `422` 请求体校验失败

## Script Generation Box 契约

当前建议未来新增统一契约：

### Future POST `/script-generation/run`

用途：

- 以单入口方式运行完整 Script Generation Box

输入：

- `ScriptGenerationRequest`

输出：

- `ScriptGenerationResult`

当前说明：

- 本轮不要求实现该接口
- 当前仅作为未来正式公共契约方向
- 上游变化应优先由 `ScriptGenerationRequestMapper` 适配
- 下游变化应优先由 Handoff Mapper 适配

## 当前内部步骤 API 归类

当前以下接口更适合作为内部步骤或调试 / 评估 API：

- `POST /script-generation/generate-draft`
- `POST /script-generation/build-revision-plan`
- `POST /script-generation/revise-draft`
- `POST /master-scripts/finalize`

当前以下请求对象不应被视为长期对上游暴露的统一盒子契约：

- `ScriptGenerationDraftRequest`
- `ScriptRevisionPlanRequest`
- `ScriptRevisionRequest`
- `MasterScriptFinalizeRequest`

## 兼容与迁移策略

当前建议：

- 不立即删除现有稳定 API
- 未来新增统一 facade API 时，优先复用现有 service 和步骤对象
- 旧步骤 API 可以继续保留给：
  - Benchmark
  - Prompt Evaluation
  - 手动 smoke test
  - 开发调试
- 版本迁移应通过 adapter / mapper 支持旧调用方过渡

### 1.3 GET `/assets`

用途：

- 查询当前资产列表

输出：

- `AssetListResponse`

### 1.4 GET `/assets/{asset_id}`

用途：

- 根据 ID 获取单个 `Asset`

输出：

- `AssetResponse`

错误处理：

- `404` 对应对象不存在

### 1.5 POST `/retrieval/resolve`

用途：

- 根据 `OrchestrationPlan.asset_requests` 解析候选资产

输入：

- `RetrievalResolveRequest`

输出：

- `RetrievalPlanResultResponse`

错误处理：

- `404` 引用的 `OrchestrationPlan` 不存在
- `422` 请求体校验失败

### 1.6 POST `/ingestion-jobs`

当前能力验证阶段已新增 Benchmark API。

### 1.7 POST `/benchmarks/run`

用途：

- 运行一次固定 Benchmark 验证

输入：

- `BenchmarkRunRequest`

输出：

- `BenchmarkRunResponse`

错误处理：

- `404` Benchmark 数据集不存在
- `422` 请求体校验失败

### 1.10 POST `/script-generation/build-revision-plan`

用途：

- 根据 `DraftMasterScript + StoryQCReport` 生成结构化 `RevisionPlan`

输入：

- `ScriptRevisionPlanRequest`

输出：

- `ScriptRevisionPlanResponse`

错误处理：

- `422` 请求体校验失败

### 1.11 POST `/script-generation/revise-draft`

用途：

- 根据 `DraftMasterScript + RevisionPlan` 执行一次占位修订并返回 Re-QC 结果

输入：

- `ScriptRevisionRequest`

输出：

- `ScriptRevisionResponse`

错误处理：

- `404` 引用的 `GenerationStrategy` 不存在
- `422` `RevisionPlan` 与 `DraftMasterScript` 不匹配

### 1.8 GET `/benchmarks`

用途：

- 查看当前已运行的 Benchmark 结果列表

输出：

- `BenchmarkRunListResponse`

### 1.8 GET `/benchmarks/results/{result_id}`

用途：

- 查看单次 Benchmark 结果详情

输出：

- `BenchmarkRunResponse`

### 1.9 POST `/benchmarks/prompt-evaluations/run`

用途：

- 基于固定 Benchmark 数据运行一次 Prompt Evaluation 最小闭环

输入：

- `PromptEvaluationRunRequest`

当前关键输入要求：

- 必须提供 `evaluation_case_id`
- 必须提供 `dataset_id`
- 必须提供至少一个 `variants`
- 每个 variant 必须声明 `generation_strategy`
- 如需新增 Prompt 版本，可在 variant 中提供 `prompt_library_items`
- `repeat_count` 用于稳定性观察

输出：

- `PromptEvaluationRunResponse`

当前返回重点字段：

- `content_spec_id`
- `variants[].prompt_ids`
- `variants[].prompt_versions`
- `variants[].generation_strategy_id`
- `variants[].generation_strategy_version`
- `variants[].metrics_summary`
- `variants[].explainability`
- `variants[].samples[].deterministic_checks`
- `variants[].samples[].story_qc_score`
- `variants[].samples[].latency_ms`
- `variants[].samples[].token_usage`
- `variants[].samples[].artifact_ids`
- `decision_summary`

错误处理：

- `404` Benchmark 数据集不存在
- `422` 请求体校验失败

### 1.10 GET `/benchmarks/prompt-evaluations`

用途：

- 查看当前已运行的 Prompt Evaluation 结果列表

输出：

- `PromptEvaluationRunListResponse`

### 1.11 GET `/benchmarks/prompt-evaluations/results/{result_id}`

用途：

- 查看单次 Prompt Evaluation 结果详情

输出：

- `PromptEvaluationRunResponse`

用途：

- 创建 `Scheduled Data Ingestion` 的 `DataIngestionJob`

输入：

- `DataIngestionJobCreate`

输出：

- `DataIngestionJobResponse`

错误处理：

- `404` 引用的 `PlatformProfile` 不存在
- `409` Job ID 已存在
- `422` 请求体校验失败

### 1.5 GET `/ingestion-jobs`

用途：

- 查询当前 ingestion job 列表

输出：

- `DataIngestionJobListResponse`

### 1.6 GET `/ingestion-jobs/{job_id}`

用途：

- 根据 ID 获取单个 ingestion job

输出：

- `DataIngestionJobResponse`

错误处理：

- `404` 对应对象不存在

### 1.7 POST `/ingestion-jobs/{job_id}/run`

用途：

- 手动触发一次 Scheduled Ingestion Job 运行

输入：

- 路径参数 `job_id`

输出：

- `DataIngestionRunResultResponse`

错误处理：

- `404` 对应 Job 不存在
- `409` Job 运行时发生业务冲突
- `422` 请求体校验失败
- `501` Placeholder adapter 尚未实现

### 1.8 GET `/ingestion-jobs/{job_id}/runs`

用途：

- 查询某个 ingestion job 的运行历史列表

输出：

- `DataIngestionRunHistoryListResponse`

错误处理：

- `404` 对应 Job 不存在

### 1.9 GET `/ingestion-jobs/runs/{run_history_id}`

用途：

- 根据 ID 获取单次 ingestion run history

输出：

- `DataIngestionRunHistoryResponse`

错误处理：

- `404` 对应运行历史不存在

### 1.10 POST `/trend-snapshots/generate`

用途：

- 基于某个 ingestion job 的最近运行历史生成 `TrendSnapshot`

输入：

- `TrendSnapshotGenerateRequest`

输出：

- `TrendSnapshotResponse`

错误处理：

- `404` 对应 Job 不存在
- `409` 历史数据不足
- `422` 请求体校验失败

### 1.11 GET `/trend-snapshots`

用途：

- 查询当前已生成的 trend snapshot 列表

输出：

- `TrendSnapshotListResponse`

### 1.12 GET `/trend-snapshots/{snapshot_id}`

用途：

- 根据 ID 获取单个 trend snapshot

输出：

- `TrendSnapshotResponse`

错误处理：

- `404` 对应对象不存在

### 1. POST `/data-intelligence/manual-json/pipeline`

用途：

- 从手工 JSON 导入运行完整 Data Intelligence 管线

输入：

- `ManualJSONPipelineRequest`

输出：

- `DataPipelineResponse`

错误处理：

- `404` 引用的 `PlatformProfile` 不存在
- `409` 无法映射出受控标签
- `422` 请求体校验失败

### 1.1 POST `/data-intelligence/manual-csv/pipeline`

用途：

- 从手工 CSV 导入运行完整 Data Intelligence 管线

输入：

- `ManualCSVPipelineRequest`

输出：

- `DataPipelineResponse`

错误处理：

- `404` 引用的 `PlatformProfile` 不存在
- `409` 无法映射出受控标签
- `422` 请求体校验失败

### 2. POST `/content-specs`

用途：

- 创建新的 `ContentSpec`

输入：

- `ContentSpecCreate`

输出：

- `ContentSpecResponse`

错误处理：

- `404` 引用的 `PlatformProfile` 不存在
- `404` 引用的 `OntologyNode` 不存在
- `409` Tag 引用与 OntologyNode 定义不一致
- `422` 请求体校验失败

### 3. GET `/content-specs`

用途：

- 查询当前已创建的 `ContentSpec` 列表

输出：

- `ContentSpecListResponse`

### 4. GET `/content-specs/{content_spec_id}`

用途：

- 根据 ID 获取单个 `ContentSpec`

输出：

- `ContentSpecResponse`

错误处理：

- `404` 对应对象不存在

### 5. POST `/platform-profiles`

用途：

- 创建新的 `PlatformProfile`

输入：

- `PlatformProfileCreate`

输出：

- `PlatformProfileResponse`

错误处理：

- `409` Profile ID 已存在
- `422` 请求体校验失败

### 6. GET `/platform-profiles`

用途：

- 查询当前已创建的 `PlatformProfile` 列表

输出：

- `PlatformProfileListResponse`

### 7. GET `/platform-profiles/{platform_profile_id}`

用途：

- 根据 ID 获取单个 `PlatformProfile`

输出：

- `PlatformProfileResponse`

错误处理：

- `404` 对应对象不存在

### 8. POST `/ontology-nodes`

用途：

- 创建新的 `OntologyNode`

输入：

- `OntologyNodeCreate`

输出：

- `OntologyNodeResponse`

错误处理：

- `409` Ontology node ID 已存在
- `422` 请求体校验失败

### 9. GET `/ontology-nodes`

用途：

- 查询当前已创建的 `OntologyNode` 列表

输出：

- `OntologyNodeListResponse`

### 10. GET `/ontology-nodes/{ontology_node_id}`

用途：

- 根据 ID 获取单个 `OntologyNode`

输出：

- `OntologyNodeResponse`

错误处理：

- `404` 对应对象不存在

### 11. POST `/master-scripts`

用途：

- 已弃用入口，不允许直接创建新的 Final `MasterScript`

输入：

- 任意请求体都会返回弃用错误

输出：

- `410 Gone`

错误处理：

- `410` 直接 Final `MasterScript` 创建已弃用

### 12. GET `/master-scripts`

用途：

- 查询当前已创建的 `MasterScript` 列表

输出：

- `MasterScriptListResponse`

### 13. GET `/master-scripts/{master_script_id}`

用途：

- 根据 ID 获取单个 `MasterScript`

输出：

- `MasterScriptResponse`

错误处理：

- `404` 对应对象不存在

### 13.1 POST `/master-scripts/finalize`

用途：

- 通过受控 Finalization Gate 生成 Final `MasterScript`

输入：

- `MasterScriptFinalizeRequest`

输出：

- `MasterScriptFinalizationResponse`

错误处理：

- `404` 引用的 `ContentSpec` 不存在
- `422` Finalization 链路不完整或不一致
- `422` Re-QC 分数低于阈值
- `422` 请求体校验失败

### 14. POST `/orchestrations`

用途：

- 创建新的 `OrchestrationPlan`

输入：

- `OrchestrationPlanCreate`

输出：

- `OrchestrationPlanResponse`

错误处理：

- `404` 引用的 `ContentSpec` 不存在
- `422` 请求体校验失败

### 15. GET `/orchestrations`

用途：

- 查询当前已创建的 `OrchestrationPlan` 列表

输出：

- `OrchestrationPlanListResponse`

### 16. GET `/orchestrations/{plan_id}`

用途：

- 根据 ID 获取单个 `OrchestrationPlan`

输出：

- `OrchestrationPlanResponse`

错误处理：

- `404` 对应对象不存在

## 设计说明

- API 当前已实现 `Data Intelligence`、`ContentSpec`、`PlatformProfile`、`OntologyNode`、`MasterScript` 与 `OrchestrationPlan` 六个最小闭环
- TikTok 只通过 `platform_goal.platform_profile_id` 和独立 `PlatformProfile` 体现，不写入核心业务规则
- Data Intelligence 当前采用 `Manual Import First`
- 当前支持：
  - `ManualJSONImportAdapter`
  - `ManualCSVImportAdapter`
- `ContentSpec` 创建时会校验引用的 `PlatformProfile` 是否已存在
- `ContentSpec` 创建时会校验引用的 `OntologyNode` 是否已存在且定义一致
- `MasterScript` 创建时会校验引用的 `ContentSpec` 是否已存在
- `OrchestrationPlan` 创建时会校验引用的 `ContentSpec` 是否已存在
- 当前仓储为内存实现，用于先稳定接口契约
- 后续切换 PostgreSQL 时，应保持 API 契约稳定
