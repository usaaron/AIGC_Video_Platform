# 14_Script_Engine

Script Engine 的当前唯一目标是稳定产出高质量、结构化、可复用的 Final `MasterScript`。

当前默认市场为 `cn_mainland`，不绑定单一发行平台，红果仅作参考。`overseas_tiktok` 能力完整保留但默认关闭。当前创作重点已转向中文长篇故事母本；现有 runtime 可把单集框架按有界阶段连续生成，但尚不能宣称已经具备专业 Story Blueprint、后端可恢复任务或自动完成 60 万字母本。

市场切换不重写历史项目。Frontend 根据项目 `marketProfile` 与既有 Generation Strategy 识别来源；非当前市场项目仅保留查看、导出和删除能力，不能调用续写、AI 修改、审核或 Finalization。用户需要继续创作时，应复制为绑定当前市场的新版本，从而保持 Prompt、Strategy 和产物 lineage 一致。

## 当前阶段产物

当前阶段最终产物是：

- Final `MasterScript`

其中：

- Scene
- Dialogue

作为 `MasterScript` 的组成结构存在。

以下能力当前只保留接口与扩展位置：

- Storyboard
- Voice
- Animation
- Video Composition

## 当前推荐流程

`ContentSpec`
→ optional `ResolvedCreativeContext`
→ `CreativeBrief`
→ Orchestrator / Asset Retrieval
→ Prompt Retrieval
→ Static Creative Knowledge Selection（optional）
→ Prompt Builder
→ `LLMAdapter`
→ `DraftMasterScript`
→ Creative Deepening Candidate（当前默认关闭）
→ Source / Candidate Story QC Comparison（仅显式启用时）
→ `StoryQCReport`
→ `RevisionDecision`
→ `RevisionStrategy`
→ `RevisionPlan`
→ `RevisionExecutor`
→ Re-QC
→ `AcceptanceDecision`（shadow）
→ `ScriptRevisionRun`
→ Finalization Gate
→ Final `MasterScript`

## Script Generation Box Contract

当前 Script Engine 的长期对外形态应是一个独立、可替换、可维护的能力盒子：

`ScriptGenerationRequest`
→ Script Generation Box
→ `ScriptGenerationResult`

当前说明：

- 上游模块不应了解盒子内部步骤细节
- 下游模块不应直接依赖 Draft、Prompt Builder、Story QC 或 Revision 的内部对象
- 盒子内部仍可保留当前主链路的各个步骤
- 但这些步骤不应长期成为外部调用方必须自行编排的公共契约

当前内部参考步骤可以继续包括：

- ContentSpec Validation
- Knowledge Retrieval
- Prompt Retrieval
- Prompt Builder
- `LLMAdapter`
- `DraftMasterScript`
- `StoryQCReport`
- `RevisionDecision`
- `RevisionStrategy`
- `RevisionPlan`
- `RevisionExecutor`
- `RevisedDraftMasterScript`
- Re-QC Report
- `AcceptanceDecision`
- `ScriptRevisionRun`
- Final `MasterScript`

上述 Revision 对象已进入盒子内部 runtime，其中 `AcceptanceDecision` 仅以 shadow mode 运行。它们不改变 `ScriptGenerationRequest` / `ScriptGenerationResult` 的单入口、单出口目标，也不会成为上游或下游必须自行编排的新公共契约。

## 当前阶段设计规则

- 不允许把生成逻辑绑定到某一个具体模型
- 不允许把 Prompt 散落在业务代码中
- Prompt 必须来自 `Prompt Library` 或 `Prompt Builder`
- `MasterScript` 必须是结构化输出，而不是不可控长文本
- Story QC 的结构化报告与 Explainability v1 已实现，但专业评分可信度仍属于实验性占位能力
- 当前所有设计优先服务于剧本质量，而不是视频生成便利性
- Creative Deepening 的实现与 preservation contract 保留，但当前中国大陆配置为 `disabled`，不进入默认创作路径
- 后端 Draft 调用仍以单集为单位，但已支持 optional episode continuity context；Story Blueprint、Episode Plan 与服务端全集事务仍为 Research / Backlog

## 关键组件

### Prompt Retrieval

负责从 `Knowledge Base` 中读取适用的 Prompt 资产。

当前最小规则：

- 根据 `GenerationStrategy.prompt_ids` 精确读取
- 后续可扩展为按标签、平台、受众做规则检索

当前相关基础能力：

- `Prompt Library Foundation` 已落地
- `Prompt Retrieval Foundation` 已落地
- `GenerationStrategy Foundation` 已落地
- `Script Generation Draft Integration Service` 已落地

当前 `Draft Integration Service` 的职责：

- 输入 `ContentSpec + GenerationStrategy`，并可选消费 `ResolvedCreativeContext`
- 自动调用：
  - `Orchestrator`
  - `Retrieval`
  - `Prompt Retrieval`
  - `Prompt Builder`
  - `LLMAdapter`
  - `Story QC`
- 输出结构化 Draft 运行结果
- 当前标准草稿对象为 `DraftMasterScript`
- `Story QC` 当前消费 `DraftMasterScript` 而不是松散原始字典

### Static Creative Knowledge Bundle v1

Script Generation Box v2 MVP Phase 2 已在现有 Draft 路径中接入静态 Creative Knowledge Bundle：

```text
ContentSpec + optional ResolvedCreativeContext
→ GenerationStrategy 声明 exact Draft bundle
→ StaticKnowledgeBundleCatalog
→ tag / platform applicability check
→ Prompt Builder
→ LLMAdapter
→ DraftMasterScript
```

当前实现边界：

- `GenerationStrategy.draft_knowledge_bundle_id` 为 optional；省略时 Prompt 与生成行为保持原状
- 只做精确 ID 选择和确定性适用性校验，不做语义检索、排名或自动推荐
- Prompt Builder 只在 bundle 存在时注入独立 `CreativeKnowledgeUsage` / `CreativeKnowledgeBundle` 段
- 注入内容限定为有来源的原则、应用规则、限制和反模式，不复制完整 Research 知识文件
- bundle 与 `KnowledgeSelectionTrace` 保存在 `ScriptGenerationDraftRun`，支持后续评估与复现
- 未知 bundle、阶段错误或条件不匹配会明确失败，不静默降级为错误知识
- Draft Generation 与 Creative Deepening 可分别使用独立的 exact-ID 静态 bundle；二者不自动复用，Story QC 与 Revision 不消费该 bundle

这仍是静态知识能力，不等于完整 Knowledge Base、Retriever、RAG 或 Creative Skill runtime。当前唯一内置 bundle 面向 TikTok Dark Romance，并随海外模式关闭；中国大陆长篇知识 bundle 尚未进入 runtime，必须先完成来源治理和固定样本验证。

### Creative Deepening Shadow v1

状态：实现保留，前后端 feature flag 当前默认关闭。以下内容描述已完成能力边界，不代表当前模式正在执行该步骤。重新启用必须显式设置 `SCRIPT_CREATIVE_DEEPENING_ENABLED=true`，不能仅依赖 Strategy 或市场切换。

当前在既有 `ScriptGenerationService` 内提供一次、可选、策略驱动的候选深化：

```text
Source Draft
+ optional Character Context
+ optional stage-specific Knowledge Bundle
→ dedicated Deepening Prompt
→ existing LLMAdapter
→ Candidate Draft
→ deterministic preservation checks
→ same Story QC comparison metadata
```

允许增强对白、情绪表达、可视动作、场景强度和角色表达。禁止改变 premise、角色身份、场景结构与因果、结尾和 cliffhanger purpose。change trace 与 preservation checks 会保存在 `CreativeDeepeningRun`。

当前严格边界：

- 只有 `disabled` 和 `shadow`；没有 `apply`
- source Draft 始终作为 `ScriptGenerationDraftRun.draft_master_script`
- 正式 `StoryQCReport` 与 `RevisionPlan` 始终基于 source Draft
- candidate QC 只用于 source/candidate 观察性比较
- 技术失败或结构漂移不会阻断既有生成路径
- Finalization Gate、Revision、Acceptance 均未修改
- 当前结构检查不能证明对白中不存在隐含的新重大冲突，仍需后续固定样本人工验证

### Initial Generation Quality Improvement v1 Step 1

当前首次生成已加入 Scene Causality 结构约束：

`ContentSpec`
→ 内嵌 Scene Plan
→ Scene Goal / Conflict / Outcome
→ `DraftMasterScript`

当前采用一次结构化 LLM 调用，而不是立即增加第二次 Scene Plan 调用。原因是当前单调用 Schema 已能可靠承载 `scene_causality`，真正的双调用会扩大 workflow、失败恢复、成本与 lineage 改动范围，不符合本轮最小收口边界。

当前每个新生成场景必须说明：

- `goal`：焦点角色当前要取得什么
- `conflict`：什么阻止目标或提高代价
- `outcome`：场景结束时发生了什么不可忽略的变化
- `caused_by_scene_number` / `causal_link`：后续场景如何由更早结果触发

当前约束还要求：

- `outcome` 不得复述 `goal`
- 后续场景必须引用更早场景的结果
- 最终场景结果必须落到既有 cliffhanger / payoff 约束
- Prompt Builder 的因果契约保持平台与类型无关，不包含婚礼、背叛或其他固定剧情
- 旧 Draft / Final payload 可以整体省略该兼容字段
- Revision、Acceptance 与 Finalization Gate 行为不变

当前边界：

- 仅验证主链路 Draft 阶段可联调
- Final `MasterScript` 当前通过独立 Finalization Mapper 从 `DraftMasterScript` 生成
- `MockLLMAdapter` 当前继续保留给测试与无外部模型环境
- `RealLLMAdapter` 当前仅用于首次真实剧本生成验证

## Upstream Creative Brief Authoring Boundary

新的输入控制需求位于 Script Generation Box 上游：

```text
Data Intelligence Recommended Tags
+ User Selected / Added / Excluded Tags
+ User Creative Prompt
+ PlatformProfile Hard Constraints
→ Creative Brief Resolution
→ Final ContentSpec
→ Script Generation Box
```

Phase 1 当前状态：

- 已实现最小 `CreativeIntentInput`、`CharacterContext`、`ResolvedCreativeContext` 和 `CreativeIntentResolutionResult`
- 已新增 `POST /content-specs/resolve-creative-intent`，通过现有 `ContentSpecService` 确定性解析
- selected / added / excluded tag 必须引用现有 active `OntologyNode`
- Character 字段保存 `user_provided` / `ai_inferred` provenance 和 `locked_fields`
- `ScriptGenerationDraftRequest` 可选接收 `resolved_creative_context`
- Prompt Builder 只在上下文存在时注入已解析 Character facts、provenance、locks 与 exclusions
- 旧 generate-draft 请求省略新字段时保持原有 Prompt 和生成流程

当前边界：

- 完整 `CreativeBriefInput` 的 recommendation、alias、unresolved tag 与用户确认能力仍是文档级设计
- 当前 `CreativeBrief` 仍指 `ContentSpec.creative_brief` 的标准化运行时子结构
- Script Engine 只消费解析完成的 `ContentSpec + ResolvedCreativeContext`，不自行决定采用哪些推荐标签
- Prompt Builder 不应直接接收 unresolved tag、原始推荐列表或未经解析的自由 Prompt
- 用户新增标签必须解析为现有 `OntologyNode`；未知标签不得在 Script Engine 中临时创建
- 用户排除项和平台硬约束必须在进入 Script Engine 前得到明确解析
- 重大语义冲突应要求用户确认，不能由 Script Engine 静默猜测
- Character Context 与 exclusions 不写入 `ContentSpec.metadata`
- Phase 1 的 Resolver 本身不实现 Relationship Context、AI 自动补全、持久化 authoring session、Knowledge Retrieval 或 Creative Deepening

当前集成状态：

- Frontend MVP 已将 Resolver、分集上下文 `generate-draft`、编辑后 `review-draft`、用户指令 `modify-draft` 和主动 `deepen-draft` 接入创作界面
- 当前支持逐集生成与“全部生成（分阶段）”；逐集模式每次一集，全部模式每次最多生成使用者设定的有界批次，再由使用者决定何时继续下一阶段
- 每次阶段生成通过 optional `GenerationBatchContext` 保留阶段编号、起止集数与阶段指令；批次之间可更新 Creative Intent、标签、角色和连续性信息，新输入只影响后续集数
- 当前阶段生成仍由前端顺序调用现有单集 API；项目状态先写 IndexedDB，再同步 PostgreSQL Project + Workspace Snapshot。用户确认稿、规则修订稿和终稿另存 immutable Episode Artifact；后台 Job 与断点重试尚未接入
- 每集保持独立编辑、确认、候选、Revision 与 Finalization 状态；确认后的手动稿先重新 QC，再允许进入受控质量链
- Frontend 使用现有 `revise-draft` 和 `master-scripts/finalize` 步骤 API 完成受控质量链，不改变 Script Engine 契约
- 项目与本地编辑版本存在 IndexedDB，并在数据库可用时同步版本化 Workspace Snapshot；ContentSpec、Prompt 等历史仓储仍有进程内实现，不能宣称整个系统已经全部 durable

### Long-Story Contract Foundation

当前已实现 `StoryProject`、`StoryBible`、`StoryStagePlan`、`EpisodePlan`、`ContinuityLedger`、`GenerationBatchPlan` 和 `GenerationJobCheckpoint` 的版本化模型与校验。

建议的未来内部链路保持：

```text
Creative Intent / ContentSpec
→ Human-reviewed StoryBible
→ Human-reviewed StoryStagePlan
→ EpisodePlan
→ Existing Episode Draft Generation
→ ContinuityLedger update
→ Next bounded batch
```

职责边界：

- `StoryBible` 固定整部故事事实、人物和长期方向。
- `StoryStagePlan` 定义一个集数区间的结构责任，不产生正文。
- `EpisodePlan` 定义单集目标、决定、状态变化和悬念。
- 当前 Draft Generation 仍负责写具体单集场景与对白。
- `ContinuityLedger` 保存紧凑已发生状态，不替代历史剧本或 Story QC。
- `GenerationJobCheckpoint` 只表达技术恢复状态，不评价内容质量。

当前已完成 contract foundation、SQLModel / PostgreSQL + JSONB mapping、Alembic migration、事务型 Repository，以及 Project / Workspace Snapshot / Episode Artifact / Story Bible / Stage / Episode Plan 的 Application Service 和资源 API。Frontend 已接入本地优先同步、恢复、冲突提示、版本保护软删除及确认/修订/终稿里程碑上报；尚未实现规划生成、完整人工批准工作流、自动账本更新、后台 Job executor 或 Prompt 注入，因此现有生成质量链行为不变。

持久化规则：

- PostgreSQL 是生产目标；SQLite 只运行 Repository 与 migration tests。
- Story Bible / Stage / Episode Plan / Ledger 采用 immutable version snapshot。
- Project / Batch / Job 使用 optimistic revision，Repository 拒绝 stale write。
- Batch / Job 状态必须按显式状态机推进，completed 不允许倒退。
- 当前 migration 可完成 upgrade、downgrade，并通过 Alembic metadata drift check。
- 资源 API 使用幂等 PUT、immutable version、分页 Project list 和明确的 404 / 409 / 503 语义。
- Application Service 校验 Project、Story Bible、Stage 与 Episode Plan 的归属和集数范围；API 不直接操作 SQLModel Record。

当前 Resolver 仅支持已归一化且不超过 240 字符的 free creative prompt，并将其确定性映射为 `ContentSpec.story_goal`。更复杂的语义解析仍需后续独立验证，不允许在 Phase 1 中静默使用 LLM 推断。

## Unified Input Contract

当前未来统一入口对象建议为 `ScriptGenerationRequest`。

它不应由零散参数组成，而应是结构化、版本化请求对象。

当前建议字段包括：

- `schema_version`
- `content_spec_id`
- `content_spec`
- `generation_strategy_id`
- `output_requirements`
- `retrieved_asset_refs`
- `retrieval_context`
- `knowledge_refs`
- `platform_context`
- `developer_options`
- `extensions`
- `request_metadata`

当前设计规则：

- 输入契约必须支持版本演进
- 新增字段优先保持向后兼容
- 核心字段必须有明确类型
- 不允许把整个入口退化成任意字典
- `extensions` 可用于实验性字段，但不应永久堆积稳定字段

## ScriptGenerationRequestMapper

当前应预留 `ScriptGenerationRequestMapper`。

它的职责是把上游对象映射为稳定的 `ScriptGenerationRequest`，而不是让上游对象直接侵入 `Script Engine`。

当前可映射输入包括：

- `AnalysisResult`
- `ContentSpecDraft`
- `ContentSpec`
- `PlatformProfile`
- Retrieved Assets
- `ScriptIndustryKnowledge`

当前原则：

- 上游数据格式变化应优先通过 mapper 适配
- 不应直接扩散到 `Script Engine` 核心逻辑
- `ScriptGenerationRequestMapper` 接收标准化 `ContentSpec`；它不替代上游 Creative Brief Resolution
- 原始 authoring input 的 lineage 可以由未来 resolution artifact 引用，但不应把任意自由字段永久塞入 `ScriptGenerationRequest.extensions`

### Finalization Mapper

负责将 `DraftMasterScript` 转换为 Final `MasterScript`。

当前最小规则：

- 保留 `DraftMasterScript` 的结构主干
- 将 `DraftSceneCard` 映射为 `SceneCard`
- 通过确定性规则补齐最小 `DialogueLine`
- 保持最后一场 cliffhanger 约束不变

当前边界：

- 当前不调用真实 LLM 做最终润色
- 如果 `DraftMasterScript.scenes[].dialogues` 已存在，Finalization 当前会直接保留真实对白
- 仅当 Draft 仍是 prompt-only 草稿时，Finalization 才会退回最小对白映射
- 导出到 `final_master_script.md` 时必须优先面向人类可读性，而不是直接暴露内部结构字段风格

### Prompt Builder

负责根据以下输入动态生成最终 `Master Prompt`：

- `ContentSpec`
- `CreativeBrief`
- `PlatformProfile`
- Audience / Commercial 上下文
- Retrieved Assets
- `GenerationStrategy`

当前要求：

- 输出必须可追踪
- 输出必须可版本化
- 输出必须可测试
- 输出必须至少包含：
  - `ContentSpec`
  - `CreativeBrief`
  - `PlatformProfile`
  - Retrieved Assets
  - `GenerationStrategy`
  - Prompt 资产内容
  - `output_language`
  - `desired_scene_count`
  - `target_duration_seconds`
  - Hook / Cliffhanger / Character Agency / Cultural Fit 约束
  - Scene Goal / Conflict / Outcome 与跨场因果链约束
  - 输出 JSON Schema

当前补充要求：

- `Prompt Builder` 应优先消费可追踪的行业知识资产，而不是临时手写“灵感 Prompt”
- 当前不允许在业务代码中写死三幕式、beat sheet、角色弧线或短剧节奏规则
- 如果某次生成使用了行业知识，后续应能追踪到对应 `knowledge_id`、版本与适用范围

### LLMAdapter

负责屏蔽不同模型提供商差异。

当前要求至少预留：

- `generate_text()`
- `generate_structured_output()`
- `validate_output()`
- `get_model_info()`

当前首次真实验证规则：

- 业务层只依赖 `LLMAdapter`
- 真实模型配置必须来自环境变量，不允许写死
- 当前真实适配器采用 OpenAI-compatible chat completion 结构化输出模式
- 真实模型输出必须先校验为 `DraftMasterScript` 结构化 schema
- 非法 JSON 或不可解析结构必须重试或返回明确错误

## Unified Output Contract

当前未来统一出口对象建议为 `ScriptGenerationResult`。

它不应只是纯文本，也不应只返回 Final `MasterScript`。

当前建议字段包括：

- `schema_version`
- `final_master_script`
- `quality_report`
- `revision_summary`
- `production_handoff`
- `lineage`
- `warnings`
- `generated_artifacts`
- `result_metadata`
- `extensions`

其中：

- `final_master_script` 是正式生产对象
- `quality_report` 应包含 `StoryQCReport`、Re-QC 结果和可信度说明
- `revision_summary` 应包含 `RevisionPlan` 与实际修订摘要
- `production_handoff` 用于未来下游对接
- `generated_artifacts` 可引用 Developer Artifact，但不得污染正式剧本字段

## Industry Knowledge Before Free Generation

当前 Script Engine 的长期原则是：

- 优先复用 `Knowledge Base` 中已整理的专业剧作知识
- 优先复用 `Prompt Library` 中已版本化的 Prompt 资产
- 优先复用 `GenerationStrategy` 中已验证的生成策略
- 仅在结构化知识无法覆盖时，再让模型做自由生成补全

当前明确边界：

- 不允许把行业知识写死在生成服务内部
- 不允许把“某个编剧经验”直接作为不可追踪的提示语散落在代码里
- 不允许把国内流程经验直接当作海外内容默认标准

未来知识引导生成应遵循：

Source Material
→ Structured Knowledge
→ Creative Skill / Task Framework
→ Prompt
→ `LLMAdapter`

其中 Creative Skill 当前只是 Research 概念，不代表已经批准新增 Skill Registry。专业知识负责提供质量底线和适用约束，`LLMAdapter` 负责在约束内生成原创内容；知识不能退化为散落在 Prompt 中的不可追踪规则。

## Production Artifact vs Developer Artifact

当前必须区分两类工件：

### Production Artifact

包括：

- `ContentSpec`
- `CreativeBrief`
- `DraftMasterScript`
- `RevisedDraftMasterScript`
- Final `MasterScript`
- `Storyboard`
- `Voice Script`
- `Video Generation Spec`

当前规则：

- 正式 `MasterScript` 的源语言必须保持目标市场语言
- 生产字段中不允许混入中英双语解释文本
- 开发调试信息不得污染正式生产工件

### Developer Artifact

包括：

- `Bilingual Developer View`
- `Prompt Snapshot`
- `StoryQCReport`
- `RevisionPlan`
- `Evaluation Report`
- `Lineage`
- `Debug Metadata`

当前规则：

- Developer Artifact 只服务于研发、评审和调优
- Developer Artifact 不参与 Final `MasterScript` 主链路的正式内容定义
- 允许保留中英双语说明、评估注释、调试信号和版本追踪信息

## Bilingual Developer View

当前已为 Frontend MVP 实现 presentation-only `BilingualScriptView`。

它的输入是正式英文 Draft，输出是供中文界面审阅的中英双语工件；未来也可用于 Final `MasterScript` 的开发者视图。

当前实现采用稳定文本路径：

- `view_version`
- `source_draft_master_script_id`
- `source_language`
- `target_language`
- `items[].path`
- `items[].source_text`
- `items[].translated_text`
- `llm_model_info`
- `warnings`

当前明确边界：

- `BilingualScriptView` 不是新的生产主链路节点
- 它不能替代正式 `MasterScript`
- 中文界面查看英文稿时，每个可见剧本文本块同时保留原文和中文译文
- 场景标题、场景目的、节拍摘要、情绪目标、动作、转折点、cliffhanger、下一集问题可以做开发者译注
- 翻译缺失任何源路径时整份视图无效；失败不影响英文源稿
- 英文界面不请求或显示中文翻译

## Frontend Project Continuity View

Frontend 本地项目已支持可编辑的故事线与人物关系视图：

- 主线、支线和角色成长线记录跨集推进
- 人物关系记录当前状态与每集变化
- 新增角色从下一次生成或 AI 操作开始参与上下文，不自动改写旧集
- 用户可根据当前剧本刷新确定性整理结果，也可手动修改
- 后续分集生成会消费 bounded 连续性摘要，以延续用户确认的故事线和关系状态
- 连续性摘要不触发对已生成分集的静默重写

该视图属于 authoring / continuity artifact，不进入单集 `MasterScript`，不替代 Story Blueprint / Episode Planning，也不改变 Script Generation Box 主链路。

## Production Handoff

未来下游模块的输入需求可能变化，因此不应为了某个下游模块直接修改 Final `MasterScript`。

当前应预留以下 mapper：

- `StoryboardHandoffMapper`
- `VoiceHandoffMapper`
- `AnimationHandoffMapper`
- `VideoGenerationHandoffMapper`

当前原则：

- 下游 mapper 应消费 `ScriptGenerationResult`
- 下游 mapper 负责生成各自模块的请求对象
- Final `MasterScript` 保持面向剧本生产的稳定数据契约
- Phase 2 功能当前只做结构预留，不实现真实视频链路

### Future Script-to-Production Adapter Boundary

未来推荐的生产交接链路为：

Final `MasterScript`
→ Script-to-Production Adapter
→ Model-Independent Production Package
→ Seedance Adapter / Other Video Model Adapter
→ Provider-Specific Generation Prompts

Model-Independent Production Package 可派生：

- Character Bible、原创角色视觉一致性锚点、人格、决策模式、语言模式、情绪边界与关系动态
- Scene Bible、环境、重要道具和连续状态
- Shot List、可见动作、微动作、表情、构图意图、视觉风格、灯光与色彩建议
- 对白表演、语速、声音、环境音和时长指导
- 空间、服装、道具、对象状态和转场连续性约束
- 模型无关 negative constraints

Seedance Adapter 只负责把模型无关 Package 转换为 Seedance 支持的 Prompt 结构、参考素材要求、镜头限制和模型专用负面提示。Seedance 版本变化不应迫使 Final `MasterScript` 或 Script Generation 主链路修改。

当前状态：deferred, not implemented。当前不创建 Production Package 模型、Adapter、API、工作流或测试。

### FinalMasterScript Future Compatibility Review

| 语义区域 | 当前支持 | 兼容性判断 |
|---|---|---|
| Scene、顺序、目的、Hook、Turning Point、Cliffhanger | 有明确结构字段 | sufficient，继续保留为稳定故事语义 |
| Conflict、Scene Outcome、Escalation、Emotional Progression、Payoff | 可从 purpose、beat summary、emotional shift、turning point 部分推断 | partially sufficient；未来如质量验证证明必要，再评估正式语义字段 |
| 角色身份、故事角色、基础动机 | `CharacterProfile` 已包含 name、role、description、motivation | partially sufficient，适合基础 Character Bible 派生 |
| 角色外部目标、内部需要、缺陷、决策模式、情绪边界、关系、语言风格 | 当前没有独立稳定字段 | missing；属于未来候选故事语义，但本轮不改 schema |
| Dialogue、Dialogue Intent、Character Actions | 当前有结构字段，但动作仍是自由文本 | partially sufficient，可作为表演与可见动作派生输入 |
| Facial Expression、Subtext、Delivery Cue | 当前未显式表达 | should remain adapter-derived；只有影响因果的例外内容才值得未来进入故事语义 |
| Location / Environment | 当前 `setting` 是简化字符串 | partially sufficient；Production Adapter 可继续扩展视觉环境 |
| Important Props、Object State、故事必需的 Spatial State | 当前缺少 | missing；如果影响因果和连续性，未来应考虑稳定语义引用 |
| Camera、Composition、Lighting、Color、Audio、Costume、Transition、分镜时长 | 当前核心模型未正式承载 | should remain adapter-derived |
| Seedance Prompt、参考图语法、模型参数、模型负面提示 | 当前未承载 | should remain adapter-specific，不得进入 Final `MasterScript` |

稳定边界是：Final `MasterScript` 描述 what happens and why；Production Adapter 描述 how it should be visually and audiovisually generated。

### Story QC

负责评估草稿剧本质量。

未来可检查：

- 剧情逻辑
- 人设一致性
- 情绪曲线
- Hook 强度
- Cliffhanger 强度
- TikTok 适配度
- 商业潜力
- 文化适配
- 风险内容

当前已经实现结构化 `StoryQCReport`、Rubric Foundation 与 Explainability v1；尚未完成的 placeholder 是专业评分可信度、知识支撑和行业 Ground Truth 校准，而不是报告接口本身。

当前额外要求：

- `Story QC` 评分必须基于显式 `Story Quality Rubric`
- 不允许只做随意文本评价
- 后续 Revision Loop 应消费 Rubric 扣分原因和修改建议

当前长期方向：

- `Story QC` 不应停留在轻量 Quality Checker
- `Story QC` 应逐步发展为可引用专业知识的 `Script Expert`
- `Story QC` 的专业判断应优先来自可治理知识，而不是不断堆叠零散硬编码规则

当前后续知识来源应优先包括：

- `ScriptIndustryKnowledge`
- `Script Knowledge Registry`
- `Knowledge Base`
- `GenerationStrategy`
- 平台和文化适配约束

当前 `Story QC Explainability Upgrade v1` 已经补充兼容字段，用于在不重构主链路的前提下增强报告解释力。

当前除 `score` 外，`StoryQCReport` 已支持：

- `report_version`
- `explainability_status`
- `dimension_evaluations`
- `evidence_summary`
- `knowledge_refs`

其中：

- `dimension_evaluations` 当前覆盖 5 个核心维度
- `knowledge_refs` 当前仅作为兼容字段与占位引用，不代表完整知识系统已落地
- 适用范围说明与更完整 `Structural Evaluation` 仍属于后续增强方向

## Story QC Credibility Improvement v1

`Story QC Credibility Improvement v1` 的 Explainability 增强已经实现；本节记录该版本的设计边界，不代表当前开发优先级。

v1 的目标不是把 `Story QC` 变成复杂评分模型，而是提升 Explainability，让 `StoryQCReport` 能更清楚回答：

- 为什么得分高或低
- 为什么被扣分
- 问题出在哪个维度
- 问题与哪些场景或文本证据有关
- 当前报告能否直接支持 `RevisionPlan` 与 `Prompt Evaluation`

### v1 聚焦的 5 个维度

第一轮只聚焦以下 5 个维度：

- `Hook Quality`
- `Character Agency`
- `Conflict Escalation`
- `Emotional Payoff`
- `Cliffhanger Strength`

当前设计原则：

- 先覆盖最影响短剧留存与追更动力的维度
- 先服务 `RevisionPlan`、`Prompt Evaluation` 与人工复查
- 不在知识体系未稳定前一次性扩展全部评分维度

### v1 Explainability 输出方向

`StoryQCReport` 当前 v1 已支持以下说明能力：

- `dimension`
- `summary`
- `score_reason`
- `deduction_reason`
- `evidence`
- `scene_refs`
- `revision_signal`
- `confidence_note`

其中：

- `dimension` 表示当前评审维度
- `summary` 表示该维度的简要判断
- `score_reason` 表示当前为什么给出这个分数
- `deduction_reason` 表示当前扣分的主要原因
- `evidence` 表示引用的剧本文本、场景节拍或结构信号
- `scene_refs` 表示问题关联到哪些场景
- `revision_signal` 表示可直接传给 `RevisionPlan` 的动作线索
- `confidence_note` 用于标明当前判断仍是规则信号、实验信号还是后续知识增强信号

### v1 当前数据契约

当前 `StoryQCReport` 已补充以下兼容字段：

- `dimension_evaluations`
- `evidence_summary`
- `knowledge_refs`
- `report_version`
- `explainability_status`

当前约束：

- 新字段保持向后兼容
- 当前已有 `checks`、`rubric_categories` 不移除
- `dimension_evaluations` 当前优先服务 5 个核心维度
- `knowledge_refs` 当前只提供占位级引用，不要求完整知识系统落地

### v1 与 Revision 的关系

`Story QC` v1 的核心价值之一，是让 `RevisionPlan` 不只知道“哪一项低分”，还知道：

- 哪个维度需要修
- 问题出现在哪个场景
- 修改目标是什么
- 建议强化哪种结构信号

当前 `RevisionPlan` 后续优先消费：

- 维度级扣分原因
- 场景引用
- 可执行修订信号

而不是只消费笼统分数。

### v1 当前明确不做

本轮不做：

- 新增大型 `Story QC` 子系统
- 引入 Agent Framework
- 改写主生成链路
- 修改 Finalization Gate
- 自动重写剧本
- 引入复杂 ML 模型
- 把行业知识直接写成大量不可治理规则

### v1 当前定位

`Story QC Credibility Improvement v1` 当前已完成第一步实现，但仍然只属于 explainability 增强，不等于专业化 `Script Expert` 已完成。

当前状态应被描述为：

- `StoryQCReport` 已具备结构化基础
- `Story Quality Rubric` 已具备基础骨架
- v1 已先提高报告可解释性与证据关联能力
- 专业化 `Script Expert` 能力仍属于后续持续优化方向

当前研究入口见：

- `Research/06_Script_Knowledge_Framework.md`

## Current API Status

当前对外 API 还没有完全盒子化。

当前公开链路主要仍是：

- `POST /script-generation/generate-draft`
- `POST /script-generation/build-revision-plan`
- `POST /script-generation/revise-draft`
- `POST /master-scripts/finalize`

这意味着：

- 当前已经具备盒子内部步骤的稳定基础
- 但外部调用方仍需要理解 Draft、Revision、Finalize 等内部对象
- Frontend MVP 当前就是一个已验证的步骤 API 编排调用方；这是当前兼容集成，不代表统一 Facade 已实现

当前最小迁移方案：

- 保留现有稳定步骤 API
- 未来新增统一 facade，例如：
  - `ScriptGenerationWorkflowService`
  - `ScriptGenerationFacade`
  - `generate_script()`
- 统一 facade 在内部复用现有步骤 service，而不是重写主链路

### Revision Loop

当前建议流程：

`DraftMasterScript`
→ `Story QC Report`
→ `RevisionDecision`
→ `RevisionStrategy`
→ `RevisionPlan`
→ `RevisionExecutor`
→ Re-QC
→ `AcceptanceDecision`
→ `ScriptRevisionRun`
→ Final `MasterScript`

当前阶段：

- 已提供最小 `Revision Plan` 结构与生成入口
- 当前 `Revision Plan` 基于 `Story QC` Rubric 扣分项与检查项自动整理修订动作
- 当前 `ScriptRevisionService` 负责编排校验、执行、Re-QC 和 shadow Acceptance 生命周期
- 当前 `RuleBasedRevisionExecutor` 采用规则化修订，不绑定真实 LLM
- controlled mode 会消费 `RevisionDecision`、`RevisionStrategy`、scene refs 和 protected dimensions
- 缺少 Decision / Strategy 的旧计划会进入 `legacy_fallback`，保持兼容
- 每次执行生成 `RevisionExecutionTrace`
- 规则化修订只能写回与当前场景已有证据一致的内容，不允许把控制指令、通用评审句或编辑说明泄露到 `DraftMasterScript` / Final `MasterScript`
- Executor 只有在 Draft 内容真实变化时才记录 applied action；没有可靠确定性修改时记录 `no_supported_deterministic_change`
- 当前修订后会自动重新执行一次 `Story QC`
- 先使用 Rubric 和 Benchmark 验证质量变化
- Final `MasterScript` 当前必须只从 `ScriptRevisionRun` Finalize
- 当前 Finalization Gate 会强制检查：
  - 原始 Draft 与 RevisionPlan 对齐
  - Re-QC 已存在
  - Re-QC 分数达到 Policy 阈值
  - `RevisionDecision.revision_required = false` 时允许无内容修订通过受控链路；其他无动作计划仍禁止 Finalize
  - Final `MasterScript` 保存完整 lineage 与版本信息
- 旧的直接 `from-draft` Finalize 入口应视为弃用

## Revision Quality Improvement v1

`Revision Quality Improvement v1` 的目标，是将当前基于 Rubric 的规则化修补逐步演进为：

- 有边界（bounded）
- 可解释（explainable）
- 证据驱动（evidence-driven）
- 面向生产质量阈值的受控剧本打磨

当前已完成数据模型、Planner、受控 `RevisionExecutor`、execution trace、Re-QC 和 Acceptance shadow integration。该闭环已具备运行时完整性，但 Story QC、规则式创意修改和 Policy 阈值尚未经过专业 Ground Truth 校准，因此仍不能描述为 production-quality Revision。现有 API 保持不变；Finalization Gate 仅增加了对显式 `revision_required = false` 的无修订受控路径支持，并未开放直接 Draft Finalize。

### 当前与目标修订流程

当前已实现的 Revision runtime 为：

`DraftMasterScript`
→ `StoryQCReport`
→ `RevisionDecision`
→ `RevisionStrategy`
→ `RevisionPlan`
→ `RevisionExecutor`
→ Re-QC
→ `AcceptanceDecision`
→ `ScriptRevisionRun`

`ScriptRevisionRun` 之后仍由独立 Finalization Gate 决定是否生成 Final `MasterScript`。

职责边界：

- `Story QC` 负责识别问题、给出维度判断、扣分原因、场景引用与证据
- `RevisionDecision` 负责判断本轮是否需要修订，以及选择、延后和保护哪些维度
- `RevisionStrategy` 负责把问题转换成有目标、有边界的修改策略
- `RevisionPlan` 负责将策略整理为当前 `ScriptRevision` 可执行的动作
- `RevisionExecutor` 负责应用受控修改并输出执行 trace，不重新承担质量判断职责
- Re-QC 负责以相同评估契约检查目标维度提升与非目标维度回退
- `AcceptanceDecision` 负责根据 `RevisionPolicy` 观测本次修订是否有效，不直接创建 Final `MasterScript`
- Finalization Gate 继续负责现有 lineage、Re-QC 和最低阈值校验

### Revision Decision Layer

`RevisionDecision` 已由当前 Revision Planner 生成，用于阻止“发现问题就全部修改”。它当前回答：

- 是否需要修订
- 为什么需要或不需要修订
- 本轮优先处理哪些高影响维度
- 哪些问题延后处理
- 哪些已表现良好的维度必须保护
- 修改应聚焦哪些场景

v1 当前每轮最多选择 1 至 2 个维度，优先从以下 5 个 explainability 维度中选择：

- `hook_quality`
- `character_agency`
- `conflict_escalation`
- `emotional_payoff`
- `cliffhanger_strength`

当前 Planner 按高影响维度优先级和 scene-level evidence 选择目标，并保留 selected、deferred、protected dimensions 与 primary scene refs。旧 `StoryQCReport` 缺少 explainability 字段时，继续使用原 Rubric 映射路径。

### Revision Strategy

`RevisionStrategy` 当前已由 Revision Planner 生成，用于表达“为什么改、改什么、如何改、哪些内容不能动”。每条策略关联：

- Story QC dimension
- problem reason
- scene evidence
- revision goal
- expected effect

例如，不应只输出“Improve character agency”，而应说明：主角在 Scene 2 只对事件作出反应；修订目标是在该场景加入一个会产生后果的主动选择；预期改善 `character_agency`，同时保护现有 Hook 和 Cliffhanger。

Revision 应优先修改有限场景和有限维度，不应默认重写整份剧本，也不应为了提高所有指标引入无必要改动。

当前 Planner 会把 Strategy 映射为兼容的 `RevisionPlan.actions`，同时把完整 Decision / Strategy 保留在 `RevisionPlan`。`RuleBasedRevisionExecutor` 已强制 scene-level 修改范围和 protected dimensions，并在无法执行时记录 skipped action；当前限制在于修改本身仍是确定性规则式 patch，而不是专业创意重写。

当前可信度修正还要求：Character Agency 基于可见行动、turning point 与 scene causality 证据判断；Cliffhanger 基于结尾未解决压力与下一集问题判断。不得仅通过向 `purpose` 追加通用句，或向 `emotional_shift` 写入 `suspense` 关键词制造 Re-QC 涨分。

### Bounded Revision Policy

当前推荐默认策略：

- `max_revision_rounds = 1`

`RevisionPolicy` 模型已实现，当前 `revision_acceptance_shadow_policy.v1` 由 Acceptance Evaluator 消费，默认 `max_revision_rounds = 1`。该 Policy 目前只提供观测阈值，不驱动循环，也不阻断 Finalization。未来如需支持多轮修订或 enforcement，必须先通过固定 Benchmark 证明收益、稳定性和停止策略有效。

Revision 的长期目标是达到生产质量标准，而不是无限最大化分数。当前 shadow `RevisionPolicy` 只判断一次修订是否有效，不认证剧本是否已达到专业生产质量。它至少定义：

- `acceptance_threshold`：当前 shadow revision effectiveness 的最低标准
- `minimum_improvement_threshold`：目标维度改善低于该值时视为边际收益不足
- `regression_limit`：非目标或受保护维度允许的最大回退范围
- `max_revision_rounds`：允许执行的最大修订轮数

当前 evaluator 的停止条件包括：

- 没有实际执行动作或缺少可解释 QC / Strategy
- revision round 超过最大修订轮数
- 目标维度改善低于 minimum improvement threshold
- 受保护或非目标维度回退超过允许范围
- 修改场景与计划范围不对齐
- revision effectiveness 低于 acceptance threshold

### Acceptance Decision

`AcceptanceDecision` 不应只判断 `overall_score` 是否上涨。它应综合判断：

- 目标维度是否得到有效改善
- 是否引入新的退化维度
- 受保护维度是否保持稳定
- 实际修改是否与计划场景对齐
- 本次修订是否达到 shadow revision effectiveness threshold
- 是否已经触发停止条件

`RevisionAcceptanceEvaluator v1` 已实现为确定性、无状态评估器。它在 Re-QC 后消费原始/修订 QC、Decision、Strategies、Execution Trace 和版本化 Policy，计算目标维度改善、回退、保护维度稳定性、场景对齐与 revision effectiveness，并把 `AcceptanceDecision` 保存到 `ScriptRevisionRun`。

当前为 shadow mode：

- `accepted = false` 只记录结果和 stop reason，不拒绝修订输出
- `AcceptanceDecision` 不进入当前 Finalization Gate 条件
- 旧 RevisionPlan 不具备 Decision / Strategy 时，`acceptance_decision` 保持为空
- `ScriptRevisionRun.improved` 继续作为兼容的 overall-score 信号；它与 `acceptance_decision` 不等价

### 当前完成与待完成

已完成：

- `RevisionDecision` / `RevisionStrategy` / `RevisionPolicy` / `AcceptanceDecision` 数据模型
- Decision generation
- Strategy generation
- Planner integration
- 最多两个目标维度、scene refs 和 protected dimensions 生成
- 旧 Story QC 报告兼容路径
- `RevisionPlan` 无损保留 Decision / Strategy
- `RevisionExecutor` / `RuleBasedRevisionExecutor`
- scene-level scope 与 protected dimension enforcement
- `RevisionExecutionTrace` 与 legacy fallback
- Re-QC 后确定性 Acceptance evaluation
- `AcceptanceDecision` 保存到 `ScriptRevisionRun` runtime lineage

待完成：

- 人工/策划 Ground Truth 校准
- 固定 Benchmark 上的 Revision Policy 阈值校准
- 跨样本 Revision effectiveness 聚合与报告
- 是否让 Acceptance 影响 Finalization 的独立决策
- 是否弃用旧 `improved` 信号的兼容性决策
- 数据库级 Revision lineage 持久化

### Runtime 成熟度 Checkpoint

- 已实现：QC → Decision → Strategy → Plan → Executor → Re-QC → Acceptance → `ScriptRevisionRun`
- Shadow：Acceptance 计算和记录已运行，但不改变现有业务结果
- 实验性：Story QC 专业可信度、规则式 Revision 创意质量和 Acceptance 阈值
- 生产强制：当前仅 Finalization Gate 继续执行 lineage、Re-QC 存在性与最低阈值校验

### Acceptance Calibration v1

当前已使用 12 个固定、原创、合成样本完成一次离线 shadow Acceptance 校准。校准器复用现有 `RevisionAcceptanceEvaluator`，只比较机器 Decision 与冻结人工 Ground Truth，不进入 Script Generation runtime。

首轮结果为 `review_required`：可复现性和 clear-negative safety 通过，但人工一致率为 `0.667`，低于 `0.80` 目标。

一次性 false-acceptance 安全修正后，受保护维度的任何负向分数移动都会标记为不稳定，普通非目标维度仍保留原 tolerance。固定 12 样本复校准的一致率提升为 `0.750`，false acceptance 从 2 个降为 1 个；Hook 保护问题已解决。

剩余 false acceptance 来自对白自然度和角色声音退化。当前 runtime 没有可靠的结构化证据，因此 Acceptance 不增加文本关键词或主观启发式判断，只在校准报告中把它标记为已知 QC blind spot。两个低于 improvement threshold 的 false rejection 本轮保持不变。

该结论表示 Acceptance 仍应保持 shadow mode。校准不会自动调整 `RevisionPolicy`、60/20/20 公式或 Finalization Gate，也不代表 Revision 已达到专业生产可信度。

### v1 明确边界

当前不包含：

- 多轮或无限 Revision Loop
- 全剧本重新生成
- 多 Agent 或 LangGraph 编排
- 自动知识推理系统
- 修改 `MasterScript` 正式结构
- 修改当前步骤 API
- 修改 Finalization Gate
- 自动追求最高 Story QC 分数

## 与 Orchestrator 的关系

当前 `Orchestrator` 仍然负责组织剧本生成前的约束与资产需求。

Script Engine 消费的不是裸 Prompt，而是：

- `ContentSpec`
- 编排约束
- 检索到的资产
- 检索到的 Prompt 资产
- `GenerationStrategy`

然后先生成 `DraftMasterScript`，再进入 Final `MasterScript`。

## Finalization Gate

当前 Finalization Gate 的职责是：

- 阻止直接创建 Final `MasterScript`
- 阻止绕过 `Story QC` / `RevisionPlan` / Re-QC
- 校验 Finalize 请求中的 Draft Run 与 Revision Run 是否一致
- 根据集中 Finalization Policy 校验最低 Re-QC 分数
- 将 Finalize 请求参数、Prompt 版本、LLM 元信息和 Re-QC 结果写入 `MasterScript.lineage`

当前明确要求：

- 语言不得由 Finalization 层静默默认
- 角色名必须来自显式 Finalize 请求参数
- 场景信息必须来自 `RetrievedAssets` 或显式可追踪来源
- 不允许在 Finalization 层写死角色名或模板对白

## 可借鉴的开源工作流边界

当前 Script Engine 可以优先借鉴以下开源方向：

- `promptfoo` 一类的 Prompt / Benchmark 回归方法
- `Instructor` / `Guardrails` 一类的结构化输出校验模式
- `LangGraph` 一类的状态工作流建模思想
- `Fountain` 一类的剧本导出标准

但当前明确边界是：

- 不允许外部框架绕过 `ContentSpec`
- 不允许外部框架绕过 Prompt Library / Generation Strategy
- 不允许外部框架直接生成不带 lineage 的 Final `MasterScript`
- 不允许为了接入开源工作流而把 Script Engine 改造成通用 Agent Playground

当前详细调研记录见：

- `Research/04_Open_Source_Workflow_References.md`

## Prompt Evaluation 边界

当前 `Prompt Evaluation` 可以调用现有 `ScriptGenerationService` 进行评估，但它属于评估层，不属于新的内容生产链路。

当前后续可扩展方向：

- 记录一次生成使用了哪些 `knowledge_id`
- 记录哪些结构规则进入了 Prompt
- 对比不同文化适配策略是否带来了可观察差异
- 评估行业知识是否真正提升了 Hook、节奏、角色主动性和 cliffhanger 执行度

当前明确要求：

- `Prompt Evaluation` 必须优先复用现有 API 或现有 service
- 不允许复制新的 Prompt Retrieval / Prompt Builder / `LLMAdapter` / `Story QC` 实现
- 不允许把评估工具插入核心业务主链路
- `promptfoo` 当前只能作为外部测试或对比工具，不进入核心业务运行时
- 当前 `StoryQCReport` 结构与 Explainability v1 已实现，但专业评分可信度仍为 placeholder，因此相关分数只能作为实验信号

当前额外边界：

- `Prompt Evaluation` 可以继续直接复用现有步骤 API / service
- 未来即使新增统一 `ScriptGenerationResult` 契约，也不要求立刻删除当前步骤级评估入口
- 当前 `Prompt Evaluation Explainability Integration v1` 已开始消费 `StoryQCReport.dimension_evaluations`
- 当前它可以解释维度级提升、退化、证据和修订信号
- 当前它仍然只属于评估层增强，不会自动改变 Script Engine 的生成决策

## Versioning & Compatibility

当前统一契约应明确：

- `ScriptGenerationRequest` 必须包含 `schema_version`
- `ScriptGenerationResult` 必须包含 `schema_version`
- 兼容性新增字段优先作为 optional
- 不兼容变更应提升 major version
- 内部对象升级不应强迫所有外部调用方立即修改
- API 层可通过 adapter / mapper 支持旧版本迁移
- 版本迁移必须同步文档与测试
