# 17 MVP Roadmap

## Purpose

本文件只维护开发阶段、当前优先级和 Backlog。已经实现的详细字段、API 和内部行为分别以 `02_Data_Model.md`、`05_API_Design.md`、`14_Script_Engine.md` 和 `21_Current_Status_Checklist.md` 为准。

## Current Phase

当前阶段：`Capability Optimization / System Validation`

当前唯一产品目标：面向中国大陆漫剧市场，稳定生成优质、可控、可追踪的中文长剧本母本，目标支持约 60 万字正文规模，并为后续漫剧改编保留结构化基础。60 万字必须由递归规划和可恢复有界批次累计完成，不是单次模型输出。

当前状态：市场默认配置已切换为 `cn_mainland`；红果仅作参考，`overseas_tiktok` 保留但关闭。产品已取消“逐集/全部生成”的入口选择，统一采用 Story Bible → 可变深度递归剧情树 → Episode Plan → 有界基础剧本批次；当前继续补齐全量续跑、连续性和可恢复执行，不扩展视频生产，Creative Deepening 前后端默认关闭。

本轮规划修复：新递归拆分请求不再固定四个子节点，模型按每个父节点自身的叙事复杂度选择 2–12 个不同部分；不同分支允许不同宽度和深度。服务端新增父子/兄弟内容差异校验，叶节点严格执行 8–12 集范围。Episode Plan 仍是正文前的分集施工单，最终质量与目标量级完成度必须由具体集的动作、对白和连续性验收证明。

验收口径：旧固定 334 集串行脚本只用于单集正文容量校准，不代表当前递归长篇架构。当前端到端验收必须从总纲开始，经过经人工确认的非平衡递归规划树与 Episode Plan，再累计基础剧本正文。

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
- Frontend MVP 的本地项目、递归规划、分集基础剧本、候选版本、导出与历史中英文审阅兼容
- Story Bible、Story Plan Node 与 Episode Plan 的草稿编辑、版本化保存和人工批准
- 有界基础剧本批次与 batch lineage（前端编排；非后端 Job）
- 正文编号 Key Pool：规划继续使用主 Key，已批准 Episode Plan 叶子的有界批次可并行

“已建立”不等于“专业化或生产校准完成”。Story QC、规则 Revision、Acceptance 阈值、跨供应商真实模型稳定性仍有明确限制。

## Validated Capability Evidence

- Scene Causality v1：三样本真实模型 A/B 中 2/3 更优，无重大结构回退；存在 token 增长与表达机械化风险。
- Structured Creative Control：Creative Intent + Character Context 的固定实验获得正向结果。
- 旧 Serialized Story Planning v1.1 四集实验：长程因果和 Setup/Payoff 有改善，但 Hook / Cliffhanger 未通过其 runtime gate，保持历史 Research；当前人工受控的 Story Bible → 可变深度 StoryPlanNode → EpisodePlan 是后续独立产品决策，不把旧实验误写为已直接上线。
- Creative Knowledge / Deepening：已有有界正向证据，当前仅进入静态 bundle 与 shadow candidate，不扩展为动态 Retrieval 或自动 apply。
- Acceptance Calibration：保留 `review_required` shadow 结论，不启用 enforcement。

实验细节只在 `20_Benchmark_Evaluation.md` 和对应 `Research/` 记录，不在 Roadmap 重复维护分数表。

## Current Priority

当前默认顺序：

1. 先完成长篇规划质量与容量验证：区分产品目标与内容实际容量，验证 Story Engine、宏观叙事运动、反派策略、悬疑信息控制、支线贡献和 Setup / Payoff 可追踪性；不得把合法 Schema、目标集数或模型自评当作可持续性证明。
2. 在通过规划门槛的固定样本上完成一部约 60 万字基础长剧本的端到端真实验收：从已批准 Story Bible 和非平衡递归规划树开始，逐叶生成 Episode Plan 与正文批次，累计有效正文并形成完整作品。
3. 补齐长任务可靠性：后台可恢复 Job、失败重试、跨批次自动续跑、暂停/恢复、幂等写入和成本/耗时记录。
4. 补齐长程质量控制：Continuity Ledger 自动更新、人物/关系/故事线 bounded context、伏笔回收检查、跨批次漂移和重复检测。
5. 保持 Creative Deepening、海外 TikTok 默认适配、视频生产、Agent runtime 和大型架构重构关闭，除非它们明确阻碍上述长篇目标。

当前压力样本已证明 Story Bible 与根节点可以生成、保存、批准，但也暴露出“摘要合法不等于内容足以支撑数百集”。流程优化设计与进入 runtime 前的验证门槛见 `Research/15_Longform_Script_Planning_Process_Optimization_v1.md`。

已完成的 Contract、PostgreSQL persistence、版本化资源 API、规划编辑/批准 UI、首条根到分集 runtime 和不可变 Episode Artifact 以 `21_Current_Status_Checklist.md` 为准，不再作为待办重复维护。

既有 `ContentSpec`、标签与角色输入、Knowledge Bundle、Prompt Library / Builder、`LLMAdapter`、单集 Draft 原子能力、Story QC、Revision、Acceptance Shadow、Prompt Evaluation、Benchmark、版本化 Artifact 和导出能力继续保留。它们应作为长篇主链路内部能力复用和逐步适配，不因产品核心调整而删除；只有与当前入口冲突的旧“逐集/全部生成”模式、海外默认配置和 Creative Deepening 入口保持关闭。

## Near-Term Candidates

以下事项只有在新要求确认后才排序：

- Creator Agent / Copilot 的受控 Tool 与 Application Use Case 边界
- Frontend 项目与版本工作流收口
- Story QC 专业可信度提升
- Revision 创意执行质量提升
- 真实模型失败率、成本和跨供应商稳定性校准
- 后台可恢复 Generation Job 与跨批次续跑
- Script Generation Box 正式 Request / Result 与统一 Facade

Agent 是合作方需求，但不预设为多 Agent。默认候选是单一 Creator Copilot，通过受控用例调用现有生成能力，并保留用户确认、停止条件和 lineage。

## Research Only

以下已有研究尚未获得 runtime 批准：

- Character Decision Logic runtime
- 动态 Creative Knowledge Retrieval / RAG
- Creative Skill Registry
- 自动 Prompt 学习或自动知识更新
- Acceptance enforcement 与多轮 Revision loop

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
