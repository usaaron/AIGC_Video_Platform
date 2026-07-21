# 07 Dynamic Comic Script Practitioner Observation

## Source Classification

```yaml
source_type: practitioner_observation
authority_level: informal
confidence: medium
usage_mode: reference_only
culture_scope: China dynamic comic production practice
source_title: 漫剧剧本怎么写？漫剧基本格式是什么？范例来了！
source_date: 2026-01-20
source_material: user-provided article excerpt
```

## Research Boundary

本文只分析一篇从业者自述文章中可能具有可迁移价值的生产观察。原作者明确说明其格式不是专业剧本标准、示例为临时创作、本人尚未建立爆款或行业验证记录。

因此，本研究不得被解释为：

- 行业标准或专业剧本规范
- 商业成功方法论
- TikTok 或海外竖屏短剧最佳实践
- 已验证的 Prompt、Story QC 或 Script Revision 规则
- AI Comic Content OS 的正式数据模型设计

本文不修改当前 Script Generation 架构、Prompt Builder、Story QC、Scene Causality、数据模型或 Roadmap。所有结论默认停留在 Research。

## Extraction Method

本文将原文观点分为三类：

- A. 可泛化原则：可能跨制作团队、平台和文化成立，但仍需验证
- B. 场景相关经验：可能适用于部分中国动态漫交付流程，不能直接迁移
- C. 不可靠观点：缺少证据、依赖具体市场或被作者本人明确弱化

抽取标准：

- 优先保留与生产可读性、信息通道、可视化表达和叙事功能有关的观察
- 去除固定符号、固定篇幅、固定集数、网文题材外壳和商业转化假设
- 不把“常见”“最好”“至关重要”等主观措辞视为已验证结论
- 不从临时示例剧情推导类型规律

## A. Potentially Generalizable Practices

以下内容具有一定跨场景迁移价值，但只能作为待验证假设。

### A1. Separate Semantic Channels

原文把场景信息、可见动作、对白、画外音、内心独白、字幕、系统音、闪回和快速剪辑分开标记。

可泛化部分不是 `△`、`VO`、`OS` 等具体写法，而是：

> 不同生产语义应有明确通道，避免动作、声音、角色思想和屏幕文字混在同一段不可解析文本中。

潜在价值：

- 提高人类制作人员的阅读速度
- 降低对白与非对白内容混淆
- 支持未来将同一剧本映射到画面、声音、字幕和编辑提示
- 便于检查信息究竟通过什么媒介传达

限制：

- 通道名称和语法依赖制作团队
- 当前 `MasterScript` 不应为适配这篇文章而增加新字段
- 未来是否需要独立 VO / OS / on-screen text 结构，必须由实际 production handoff 验证

### A2. Prefer Observable Visual Description

原文建议画面描述使用可直接理解的环境、动作、行为和神态，避免只写“气势”“想死”等不可直接呈现的抽象状态。

可泛化原则：

> 视觉生产输入应优先描述可观察行为、状态变化和画面证据，而不是只声明角色内部状态。

例如，相比“她感到被背叛”，更具生产可读性的表达是“她摘下戒指，把签好的合同撕成两半，并挡住他的出口”。

与当前系统的关系：

- 可作为未来评估 `character_actions` 可见性的研究假设
- 可辅助判断 Scene Goal / Conflict / Outcome 是否真正落到动作
- 不应演变为“所有情绪必须转换成颜色或特效”的硬规则

### A3. Dialogue Should Have a Dramatic Function

原文提出删除后既不影响剧情、也不影响当前情绪的文字可能属于无效对白。

可泛化原则：

> 每条对白应尽量承担可识别功能，例如推进目标、制造冲突、暴露选择、改变关系、传递必要信息或形成情绪回报。

需要保留的反例边界：

- 自然对白不等于只剩剧情说明
- 停顿、回避、重复和闲谈有时承担潜台词、人物塑造或节奏功能
- “越短越好”不是可靠规则
- 删除测试需要同时检查剧情、情绪、角色声音和表演节奏

### A4. Use Narration and Internal Monologue Intentionally

原文区分 VO 与 OS，并提醒旁白过多可能影响流畅度和代入感。

可泛化原则：

> 旁白与内心独白应有明确的信息功能，不能长期替代可见行动、关系互动或戏剧化选择。

可研究问题：

- 该信息是否无法通过当前画面和对白自然表达
- 旁白是在压缩必要背景，还是重复已经可见的内容
- 内心独白是否揭示了外部行为无法表达的矛盾

当前不能推导：

- VO / OS 的固定数量上限
- TikTok 英文内容必然不适合旁白
- 所有非画面信息都应被删除

### A5. Flashbacks Need Purpose and Compression

原文认为闪回应尽量精简，并对无助于情绪叠加的闪回持谨慎态度。

可泛化原则：

> 非线性插入应改变观众对当前冲突的理解、提高行动代价或产生必要情绪回报，否则可能中断前向推进。

该观察与本项目 Scene Causality A/B 中发现的风险一致：解释过去的场景不一定由当前场景结果触发，可能削弱单集推进。但这只构成研究上的相互印证，不足以形成禁止闪回的规则。

### A6. Montage Should Have a Defined Compression Goal

原文把快速剪辑用于压缩世界观说明或叠加情绪证据。

可泛化原则：

> 蒙太奇或快速剪辑应明确它在压缩什么，以及组合后的信息或情绪是否强于单个镜头。

潜在用途：

- 压缩必须理解的背景规则
- 用多个可见证据建立持续行为模式
- 在有限时长内建立前因或情绪累积

限制：

- 快速剪辑不能成为无因果信息堆积
- 当前 Script Generation 不需要新增 Montage 模型
- 是否适合 TikTok 需要独立可读性和时长验证

### A7. Scene Handoff Benefits from Minimum Context

原文的基础格式为场景提供集数/场号、时间、内外景、地点和出场角色。

可泛化原则：

> 面向制作的场景交付需要足以定位场景、参与者和时空条件的最小上下文。

这与专业 screenplay 格式是否一致是另一个问题。可借鉴的是“减少制作歧义”，不是照搬原文的排版。

## B. Culture- or Workflow-Specific Observations

以下内容应标记为 `culture_specific_observation` 或 `workflow_specific_observation`：

| Observation | Classification | Why It Is Not Generalized |
|---|---|---|
| 使用 `△` 标记画面描述 | workflow_specific_observation | 属于编辑或团队排版习惯，不是稳定语义标准 |
| `AA（BB）：台词` 的固定写法 | workflow_specific_observation | 角色、情绪和对白可以结构化，但语法依赖交付方 |
| 主角必须列在角色表第一位 | workflow_specific_observation | 可能方便阅读，但没有质量或生产效率证据 |
| “系统音”“光幕”“金手指”表达 | culture_specific_observation | 强关联中国网文、系统流和游戏化叙事 |
| 短文字用字幕、长文字用光幕 | workflow_specific_observation | 呈现方式依赖视觉产品、平台和制作模板 |
| 用颜色或华丽特效替代抽象气势 | workflow_specific_observation | 可能帮助部分低成本制作，也可能造成视觉俗套和过度指令 |
| 中国动态漫团队可能不常看小说 | practitioner_observation | 属于作者对特定协作对象的推测，不能推广到行业 |
| 脑洞与情绪的三档组合 | culture_specific_observation | 接近中国网文创作经验，缺少海外短剧验证 |

这些观察如未来进入生产研究，必须重新标注目标团队、地区、内容类型和实际交付约束。

## C. Unreliable or Unsupported Claims

以下内容不应进入 Architecture、Prompt、QC、Benchmark Ground Truth 或系统默认值：

### C1. Fixed Word Counts and Episode Counts

- 每集约 800 字
- 前三集 1000 至 1200 字
- 后期 600 至 700 字
- 约 60 集，或 30 至 40 集、100 集以上

原因：

- 作者没有提供样本、平台、制作成本或完成率数据
- 中文字数不能直接映射英文时长、对白速度或镜头密度
- TikTok 内容长度和海外平台消费机制不同
- 原文自己也说明这些数字并非固定

### C2. Episode 1 / Episode 10 Monetization Gates

原文关于第 1 集、第 10 集和免费十集转化的判断依赖特定平台与付费流程，不能迁移到 TikTok 或海外短剧。

分类：`culture_specific_observation` + `platform_specific_observation`。

### C3. Viral or Commercial Success Formula

原文没有成功样本、对照实验、平台数据或专业评审，因此不能从“脑洞、情绪、快节奏”等概括推出爆款概率。

### C4. Example Story as Evidence

示例由作者临时创作，且作者明确提醒不要参考其剧情与节奏。因此示例只能帮助理解文本通道，不能作为故事结构、世界观、角色或节奏知识。

### C5. Shorter Is Always Better

“精简”可以支持信息密度，但固定追求最短台词可能损害：

- 角色区分度
- 潜台词
- 情绪层次
- 关系节奏
- 自然英文表达

## Cultural and Platform Boundary

本来源来自中国动态漫与网文实践。AI Comic Content OS 当前面向国际短视频、TikTok、英语受众和跨文化内容生产。

不得直接迁移：

- 中国网文系统流、穿越流、修炼和金手指惯例
- 中文对白节奏与网络表达
- 中国动态漫制作公司的排版偏好
- 中文字数与集数假设
- 免费集、付费卡点和本土商业转化假设
- “爽文”“脑洞”作为未经拆解的全局质量概念

可以保留为跨文化研究假设的只有：

- 信息通道需要区分
- 动作描述应具有可视性
- 对白应有明确功能
- 闪回和蒙太奇应有叙事目的
- 生产交付应降低歧义

即使这些原则也必须通过英语剧本、目标平台和实际制作协作验证。

## Candidate Knowledge Observations

以下 ID 只是 Research 引用候选，不是已注册 `ScriptIndustryKnowledge`：

| Candidate ID | Observation | Possible Future Use | Confidence | Status |
|---|---|---|---|---|
| `research.production.semantic_channel_separation.v1` | 动作、对白、旁白、内心、字幕等通道应可区分 | Production handoff research | medium | research_only |
| `research.production.observable_visual_action.v1` | 抽象情绪应尽量有可观察的行为或画面证据 | Script readability evaluation | medium | research_only |
| `research.dialogue.dramatic_function.v1` | 对白应承担剧情、情绪、关系或角色功能 | Dialogue quality research | medium | research_only |
| `research.narration.intentional_modality.v1` | VO / OS 应有必要且明确的表达目的 | Script QC research | low_to_medium | research_only |
| `research.flashback.current_conflict_relevance.v1` | 闪回应改变当前冲突理解或情绪代价 | Pacing and causality research | medium | research_only |
| `research.montage.defined_compression_goal.v1` | 快速剪辑应声明压缩目标并形成组合价值 | Future handoff research | low_to_medium | research_only |
| `research.scene.minimum_handoff_context.v1` | 场景需提供时空、参与者和可执行内容 | Production readability research | medium | research_only |

这些候选在进入 Knowledge Base 前仍需：

- 更高权威来源或多个独立实践来源交叉验证
- 英语及海外短剧适用性检查
- 与当前结构化剧本对象的 gap analysis
- 固定样本的 before / after 评估
- 人类编剧或制作人员评审

## Relationship With Current Script Generation

当前已有结构与文章可泛化观察存在有限概念对应：

- `SceneCard.setting` / `DraftSceneCard.setting_hint` 提供场景位置上下文
- `character_actions` 承载可观察动作
- `DialogueLine.character_name`、`intent`、`text` 区分说话者、功能和台词
- `SceneCausality` 描述 Goal / Conflict / Outcome 和跨场结果
- `emotional_objective`、`turning_point` 与 `cliffhanger` 提供场景功能信息

这不意味着当前模型已经覆盖完整动态漫 production format，也不构成新增字段的理由。

当前明确不做：

- 增加 VO / OS / Subtitle / Montage runtime schema
- 将 `△` 或文章排版做成 formatter
- 把台词长度、旁白数量或闪回数量写入 QC
- 修改 Scene Causality
- 修改 Prompt Builder
- 修改 Story QC 或 Revision
- 实现 Script-to-Production Adapter

## Validation Before Any Adoption

未来若要验证这些观察，应采用小范围 Benchmark，而不是直接实现：

1. Visual Readability：比较抽象情绪描述与可观察行动描述是否降低制作歧义。
2. Dialogue Function：由人类评审删除某条台词后，剧情、情绪、角色声音或节奏是否真正不受影响。
3. Narration Necessity：比较旁白是否提供不可替代信息，还是重复画面。
4. Flashback Utility：检查闪回是否改变当前选择、风险或关系，而不只补背景。
5. Montage Utility：检查组合画面是否实现明确压缩目标并保持可理解性。
6. Cross-Cultural Review：使用英文样本和海外受众/制作人员进行复核。

在这些验证完成前，本文不能成为 Prompt Evaluation 的 expected result，也不能成为 Story QC 扣分依据。

## Conclusion

该文章最有价值的不是它提出的固定格式，而是它暴露了动态漫画从文字到制作交付时的几个实际关注点：语义通道区分、画面可视性、对白功能、非线性内容的目的性和场景交付可读性。

这些内容适合进入 Research backlog，作为未来 production readability 与 script controllability 的验证假设。文章中的固定字数、固定集数、卡点、网文类型经验和爆款判断缺少证据，不能进入当前系统。

Roadmap impact：Research only, no current architecture or priority change.
