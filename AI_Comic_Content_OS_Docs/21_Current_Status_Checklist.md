# 21 Current Status

## Purpose

本文件是“当前已经实现什么、哪些仍是实验性、哪些尚未实现”的唯一状态来源。它不维护路线图、运行教程或详细 API 字段。

状态更新时间：2026-09-05。

当前产品核心：生成优质中文长剧本母本。用户按 10 万字量级选档，当前最大档为约 40–50 万字有效正文。当前“支持”指已建立长篇契约、递归规划、内容驱动的 episode-ready 叶节点、单集线路图、正文参考、持久化与有界生成路径；不代表整部最大档作品已经完成真实质量、连续性、成本和恢复验收。

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
- 已推送规划 API 基线：`2cdc79c`，commit 为 `feat: add persistent long story planning API`；持久化基线为 `0f6b2ec`，长篇契约基线为 `e5fdf81`。
- 主要内容：默认 `cn_mainland` market profile、保留但关闭 `overseas_tiktok`、红果 reference-only 定位、唯一递归剧情树流程、有界基础剧本批次、批次 lineage、长篇参数估算、Creative Deepening 前后端默认关闭。
- 当前增量：长篇 Contract Foundation、level-free recursive Story Plan Node、PostgreSQL/JSONB schema、Alembic migration、事务型 Repository、原子 optimistic revision、Project / Workspace Snapshot / Episode Artifact / Story Bible / Plan Node / Stage / Episode Plan 资源 API，以及 Frontend 本地优先同步、恢复、冲突提示、软删除和内容里程碑上报。
- 明确边界：仍通过现有单集 Draft API 编排；规划资源 API 不等同于自动 Story Blueprint / Episode Planning，也不等同于后台长任务或完整 60 万字自动生成 runtime。
- 验证状态：后端全量 `306 passed, 1 skipped`；前端递归工作流归一化与正文指标测试 `6 passed`，typecheck 与 production build 均通过。
- 远程状态：已推送并跟踪 `origin/feature/cn-mainland-staged-generation`。
- 合并状态：尚未合并到 `main`；应在合作方需求确认和新版手工验收完成后再决定是否合并并建立新版本 tag。

### `test1`

- 职责：承载作者主权、输入完成度识别、来源保留导入、规划审批门禁和正文自动恢复安全收口的交接分支。
- 基于：`creative-sovereignty-v1`（`f6696c1`）。
- 功能代码基线：`c0b168d`；交接文档从 `b058cdd` 开始记录，分支已推送并跟踪 `origin/test1`。
- 主要增量：Story Bible 来源保留导入草稿、分集原文 `episode_plan_import.v1` 来源审计草稿、规划版本变化失效、确认规划后才允许自动续写/恢复、旧项目省略规划状态的兼容，以及全剧交付确认门禁。
- 明确边界：分集原文审计尚未物料化为 `StoryPlanNode` 或 `EpisodeRoadmapItem`；没有后台 durable Story Planning Job、自动批准或权威 Continuity Ledger 自动更新。
- 验证状态：前端 TypeScript 与差异检查通过；生成恢复定向测试记录为 `12/12`；浏览器、Playwright、后端全量和真实长任务尚未在本交接轮执行。
- 交接文档：[22_TEST1_HANDOFF.md](22_TEST1_HANDOFF.md)。
- 合并状态：尚未合并到 `main`；应先完成交接文档列出的状态机、导入映射和真实流程验收，再决定合并或建立版本 tag。

新增分支时必须追加登记；分支合并或关闭后保留简短历史状态，避免后续开发者误判能力所在分支。

## Active Market And Capability Flags

- `SCRIPT_MARKET_PROFILE=cn_mainland`：当前默认
- `overseas_tiktok`：实现与资产保留，默认关闭，可显式切换
- 红果：reference only，不是硬绑定平台
- Creative Deepening：实现和历史数据兼容位保留；前端入口隐藏，后端 runtime feature flag 默认关闭
- Static Creative Knowledge：大陆默认 Strategy 已启用 `knowledge_bundle.draft.cn_mainland_longform_planning_candidate.v2`，有界注入 Story Bible、递归拆分、Episode Plan 和基础 Draft；不含 TikTok 条目，不是 RAG。该 bundle 同时覆盖长篇可持续故事引擎、宏观运动、人物长期弧线和并行故事线；基础 `foundation.v1` 保留用于显式对照。知识原则仍是提示词级生成指引，不能独立证明 60 万字正文质量或替代跨批次连续性验收
- 长篇故事母本：当前目标；Story Bible、无固定层级的递归 Story Plan Node、episode-ready 叶节点、单集线路图/Episode Plan、ContinuityLedger 与 batch checkpoint 契约已实现。Story Plan Node 按剧情语义选择非均匀边界，系统强制叶节点为 8–12 集，至少 16 集继续递归，1–7 集或 13–15 集返回父层协调。每个叶节点在分集前完整定义单位剧情因果链、局部结算和交接压力。正式后台 Job 和权威 ContinuityLedger 自动更新仍未接入
- 60 万字产品验收：尚未完成；真实 Story Bible / Root 样本已经验证生成、持久化、编辑与批准路径，但同时暴露出合法摘要无法证明数百集内容容量。下一验收主线先完成 Story Engine、宏观运动、人物/反派策略、信息揭示、支线贡献和重复风险的规划质量验证，再进入完整作品累计正文、跨批次连续性、失败恢复、成本、耗时与人工质量检查
- ContentSpec persistence：配置 PostgreSQL 时已可跨 API 重启恢复，长篇规划不再依赖创建 ContentSpec 的原始进程；Prompt / Strategy 等开发资源仍需启动 bootstrap
- `scripts/run_cn_longform_acceptance.py` 当前是旧版固定集数正文容量校准工具，直接串行调用单集 Draft，不经过 Story Bible / 递归剧情树 / Episode Plan；不得将其结果作为当前长篇主路径的正式端到端验收。正式测试从 Frontend 规划页的总纲确认开始
- `scripts/run_cn_recursive_600k_acceptance.py` 是当前隔离容量验收工具：默认 `all` 按最早未完成剧情部分逐层拆分，模型判定剧情语义已可直达正文后进入 episode-ready，再逐集生成该部分正文；每集保存本地 `continuity_snapshot.json` 并有界注入后续请求。该本地快照不是正式后端 `ContinuityLedger`

## Current Runtime Flow

```text
Raw Data
→ AnalysisResult
→ ContentSpecDraft
→ ContentSpec
→ optional ResolvedCreativeContext
→ exact-ID Mainland Long-form Knowledge Bundle
→ StoryBible / Recursive StoryPlanNode / Episode-ready Leaf / Episode Roadmap
→ Orchestrator / Retrieval
→ Prompt Retrieval
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

### Recent Workflow Guardrails (2026-09-04)

- 输入完成度识别保持建议式行为：识别结果不会自行改变项目阶段，也不会跳过总纲、规划或正文的保存/确认门禁。
- 规划页的首层剧情、剧情树展开和分集路线图均由用户按钮触发；进入页面不会自动生成。
- 确认规划只会把规划会话锁定并解锁正文工作区；不会附带首轮正文生成意图。正文为空时由用户点击“生成下一部分”开始。
- 正文已有内容后的受控续写与中断恢复仍保留，但首次生成、页面导航和刷新不会隐式启动。

Frontend 不再提供逐集/全部生成的产品模式选择。唯一流程先形成 Story Bible 和递归 Story Plan Node；分支根据剧情完整性停止拆分，批准叶节点在运行时均衡分批并覆盖区间内的逐集正文请求。每集仍是一次独立请求，旧 `mode` 字段只保留历史 payload 兼容。

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
- OpenAI-compatible Chat Completions / Responses 双 wire API；Responses 可选 reasoning effort，当前 Kimi 本地配置为 `responses + medium`
- 结构化输出、重试和 Schema 校验
- 长篇规划 provider compatibility：Story Bible、Story Plan Node、递归拆分和 Episode Plan 兼容 OpenAI strict schema 与只保证 JSON mode 的网关；Prompt 内含权威 Schema，本地执行 Pydantic 校验。Story Bible 会过滤输入重复字段；后续规划产物首次返回非 JSON 或非合约字段时最多执行一次带错误反馈的格式修复
- `CreativeIntentInput → ContentSpec + ResolvedCreativeContext`
- Character Context provenance 与 locked fields
- 策略声明的静态 Knowledge Bundle
- Scene Goal / Conflict / Outcome 与跨场 causal link
- 结构化 `DraftMasterScript`
- optional episode context，包括上一集状态、本集指令和项目连续性摘要
- optional 单集正文预算：中国大陆长篇前端按“总正文目标 ÷ 计划集数”传入 `target_script_body_characters`，Prompt Builder v0.3 将其限定为动作与对白预算，省略时保持旧行为
- 系统推荐集数会按已生成动作与对白正文的实际集均重新估算达标集数，并以有界批次继续到目标；手动集数严格按使用者设定停止，动态估算受 2000 集硬上限保护
- 长篇 Contract Foundation：`StoryProject`、`StoryBible`、人物弧/关系/故事线、level-free `StoryPlanNode`、兼容 `StoryStagePlan`、`EpisodePlan`、`ContinuityLedger`、`GenerationBatchPlan`、`GenerationJobCheckpoint`
- 长篇 Persistence Foundation：SQLModel tables、PostgreSQL JSONB、Psycopg 3、Alembic migration、事务 Session、版本不可覆盖、stale write 与非法状态倒退保护
- 长篇 Planning API：Project 分页与 optimistic update、Story Bible / Story Plan Node / Stage / Episode Plan immutable version 写入和读取；递归节点校验唯一根、父子归属、同级顺序、前驱及父子容量边界
- Story Planning Slice：复用 ContentSpec、GenerationStrategy 和 LLMAdapter 生成 Story Bible、第一层剧情与递归子节点；独立 Planning Workspace 先展示总纲，再逐分支审阅并以 immutable version 批准。达到可分集粒度的叶节点继续生成并审批单集路线图，路线图作为现有正文生成器的本集约束
- Frontend Workspace Persistence：Project 可在 ContentSpec 解析前创建；完整工作区使用 50 MB 上限的 JSONB snapshot、checksum、独立 revision 和 client lineage 保存
- Episode Artifact Persistence：确认 draft、规则 revised 和 final 使用服务端分配版本的 immutable JSONB artifact，保留 checksum、source artifact 与 bounded lineage

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

- Next.js 中国大陆中文创作界面；海外双语能力保留但当前关闭
- IndexedDB 本地优先项目、角色、分集和版本快照
- PostgreSQL Project + Workspace Snapshot 同步、跨浏览器恢复、updated-at 合并、显式 revision conflict 和版本保护软删除
- 项目级市场来源隔离：中国大陆前端只显示 `cn_mainland` 项目；海外/TikTok 与来源不明项目在 UI 和直接路由中隐藏但底层数据不删除
- 中国大陆界面与生成语言固定为中文；语言切换、海外入口和英文 presentation 在当前前端关闭，仅在显式切换 `overseas_tiktok` 后恢复
- 确认稿、修订稿和终稿 Episode Artifact 里程碑上报；失败不覆盖或删除本地稿件
- Creative Input、系统标签、“我的标签”和 Character Builder
- 中国大陆系统标签目录：题材类型、剧情元素、关系冲突、情绪体验与目标受众；静态“灵感推荐”需用户主动选择，不冒充实时热榜
- 旧 `element.*` 项目标签兼容迁移到正式 Ontology ID；海外标签资源保留但在 `cn_mainland` runtime 不注册
- 递归剧情树驱动的有界基础剧本批次，包含本地 batch lineage 和 optional 阶段指令
- Story Bible、Story Plan Node 与 Episode Plan 草稿的结构化编辑、版本化保存和独立批准
- 长篇字数验收仪表：以动作与对白正文作为 60 万字目标口径，单独显示结构稿辅助文本、当前集、正文集均产量、目标进度、达标所需集均和按当前正文集均的完结投影；整部 Markdown / JSON 导出保留同口径统计
- 分集切换、结构化编辑、保存、确认和 AI 修改；Deepening 入口当前隐藏
- Framework / Modification / Revised / Final 版本视图；历史 Deepening 数据仍可兼容读取
- 单集与整部 Markdown / JSON 导出
- 已有分集覆盖保护和复制新生成版本
- presentation-only 中英对照实现保留；当前大陆前端不展示海外英文项目或语言入口
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

- 实现和 preservation contract 保留，但当前产品流程关闭。
- 前端不展示候选入口，后端默认拒绝执行；历史候选数据只作兼容读取，不代表当前可用能力。

### Real LLM

- 已验证一个 OpenAI-compatible 接入。
- 跨 provider 稳定性、成本、延迟、429 / 5xx 和 Schema 失败率尚未完成生产校准。

### Knowledge

- 已实现 bounded static bundle 和 source lineage。
- 中国大陆通用基础 bundle 已覆盖规划与 Draft，但题材知识和大陆市场知识覆盖仍有限，不是完整 Knowledge Base runtime。

## Not Implemented

- Story Plan Node 的转折点、引用集合等低频字段的完整表单编辑；当前核心叙事字段和 Episode Plan 核心字段已支持编辑、保存和批准
- Episode Artifact 审计/恢复 UI 和编辑过程细粒度版本
- 后台 Job executor、全自动递归、自动批量批准、Continuity Ledger 自动更新与跨批次续跑；当前已批准叶节点通过本集 instruction 进入现有正文生成 Prompt，但还不是独立的持久化 Context Mapper
- Continuity Ledger 的自动提取、更新与冲突检查
- Frontend 已有可点击人物节点、关系记录、人物卡入口和逐集关系详情；仍缺正式自由布局关系图、与递归故事线树交叉跳转及后端权威状态同步
- 后端 Relationship / Story Line authoring contract、渐进式 proposed/confirmed fact lifecycle、future effective point、impact analysis 与分支再生成
- 按当前规划节点/分集生成 bounded continuity slice 的 Context Mapper；当前只有 Frontend 本地摘要，不足以承担完整长篇约束
- 后台 Generation Job 执行、暂停、恢复和断点重试
- Authentication、权限、多用户协作和账户级云空间（单用户工作区服务端同步已实现）
- Story Planning 的后台自动递归、跨叶子调度与 durable job runtime
- Character Decision Logic runtime
- 动态 Knowledge Retrieval、RAG、向量库和 Skill Registry
- 标签来源证据聚合、Tag Knowledge Profile、动态 Tag Context Retrieval 和实时热门标签接入
- Project-scoped `CustomTagContext` 语义确认；当前“我的标签”仍只是本地创作关键词
- Prompt-only 与受控 Ontology Tag-only 输入已支持；confirmed CustomTagContext-only 仍待语义确认契约
- Tag Context 到可审阅 Story Synopsis / Story Direction 的正式映射
- 自动 Prompt 优化或自主学习
- Acceptance enforcement、多轮 Revision 和无限质量循环
- Script Generation 正式统一 Facade
- Storyboard、Voice、Animation、Video、Seedance 和发布系统

## Important Boundaries

- Frontend 项目数据先保存在 IndexedDB，并在 PostgreSQL 可用时同步 Project + Workspace Snapshot；远端新版本可恢复到本地，版本冲突只提示不自动覆盖。
- Workspace Snapshot 是当前兼容恢复边界，不代表 Draft / Revised / Final episode 已成为独立、可查询的服务端领域版本。
- 用户界面只提供递归规划后的有界基础剧本批次，不再展示“逐集/全部生成”；批次尚不具备后端持久化 Job 或断点任务恢复。
- 新 `StoryPlanNode` 允许任意深度、非平衡递归拆分：`episode_ready` 由事件链、选择后果、转折和退出状态是否足以直接指导正文决定，与集数无关。当前前端已经可以调用 LLM 生成第一层、拆分分支，并逐项编辑、保存和批准；系统仍不会自动递归整棵树。
- 长篇字数仪表是验收与容量投影工具，不是后台 60 万字生成 Job；60 万目标只计动作与对白中的字母、数字与中文字符，不将梗概、人物说明、Goal / Conflict / Outcome 等规划字段凑入正文字数。
- 正文 Key Pool 只在后端读取 `LLM_API_KEY_01` 到 `LLM_API_KEY_XX`，每个 Key 同时只执行一个请求；未配置编号 Key 时自动回退主 `LLM_API_KEY`。Key Pool 不绕过供应商账户级限制。
- 系统推荐集数模式可以在前端继续追加有界批次直到正文目标，但仍需要使用者触发下一阶段；当前没有无人值守后台 Job，也未把 60 万字一次性锁定为单个 LLM 请求。
- 故事线和人物关系是本地 authoring / continuity artifact，不是 Final `MasterScript` 字段。
- Bilingual View 是开发者 / 中文用户审阅工件，不进入目标语言正式剧本。
- Static Knowledge 只在 Strategy 明确声明并通过适用性校验时注入。
- Deepening 和 Acceptance 都不得绕过 Finalization Gate。
- Agent 尚未实现；合作方已提出 Creator Agent / Copilot 需求，但进入时点仍待长篇核心用例稳定后确认。未来 Agent 应调用受控 Application Use Cases，而不是直接自由操作领域数据。

## Last Recorded Validation

最近一次代码变更后的记录：

- 后端全量测试：`306 passed, 1 skipped`
- 大陆/海外标签 bootstrap 与 Ontology 模型定向测试：`5 passed`
- 前端正文计数、推荐集数调度与旧模式归一化测试：`6 passed`
- 长篇模型、ContentSpec durable Repository、migration、Planning API、非平衡递归 Story Plan Node、Workspace Snapshot 与 Episode Artifact 定向测试：通过
- 前端 TypeScript：通过
- 前端 production build：通过
- `git diff --check`：通过
- Alembic upgrade / check / downgrade / re-upgrade：通过 SQLite 自动化验证
- 真实 PostgreSQL 集成：已使用本地 PostgreSQL 完成 migration、Workspace Snapshot 写入/读回、进程重启后恢复和版本保护软归档
- ContentSpec durable lifecycle：本地 PostgreSQL 已升级到 `20260804_0005 (head)` 且 Alembic 无 schema drift；Creative Intent 创建的 ContentSpec 在完整前后端重启后按原 ID 读取返回 `200`，大陆 Platform Profile 与内容保持一致

### Mainland China MVP Acceptance - 2026-08-02

- 独立验收 runtime 只注册 `cn_mainland_comic_drama_v1`、大陆 Strategy 和两个中文 Prompt；未注册海外/TikTok Strategy，Creative Deepening 为 `disabled`
- OpenAI-compatible 真实模型完成连续 2 集中文生成：两次均为 HTTP 200；第 1 集耗时约 271 秒，第 2 集耗时约 58 秒；合计 6 个场景、20 条对白、26 条动作
- Scene Causality 验收全部通过：每场 Goal / Conflict / Outcome 完整，Goal 与 Outcome 不同，场景 2/3 具有前序因果引用，最终场景提供 cliffhanger 和 next episode question
- 逐集连续性验收通过：第 2 集直接承接第 1 集的诱饵访问记录，由苏晚主动设计三份标记副本验证嫌疑人，并将“账户权限提前调用”作为新的下集问题；未重置冲突、未重复第 1 集揭露、未提前公布幕后主谋
- 用户锁定角色 `苏晚`、`顾沉舟` 被保留；生成正文未发现 TikTok、livestream、Mara、Adrian 等海外模板残留
- Story QC Explainability 两集均正常输出 5 个维度，但都评为 `character_agency=2.5/5`；第 2 集已有苏晚拒绝盲目扣人、主动设计分层诱饵、限制顾沉舟信息范围等明确选择，该分数与文本证据不充分一致，暴露的是 Story QC 可信度缺口，不宜直接当作生成质量事实
- 发现一项输出规范缺口：第 2 集内容连续，但标题未稳定包含“第2集”；后续应将集号视为结构化展示信息，不应仅依赖模型自由命名
- 约 88 KB Frontend Workspace Snapshot 成功写入 PostgreSQL，checksum 长度 64；后端进程重启后读回内容、市场来源和标题一致
- 验收项目已按 expected revision 软归档，不出现在正常项目列表
- 前端 TypeScript 与 production build 通过；由于执行环境不能接管用户当前 Chrome / Next dev 会话，本轮未替代人工完成浏览器按钮级验收

该记录是当前 Project + Workspace Snapshot + 内容里程碑 Artifact 的验证快照，不代表后台任务、编辑过程细粒度历史或全部旧 Repository 已完成持久化接入，也不代表 60 万字长篇已完成端到端生产验收。

### 600K Script Body Calibration - 2026-08-02

- 60 万字目标口径固定为 `character_actions + dialogues.text` 的有效中文、字母和数字字符；不计梗概、人物说明、Scene Causality、标点和 JSON 格式。
- 旧真实样本正文分别约 643 和 630 字，按 334 集只能投影约 21.2 万字，确认旧 Prompt 无法支撑真实 60 万正文。
- Prompt Builder v0.3 接收 `target_script_body_characters=1797` 后，固定样本首次生成 1505 字正文，HTTP 200，耗时约 125 秒；较 643 字旧样本提升约 134%，但按 334 集仅投影 502,670 字。
- 第二次有依据校准请求目标为 2150，实际生成 1670 字正文，HTTP 200，耗时约 378 秒；没有发现明显重复灌水，按 334 集投影 557,780 字，按当前集均达到 60 万需要约 360 集。
- 因真实模型不会严格命中字符预算，系统推荐集数不再把 334 视为硬停止点：在 334 集仅有 557,780 字时，下一批范围为 335-339，动态估算总集数为 360；累计达到 600,000 后停止。手动 334 集仍保持硬停止。
- 当前结论：单集正文扩展和基于实际产量的有界续写调度已得到真实样本支持；完整 60 万字作品尚未实际生成，因此不能宣称全量质量、成本、连续性和失败恢复已经验收。
- 上述 334 / 360 集数字仅属于 2026-08-02 的单集容量校准记录，不再定义当前递归规划树的结构或硬编码集数；当前正式流程应由总纲和各分支内容决定拆分深度，episode-ready 叶子最多覆盖 10 集并直接进入逐集正文。

## Current Hold

- 暂停旧手工测试清单；旧清单已从当前文档集移除，待长篇主流程形成可用切片后重建验收清单。
- 暂停 Creative Deepening、海外 TikTok 默认适配、视频生产、Agent runtime 和大型架构重构。
- 当前只推进中国大陆长篇生成基础、持久化接入和有界阶段生产能力。
