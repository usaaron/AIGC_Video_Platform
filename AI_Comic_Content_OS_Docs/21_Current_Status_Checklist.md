# 21 Current Status

## Purpose

本文件是“当前已经实现什么、哪些仍是实验性、哪些尚未实现”的唯一状态来源。它不维护路线图、运行教程或详细 API 字段。

状态更新时间：2026-08-01。

## Active Market And Capability Flags

- `SCRIPT_MARKET_PROFILE=cn_mainland`：当前默认
- `overseas_tiktok`：实现与资产保留，默认关闭，可显式切换
- 红果：reference only，不是硬绑定平台
- Creative Deepening：实现保留，前端和后端 runtime feature flag 默认关闭
- 长篇故事母本：当前目标；Story Bible、故事阶段规划、Continuity Ledger 与 60 万字完整 runtime 尚未实现

## Current Runtime Flow

```text
Raw Data
→ AnalysisResult
→ ContentSpecDraft
→ ContentSpec
→ optional ResolvedCreativeContext
→ Orchestrator / Retrieval
→ Prompt Retrieval
→ optional Static Knowledge Bundle
→ Prompt Builder
→ LLMAdapter
→ DraftMasterScript with Scene Causality
→ optional Creative Deepening Shadow（当前默认关闭）
→ StoryQCReport
→ RevisionDecision / RevisionStrategy / RevisionPlan
→ RevisionExecutor
→ Re-QC
→ AcceptanceDecision (shadow)
→ ScriptRevisionRun
→ Finalization Gate
→ Final MasterScript
```

Frontend 在此单集 Draft API 之上提供逐集和分阶段全部生成，并通过 optional episode context 传递上一集、项目连续性和 `GenerationBatchContext`。阶段间可更新后续创作信号。它不是 Story Blueprint / Episode Planning runtime，也不是后端统一多集事务。

## Implemented

### Content And Data Foundation

- Manual JSON / CSV Data Intelligence pipeline
- `RawContentRecord → AnalysisResult → ContentSpecDraft → ContentSpec`
- 关键词证据、标签映射原因和分数拆解
- `PlatformProfile` 注入；当前 active 为中国大陆参考 Profile，TikTok Profile 保留但关闭
- `OntologyNode` / `TagRef` 受控标签
- 统一 `Asset`、规则 Retrieval 与 `OrchestrationPlan`
- Prompt Library、Prompt Retrieval 与 Generation Strategy

### Generation

- `MockLLMAdapter`
- OpenAI-compatible `RealLLMAdapter`
- 结构化输出、重试和 Schema 校验
- `CreativeIntentInput → ContentSpec + ResolvedCreativeContext`
- Character Context provenance 与 locked fields
- 策略声明的静态 Knowledge Bundle
- Scene Goal / Conflict / Outcome 与跨场 causal link
- 结构化 `DraftMasterScript`
- optional episode context，包括上一集状态、本集指令和项目连续性摘要

### Quality Loop

- Story QC Explainability v1：五个维度、证据、场景引用和 revision signals
- Revision Decision / Strategy / Plan
- Rule-based Revision Executor、场景范围和保护维度检查
- Revision Execution Trace
- Re-QC
- deterministic Acceptance evaluation 与 `ScriptRevisionRun` shadow lineage
- Finalization Gate 和 Final `MasterScript` lineage
- Creative Deepening Shadow candidate、preservation trace 与 QC comparison（能力保留，当前默认关闭）

### Evaluation

- 固定 Benchmark datasets 与 runner
- Prompt Evaluation Explainability
- Revision Acceptance calibration fixtures
- Scene Causality、Creative Control、Serialized Planning 与 Knowledge / Deepening 离线实验资产
- 单元、API、Benchmark 与 E2E smoke tests

### Frontend MVP

- Next.js 中英文创作界面
- IndexedDB 本地项目、角色、分集和版本快照
- Creative Input、系统标签、“我的标签”和 Character Builder
- 逐集生成与有界阶段生成，包含本地批次 lineage 和 optional 阶段指令
- 分集切换、结构化编辑、保存、确认和 AI 修改；Deepening 入口当前隐藏
- Framework / Modification / Revised / Final 版本视图；历史 Deepening 数据仍可兼容读取
- 单集与整部 Markdown / JSON 导出
- 已有分集覆盖保护和复制新生成版本
- 英文稿的 presentation-only 中文对照视图；英文源稿不被覆盖
- 可编辑故事线、角色成长线和人物关系状态
- 后续分集消费 bounded 连续性摘要，不自动改写历史集

## Experimental Or Partially Calibrated

### Story QC

- 当前是轻量规则和 Rubric Explainability，不是专业 Script Expert。
- `overall_score` 和维度分数只能作为实验信号，不能作为最终剧本质量结论。

### Revision And Acceptance

- Revision 执行仍以规则式修改为主，创意质量有限。
- Acceptance 当前只观察目标维度改善、回退和场景对齐，不阻断 Finalization。
- Acceptance calibration 仍为 `review_required`，未达到 enforcement 标准。

### Creative Deepening

- 可以生成受保护候选并比较 QC。
- 候选必须由用户明确采用；当前没有自动 apply 或自动最优选择。

### Real LLM

- 已验证一个 OpenAI-compatible 接入。
- 跨 provider 稳定性、成本、延迟、429 / 5xx 和 Schema 失败率尚未完成生产校准。

### Knowledge

- 已实现 bounded static bundle 和 source lineage。
- 只有有限 genre / stage coverage，不是完整 Knowledge Base runtime。

## Not Implemented

- 后端持久化的 Script Project / Episode / Version 聚合
- Authentication、权限、协作和云同步
- Story Blueprint / Episode Plan runtime
- Character Decision Logic runtime
- 动态 Knowledge Retrieval、RAG、向量库和 Skill Registry
- 自动 Prompt 优化或自主学习
- Acceptance enforcement、多轮 Revision 和无限质量循环
- Script Generation 正式统一 Facade
- Storyboard、Voice、Animation、Video、Seedance 和发布系统

## Important Boundaries

- Frontend 项目数据当前保存在浏览器 IndexedDB；后端重启不会恢复内存 Repository 数据。
- “全部生成”是前端按有界批次逐集调用，不等同于一次生成完整系列规划；批次尚不具备后端持久化或断点任务恢复。
- 故事线和人物关系是本地 authoring / continuity artifact，不是 Final `MasterScript` 字段。
- Bilingual View 是开发者 / 中文用户审阅工件，不进入目标语言正式剧本。
- Static Knowledge 只在 Strategy 明确声明并通过适用性校验时注入。
- Deepening 和 Acceptance 都不得绕过 Finalization Gate。
- Agent 尚未实现；合作方需求待确认。未来 Agent 应调用受控 Application Use Cases，而不是直接自由操作领域数据。

## Last Recorded Validation

最近一次代码变更后的记录：

- 后端全量测试：`225 passed, 1 skipped`
- 前端 TypeScript：通过
- 前端 production build：通过
- `git diff --check`：通过
- 本地前后端 HTTP smoke：通过

该记录是历史验证快照，不代表后续未提交改动自动通过。合作方新要求完成后需要重新建立完整验收结果。

## Current Hold

- 暂停旧手工测试清单；旧清单已从当前文档集移除。
- 暂停新增大型能力和架构重构。
- 等待合作方新要求，再更新 Roadmap、契约和验收方案。
