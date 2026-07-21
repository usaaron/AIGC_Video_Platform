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

1. Initial Generation Quality Improvement v1

`Revision Acceptance / Policy Calibration` 已完成当前 shadow 校准并关闭，不在本阶段继续调参。

`Initial Generation Quality Improvement v1 Step 1 - Scene Causality` 已完成最小实现：

- 新生成场景包含结构化 Goal / Conflict / Outcome
- 后续场景引用更早场景结果并保存 causal link
- Prompt Builder 使用平台无关的内嵌 Scene Plan 契约
- 旧 Draft / Final payload 保持兼容
- Prompt Evaluation 增加 GCO 完整度、跨场因果链和终场因果悬念检查
- 三个固定 Mock Benchmark 的 GCO 覆盖由 `0/3` 提升为 `3/3`，后续场景引用为 `2/2`
- 真实模型固定三样本 A/B 已完成，Improved 在 2/3 样本中被偏好且无重大结构回退，状态为 `validated_for_next_step`
- 当前同时记录候选平均 total token 增加约 16%、部分结尾惊喜度下降和因果表达可能机械化的风险；不基于单轮实验继续调 Prompt

`Serialized Story Planning v1` 首轮真实模型离线 A/B 已完成：

- 三组原创四集 fixture 共完成 24 次 Direct / Planned 生成；Planned 在 Dark Romance 与 Revenge Drama 中被偏好
- Setup/Payoff、Repetition Control 与 Serialization Quality 改善，但 Hook、Cliffhanger 与 Conflict Escalation 退化
- Supernatural Romance 暴露相邻 Episode Plan 重复指定 `rescue -> memory loss` 的过度约束问题
- 当前决策为 `revise_planning_concept`，不进入 Schema、Prompt Builder、Generation Service 或 runtime

`Serialized Story Planning Contract v1.1 Candidate` 有界真实模型复验已完成：

- Story Blueprint 保留稳定系列方向和 Setup/Payoff 义务
- Episode Plan 只定义叙事责任、必要状态变化和信息义务，不指定具体冲突、Hook 或 Cliffhanger 装置
- Supernatural Romance 主案例与 Revenge Drama 对照案例共完成 16 次受控生成；Planned 在 2/2 故事中被偏好
- 主要重复机制已修复，Setup/Payoff、Repetition Control、Cross-Episode Causality 与 Character Decision Consistency 改善
- Aggregate Hook 与 Cliffhanger 仍分别低于 Direct `0.20` 与 `0.10`，未通过严格 runtime-entry gate
- 当前冻结为正向 Research Evidence，不继续调优，也不进入 Schema、Prompt Builder、Generation Service 或 runtime

`Character Decision Logic v1` 当前进入架构评审与离线验证设计：

- 只研究角色目标、恐惧、信念、矛盾、压力决策模式与行为边界是否能提升首稿角色可信度
- 复用固定单集 ContentSpec 与现有 Scene Causality，计划最多执行一次 3 组、6 次真实模型 A/B
- 当前不修改 CharacterProfile、Prompt Builder、Story QC、Revision 或主链路

### Creative Brief Input Control Requirement（Design Only）

已完成文档级输入控制设计：

```text
Data Intelligence Recommended Tags
→ User Selection / Addition / Exclusion + Creative Prompt
→ Platform Hard Constraints
→ Creative Brief Resolution
→ Final ContentSpec
→ Existing Script Generation
```

当前状态：

- `CreativeBriefInput` 与 Resolution Result 仅为文档级建议契约
- 继续复用统一 Ontology 与 `TagRef`，不创建第二套标签系统
- `ContentSpec` 继续作为标准化运行时 Single Source of Truth
- 当前未实现 Resolver、API、前端、持久化或 Knowledge Retrieval
- 该需求用于未来提升输入可控性，不替代当前 Initial Generation Quality Improvement 优先级

未来实现缺口：

- Creative Brief Resolution 的确定性 mapper / resolver
- Ontology alias 解析和 unresolved tag 人工确认
- 冲突 warning 与 `requires_user_resolution` 流程
- authoring lineage 持久化
- 固定输入样本上的 controllability Benchmark

当前 checkpoint 只聚焦 Script Generation；Data Intelligence Quality Improvement 暂不启动。

已完成的本阶段能力优化：

- Story QC Explainability Upgrade v1
- Prompt Evaluation Explainability Integration v1

当前重点：

- Initial Generation Quality Improvement 的固定样本验证
- Character Decision Logic v1 的有界离线验证准备
- Benchmark Stability、Quality Comparison 与 Regression Detection
- 保留既有 Revision effectiveness 观测，不继续 Acceptance 自动调参

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
- Phase 4.2 已完成：12 个固定合成 Ground Truth 样本与离线 Acceptance 校准报告
- Phase 4.3 已完成：一次性 protected-dimension false-acceptance 安全修正
- 当前 API、Benchmark dataset 和 Finalization Gate 保持不变

当前 checkpoint 结果：

- 首轮校准状态为 `review_required`
- 可复现性与 clear-negative safety 已通过
- 一次性复校准人工一致率为 `0.750`，仍未达到 `0.80` go/no-go 目标
- Hook protected-dimension false acceptance 已解决；对白自然度/角色声音 blind spot 仍存在
- false rejection 保持 2 个，本轮未优化
- 当前不启用 Acceptance enforcement，不自动调整 Policy

后续仍待人工决策：

- 评审对白自然度和角色声音缺少 runtime 证据的剩余 false acceptance
- 保留两个 minimum threshold false rejection，除非后续另行批准独立实验
- 决定是否另行批准阈值实验；本轮不自动校准 `RevisionPolicy`
- 增加跨样本 Revision effectiveness 汇总与回归报告
- 达到可信证据标准后再决定 Acceptance 是否影响 Finalization
- 校准完成后再决定是否弃用旧 `ScriptRevisionRun.improved`

### Script Generation Quality Loop v1 Checkpoint

- 结构完整：QC → Decision → Strategy → Plan → Executor → Re-QC → Acceptance → `ScriptRevisionRun`
- Runtime 已实现：Planner、controlled executor、execution trace、Re-QC 与 Acceptance 计算
- Shadow：Acceptance 只记录，不改变 Revision 或 Finalization 行为
- 实验性：Story QC 专业可信度、规则式创意修改质量与 Acceptance 阈值
- 生产强制：仍只有独立 Finalization Gate 的既有校验
- 最近记录的全量测试基线：`177 passed, 1 skipped`

当前先人工评审 Acceptance Calibration v1 的 `review_required` 结果。未达到 go/no-go 标准前，不把 Acceptance 当作 Initial Generation Quality 优化的可信自动判定器，也不自动进入 Policy 调参。

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
- Script-to-Production Adapter Design
- Model-Independent Production Package Design
- Seedance / Other Video Model Adapter Compatibility
- Knowledge-Guided Script Generation Research
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

未来兼容链路预留为：

Final `MasterScript`
→ Script-to-Production Adapter
→ Model-Independent Production Package
→ Seedance / Other Video Model Adapter
→ Provider-Specific Generation Package

该链路当前只记录设计边界，不代表 Media Production 已启动，也不改变上文定义的 `Initial Generation Quality Improvement v1` 优先级。

在 Script Generation 质量稳定之前，不实现 Production Adapter、Seedance Prompt、生产 API、Creative Skill Registry 或完整 Knowledge Base。
