# 21 Current Status

## Purpose

本文件是“当前已经实现什么、哪些仍是实验性、哪些尚未实现”的唯一状态来源。它不维护路线图、运行教程或详细 API 字段。

状态更新时间：2026-08-01。

## Branch Registry

本节是当前活跃 Git 分支职责的权威登记。具体提交历史与远程同步状态仍以 `git log`、`git branch -vv` 和 GitHub 为准。

### `main`

- 职责：保存进入中国大陆长篇方向前的稳定 Script Generation 研究与能力基线。
- 当前稳定研究基线：`5b760e5`，tag 为 `script-generation-research-checkpoint-v1.1.0`。
- 主要内容：Generation Pipeline v1、Scene Causality、Story QC Explainability、Prompt Evaluation Explainability、受控 Revision / Re-QC / Acceptance Shadow、Creative Intent / Knowledge / Story Planning 等研究与验证资产。
- 不包含：`feature/cn-mainland-staged-generation` 中新增的中国大陆默认市场切换、长篇分阶段生成 UI 与 batch context、Deepening 默认关闭收口。
- 当前状态：本地稳定研究基线；尚未把当前功能分支合并回 `main`。
- 同步提示：当前本地 `main` 相对本地记录的 `origin/main` 领先 6 个提交；这只是仓库同步状态，不代表这些提交已进入远程稳定主线。

### `feature/cn-mainland-staged-generation`

- 职责：承载中国大陆漫剧市场切换与长篇分阶段生成的最小兼容实现。
- 基于：本地 `main` 的 `script-generation-research-checkpoint-v1.1.0` 基线。
- 已推送持久化基线：`0f6b2ec`，commit 为 `feat: add PostgreSQL long story persistence foundation`；长篇契约基线为 `e5fdf81`。
- 主要内容：默认 `cn_mainland` market profile、保留但关闭 `overseas_tiktok`、红果 reference-only 定位、逐集与有界阶段生成、批次 lineage、后续阶段可选新元素指令、长篇参数估算、Creative Deepening 前后端默认关闭。
- 当前增量：长篇 Contract Foundation、PostgreSQL/JSONB schema、Alembic migration、事务型 Repository、原子 optimistic revision，以及 Project / Story Bible / Stage / Episode Plan 资源 API；尚未接入 Frontend 和生成 runtime。
- 明确边界：仍通过现有单集 Draft API 编排；规划资源 API 不等同于自动 Story Blueprint / Episode Planning，也不等同于后台长任务或完整 60 万字自动生成 runtime。
- 验证状态：当前增量后端全量 `257 passed, 1 skipped`，长篇模型 / Repository / migration / Planning API 定向 `28 passed`，前端 typecheck/build 通过。
- 远程状态：已推送并跟踪 `origin/feature/cn-mainland-staged-generation`。
- 合并状态：尚未合并到 `main`；应在合作方需求确认和新版手工验收完成后再决定是否合并并建立新版本 tag。

新增分支时必须追加登记；分支合并或关闭后保留简短历史状态，避免后续开发者误判能力所在分支。

## Active Market And Capability Flags

- `SCRIPT_MARKET_PROFILE=cn_mainland`：当前默认
- `overseas_tiktok`：实现与资产保留，默认关闭，可显式切换
- 红果：reference only，不是硬绑定平台
- Creative Deepening：实现保留，前端和后端 runtime feature flag 默认关闭
- 长篇故事母本：当前目标；Story Bible、故事阶段、Episode Plan、Continuity Ledger 与 batch checkpoint 契约已实现，前四类规划资源具备后端持久化 API；自动规划与生成 runtime 尚未接入

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
- 长篇 Contract Foundation：`StoryProject`、`StoryBible`、人物弧/关系/故事线、`StoryStagePlan`、`EpisodePlan`、`ContinuityLedger`、`GenerationBatchPlan`、`GenerationJobCheckpoint`
- 长篇 Persistence Foundation：SQLModel tables、PostgreSQL JSONB、Psycopg 3、Alembic migration、事务 Session、版本不可覆盖、stale write 与非法状态倒退保护
- 长篇 Planning API：Project 分页与 optimistic update、Story Bible / Stage / Episode Plan immutable version 写入和读取、跨资源归属与集数范围校验

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

- Frontend 对长篇 Project / Story Bible / Stage / Episode Plan API 的接入与冲突处理
- 服务端 Episode Draft / Revised / Final 版本聚合与 API
- Episode Draft / Revised / Final artifact 的服务端版本持久化
- Story Bible / Story Stage / Episode Plan 的生成、人工批准和 Prompt 注入
- Continuity Ledger 的自动提取、更新与冲突检查
- 后台 Generation Job 执行、暂停、恢复和断点重试
- Authentication、权限、协作和云同步
- Story Planning runtime
- Character Decision Logic runtime
- 动态 Knowledge Retrieval、RAG、向量库和 Skill Registry
- 自动 Prompt 优化或自主学习
- Acceptance enforcement、多轮 Revision 和无限质量循环
- Script Generation 正式统一 Facade
- Storyboard、Voice、Animation、Video、Seedance 和发布系统

## Important Boundaries

- Frontend 项目数据当前仍保存在浏览器 IndexedDB；后端规划 API 已可持久化独立长篇资源，但当前页面尚未调用，因此浏览器项目不会自动迁移或恢复。
- “全部生成”是前端按有界批次逐集调用，不等同于一次生成完整系列规划；批次尚不具备后端持久化或断点任务恢复。
- 故事线和人物关系是本地 authoring / continuity artifact，不是 Final `MasterScript` 字段。
- Bilingual View 是开发者 / 中文用户审阅工件，不进入目标语言正式剧本。
- Static Knowledge 只在 Strategy 明确声明并通过适用性校验时注入。
- Deepening 和 Acceptance 都不得绕过 Finalization Gate。
- Agent 尚未实现；合作方需求待确认。未来 Agent 应调用受控 Application Use Cases，而不是直接自由操作领域数据。

## Last Recorded Validation

最近一次代码变更后的记录：

- 后端全量测试：`257 passed, 1 skipped`
- 长篇模型、Repository、migration 与 Planning API 定向测试：`28 passed`
- 前端 TypeScript：通过
- 前端 production build：通过
- `git diff --check`：通过
- Alembic upgrade / check / downgrade / re-upgrade：通过 SQLite 自动化验证
- 真实 PostgreSQL 集成：本轮未运行，进入 CI / 部署环境验证阶段后补充

该记录是当前持久化 foundation 的验证快照，不代表 API、Frontend 或后台任务已经完成持久化接入。

## Current Hold

- 暂停旧手工测试清单；旧清单已从当前文档集移除，待长篇主流程形成可用切片后重建验收清单。
- 暂停 Creative Deepening、海外 TikTok 默认适配、视频生产、Agent runtime 和大型架构重构。
- 当前只推进中国大陆长篇生成基础、持久化接入和有界阶段生产能力。
