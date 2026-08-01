# 11_KnowledgeBase

## 定位

当前 `Knowledge Base` 是 `Content Planning Engine` 的中游基础设施。

它的职责不是直接生成剧本，而是沉淀可复用的知识与资产，供后续 `Asset Retrieval`、`Orchestrator`、`MasterScript` 使用。

当前市场切换状态：

- TikTok Knowledge Items 与两个 Dark Romance Bundle 保留，但随 `overseas_tiktok` 默认关闭
- 中国大陆资料的 market applicability 可以提高，但来源 authority 与 confidence 不会因市场切换自动提高
- 当前中国大陆 runtime 尚未声明正式 Knowledge Bundle，不得把 Research 文档直接注入 Prompt
- 下一批知识资产优先服务长篇结构、人物长期发展、连续性、伏笔回收和漫剧改编可读性

## 长期范围

长期包括：

- 剧情结构库
- Script Industry Knowledge
- 人物库
- 世界观库
- 动作库
- 声音库
- 镜头库
- 场景库
- 风格库
- Platform Knowledge
- Prompt Library

## 当前最小实现

当前阶段先实现统一 `Asset` 模型与 `Prompt Library Foundation`，作为 `Knowledge Base` 的最小基础对象。

原因：

- 先建立统一资产数据契约
- 先保证所有资产都受 Ontology 约束
- 为后续 `Asset Retrieval` 提供标准输入
- 为后续 Prompt Retrieval 提供标准输入

当前同时新增 Script Generation 相关基础模块：

- `Prompt Library`
- `GenerationStrategy`

它们当前先作为知识与生成规则的结构化定义，不直接绑定某个 LLM 厂商。

## 当前 Asset 规则

当前 `Asset` 必须：

- 使用统一 `asset_type`
- 使用受控 `TagRef`
- 使用统一 `content.text + content.payload`
- 支持平台适用范围声明
- 支持后续被 Retrieval Engine 检索

## Prompt Library

`Prompt Library` 属于 `Knowledge Base` 的一部分。

它用于沉淀和管理可复用 Prompt 资产，而不是在业务代码中散落手写 Prompt。

当前支持的 Prompt 类型至少包括：

- Story Planning Prompt
- Character Development Prompt
- Dialogue Generation Prompt
- Hook Generation Prompt
- Cliffhanger Generation Prompt
- TikTok Optimization Prompt
- Story QC Prompt
- Commercial Evaluation Prompt
- Localization Prompt
- Negative Prompt

当前 `Prompt Library` 条目建议字段包括：

- `id`
- `name`
- `prompt_type`
- `target_module`
- `applicable_tags`
- `target_platform`
- `target_audience`
- `version`
- `prompt_template`
- `input_variables`
- `output_schema`
- `evaluation_notes`
- `created_at`
- `updated_at`

当前规则：

- Prompt 必须是结构化资产，而不是一次性文本
- Prompt 必须支持版本管理与追踪
- Prompt 必须可被 `GenerationStrategy` 引用
- Prompt 当前必须可被 `Prompt Retrieval` 以 `GenerationStrategy.prompt_ids` 精确解析
- Prompt 内容应尽量与平台、受众、标签适用范围关联
- 业务代码不允许绕过 `Prompt Library` 随意散落 Prompt
- 当前 `applicable_tags` 必须引用已存在的 `OntologyNode`
- Prompt 当前推荐只保存稳定模板与策略资产，不在业务层散落一次性长 Prompt
- Prompt 输出要求应通过 `output_schema` 与 `Prompt Builder` 的 schema 上下文共同约束

## Script Industry Knowledge

`Script Industry Knowledge` 属于 `Knowledge Base` 的长期组成部分。

它的职责不是替代自由生成，而是把可复用、可评估、可版本化的专业剧作知识沉淀为结构化资产，优先服务于：

- `Prompt Retrieval`
- `Prompt Builder`
- `GenerationStrategy`
- `Story QC`
- `Prompt Evaluation`

当前应优先沉淀的知识类型包括：

- Three-Act Structure
- Beat Sheet
- Scene Goal / Conflict / Outcome
- Hook 设计
- Conflict Escalation
- Turning Point
- Cliffhanger
- Character Agency
- Character Arc
- Story Bible
- Character Bible
- Dialogue Style Guide
- Emotion Curve
- Short-form Pacing
- TikTok Vertical Pacing
- 海外短剧 / Webtoon 叙事经验
- 国内 AI 漫剧工业化经验的抽象方法论

当前推荐字段包括：

- `knowledge_id`
- `knowledge_type`
- `title`
- `description`
- `source_type`
- `source_reference`
- `applicable_platforms`
- `applicable_culture_clusters`
- `applicable_genres`
- `applicable_audiences`
- `constraints`
- `version`
- `status`
- `created_at`
- `updated_at`

当前规则：

- 行业知识必须作为结构化、可版本化资产沉淀
- 行业知识不得直接硬编码到 `Script Engine`
- 行业知识必须通过 `Knowledge Base`、`Prompt Library`、`GenerationStrategy`、Retriever 或等价标准机制进入主链路
- 行业知识应记录适用范围，而不是被当作全局通用真理
- 行业知识优先沉淀“结构规律”和“生产经验”，不直接搬运具体作品内容
- 行业知识不应被直接复制进 Prompt，而应先成为受治理知识条目，再由受控模块决定如何引用

## Script Knowledge Registry

未来建议在 `Knowledge Base` 内建立 `Script Knowledge Registry`。

每条知识建议字段包括：

- `knowledge_id`
- `title`
- `category`
- `description`
- `source`
- `applicability`
- `target_platforms`
- `target_regions`
- `genres`
- `confidence`
- `implementation_status`
- `reference`

当前定位：

- 它是 `ScriptIndustryKnowledge` 的注册层
- 它当前只作为文档和后续数据契约方向
- 它后续应成为 `Story QC`、`Prompt Builder`、`Prompt Evaluation`、`Benchmark` 的统一知识引用来源

## Overseas Adaptation

行业知识不能被视为全球统一模板。

当前任何知识调用都应结合以下约束做适配：

- `PlatformProfile`
- `target_region`
- `target_language`
- `culture_cluster`
- `target_audience`
- `commercial_goal`
- `genre`
- `tone`
- `content_policy`
- `monetization_constraints`

当前原则是：

- 可以借鉴结构方法、节奏经验、工业流程抽象
- 不应照搬特定文化外壳、具体剧情或特定作品表达
- TikTok 出海内容必须优先围绕海外用户、海外平台规则和商业目标重组知识

## Generation Strategy

`GenerationStrategy` 表示一次剧本生成任务采用的完整生成方案。

它不只是 Prompt 集合，还包括：

- 使用哪类 Prompt
- 使用哪个 `LLMAdapter`
- 模型参数
- 生成步骤
- 是否启用多轮生成
- 是否启用 Story QC
- 是否启用自检
- 是否需要人工审核
- 输出格式要求

当前 `GenerationStrategy` 已具备最小基础模块能力：

- 结构化数据模型
- 基础仓储
- 基础 API
- Prompt 引用校验
- 记录 `model_provider`、`model_name`、参数与版本
- 为首次真实剧本生成验证提供可追踪的策略版本

它当前仍不负责复杂多轮策略编排。

## Static Creative Knowledge Bundle v1

当前已实现有界、静态、阶段隔离的 Creative Knowledge 入口，用于 Draft Generation 和 Creative Deepening shadow，不是完整 Knowledge runtime。

当前流程：

```text
GenerationStrategy.draft_knowledge_bundle_id
→ StaticKnowledgeBundleCatalog 精确查找
→ ContentSpec tag / platform 适用性校验
→ bounded KnowledgeBundle
→ Prompt Builder 独立知识段
→ Draft Generation
```

Creative Deepening 使用另一条 exact-ID 路径：

```text
GenerationStrategy.deepening_knowledge_bundle_id
→ target_stage=creative_deepening 校验
→ bounded KnowledgeBundle
→ dedicated Deepening Prompt
→ shadow candidate
```

当前规则：

- bundle 必须由 `GenerationStrategy` 显式声明，生成请求不能注入任意知识文本
- 当前静态 bundle 最多包含 8 个 `knowledge_id`
- runtime 只保留原则、application rules、limitations、anti-patterns 与 source reference 的最小投影
- Prompt Builder 不把知识当作必须照抄的剧情模板，也不允许知识覆盖用户排除项、角色锁定字段、平台或安全约束
- 选择结果通过 `KnowledgeSelectionTrace` 保留 selector、bundle 与 knowledge lineage
- 未声明 bundle 时不生成知识 Prompt section，原路径保持不变
- Draft 与 Deepening bundle 不自动复用，也不能跨阶段误用
- 当前只有 TikTok Dark Romance 的 Draft / Deepening bundle，且随海外模式默认关闭；中国大陆 bundle 尚未通过提取、验证和 runtime promotion
- Deepening knowledge refs 当前只支持候选生成与复现，不自动成为 Story QC 规则

`Research/Knowledge_Items/` 仍是来源完整的知识资产。runtime 不读取或解析 Research Markdown，避免文档格式成为生产依赖。

## Future Knowledge-Guided Generation Compatibility

未来 Script Generation 与 Script-to-Production 生成不应只依赖自由 LLM 即兴。长期概念流程为：

`ContentSpec`
→ Task Decomposition
→ Professional Knowledge Retrieval
→ Creative Constraints
→ `GenerationStrategy`
→ Prompt Builder
→ `LLMAdapter`
→ Structured Output

当前已实现上述静态 exact-ID Draft / Deepening bundle 的最小子集；以下长期流程仍只记录兼容原则，不代表完整 Knowledge Base、RAG、向量检索或 Creative Skill Registry 已实现。

### Creative Brief Input Compatibility

未来 Knowledge Retrieval 可以利用以下已解析输入：

- Final selected `TagRef`
- 解析后的用户创作意图
- 标准化 `ContentSpec`
- `PlatformProfile`
- Excluded tags / patterns 形成的负向过滤条件

检索用途可以包括：

- Story Structure
- Character Design
- Dialogue
- Genre Conventions
- Scene Goal / Conflict / Outcome
- Hook / Payoff / Cliffhanger

边界规则：

- Data Intelligence 的原始 Recommended Tags 不应未经用户确认直接驱动知识检索
- 原始用户 Creative Prompt 可作为经过清洗、带 lineage 的辅助检索上下文，但 resolved intent 与 `ContentSpec` 必须是主要查询约束
- 用户自由 Prompt 不应原样拼接进 Master Prompt，也不能绕过排除项和平台约束
- Excluded tags / patterns 必须作为检索过滤或适用性约束，不能在后续步骤中被重新引入
- 检索结果应记录使用的 resolved tags、Prompt 意图摘要、平台版本和 `knowledge_id`
- Knowledge Retrieval 只能辅助生成，不得覆盖 `PlatformProfile` 硬约束或用户明确排除项

当前不实现上述动态检索。静态 v1 只使用已解析 `ContentSpec` tag / platform 做适用性校验；未来 `CreativeBriefInput → ContentSpec` 的解析结果仍可成为受治理检索输入。

### Knowledge Responsibility Chain

未来知识使用应保持以下分工：

Source Material
→ Structured Knowledge
→ Creative Skill / Task Framework
→ Prompt
→ LLM

- Source Material 提供可审查来源，包括专业书籍、公开行业标准、授权或公版剧本、人工复核作品分析、官方模型文档和内部实验
- Structured Knowledge 回答“什么专业原则或生产规则适用”
- Creative Skill / Task Framework 回答“如何把原则应用到一个有边界的具体任务”；它当前只是 Research 概念
- Prompt 是版本化执行工件，负责向模型表达当前任务约束
- LLM 在约束内生成原创内容，不拥有知识真相，也不替代知识治理

### Expected Professional Knowledge Domains

未来可研究的专业知识域包括：

- Story and Screenwriting：结构、因果、角色目标、冲突、升级、反转、铺垫与回收、情绪回报、悬念和短叙事节奏
- Character and Persona：原创角色身份、动机、恐惧、信念、矛盾、决策模式、压力行为、情绪边界、语言节奏、关系模式和反模式
- Visual Storytelling：景别、角度、运动、构图、调度、空间关系、视觉强调、反应镜头、灯光、颜色、连续性和微表情
- Dialogue and Performance：对白功能、潜台词、角色声音、打断、停顿、克制、语速和言外意图
- Audio and Sound：环境声、音效、沉默、音乐进出、声音转场、节奏支持和对白清晰度
- Generative Model Practice：模型支持的 Prompt 结构、角色一致性锚点、参考素材、动作可见性、时长、镜头限制、漂移防止和失败模式

模型实践知识在必要时必须由 Adapter 限定适用范围。Seedance 专用经验不得进入核心 Script 数据模型。

### Knowledge Source Boundary

未来来源必须区分：

- Professional Narrative Sources：用于抽象人物构造、因果、情绪推进、对白功能、场景结构和主题深度
- Successful Market Content：只用于抽象 Hook 类型、情绪承诺、关系张力、冲突密度、反转机制、节奏、Cliffhanger 功能和受众幻想

目标不是复制或改写具体作品，而是：

```text
Professional narrative foundation
+ abstracted market-proven mechanisms
+ new characters, settings, causality, and expression
= original generated work
```

知识条目必须保留来源、适用范围、版本和引用 lineage。未经许可的全文、具体表达或人物模仿不得作为可直接生成资产。

## 当前阶段不实现

当前 `Knowledge Base` 不实现：

- 向量检索
- 图检索
- 自动知识抽取
- 自动知识合并
- 复杂版本管理
- Prompt 自动优化闭环
- Prompt A/B 自动路由
- 完整 Script Knowledge Registry runtime
- Creative Skill Registry
- RAG execution
- Script-to-Production 知识执行
- Seedance 专用知识注入

这些能力属于后续阶段。
