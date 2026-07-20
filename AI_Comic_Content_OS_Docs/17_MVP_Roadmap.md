# 17_MVP_Roadmap

## 已完成基础能力

- Data Intelligence 基础链路
- Scheduled Data Ingestion Foundation
- Ingestion Run History Foundation
- Trend Snapshot Foundation
- TikTok Platform Intelligence Foundation
- Ontology
- Tag System
- Knowledge Base Foundation
- Unified Asset Model
- Prompt Library Foundation
- Generation Strategy Foundation
- `AnalysisResult`
- `ContentSpecDraft`
- `ContentSpec`
- Rule-based Retrieval
- `Orchestrator`
- `LLMAdapter` Foundation
- Prompt Builder Foundation
- `DraftMasterScript` Generation
- `StoryQCReport` Placeholder + Rubric Foundation
- `RevisionPlan` Foundation
- Revision Decision / Strategy / Planner
- `RuleBasedRevisionExecutor` Controlled Execution
- `RevisionExecutionTrace`
- Revision Acceptance Evaluator v1（shadow mode）
- Re-QC Gate
- Final `MasterScript` Finalization Workflow
- Fixed Benchmark Datasets
- Benchmark Ground Truth
- Analysis Evaluation
- ContentSpec Evaluation
- Prompt Evaluation
- Prompt Evaluation Explainability
- Prompt Evaluation Explainability Integration v1
- Script Evaluation
- Story QC Evaluation
- Benchmark Runner
- Benchmark API
- Explainable `AnalysisResult`

## Current Capability Optimization

当前阶段：`Capability Optimization / System Validation`

当前优化优先级：

1. Revision Acceptance / Policy Calibration
2. Initial Generation Quality Improvement v1

当前 checkpoint 只聚焦 Script Generation；Data Intelligence Quality Improvement 暂不启动。

已完成的本阶段能力优化：

- Story QC Explainability Upgrade v1
- Prompt Evaluation Explainability Integration v1

当前重点：

- Explainability
- Benchmark Stability
- Quality Comparison
- Regression Detection
- Revision effectiveness
- 受控修订的目标维度改善与回退检测
- `ContentSpec` 质量提升

已完成的 `Story QC Credibility Improvement` 第一轮只聚焦：

- `Hook Quality`
- `Character Agency`
- `Conflict Escalation`
- `Emotional Payoff`
- `Cliffhanger Strength`

已完成的第一轮目标：

- 提升 `StoryQCReport` Explainability
- 增强 scene-level 问题定位
- 增强对 `RevisionPlan` 的可执行支持
- 增强 `Prompt Evaluation` 的质量分析能力

当前 `Prompt Evaluation Explainability Integration v1` 已完成最小落地：

- 已消费 `StoryQCReport.dimension_evaluations`
- 已输出维度级 improvements / regressions
- 已输出 evidence / scene refs / revision signals
- 已输出推荐保留理由与 confidence note

## Revision Quality Improvement v1

当前优化目标是将 Revision 从“基于 Rubric 的规则化修补”逐步演进为“有边界、可解释、证据驱动的受控剧本打磨”。

Revision v1 能力范围：

- `RevisionDecision`
- `RevisionStrategy`
- `RevisionPolicy`
- `AcceptanceDecision`
- 单轮、定向修订原则
- Revision effectiveness 评估指标

当前设计策略与落实状态：

- `RevisionPolicy.max_revision_rounds` 模型与 shadow policy 当前均为 `1`，但尚不驱动多轮 runtime loop
- Planner 已落实每轮最多选择 1 至 2 个高影响维度
- `RuleBasedRevisionExecutor` 已限制到 Strategy scene refs，并检查 protected dimensions
- `RevisionAcceptanceEvaluator` 已计算目标维度改善、回退、保护稳定性、场景对齐和 effectiveness
- Acceptance 当前只以 shadow mode 保存，不阻断 Revision 或 Finalization

当前状态：

- Phase 1 已完成：`RevisionDecision`、`RevisionStrategy`、`RevisionPolicy`、`AcceptanceDecision` 数据模型基础
- Phase 2 已完成：Revision Planner decision logic 与 explainable strategy generation
- Planner 当前最多选择两个高影响、有场景证据的维度
- Planner 当前生成 selected / deferred / protected dimensions 并保留 scene refs
- Planner 当前兼容旧 `StoryQCReport`
- Phase 3 已完成：RevisionPlan 意图保留、Executor abstraction、controlled rule execution 与 execution trace
- Phase 4.1 已完成：Acceptance Evaluator 与 `ScriptRevisionRun` shadow lineage integration
- 当前 API、Benchmark dataset 和 Finalization Gate 保持不变

当前 checkpoint 待验证：

- 用人工/策划 Ground Truth 校准 Acceptance 判定
- 在固定 Benchmark 上校准 `minimum_improvement_threshold`、`acceptance_threshold`、`regression_limit` 和 tolerance
- 增加跨样本 Revision effectiveness 汇总与回归报告
- 校准完成后再决定 Acceptance 是否影响 Finalization
- 校准完成后再决定是否弃用旧 `ScriptRevisionRun.improved`

### Script Generation Quality Loop v1 Checkpoint

- 结构完整：QC → Decision → Strategy → Plan → Executor → Re-QC → Acceptance → `ScriptRevisionRun`
- Runtime 已实现：Planner、controlled executor、execution trace、Re-QC 与 Acceptance 计算
- Shadow：Acceptance 只记录，不改变 Revision 或 Finalization 行为
- 实验性：Story QC 专业可信度、规则式创意修改质量与 Acceptance 阈值
- 生产强制：仍只有独立 Finalization Gate 的既有校验
- 最近记录的全量测试基线：`166 passed, 1 skipped`

当前先完成 Acceptance / RevisionPolicy 校准，因为后续 Initial Generation Quality 优化需要可信、可复现的质量判定信号。校准完成后，再进入 Initial Generation Quality Improvement v1。

当前不启用：

- Acceptance enforcement
- 多轮 Revision Policy loop
- LLM judge
- 自动 Revision 重试

`Revision Quality Improvement v1` 当前不做：

- 重写主链路
- 引入复杂模型
- 多轮或无限 Revision Loop
- 全剧本重新生成
- 多 Agent / LangGraph 修订架构

## Backlog Reserve

- Script Industry Knowledge Registry Design
- Bilingual Developer View Placeholder / Export Design
- Script Generation Box Contract
- `ScriptGenerationRequest` / `ScriptGenerationResult` Formalization
- `ScriptGenerationRequestMapper`
- `ScriptGenerationWorkflowService` / Facade
- Storyboard / Voice / Animation / Video Handoff Mapper Design
- Knowledge-aware Story QC
- Knowledge-aware Prompt Builder
- Knowledge-aware Prompt Evaluation
- Knowledge-aware Script Revision
- Knowledge-aware Retrieval
- Knowledge-aware Benchmark
- Feedback Learning Expansion
- Cost Optimization

## Media Production Phase

以下能力继续保留在后续 Media Production Phase，不进入当前剧本 MVP 主链路：

- Storyboard
- Voice Pipeline
- Animation Pipeline
- Video Pipeline
- Seedance Integration
- Video Composition
