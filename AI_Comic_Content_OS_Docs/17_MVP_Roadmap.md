# 17 MVP Roadmap

## Purpose

本文件只维护开发阶段、当前优先级和 Backlog。已经实现的详细字段、API 和内部行为分别以 `02_Data_Model.md`、`05_API_Design.md`、`14_Script_Engine.md` 和 `21_Current_Status_Checklist.md` 为准。

## Current Phase

当前阶段：`Capability Optimization / System Validation`

当前产品目标：面向中国大陆漫剧市场，稳定生成高质量、可控、可追踪的中文长篇故事母本，并为后续分集漫剧改编保留结构化基础。

当前状态：市场默认配置已切换为 `cn_mainland`；红果仅作参考，`overseas_tiktok` 保留但关闭。基础阶段生成已进入 runtime，允许按批次生成并在批次间更新创作输入；当前继续补齐长篇规划、后端持久化和可恢复执行，不扩展视频生产，Creative Deepening 前后端默认关闭。

## Completed Foundations

以下基础能力已经建立，成熟度边界见 Current Status：

- Data Intelligence 手工导入与可解释分析链路
- `ContentSpec`、Ontology、Tag、Platform Profile
- 中国大陆创作标签目录、旧前端标签 ID 兼容迁移和有界“灵感推荐”（非实时趋势）
- Asset、规则 Retrieval、Orchestrator
- Prompt Library、Prompt Retrieval、Prompt Builder、Generation Strategy
- Mock / OpenAI-compatible `LLMAdapter`
- 结构化 Draft 与 Scene Causality
- Story QC Explainability
- Revision Decision / Strategy / Planner / Executor / Re-QC
- Acceptance shadow evaluation 与受控 Finalization
- Benchmark、Prompt Evaluation 与固定能力样本
- Creative Intent、Character Context 与静态 Knowledge Bundle
- Creative Deepening Shadow（实现保留，当前默认关闭）
- Frontend MVP 的本地项目、分集创作、候选版本、导出与中英文审阅
- 有界阶段生成与批次 lineage（前端编排；非后端 Job）

“已建立”不等于“专业化或生产校准完成”。Story QC、规则 Revision、Acceptance 阈值、跨供应商真实模型稳定性仍有明确限制。

## Validated Capability Evidence

- Scene Causality v1：三样本真实模型 A/B 中 2/3 更优，无重大结构回退；存在 token 增长与表达机械化风险。
- Structured Creative Control：Creative Intent + Character Context 的固定实验获得正向结果。
- Serialized Story Planning v1.1：长程因果和 Setup/Payoff 有改善，但 Hook / Cliffhanger 未通过 runtime gate，保持 Research。
- Creative Knowledge / Deepening：已有有界正向证据，当前仅进入静态 bundle 与 shadow candidate，不扩展为动态 Retrieval 或自动 apply。
- Acceptance Calibration：保留 `review_required` shadow 结论，不启用 enforcement。

实验细节只在 `20_Benchmark_Evaluation.md` 和对应 `Research/` 记录，不在 Roadmap 重复维护分数表。

## Current Priority

当前默认顺序：

1. 已完成第一轮长篇 contract foundation：`StoryProject`、`StoryBible`、level-free recursive `StoryPlanNode`、兼容 `StoryStagePlan`、`EpisodePlan`、`ContinuityLedger`、bounded batch / checkpoint models。
2. 已完成 PostgreSQL / JSONB schema、Alembic migration、事务型 Repository、immutable version 与 optimistic revision foundation。
3. 已完成 Project / Story Bible / Stage / Episode Plan 的 Application Service 与版本化资源 API。
4. 已完成 Frontend Project + Workspace Snapshot 的 IndexedDB 本地优先同步、服务端恢复、冲突报告和版本保护软删除。
5. 已完成确认 Draft / Revised / Final Episode Artifact 的不可变版本持久化和前端里程碑写入。
6. 当前下一步是递归规划 runtime 最小切片：生成并人工确认 Story Bible 根方向，按每个 Story Plan Node 自身复杂度展开当前分支，并在各自达到 `episode_ready` 后映射到 Episode Plan；不固定全局拆分层级，不要求各分支等深，也不一次展开全部集数。
7. 60 万字真实生成验收在递归规划进入 runtime 前暂停继续烧取单集；已有单集正文预算和动态集数校准证据保留，后续从通过审核的叶子 Episode Plan 恢复有界生成，并验证连续性、热点增量、持久化恢复和失败续跑。
8. 扩充并治理中国大陆长篇创作与漫剧改编知识资产。
9. 在长篇结构稳定后，再决定 Creative Deepening、Agent 和 DDD-lite 的进入时点。

## Near-Term Candidates

以下事项只有在新要求确认后才排序：

- Creator Agent / Copilot 的受控 Tool 与 Application Use Case 边界
- Frontend 项目与版本工作流收口
- Story QC 专业可信度提升
- Revision 创意执行质量提升
- 真实模型失败率、成本和跨供应商稳定性校准
- 后端 durable project persistence
- Script Generation Box 正式 Request / Result 与统一 Facade

Agent 是合作方需求，但不预设为多 Agent。默认候选是单一 Creator Copilot，通过受控用例调用现有生成能力，并保留用户确认、停止条件和 lineage。

## Research Only

以下已有研究尚未获得 runtime 批准：

- Serialized Story Planning runtime（递归节点契约、持久化与 API 已实现；自动拆分、审核 UI 和生成上下文接入待实现）
- Character Decision Logic runtime
- 动态 Creative Knowledge Retrieval / RAG
- Creative Skill Registry
- 自动 Prompt 学习或自动知识更新
- Acceptance enforcement 与多轮 Revision loop
- 60 万字故事母本完整 runtime、自动故事阶段规划与 Continuity Ledger 更新

Research 结论不得直接写入 Prompt、Schema 或业务规则。

## Backlog

- `ScriptGenerationRequest` / `ScriptGenerationResult` 正式化
- `ScriptGenerationRequestMapper`
- `ScriptGenerationWorkflowService` / Facade / `generate_script()`
- Ontology alias 与 unresolved tag 人工确认
- Creative Intent 输入兼容后续：Prompt-only、受控 Tag-only 和 Character optional 已完成；补齐 confirmed CustomTagContext-only
- 10-20 个高使用大陆标签的 source-grounded Tag Knowledge Profile pilot
- Project-scoped `CustomTagContext` 语义确认与 lineage；不自动提升为公共标签
- Data Intelligence `TrendSnapshot` 到实时热门标签推荐的版本化接入
- Tag Context 到可审阅 Story Synopsis / Story Direction，再到 Story Bible 根方向的映射与验证
- Relationship / Story Line authoring 的正式后端契约、渐进式 fact delta、确认流程与 future effective point
- Story Map 交互：人物节点详情、关系边详情、关系/支线交叉跳转和本次生成 continuity slice 预览
- Bounded Continuity Context Mapper：按规划节点和分集选择相关人物、关系、活跃支线、近期变化与 Setup / Payoff
- 编辑过程的细粒度历史、Artifact 审计 UI 与批量恢复（确认 Draft / Revised / Final Artifact 已完成）
- Knowledge-aware QC / Revision / Evaluation
- Feedback Learning Expansion
- Cost / Quality Optimization

## Media Production Phase

以下能力不属于当前剧本 MVP：

- Storyboard
- Character / Scene / Voice production assets
- Animation / Video pipeline
- Seedance 或其他视频模型集成
- Subtitle、Composition、Publish system

未来仍通过稳定 Final `MasterScript` 和 Handoff Adapter 接入，不反向污染当前剧本契约。

## Entry Gate

任何 Roadmap 项进入实现前必须满足：

- 有明确用户或能力问题；
- 现有模块无法以小改动解决，或已确认需要结构收口；
- 成功指标和回归边界明确；
- 测试 / Benchmark 方案已定义；
- 不与当前合作方要求冲突。
