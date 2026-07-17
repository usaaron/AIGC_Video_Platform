# 14_Script_Engine

Script Engine 的当前唯一目标是稳定产出高质量、结构化、可复用的 Final `MasterScript`。

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
→ `CreativeBrief`
→ Asset Retrieval
→ Prompt Retrieval
→ Prompt Builder
→ `LLMAdapter`
→ `DraftMasterScript`
→ Story QC
→ `RevisionPlan`
→ `Script Revision`
→ Re-QC
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
- `RevisionPlan`
- `RevisedDraftMasterScript`
- Re-QC Report
- Final `MasterScript`

## 当前阶段设计规则

- 不允许把生成逻辑绑定到某一个具体模型
- 不允许把 Prompt 散落在业务代码中
- Prompt 必须来自 `Prompt Library` 或 `Prompt Builder`
- `MasterScript` 必须是结构化输出，而不是不可控长文本
- Story QC 当前允许仅保留接口或轻量占位
- 当前所有设计优先服务于剧本质量，而不是视频生成便利性

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

- 输入 `ContentSpec + GenerationStrategy`
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

当前边界：

- 仅验证主链路 Draft 阶段可联调
- Final `MasterScript` 当前通过独立 Finalization Mapper 从 `DraftMasterScript` 生成
- `MockLLMAdapter` 当前继续保留给测试与无外部模型环境
- `RealLLMAdapter` 当前仅用于首次真实剧本生成验证

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

当前在 Script Engine / Export 设计中预留 `BilingualScriptView` 概念。

它的输入应是正式英文 `MasterScript`，输出是供开发者审阅的中英双语工件。

当前推荐字段包括：

- `source_master_script_id`
- `source_language`
- `developer_language`
- `translation_provider`
- `translation_model`
- `translation_version`
- `generated_at`
- `scenes`
- `dialogue_pairs`
- `action_translation`
- `scene_summary_translation`
- `translator_notes`
- `unresolved_terms`

当前明确边界：

- `BilingualScriptView` 不是新的生产主链路节点
- 它不能替代正式 `MasterScript`
- 每条对白必须同时保留原文和开发者语言译文
- 场景标题、场景目的、节拍摘要、情绪目标、动作、转折点、cliffhanger、下一集问题可以做开发者译注
- 当前只做数据模型与导出边界预留，不在本轮新增完整翻译引擎

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

当前阶段可仅保留接口和轻量 placeholder。

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

当前未来理想输出除 `score` 外，还应逐步支持：

- `Structural Evaluation`
- `Explainability`
- `knowledge_id` 引用
- 适用范围说明

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
→ `Revision Plan`
→ `Script Revision`
→ Re-QC
→ Final `MasterScript`

当前阶段：

- 已提供最小 `Revision Plan` 结构与生成入口
- 当前 `Revision Plan` 基于 `Story QC` Rubric 扣分项与检查项自动整理修订动作
- 当前已提供占位 `Script Revision Service`
- 当前 `Script Revision Service` 采用规则化修订，不绑定真实 LLM
- 规则化修订只能写回内容描述，不允许把控制指令、提示语或编辑说明泄露到 `DraftMasterScript` / Final `MasterScript`
- 当前修订后会自动重新执行一次 `Story QC`
- 先使用 Rubric 和 Benchmark 验证质量变化
- Final `MasterScript` 当前必须只从 `ScriptRevisionRun` Finalize
- 当前 Finalization Gate 会强制检查：
  - 原始 Draft 与 RevisionPlan 对齐
  - Re-QC 已存在
  - Re-QC 分数达到 Policy 阈值
  - Final `MasterScript` 保存完整 lineage 与版本信息
- 旧的直接 `from-draft` Finalize 入口应视为弃用

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
- 当前 `Story QC` 仍为 placeholder，因此评估报告中的 `Story QC` 分数只能作为实验信号

当前额外边界：

- `Prompt Evaluation` 可以继续直接复用现有步骤 API / service
- 未来即使新增统一 `ScriptGenerationResult` 契约，也不要求立刻删除当前步骤级评估入口

## Versioning & Compatibility

当前统一契约应明确：

- `ScriptGenerationRequest` 必须包含 `schema_version`
- `ScriptGenerationResult` 必须包含 `schema_version`
- 兼容性新增字段优先作为 optional
- 不兼容变更应提升 major version
- 内部对象升级不应强迫所有外部调用方立即修改
- API 层可通过 adapter / mapper 支持旧版本迁移
- 版本迁移必须同步文档与测试
