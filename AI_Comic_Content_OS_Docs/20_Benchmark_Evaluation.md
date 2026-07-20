# 20 Benchmark Evaluation

## 目标

当前阶段的目标不是继续扩展新系统骨架，而是验证当前 `Content Planning Engine` 是否真正具备稳定生成高质量剧本的能力。

## 当前目录

当前新增：

- `datasets/mock/`
- `datasets/benchmark/`
- `evaluation/`
- `tests/benchmark/`

## Dataset 规则

`datasets/mock/`

- 用于普通开发调试
- 可根据日常开发需要补充

`datasets/benchmark/`

- 用于固定能力验证
- 禁止随意修改
- 若确需调整，必须记录变更原因和预期影响

## Benchmark Ground Truth

每组 Benchmark 当前包含：

- 视频信息
- 评论
- Engagement
- Hashtag
- 发布时间
- 人工备注
- `Expected Analysis`

`Expected Analysis` 当前至少包括：

- Topics
- Genre Tags
- Emotion Tags
- Audience Signal
- Commercial Signal
- Preference Score Range
- Recommended Hook Type
- Recommended Cliffhanger Type

## Evaluation 组成

当前 `evaluation/` 已包含：

- `Analysis Evaluation`
- `ContentSpec Evaluation`
- `Prompt Evaluation`
- `Script Evaluation`
- `Story QC Evaluation`
- `Story Quality Rubric`
- `Benchmark Runner`

当前 Benchmark 产物除最终分数外，还会保留：

- `StoryQCReport`
- `RevisionPlan`
- `ScriptRevisionRun`
- `RevisedDraftMasterScript`
- `Re-QC Report`
- Draft / Final Script 对比结果

当前 `Prompt Evaluation` 第一版额外产物包括：

- `evaluation_case_id`
- `benchmark_dataset_id`
- `content_spec_id`
- Prompt IDs / Prompt Versions
- `generation_strategy_id` / `generation_strategy_version`
- `llm_provider` / `llm_model`
- 确定性检查结果
- `Story QC` 分数与状态
- 生成延迟
- Token Usage / Estimated Cost（如可获得）
- `draft_master_script_id`
- Markdown / JSON 报告路径（如启用报告落盘）

当前 `Prompt Evaluation Explainability Integration v1` 已补充：

- `variants[].story_qc_dimension_scores`
- `variants[].story_qc_dimension_summaries`
- `variants[].story_qc_evidence`
- `variants[].story_qc_revision_signals`
- `variants[].story_qc_scene_refs`
- `variants[].explainability.dimension_deltas`
- `variants[].explainability.improvements`
- `variants[].explainability.regressions`
- `variants[].explainability.unchanged_dimensions`
- `variants[].explainability.strongest_improvement`
- `variants[].explainability.largest_regression`
- `variants[].explainability.comparison_summary`
- `variants[].explainability.recommended_variant`
- `variants[].explainability.recommendation_reason`
- `variants[].explainability.confidence_note`

当前 `Prompt Evaluation` 解释性增强后，报告还应回答：

- 为什么某个 Variant 变好了
- 为什么某个 Variant 变差了
- 哪些指标真正提升
- 哪些指标发生退化
- 是否出现新的副作用
- 当前最值得保留的 Variant 是什么
- 下一步最值得优化什么

当前 v1 实现边界：

- 已开始消费 `StoryQCReport.dimension_evaluations`
- 已能比较相同 dimension 的 score delta
- 已能保留 scene refs、evidence 和 revision signals
- 已能兼容旧 `StoryQCReport`
- 仍然不是自动 Prompt 优化器
- 仍然不代表系统已经开始自主学习或自动更新 Prompt

当前推荐直接查看以下结构化摘要字段：

- `score_summary`
- `revision_summary`
- `highlights`

其中：

- `score_summary` 用于快速对比 Draft、Revised Draft、Final 的分数变化
- `revision_summary` 用于查看本次修订动作数量、目标类型与是否提升
- `highlights` 用于快速查看本次 Benchmark 最重要的结论与风险提示

当前固定 Benchmark 推荐执行链路：

`Raw Data`
→ `AnalysisResult`
→ `ContentSpec`
→ Draft `MasterScript`
→ `Story QC Report`
→ `RevisionPlan`
→ `Script Revision`
→ `Re-QC Report`
→ Final `MasterScript`

当前 `Prompt Evaluation` 最小闭环推荐执行链路：

同一 Benchmark Dataset
→ 一次 `ContentSpec`
→ 多组 Prompt / `GenerationStrategy` 变体
→ `generate-draft`
→ 确定性检查
→ Script Rubric
→ `Story QC`
→ 比较报告

## Prompt Evaluation 边界

当前 `Prompt Evaluation` 只属于评估层，不属于新的内容生产主链路。

当前明确边界：

- 可以复用现有 `Data Intelligence`
- 可以复用现有 `Prompt Library`
- 可以复用现有 `GenerationStrategy`
- 可以复用现有 `ScriptGenerationService`
- 可以复用现有 `Story QC`
- 不允许复制一套新的剧本生成逻辑
- 不允许让 `promptfoo` 接管 `ContentSpec`、Prompt Retrieval、Prompt Builder、`LLMAdapter`、`Story QC` 或 Final `MasterScript`

当前支持的比较方式至少包括：

- 同一个 `ContentSpec`，不同 Prompt 版本
- 同一个 Prompt，不同 `GenerationStrategy`
- 同一组合重复运行，观察输出稳定性

当前解释性输出至少包括：

- `metrics_summary`
- `variant.explainability`
- `run.decision_summary`

其中：

- `metrics_summary` 用于汇总单个 Variant 的平均脚本分、确定性通过率、延迟与成本信号
- `variant.explainability` 用于解释相对基线的提升、退化、副作用与保留建议
- `run.decision_summary` 用于给出当前最佳 Variant 与下一步优化目标

当前后续扩展建议还包括：

- `used_knowledge_ids`
- `used_knowledge_versions`
- `applied_structure_rules`
- `cultural_adaptation_notes`
- `observed_adaptation_differences`

其中：

- `used_knowledge_ids` 用于记录本次 Prompt / Strategy 实际调用了哪些行业知识资产
- `applied_structure_rules` 用于记录哪些结构规则真正进入了 Prompt Builder 结果
- `observed_adaptation_differences` 用于帮助判断不同文化适配策略是否带来了可验证差异

当前第一版确定性检查至少包括：

- `DraftMasterScript` schema 是否有效
- 必填字段是否完整
- `ContentSpec` 核心要求是否被执行
- Prompt 版本是否正确记录
- `GenerationStrategy` 版本是否正确记录
- Hook 是否存在并符合指定类型
- Cliffhanger 是否存在并符合指定类型
- 主角是否存在可见主动行为
- 场景数量是否符合请求
- 输出语言是否符合请求

当前限制说明：

- 当前 `Story QC` 仍然是 placeholder
- 因此 `Story QC` 分数与分类结果当前只能作为实验信号
- 不应将其直接视为最终剧本质量结论
- 当前如果使用 `MockLLMAdapter`，Hook / Cliffhanger / Agency 一类内容语义检查仍会展示，但默认作为观察信号而不是硬失败门槛
- 当前如果未来接入行业知识执行信号，也应先作为评估观察项，不应在知识体系仍不完整时过度宣称“专业质量已验证”

当前与 `Story QC` 知识体系的关系：

- `Prompt Evaluation` 当前不因本轮研究而改变执行逻辑
- 后续可以逐步增加：
  - 本次使用了哪些 `knowledge_id`
  - 哪些结构规则被执行
  - 哪些知识在当前平台 / 地区 / 类型下被认为适用
- 在 `Script Knowledge Framework` 尚未固化前，这些信息应先作为 explainability 信号，而不是新的强门槛

## Story QC Credibility Improvement v1 Validation

当前 `Story QC Credibility Improvement v1` 的验证目标不是证明“分数更高”，而是证明“报告更可信、更可用、更可解释”。

### Before / After 比较方式

当前推荐比较：

- Before：当前 placeholder `Story QC`
- After：`Story QC Explainability v1`

比较对象应尽量基于同一批固定 Benchmark 与同一批 Draft / Revised Draft 样本。

### v1 优先验证指标

第一轮优先回答以下问题：

- 是否能解释主要扣分原因
- 是否能定位到相关场景
- 是否能输出可执行 `Revision` 信号
- 是否能帮助 `Prompt Evaluation` 解释变好 / 变差原因
- 是否保持现有主链路与 Benchmark 稳定

当前建议至少记录以下验证项：

- `has_dimension_level_explanations`
- `has_deduction_reasons`
- `has_scene_references`
- `has_revision_signals`
- `has_knowledge_ref_placeholders`
- `supports_prompt_eval_analysis`

### v1 成功标准

`Story QC Credibility Improvement v1` 第一轮可视为有效，至少应满足：

- 5 个核心维度可以独立给出结构化判断
- 主要扣分项能说明原因
- 至少部分问题可定位到 scene level
- `RevisionPlan` 可从报告中提取更明确的修订方向
- `Prompt Evaluation` 可利用 `Story QC` 的维度判断增强 explainability

当前实现状态：

- `StoryQCReport` 已支持 5 个维度级 `dimension_evaluations`
- 已支持 `scene_refs`、`evidence`、`revision_signals`
- 已支持 `report_version`、`explainability_status`
- 已支持 `knowledge_refs` 兼容占位字段
- Benchmark 当前可直接消费增强后的 `StoryQCReport`，无需改写主链路

### 当前 5 个核心维度

第一轮仅建议围绕：

- `Hook Quality`
- `Character Agency`
- `Conflict Escalation`
- `Emotional Payoff`
- `Cliffhanger Strength`

说明：

- 这 5 个维度当前优先服务短剧留存、追更和剧本打磨
- 这不意味着其余 rubric 维度失效
- 其余维度当前仍保留在现有 rubric 中，后续再逐步提升可信度

### 当前限制说明

即使进入 v1，以下边界仍应明确：

- 当前 `Story QC` 仍不应被宣称为完整专业 Script Expert
- `knowledge_refs` 初期只能作为兼容字段或占位字段
- 若没有更强知识引用和证据抽取能力，分数仍主要属于规则信号
- Benchmark 第一轮重点验证“解释能力提升”，而不是宣称剧本质量结论已经专业化

## Revision Quality Improvement v1 Evaluation

`Revision Quality Improvement v1` 的验证目标，是证明修订能够针对已识别问题产生受控改善，同时避免损害原本表现良好的内容。

当前 Benchmark 已能验证 Story QC explainability、Prompt variant comparison 和现有 Draft / Revised Draft 的基础分数变化。运行时 `RevisionAcceptanceEvaluator v1` 已能对单次受控修订计算 Revision effectiveness 指标，但这些指标尚未进入 Benchmark runner 的跨样本汇总或正式报告模型。

后续校准不应为迎合当前结果修改固定 Benchmark 数据集或 Ground Truth。验证应使用同一份 Draft、同一份 `StoryQCReport` 和相同 Revision Policy，对比人工预期与 shadow Acceptance 结果。

Revision 成功不能只依据 `overall_score` 上升。当前单次 runtime Acceptance 已记录：

- `targeted_dimension_improvement`
- `regression_count`
- `protected_dimension_stability`
- `scene_alignment_rate`
- `revision_effectiveness`

### 指标定义

`targeted_dimension_improvement`

- 衡量本轮选中维度在 Re-QC 后的分数变化
- 应分别保留各目标维度 delta，不只保存平均值
- 如果目标维度没有改善，不能仅凭 overall score 上升判定修订成功

`regression_count`

- 统计超过 `RevisionPolicy.regression_limit` 的非目标维度数量
- 新增明显退化应进入失败原因或 Acceptance 风险说明
- 单一目标维度提升不能抵消多个关键维度回退

`protected_dimension_stability`

- 衡量 `RevisionDecision.protected_dimensions` 在修订前后的稳定程度
- 受保护维度超出允许回退范围时，shadow `AcceptanceDecision.accepted` 应为 false

`scene_alignment_rate`

- 衡量实际修改场景与 `RevisionStrategy.scene_refs` / `RevisionPlan` 目标场景的一致程度
- 用于发现修改范围泄漏和无关场景被改写
- v1 可以先基于场景引用和变更记录计算，不要求语义级 diff 系统

`revision_effectiveness`

- 用于汇总目标维度改善、回退控制、保护维度稳定和场景对齐情况
- v1 当前公式为：`60% target improvement + 20% scene alignment + 20% regression safety`
- 目标维度改善当前按五分制归一化：`(after - before) / 5`
- 计算方式由 `decision_version` 与 `policy_version` 追踪，保持透明且可复现
- 不应成为替代明细指标的单一黑盒分数

### Acceptance 验证原则

当前 shadow evaluator 按以下顺序判断：

1. revision round 是否超过 `max_revision_rounds`
2. Decision 是否要求修订、是否执行了动作、Strategy 是否存在
3. 原始 QC 和 Re-QC 是否具备足够的维度 explainability
4. 目标维度是否达到 `minimum_improvement_threshold`
5. 回退数量和幅度是否处于 `regression_limit` / tolerance 内
6. 受保护维度是否保持稳定
7. 修改场景是否与 Strategy 范围对齐
8. `revision_effectiveness` 是否达到 `acceptance_threshold`

`max_revision_rounds = 1` 是当前 shadow policy 默认值。这里的 `acceptance_threshold` 当前表示最低 revision effectiveness，不是剧本专业质量认证。Benchmark 应验证单轮修订是否产生稳定、可解释的净收益；在该证据成立前，不扩展到多轮循环或 Finalization enforcement。

### Before / After 验证输出

未来评估报告应至少保留：

- 原始 Draft 与 Revised Draft artifact IDs
- 原始 QC 与 Re-QC report versions
- selected / deferred / protected dimensions
- 每个目标维度的 before、after 和 delta
- 新增 regressions 及其 scene refs / evidence
- 实际修改场景与计划场景的对齐结果
- Acceptance Decision 及 stop reason
- Revision Policy 版本和实际阈值

当前实现状态：

- `RevisionDecision` 与 `RevisionStrategy` 数据模型及 Planner 生成逻辑已完成
- `RevisionPolicy` 与 `AcceptanceDecision` 数据模型已完成
- `RevisionExecutor`、scene scope、protected dimension 检查与 execution trace 已完成
- `targeted_dimension_improvement`、`regression_count`、`protected_dimension_stability`、`scene_alignment_rate`、`revision_effectiveness` 已在单次 runtime Acceptance 中实现
- `AcceptanceDecision` 已保存到 `ScriptRevisionRun` runtime lineage，且只以 shadow mode 运行
- 跨 Benchmark 的 effectiveness 汇总、人工 Ground Truth 校准和阈值校准尚未实现
- 数据库级 Revision lineage 持久化尚未实现
- 现有 Benchmark、Prompt Evaluation 和 Finalization 行为保持不变

当前临时保留两个不等价信号：

- `ScriptRevisionRun.improved`：Re-QC overall score 非下降
- `ScriptRevisionRun.acceptance_decision`：目标维度改善、回退安全和场景对齐的 shadow 判断

Benchmark 校准应评估二者分歧；在证据形成前，不自动弃用任何一个兼容字段。

### Fixed Revision Acceptance Calibration v1

当前已增加一轮有边界的离线 Acceptance 校准。该校准与内容生成 Benchmark 分离，避免把人工修订判断强行塞入现有生成评估抽象。

固定校准集位于：

- `tests/fixtures/revision_acceptance_calibration/`

数据边界：

- 恰好 12 个原创合成样本
- 3 个 clear accepted、5 个 clear rejected、4 个 ambiguous / conflict
- 覆盖 `hook_quality`、`character_agency`、`conflict_escalation`、`emotional_payoff`、`cliffhanger_strength`
- 每个样本冻结原始/Re-QC 分数、Decision、Strategy、Execution Trace、Policy、文本证据和人工判断
- 不调用 LLM，不重新生成内容，不修改既有 Benchmark Dataset 或 Ground Truth

`RevisionAcceptanceCalibrationEvaluator` 直接复用运行时 `RevisionAcceptanceEvaluator`，并输出：

- agreement、false acceptance、false rejection
- human-ground-truth successful revision rate
- average targeted improvement
- regression rate 与 protected-dimension stability rate
- average scene alignment 与 revision effectiveness
- `legacy_improved` / shadow Acceptance / human judgment 冲突
- 每个样本的 stop reason、conflict type 和人工理由

首轮固定结果：

- `total_samples = 12`
- `agreement_rate = 0.667`
- `false_acceptance_rate = 0.286`，分母为人工拒绝样本
- `false_rejection_rate = 0.400`，分母为人工接受样本
- `successful_revision_rate = 0.417`，表示人工接受样本占比，不是机器通过率
- `average_targeted_improvement = 0.120`
- `regression_rate = 0.083`
- `protected_dimension_stability_rate = 0.917`
- `average_scene_alignment_rate = 0.833`
- `average_revision_effectiveness = 0.770`

Go/no-go 结果为 `review_required`：

- reproducibility：通过
- clear-negative safety：通过，5 个清晰负例均未被误接受
- agreement target：未通过，`0.667 < 0.80`
- disagreement explainability：通过

当前四个分歧揭示的盲点为：

- Character Agency 数值提升不能识别对白自然度和角色声音退化
- 容差内的 Hook 小幅回退可能仍足以改变人工选择
- 细腻但明确的 Conflict 改善可能低于 `minimum_improvement_threshold`
- 有用的 Cliffhanger 改善可能在 effectiveness 较高时仍被 minimum threshold 提前拒绝

#### One-Time False-Acceptance Safety Correction

在不改变 12 个样本、人工标签、60/20/20 公式或 Policy 阈值的前提下，系统完成了一次有边界的 false-acceptance 安全修正：

- 普通非目标维度继续使用 `dimension_regression_tolerance`
- `RevisionDecision.protected_dimensions` 不再共享普通噪声 tolerance
- 受保护维度只要出现负向分数移动，即标记 `protected_dimension_stability = false`
- 规则适用于任意 protected dimension，不硬编码 Hook

一次性复校准结果：

- `agreement_rate = 0.750`，9/12
- `false_acceptance_count = 1`
- `false_acceptance_rate = 0.143`
- `false_rejection_count = 2`
- `false_rejection_rate = 0.400`
- `regression_rate = 0.167`
- `protected_dimension_stability_rate = 0.833`
- `average_revision_effectiveness = 0.753`

原 Hook false acceptance 已解决，stop reason 为 `protected_dimension_regression`。对白自然度与角色声音 false acceptance 未解决，因为当前 runtime `StoryQCReport` 和 `RevisionExecutionTrace` 没有可靠的结构化退化证据；校准报告将其显式标记为：

- `dialogue_naturalness_not_available_in_runtime_qc`
- `character_voice_consistency_not_available_in_runtime_qc`

两个 false rejection 保持不变，本轮不降低 `minimum_improvement_threshold`。Go/no-go 状态仍为 `review_required`，不会自动触发后续调参或 enforcement。

该结果只供人工评审。当前不自动修改 60/20/20 公式、`RevisionPolicy` 或阈值；校准失败不会改变 shadow runtime，也不会阻断 Finalization。

运行方式：

```bash
PYTHONPATH=backend python -m app.modules.script_engine.revision_acceptance_calibration
```

### 与 Prompt Evaluation 的边界

- Revision Evaluation 衡量一次受控修订是否有效
- Prompt Evaluation 比较 Prompt / Generation Strategy 对生成结果的影响
- Prompt Evaluation 可以读取 Revision effectiveness 信号，但不负责制定或执行修订策略
- Revision 的局部改善不能自动证明某个 Prompt Variant 整体更优

## Story Quality Rubric

当前 Rubric 至少覆盖：

- Hook
- Narrative Logic
- Character Consistency
- Character Agency
- Emotional Progression
- Conflict Escalation
- Dialogue Quality
- TikTok Platform Fit
- Cultural Fit
- Commercial Potential
- Cliffhanger Strength

每项 Rubric 当前包含：

- 分数范围
- 判断标准
- 扣分原因
- 修改建议

## 当前 Benchmark API

当前已提供：

- `POST /benchmarks/run`
- `GET /benchmarks`
- `GET /benchmarks/results/{result_id}`
- `POST /benchmarks/prompt-evaluations/run`
- `GET /benchmarks/prompt-evaluations`
- `GET /benchmarks/prompt-evaluations/results/{result_id}`

## 当前成功标准

当前阶段的成功标准是：

- 固定 Benchmark 能稳定跑通
- 每一步都有结构化评估结果
- `RevisionPlan` 能针对 Rubric 扣分项输出可执行修订动作
- `Re-QC` 分数相对原始 Draft QC 不下降
- `RevisedDraftMasterScript` 的脚本评分相对原始 Draft 不下降
- Final `MasterScript` 的脚本评分高于 Draft

## 当前联调验证

除固定 Benchmark 外，当前还保留一个完整端到端 smoke test：

- `tests/test_e2e_content_planning_pipeline.py`

它用于验证以下链路可以在同一次测试中跑通：

`Raw Data`
→ `AnalysisResult`
→ `ContentSpec`
→ Draft `MasterScript`
→ `RevisionPlan`
→ `Script Revision`
→ `Re-QC`
→ Final `MasterScript`
