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

Frontend MVP 当前已作为一个兼容调用方编排 `resolve-creative-intent -> generate-draft -> revise-draft -> finalize`。这证明现有步骤 API 可以支撑单集成品链路，但不代表统一 Script Generation Facade 已完成。

本地真实模型生成可能持续数十秒或更久。`start-local.sh` 当前让浏览器通过 `NEXT_PUBLIC_API_BASE_URL` 直接访问 FastAPI，并由 `FRONTEND_ORIGINS` 控制允许来源，避免 Next.js 开发 rewrite 代理提前断开长请求。生产环境仍应由正式同域网关配置请求超时、鉴权和可观测性；该本地连接策略不改变 API 契约。

长篇规划当前另有一组版本化资源 API，用于保存人工可审阅的 Project / Story Bible / 递归 Story Plan Node / Stage / Episode Plan。它们是 Script Generation Box 的上游规划资源，不是新的生成 Engine。

当前已实现第一步规划 runtime：`POST /story-projects/{project_id}/story-bibles/draft` 复用现有 ContentSpec、GenerationStrategy 与 LLMAdapter 生成一个 `draft` 版本并保存；若项目已有 Story Bible，该操作会在同一事务中失效并清空旧规划树、Stage、Episode Plan、生成批次/检查点、分集 Artifact、Continuity Ledger 和 Workspace 下游投影，同时返回新的 Project / Workspace revision 供 Frontend 继续同步。Frontend 的独立 `/projects/{project_id}/planning` 页面先展示并批准总纲，再继续剧情树，不在确认前展示正文。批准后通过 `POST /story-projects/{project_id}/plan-nodes/top-level/draft` 直接生成第一层真实剧情分支；服务端同步建立自动批准且前端隐藏的确定性技术根。批准的可展开分支通过 `POST /story-projects/{project_id}/plan-nodes/{node_id}/decompose` 按连续区间递归拆分；模型选择自然剧情边界，服务端强制叶节点为 8–12 集，至少 16 集的节点保持待展开，1–7 集或 13–15 集碎片返回父层协调。批准的 episode-ready 叶节点通过 `POST /story-projects/{project_id}/plan-nodes/{node_id}/episode-plans/draft` 生成单集线路图（兼容 `EpisodePlan` 契约），线路图只能分配已定义的单位剧情事件，批准后才允许进入区间内逐集正文请求。后台 Job、全自动递归和跨批次自动执行仍未实现。

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
- `RealLLMAdapter` 支持 `LLM_WIRE_API=chat_completions|responses`；Responses 模式可选传递 `LLM_REASONING_EFFORT=low|medium|high`
- OpenAI-compatible 不等于所有供应商都执行 strict JSON Schema；Story Bible 当前使用 Prompt 内权威 Schema + canonical field projection + Pydantic validation，并最多执行一次格式修复、一次中文语言修复和一次人物引用一致性修复，每类修复各自有界，不对业务语义做无限重写
- 已支持可选的服务端 `LLM_API_KEY_01` 到 `LLM_API_KEY_XX` 正文 Key Pool；主 `LLM_API_KEY` 继续服务总纲与规划接口，编号 Key 只服务正文生成适配器
- Key Pool 通过现有 `LLMAdapter` 抽象提供轮换和每 Key 有界并发，不改变 `POST /script-generation/generate-draft` 的请求/响应契约
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

### 0.6.1 POST `/content-specs/resolve-creative-intent`

用途：

- 将 Phase 1 结构化 Creative Intent 与 Character Context 确定性解析为标准 ContentSpec 和独立生成上下文

输入：

- `CreativeIntentInput`

输出：

- `CreativeIntentResolutionResponse`

当前行为：

- selected / added / excluded tag 只接受现有 Ontology ID
- selected / added tag 被解析为标准 `TagRef`
- free creative prompt 作为已归一化故事方向映射到 `ContentSpec.story_goal`
- Character Context、字段 provenance、locked fields 和 exclusions 保存在 `ResolvedCreativeContext`
- Character Context 不写入 `ContentSpec.metadata`
- Resolver 不调用 LLM、不创建新 OntologyNode、不做 AI 自动补全
- 解析成功后保存标准 ContentSpec

错误处理：

- `404` PlatformProfile 或 OntologyNode 不存在
- `409` 同一 tag 同时 selected / added 和 excluded
- `409` 引用 inactive OntologyNode
- `422` 输入 schema、active tag 数量或 Character Context 无效

### 0.7 POST `/script-generation/generate-draft`

用途：

- 运行一次最小 Script Generation Draft 联调流程

输入：

- `ScriptGenerationDraftRequest`

当前关键输入要求：

- `output_language` 必须显式提供
- 不允许由 Script Engine 对输出语言做静默默认
- `target_script_body_characters` 为 optional，可用于声明 300-10000 之间的单集动作与对白正文目标；当前它是 Prompt 长度预算，不是失败即拒绝的 Schema Gate
- 省略 `target_script_body_characters` 时保持旧 Prompt 长度行为，不破坏旧 API 调用方
- `resolved_creative_context` 为 optional；提供时其 `content_spec_id` 必须与请求一致
- Knowledge Bundle 不由请求任意传入；当前只通过 `GenerationStrategy.draft_knowledge_bundle_id` 精确声明
- Deepening 需要同时满足 Strategy 声明与 runtime feature flag；当前 `SCRIPT_CREATIVE_DEEPENING_ENABLED=false`，因此自动 shadow 和显式 `deepen-draft` 均关闭
- `episode_context.batch_context` 可选记录阶段编号、起止集数与阶段创作指令；旧请求保持兼容
- `episode_context` 为 optional；提供时用于约束分集编号、上一集连续状态、optional 用户续写指令和 bounded `project_continuity_summary`
- `project_continuity_summary` 来自前端可编辑的故事线与人物关系视图，只约束后续分集生成；它不改写历史 Draft，也不等同于 Story Planning runtime

输出：

- `ScriptGenerationDraftResponse`

当前返回重点字段：

- `orchestration_plan`
- `retrieval_result`
- `prompt_retrieval_result`
- `prompt_build_result`
- `llm_model_info`
- `llm_raw_output`
- `resolved_creative_context`（optional）
- `knowledge_bundle`（optional）
- `knowledge_selection_trace`（optional）
- `creative_deepening_run`（optional）
- `episode_context`（optional，原样进入 run lineage）
- `draft_master_script`
- `story_qc_report`

当前说明：

- `draft_master_script` 是当前联调链路的标准结构化草稿对象
- `llm_raw_output` 仅用于追踪和调试，不应视为最终业务对象
- `prompt_build_result.prompt_text` 当前可直接用于追踪真实模型的最终输入 Prompt
- `llm_model_info` 当前应反映 Mock / Real Adapter 的实际切换结果
- Prompt Builder 只注入已解析的 Character Context、provenance、locked fields 与 exclusions，不接收 raw Creative Intent
- 策略声明静态 Draft bundle 时，服务先校验 ContentSpec tag / platform 适用性，再将有界原则、限制与反模式注入独立 Prompt section
- 策略不声明 bundle 时，知识 section 与 selection lineage 均为空，旧请求行为保持不变
- shadow 策略使用独立 Deepening Prompt 和可选 Deepening bundle 生成一次候选，并记录 change trace、preservation checks、延迟/token 与同一 Story QC 的比较元数据
- shadow 候选无论通过或失败都不会替换 `draft_master_script`，RevisionPlan 继续基于原始 Draft 的 Story QC 生成
- Deepening 技术失败或 preservation rejection 作为 observational lineage 返回，不阻断原有 Draft 路径
- `story_qc_report` 当前除基础分数外，已返回：
  - `report_version`
  - `explainability_status`
  - `dimension_evaluations`
  - `evidence_summary`
  - `knowledge_refs`
- 该接口当前更适合作为内部步骤 API，而不是未来长期稳定的唯一外部契约

### 0.7a POST `/script-generation/review-draft`

对用户手动编辑后的结构化 Draft 重新执行现有 Story QC 与 RevisionPlan。该接口确定性运行、不调用 LLM，并返回可继续进入受控质量链的更新后 `ScriptGenerationDraftRun`。

### 0.7b POST `/script-generation/modify-draft`

接收 source generation run、source Draft 和一条用户修改指令，通过现有 Prompt Builder / LLMAdapter 生成独立候选。候选不会自动覆盖 source；返回结果包含更新后的 QC 与 RevisionPlan。

### 0.7c POST `/script-generation/deepen-draft`

保留的内部步骤 API。只有 `SCRIPT_CREATIVE_DEEPENING_ENABLED=true` 且 Strategy 配置有效时才运行；当前默认关闭并返回 `409`。重新启用后仍执行 preservation checks，返回候选、change trace、QC comparison 与 warning，且调用本身不自动替换正式 Draft。

### 0.7d POST `/script-generation/build-bilingual-view`

为英文 `DraftMasterScript` 生成供中文界面阅读的 presentation-only 对照视图。

输入：

- `generation_strategy_id`
- `draft_master_script`
- `target_language`，当前前端使用 `zh-CN`

输出：

- `BilingualScriptView`
- 每个 `items[]` 保留稳定 `path`、`source_text` 和 `translated_text`
- 实际 `llm_model_info` 与 optional warnings

边界：

- 不修改 Draft / Final `MasterScript`
- 不参与 Story QC、Revision 或 Finalization
- 输出必须覆盖所有源文本路径且不得增加未知路径
- Mock 模式只返回带明确 warning 的功能占位译文
- 前端按 Draft ID 缓存结果，避免重复请求

错误处理：

- `404` 引用的 `ContentSpec` 不存在
- `404` 引用的 `GenerationStrategy` 不存在
- `404` 引用的 `PromptLibraryItem` 不存在
- `404` `ContentSpec` 关联的 `PlatformProfile` 不存在
- `422` 缺少可追踪场景来源，例如既没有 `RetrievedAssets.scene` 也没有显式场景配置
- `422` `ResolvedCreativeContext.content_spec_id` 与生成请求不一致
- `422` 策略引用未知、阶段错误或不适用于当前 ContentSpec / platform 的静态 Knowledge Bundle
- `422` shadow 策略缺少 Deepening Prompt，或引用的 Deepening Prompt / bundle 无效
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
- 包含 Revised Draft、`RevisionExecutionTrace`、Re-QC 和 optional shadow `AcceptanceDecision`

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
- `variants[].story_qc_dimension_scores`
- `variants[].story_qc_dimension_summaries`
- `variants[].story_qc_evidence`
- `variants[].story_qc_revision_signals`
- `variants[].story_qc_scene_refs`
- `variants[].samples[].deterministic_checks`
- `variants[].samples[].story_qc_score`
- `variants[].samples[].story_qc_dimensions`
- `variants[].samples[].latency_ms`
- `variants[].samples[].token_usage`
- `variants[].samples[].artifact_ids`
- `decision_summary`

当前 `variants[].explainability` 在 v1 中已开始消费 `StoryQCReport.dimension_evaluations`，当前可返回：

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

该接口的完整受控链路、输入输出与错误处理已在上文 `1.2 POST /master-scripts/finalize` 统一定义，此处仅保留资源顺序索引，避免重复契约漂移。

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

## 长篇规划资源 API

以下长篇资源接口已接入 PostgreSQL persistence foundation。ContentSpec API 在配置 PostgreSQL 时也使用 durable Repository；生产运行前必须配置 `DATABASE_URL` 并执行 Alembic migration。长篇资源未配置数据库时返回 `503`，ContentSpec 则保留无数据库测试所需的进程内兼容路径。

### PUT `/story-projects/{project_id}`

- 幂等创建或按 optimistic `revision` 更新 `StoryProject`
- Path ID 必须与 payload 一致
- 新对象必须从 revision 1 开始；更新必须基于当前 revision + 1
- stale write、非法状态迁移或无效 active Story Bible 返回 `409`

### GET `/story-projects`

- 分页列出未归档项目，支持 `limit` 与 `offset`
- `include_archived=true` 仅用于显式审计读取
- 返回 `data`、`total`、`limit` 与 `offset`

### GET `/story-projects/{project_id}`

- 获取单个持久化项目
- 不存在时返回 `404`

### DELETE `/story-projects/{project_id}`

- 通过 `expected_revision` 执行版本保护的软归档，不物理删除数据
- stale revision 返回 `409`；归档项目默认不再出现在列表中

### PUT `/story-projects/{project_id}/workspace`

- 保存 Frontend 完整工作区 JSONB snapshot，要求 workspace payload ID 与项目 ID 一致
- 使用独立单调递增 workspace revision；同 revision 相同 payload 可幂等重放，不同 payload 返回 `409`
- 服务端记录 payload schema、client instance、checksum 和字节数；超过 50 MB 返回 `413`

### GET `/story-projects/{project_id}/workspace`

- 恢复最新 Frontend authoring snapshot；项目或快照不存在时返回 `404`

### POST `/story-projects/{project_id}/episodes/{episode_number}/artifacts`

- 保存 `draft / revised / final` 不可变内容里程碑，版本号由服务端在项目事务锁内分配
- `artifact_id` 相同且 payload 相同可幂等重放；不同 payload 返回 `409`
- optional source artifact 必须属于同一项目和同一集；超过 5 MB 返回 `413`

### GET `/story-projects/{project_id}/episodes/{episode_number}/artifacts`

- 按版本顺序列出该集 Artifact，可通过 `artifact_kind` 筛选

### GET `/story-projects/{project_id}/episodes/{episode_number}/artifacts/{artifact_id}`

- 读取单个不可变 Artifact；项目、集号或 ID 不匹配返回 `404`

### PUT `/story-projects/{project_id}/story-bibles/{story_bible_id}/versions/{version}`

- 保存 immutable `StoryBible` version
- 同一 ID / version 的相同 payload 可幂等重放，不同 payload 不允许覆盖
- `content_spec_id` 必须与所属 Project 一致

### GET `/story-projects/{project_id}/story-bibles/{story_bible_id}`

- 默认读取最新版本，也可通过 `version` 查询指定版本

### PUT `/story-projects/{project_id}/stages/{stage_id}/versions/{version}`

- 保存 immutable `StoryStagePlan` version
- Stage 必须引用同一 Project 的 Story Bible，集数范围不得超过 Project

### GET `/story-projects/{project_id}/stages`

- 按阶段编号与版本列出 Stage Plan

### PUT `/story-projects/{project_id}/episode-plans/{episode_plan_id}/versions/{version}`

- 保存 immutable `EpisodePlan` version
- Episode、Stage、Story Bible 必须属于同一 Project，集号必须处于 Stage 范围内

### GET `/story-projects/{project_id}/episode-plans`

- 可按 `start_episode` / `end_episode` 读取分集计划
- 当前返回规划版本，不返回 Draft / Revised / Final episode artifact

当前边界：

- Frontend 已调用 Project、Workspace Snapshot 与 Episode Artifact 接口，并保留 IndexedDB 作为即时本地缓存和服务不可用时的离线回退
- 合并以 `updated_at` 比较并使用 revision 防止 lost update；冲突只报告，不静默覆盖
- 尚未开放 Continuity Ledger、Generation Batch / Job 的公共写接口
- 尚未实现权限、租户、后台 worker、无人值守全树规划、跨批次自动续跑或长篇生成 facade
- 这些接口不改变现有单集 Draft、Story QC、Revision、Acceptance 或 Finalization 行为

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
- ContentSpec 已使用 PostgreSQL persistence foundation，并保持原有 API payload；Prompt、Strategy 与部分历史 Script Generation 仓储仍以进程内实现为主
- 长篇规划资源、Frontend Workspace Snapshot 与确认/修订/终稿 Episode Artifact 已使用 PostgreSQL persistence foundation；编辑过程细粒度历史仍由 Workspace Snapshot 承载
