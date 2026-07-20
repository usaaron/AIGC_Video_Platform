# AI Comic Content OS

AI Comic Content OS 是一个数据驱动、模块化、可扩展的 AI 漫剧内容生产系统。

当前 MVP 的唯一目标是构建一个能够持续生成高质量 AI 漫剧剧本的 `Content Planning Engine`。

当前主链路为：

`Data Intelligence -> ContentSpec -> Knowledge Base -> Asset Retrieval -> Orchestrator -> Prompt Retrieval -> Prompt Builder -> LLMAdapter -> DraftMasterScript -> StoryQCReport -> RevisionDecision -> RevisionStrategy -> RevisionPlan -> RevisionExecutor -> Re-QC -> AcceptanceDecision -> ScriptRevisionRun -> FinalMasterScript`

当前阶段已经从 `Build Foundation` 切换到 `Capability Optimization / System Validation`。

当前仓库已落地的首个模块是 `ContentSpec` 基础模块：

- 使用 `ContentSpec` 作为内容决策到生产之间的核心中间对象
- 使用 `FastAPI` 提供最小 API
- 使用 `Pydantic` 完成输入输出建模与校验
- 当前仓储为内存实现，后续可替换为 `SQLModel + PostgreSQL`

当前同时已提供 `PlatformProfile` 基础模块：

- 将平台规则封装为独立对象，而不是写入核心内容逻辑
- 当前支持通过 API 创建、查询 `PlatformProfile`
- `ContentSpec.platform_goal.platform_profile_id` 可引用如 `tiktok_v1` 这样的稳定 profile 标识
- 创建 `ContentSpec` 前应先确保对应 `PlatformProfile` 已存在

当前同时已提供 `OntologyNode` 基础模块：

- 用受控 `OntologyNode` 表达统一标签节点
- 当前支持通过 API 创建、查询 `OntologyNode`
- 创建 `ContentSpec` 前应先确保其 `tags` 引用的 `OntologyNode` 已存在且定义一致

当前同时已提供 `Knowledge Base` 基础模块：

- 使用统一 `Asset` 作为当前知识库最小基础对象
- 使用 `asset_type` 区分人物、场景、风格、剧情结构等不同资产
- `Asset.tags` 当前统一复用受控 `TagRef`
- 当前支持通过 API 创建、查询 `Asset`

当前同时已提供 `Asset Retrieval` 基础模块：

- 当前读取 `OrchestrationPlan.asset_requests`
- 当前采用可解释的规则检索
- 当前支持 `asset_type`、必选标签、可选标签、平台适用范围匹配
- 当前支持通过 API 解析候选资产

当前同时已提供 `MasterScript` 基础模块：

- 用结构化数据表达当前阶段的最终剧本产物
- 当前支持通过 API 查询 `MasterScript`
- 直接创建 Final `MasterScript` 的入口当前已弃用
- 当前只允许从包含 Draft、RevisionPlan、Revised Draft 与 Re-QC 的 `ScriptRevisionRun` 进入受控 Finalization
- `ScriptRevisionRun` 可携带 shadow `AcceptanceDecision`，但它当前不是 Finalization 必填条件
- Final `MasterScript` 当前会保存完整 lineage 与 Finalization Policy 版本信息

当前同时已提供 Script Generation Strategy 基础占位：

- `Prompt Library` 作为 `Knowledge Base` 的一部分沉淀可复用 Prompt 资产
- `GenerationStrategy` 用于声明一次剧本生成任务采用的完整生成方案
- `PromptBuilder` 用于根据结构化上下文组装可追踪的最终 Prompt
- `MockLLMAdapter` 作为模型无关接入占位
- `RealLLMAdapter` 作为首次真实剧本生成验证入口，当前采用 OpenAI-compatible 结构化输出接入方式
- `PlaceholderStoryQC` 作为草稿剧本质量检查占位
- `RubricRevisionPlanner` 已支持 evidence-driven `RevisionDecision`、`RevisionStrategy` 与兼容 `RevisionPlan` 生成
- `ScriptRevisionService` 通过 `RuleBasedRevisionExecutor` 执行受场景范围和保护维度约束的确定性修订
- `RevisionAcceptanceEvaluator` 已在 Re-QC 后以 shadow mode 计算修订有效性，并将结果保存到 `ScriptRevisionRun`
- 当前业务层只依赖 `LLMAdapter`

当前说明：

- `RealLLMAdapter` 已支持一个 OpenAI-compatible 接入方式
- 真实模型当前只用于能力验证和手动 integration
- 当前不允许把业务层绑定到单一模型供应商
- `Story QC`、规则式 Revision 和 Acceptance 阈值当前仍属于实验性能力，不应被描述为已经专业化或生产校准完成
- `AcceptanceDecision` 当前只用于观测和 lineage，不阻断 Finalization，也不替代 Finalization Gate

当前同时已提供 `Prompt Library Foundation`：

- 当前支持通过 API 创建、查询 `PromptLibraryItem`
- `PromptLibraryItem.applicable_tags` 当前必须引用已存在的 `OntologyNode`
- 当前先作为结构化 Prompt 资产库，不实现复杂检索与自动优化

当前同时已提供 `Prompt Retrieval Foundation`：

- 当前支持通过 API 按 `GenerationStrategy.prompt_ids` 解析 Prompt 资产
- 当前 `ScriptGenerationService` 已通过 `PromptRetrievalService` 读取 Prompt
- 当前仅支持 `exact_ids` 模式，后续可扩展标签、平台、受众匹配

当前同时已提供 `Generation Strategy Foundation`：

- 当前支持通过 API 创建、查询 `GenerationStrategy`
- `GenerationStrategy.prompt_ids` 当前必须引用已存在的 `PromptLibraryItem`
- `GenerationStrategy.applicable_tags` 当前必须引用已存在的 `OntologyNode`
- 当前先作为结构化策略层，不实现复杂多轮编排

当前同时已提供 `Script Generation Draft Integration Service`：

- 当前支持通过 API 运行一次最小 Draft 联调流程
- 当前流程会串起 `Orchestrator -> Retrieval -> Prompt Retrieval -> Prompt Builder -> LLMAdapter -> StoryQC -> RevisionPlan`
- 当前输出包含标准化的 `DraftMasterScript`
- 当前输出同时包含结构化 `RevisionPlan`
- 当前支持单独运行 `RevisionPlan -> Script Revision -> Re-QC`
- 当前输出仍然不是自动生成的 Final `MasterScript`

当前同时已提供 `MasterScript Finalization Mapper`：

- 当前支持通过 API 将完整 Revision 链 Finalize 为 Final `MasterScript`
- 当前采用受控 Finalization Gate，而不是直接 `from-draft`
- 当前 Finalization 会校验 Re-QC 阈值并写入 lineage
- 当前不调用真实 LLM 做最终润色

当前同时已提供 `Benchmark & Evaluation Framework`：

- 固定 Benchmark 数据位于 `datasets/benchmark/`
- 日常开发 Mock 数据位于 `datasets/mock/`
- 当前支持 `Analysis`、`ContentSpec`、`Prompt`、`Script`、`Story QC` 评估
- 当前支持 `Benchmark Runner` 与 Benchmark API
- 当前 Benchmark 已接入 `RevisionPlan -> Script Revision -> Re-QC`
- Revision Acceptance Calibration v1 提供 12 个固定合成 Ground Truth 样本和确定性离线报告
- 当前已提供 `Prompt Evaluation` 最小闭环，可比较 Prompt 版本、`GenerationStrategy` 和重复运行稳定性
- 当前已补充 Prompt Evaluation Explainability，强调解释“为什么变好 / 变差”，而不只输出差异摘要
- 当前已在文档层预留 `Script Industry Knowledge` 与 `Bilingual Developer View` 边界，但它们尚未进入正式生产主链路实现

当前优化优先级：

1. Revision Acceptance / Policy Calibration
2. Initial Generation Quality Improvement v1

当前已完成 Story QC Explainability Upgrade v1、Prompt Evaluation Explainability Integration v1，以及 Revision Quality Improvement v1 的 Decision、Strategy、Planner、Executor 和 Acceptance shadow integration。Acceptance Calibration v1 完成一次性 false-acceptance 安全修正后，固定 12 样本人工一致率为 `0.750`，false acceptance 从 2 个降为 1 个；受保护 Hook 回退已阻止，对白自然度/角色声音仍是明确 QC blind spot。状态仍为 `review_required`，当前不启用 Acceptance enforcement，也不自动调整 Policy。

未来 Script-to-Production 兼容边界已经在文档中预留：

`FinalMasterScript -> Script-to-Production Adapter -> Model-Independent Production Package -> Seedance / Other Video Model Adapter`

当前只记录兼容原则，不实现 Adapter、Production Package、Seedance 调用或生产 API。Final `MasterScript` 继续保存“发生什么、为什么发生”的稳定故事语义；镜头、灯光、音频、连续性展开和模型专用 Prompt 应由未来 Adapter 派生。

未来 Knowledge-Guided Generation 同样只属于设计方向：专业知识应先成为可治理、可版本化资产，再通过受控任务框架、Prompt Builder 与 `LLMAdapter` 参与原创生成。当前不实现完整 Knowledge Registry、RAG、Creative Skill Registry 或知识自动注入，当前优化优先级保持不变。

当前保留两类不同信号：

- `ScriptRevisionRun.improved`：旧版基于 Re-QC `overall_score` 的非下降判断
- `ScriptRevisionRun.acceptance_decision`：面向目标维度改善、回退安全和场景对齐的 shadow 修订有效性判断

二者当前不等价，也不应互相替代。

当前同时已提供 `Orchestrator` 基础模块：

- 用结构化 `OrchestrationPlan` 表达剧本生成前的编排结果
- 当前支持通过 API 创建、查询 `OrchestrationPlan`
- 创建 `OrchestrationPlan` 前应先确保对应 `ContentSpec` 已存在

当前同时已提供 `Data Intelligence` 基础模块：

- 使用 `RawContentRecord -> AnalysisResult -> ContentSpecDraft -> ContentSpec` 作为统一分析链路
- 当前采用 `Manual Import First`
- 当前支持 `ManualJSONImportAdapter` 与 `ManualCSVImportAdapter`
- 当前支持通过 API 运行完整手工导入分析管线并产出 `ContentSpec`
- `TikTokScraperAdapter`、`ApifyAdapter`、`RedditAdapter`、`YouTubeAdapter`、`WebtoonAdapter` 仅保留 Phase 2 扩展占位

当前同时已提供 `Scheduled Data Ingestion` 基础模块：

- 使用 `DataIngestionJob` 描述周期性导入任务
- 使用 `DataIngestionRunHistory` 保存每次运行快照
- 当前支持 `daily`、`weekly`、受限 `custom_cron`
- 当前支持记录 `last_run_at`、`next_run_at`、`run_status`、`error_message`
- 当前支持基于 `source_item_id` 与 `source_url` 去重
- 当前可运行 adapter 仅包括 `manual_json` 与 `manual_csv`

当前同时已提供 `Trend Intelligence` 基础模块：

- 当前最小实现为 `TrendSnapshot`
- 当前基于 `DataIngestionRunHistory` 聚合最近运行信号
- 当前输出运行数量、导入量、去重量、标签频率与基础平均分

## 目录

```text
backend/app/
tests/
examples/
AI_Comic_Content_OS_Docs/
```

## 安装

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## 运行 API

```bash
uvicorn app.main:app --app-dir backend --reload
```

访问 `http://127.0.0.1:8000/docs` 查看接口文档。

## 运行测试

```bash
pytest
```

运行端到端 smoke test：

```bash
pytest tests/test_e2e_content_planning_pipeline.py
```

运行真实 LLM 适配器相关测试：

```bash
pytest tests/test_llm_adapter.py tests/test_llm_runtime.py
```

运行 Prompt Evaluation 相关测试：

```bash
pytest tests/test_prompt_evaluation_runner.py tests/test_prompt_evaluation_api.py
```

## 运行 Benchmark

运行固定 Revision Acceptance Calibration：

```bash
PYTHONPATH=backend python -m app.modules.script_engine.revision_acceptance_calibration
```

该命令只读取 `tests/fixtures/revision_acceptance_calibration/` 的 12 个固定合成样本，不调用 LLM。输出是一次离线结构化报告，不会修改 `RevisionPolicy` 或当前 runtime。

运行固定 Benchmark API：

```bash
uvicorn app.main:app --app-dir backend --reload
curl -X POST http://127.0.0.1:8000/benchmarks/run \
  -H "Content-Type: application/json" \
  -d '{"dataset_id":"us_female_dark_romance","dataset_type":"benchmark"}'
```

当前建议优先查看返回结果中的：

- `score_summary`
- `revision_summary`
- `highlights`

当前完整端到端验证路径由 `tests/test_e2e_content_planning_pipeline.py` 覆盖：

`Raw Data -> ContentSpec -> Draft -> Revision -> Re-QC -> Final MasterScript`

## 运行 Prompt Evaluation

运行默认 Prompt Evaluation 配置：

```bash
python scripts/run_prompt_evaluation.py
```

运行自定义配置：

```bash
python scripts/run_prompt_evaluation.py examples/prompt_evaluations/default_request.json
```

当前默认会生成：

- `examples/prompt_evaluations/last_result.json`
- `examples/prompt_evaluations/reports/prompt_eval_minimal_v1.json`
- `examples/prompt_evaluations/reports/prompt_eval_minimal_v1.md`

也可以通过 API 运行：

```bash
curl -X POST http://127.0.0.1:8000/benchmarks/prompt-evaluations/run \
  -H "Content-Type: application/json" \
  -d @examples/prompt_evaluations/default_request.json
```

当前支持的比较方式：

- 同一个 `ContentSpec`，不同 Prompt 版本
- 同一个 Prompt，不同 `GenerationStrategy`
- 同一组合重复运行，观察输出稳定性

当前报告还会给出：

- 当前最值得保留的 Variant
- 相对基线哪些指标真正提升
- 哪些指标退化
- 是否带来新的副作用
- 下一步最值得优化的 Prompt / QC 方向

当前说明：

- `Prompt Evaluation` 复用现有 `Data Intelligence` 和 `ScriptGenerationService`
- `promptfoo` 当前只作为外部评估工具边界，不进入核心业务主链路
- 当前 `Story QC` 仍然是 placeholder，因此其分数只能作为实验信号
- 当前如果使用 `MockLLMAdapter`，内容语义类检查会保留在报告中，但主要作为观察信号

## 首次真实剧本生成验证

默认仍使用 `MockLLMAdapter`。

切换到真实适配器前请先配置：

```bash
export LLM_PROVIDER=openai_compatible
export LLM_MODEL=your-model-name
export LLM_API_KEY=your-api-key
export LLM_BASE_URL=https://your-provider.example/v1
export LLM_TIMEOUT_SECONDS=60
export LLM_MAX_RETRIES=2
```

手动运行首次真实生成验证：

```bash
python scripts/run_real_generation_validation.py
```

生成结果会写入：

- `examples/real_generation/final_master_script.json`
- `examples/real_generation/final_master_script.md`
- `examples/real_generation/story_qc_report.json`
- `examples/real_generation/revision_plan.json`
- `examples/real_generation/generated_prompt.txt`

## 示例数据

示例 `ContentSpec` 位于：

- `examples/content_specs/tiktok_v1_revenge_romance.json`

示例 `PlatformProfile` 位于：

- `examples/platform_profiles/tiktok_v1.json`

示例 `OntologyNode` 位于：

- `examples/ontology_nodes/core_tags.json`

示例 `Asset` 位于：

- `examples/assets/fake_marriage_asset_library.json`

示例 `MasterScript` 位于：

- `examples/master_scripts/fake_marriage_episode_001.json`

示例 `Revision Chain -> Final MasterScript` 请求位于：

- `examples/master_scripts/finalize_request.json`

示例 `Revision Chain -> Final MasterScript` 响应位于：

- `examples/master_scripts/finalize_response_sample.json`

示例 `OrchestrationPlan` 输入位于：

- `examples/orchestrations/fake_marriage_plan_001.json`

示例 `Retrieval` 请求位于：

- `examples/retrieval/resolve_plan_request.json`

示例 `Data Intelligence` 手工 JSON 输入位于：

- `examples/data_intelligence/manual_json_trend_sample.json`

示例 `Data Intelligence` 手工 CSV 输入位于：

- `examples/data_intelligence/manual_csv_trend_sample.csv`

固定 Benchmark 数据位于：

- `datasets/benchmark/us_female_dark_romance.json`
- `datasets/benchmark/us_werewolf_romance.json`
- `datasets/benchmark/ceo_romance.json`
- `datasets/benchmark/supernatural_romance.json`
- `datasets/benchmark/revenge_drama.json`

示例 `Benchmark` 请求位于：

- `examples/benchmarks/run_request.json`

示例 `Benchmark` 摘要结果位于：

- `examples/benchmarks/result_summary_sample.json`

示例 `Scheduled Ingestion Job` 位于：

- `examples/scheduled_ingestion/manual_json_daily_job.json`

示例 `Scheduled Ingestion Run History` 位于：

- `examples/scheduled_ingestion/run_history_sample.json`

示例 `Revision Plan` 请求位于：

- `examples/script_engine/revision_plan_request.json`

示例 `Revision Plan` 响应位于：

- `examples/script_engine/revision_plan_response_sample.json`

示例 `Revise Draft` 请求位于：

- `examples/script_engine/revise_draft_request.json`

示例 `Revise Draft` 响应位于：

- `examples/script_engine/revise_draft_response_sample.json`

示例 `Trend Snapshot` 请求位于：

- `examples/trend_snapshots/generate_request.json`

示例 `Trend Snapshot` 结果位于：

- `examples/trend_snapshots/trend_snapshot_sample.json`

示例 `Prompt Library` 位于：

- `examples/script_engine/prompt_library_sample.json`

示例 `Prompt Retrieval` 请求位于：

- `examples/script_engine/prompt_retrieval_request.json`

示例 `Prompt Retrieval` 响应位于：

- `examples/script_engine/prompt_retrieval_response_sample.json`

示例 `Generation Strategy` 位于：

- `examples/script_engine/generation_strategy_sample.json`

示例 `Prompt Evaluation` 请求位于：

- `examples/prompt_evaluations/default_request.json`

示例 `Prompt Evaluation` 运行快照位于：

- `examples/prompt_evaluations/last_result.json`

示例 `Script Generation Draft` 请求位于：

- `examples/script_engine/generate_draft_request.json`

示例 `Script Generation Draft` 响应位于：

- `examples/script_engine/generate_draft_response_sample.json`
