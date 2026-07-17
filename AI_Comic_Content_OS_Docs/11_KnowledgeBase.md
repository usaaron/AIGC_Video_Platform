# 11_KnowledgeBase

## 定位

当前 `Knowledge Base` 是 `Content Planning Engine` 的中游基础设施。

它的职责不是直接生成剧本，而是沉淀可复用的知识与资产，供后续 `Asset Retrieval`、`Orchestrator`、`MasterScript` 使用。

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

## 当前阶段不实现

当前 `Knowledge Base` 不实现：

- 向量检索
- 图检索
- 自动知识抽取
- 自动知识合并
- 复杂版本管理
- Prompt 自动优化闭环
- Prompt A/B 自动路由

这些能力属于后续阶段。
