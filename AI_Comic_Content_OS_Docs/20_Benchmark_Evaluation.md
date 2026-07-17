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

当前 `Prompt Evaluation` 解释性增强后，报告还应回答：

- 为什么某个 Variant 变好了
- 为什么某个 Variant 变差了
- 哪些指标真正提升
- 哪些指标发生退化
- 是否出现新的副作用
- 当前最值得保留的 Variant 是什么
- 下一步最值得优化什么

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
