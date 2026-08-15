# Longform Script Planning Process Optimization v1

## Status

```yaml
status: research_and_process_design
runtime_integrated: false
schema_changed: false
api_changed: false
prompt_changed: false
benchmark_dataset_changed: false
```

本文把当前生成样本作为长篇规划压力测试，识别可重复出现的系统问题。目标不是修补某一份总纲，也不是用固定编剧公式替代创作，而是建立在生成数十万字正文前可审阅、可验证的规划流程。

## 1. Current Sample As A System Signal

当前样本已经具备以下基础：

- 核心前提、主题、中心冲突和结局方向清楚；
- 主线、人物关系线、身份线、家族权力线和道德代价线可以辨认；
- 根节点覆盖整部故事，语言与合同校验通过；
- 用户可以编辑、保存和批准后继续递归拆分。

但它目前只能证明“模型生成了合法的整部故事摘要”，不能证明“故事足以持续支撑约 60 万字或数百集”。暴露出的结构性问题如下。

### 1.1 Target Length Is Being Mistaken For Story Capacity

项目目标可以要求约 60 万字，但目标字数不是叙事容量证据。当前样本仍由单一死亡真相、单一核心背叛和少量故事线承担全部篇幅，系统尚未验证这些材料能否产生足够多的不重复选择、对抗、揭示、局部回报和状态变化。

以后必须并存两个不同概念：

- `product_target`: 用户希望的规模、更新方式和商业交付目标；
- `content_supported_capacity`: 根据当前人物、世界、冲突和故事引擎得到的有依据容量区间。

系统不得为了满足 `product_target`，直接把规划节点的估算覆盖成目标值。容量不足时应提示：缩短规模、丰富故事材料、增加可独立运转的故事线，或将目标拆成多部/多阶段作品。

### 1.2 Story Bible And Root Node Are Too Similar

当前根节点大量重复 Story Bible 的前提、冲突、情绪和结局。递归树虽然存在，但根节点尚未增加足够的新规划价值。

根节点应完成 Story Bible 没有完成的工作：

- 说明故事依靠什么机制持续产生新剧情；
- 识别由内容自然形成的宏观叙事运动；
- 说明每个运动如何改变权力、认知、关系或目标；
- 暴露容量不足、重复和过早揭底风险；
- 给后续非平衡递归提供不同的拆分依据。

### 1.3 There Is No Explicit Sustainable Story Engine

“调查母亲死亡真相”是目标，不等于可持续的系列故事引擎。故事引擎需要回答：主角每完成一次行动后，什么机制会产生新的目标、阻力、选择和代价？

例如，调查类长篇的引擎可能由以下循环组成，但不能机械重复：

```text
获得可验证线索
→ 形成或修正假设
→ 主动接近一个利益相关者
→ 对手采取新的反制
→ 主角付出关系/身份/法律代价
→ 真相范围扩大并改变下一阶段目标
```

每次循环必须改变故事状态，而不是把“找到线索、线索被毁、继续寻找”重复数百次。

### 1.4 Mystery Information Is Not Yet Governed

样本已经给出最终真相，但没有表达：

- 作者层的完整事实；
- 主角当前相信什么；
- 其他角色分别知道、误解或隐瞒什么；
- 观众当前获得了哪些证据；
- 线索何时出现、如何被误读、何时重新解释；
- 哪次揭示关闭旧问题并打开新问题。

如果把完整 Story Bible 无差别注入每集，模型容易让人物过早知道答案；如果只隐藏答案，又容易靠临时新增事实制造反转。悬疑长篇需要受控的信息切片，而不是单纯“多藏一些信息”。

### 1.5 Opposition Is Reactive Rather Than Generative

当前反派功能主要是灭口、压制和隐瞒。长篇中，对手必须拥有独立目标、资源、计划和适应能力。主角改变策略后，对手也要改变策略，从而产生新的因果链，而不是重复阻止调查。

### 1.6 Subplots Comment On The Main Plot But Do Not Drive It

当前人物关系、身份、家族斗争和道德代价线大多在解释主线主题，尚未明确各自的：

- 独立欲望与冲突；
- 关键决策者；
- 局部阶段目标；
- 对主线造成的不可逆影响；
- 局部回报和最终收束。

支线不应只是“陪主线一起前进”。有效支线需要在关键时刻改变主线可用资源、人物立场、公众认知或解决方案。

### 1.7 Progressive Character Addition Conflicts With A Closed Bible

当前模型以 Story Bible 的 `character_refs` 约束后续节点，能防止模型随意造人，但与“人物在长篇生成中逐渐完善”的产品要求存在张力。

未来不应允许子节点静默创建正式人物。更稳妥的流程是：

```text
StoryPlanNode proposes character
→ character proposal with narrative function and first effective node
→ human review
→ new StoryBible / Character Registry version
→ subsequent nodes may reference the approved character
```

这样既允许人物自然生长，也保留连续性和审计能力。

## 2. External Practice Evidence

这些资料属于专业开发实践和创作研究，不是效果保证，也不是必须照搬的格式。

### 2.1 Screen Australia: Development Documents Test The Idea

Screen Australia 将 Synopsis、Outline、Bible 等视为逐步测试和改进故事的开发工具，而不只是融资材料。其指南明确提醒，概念或故事本身有缺陷时，增加剧本草稿无法补救。

可借鉴部分：在大规模正文生产前设置“内容是否准备好”的规划检查，而不是用正文数量证明概念成立。

来源：

- [Story Documents - Drama](https://www.screenaustralia.gov.au/wp-content/uploads/2025/08/Story-Documents-Drama.pdf)

### 2.2 Series Bible Must Demonstrate Ongoing Potential

同一指南要求持续性系列说明其可持续故事引擎、格式与节奏，并区分宏观和微观故事弧。人物描述需要体现长期挣扎、矛盾与轨迹；单集摘要要说明本集对主要故事线贡献的升级和揭示。

可借鉴部分：Story Bible 不应只回答“结局是什么”，还要回答“中间为什么可以持续产生不同且相关的故事”。

### 2.3 Outline Uses Cause, Escalation, Revelation And Reversal

Screen Australia 将长弧故事的 Outline 视为动机、因果和人物轨迹的展开，并建议用 sequence 组织关键的升级、揭示和逆转。

可借鉴部分：递归节点不是任意等份切割。每个宏观部分至少要通过状态变化证明自己具有独立叙事功能。

### 2.4 Sundance: Separate Series/Season Arcs And Track Character Growth

Sundance Collab 的系列开发课程把系列类型、季弧与全剧弧、人物成长、A/B/C 故事、反派、配角功能和结局方向分开处理。

可借鉴部分：主线、人物线和支线需要分别追踪后再在关键节点交汇，而不是把所有内容压成一段总梗概。

来源：

- [TV Writing: Mapping Your Series](https://collab.sundance.org/catalog/TV-Writing-Mapping-Your-Series/July-2023)
- [TV Writing: Core Elements](https://collab.sundance.org/catalog/TV-Writing-Core-Elements-Self-paced/Copy-of-January)

### 2.5 Chinese Longform Practice: Structure Grows From Material

孙犁关于长篇结构的文章强调，结构不是死板蓝图，而是在人物、环境、矛盾和演进中形成。中国作家网的长篇结构讨论也强调长篇承载人物、事件、时间和思想的总体组织能力。

可借鉴部分：继续保留当前非平衡、可变深度递归树；新增质量门槛不能退化为固定三幕、固定卷数或每个分支相同层级。

来源：

- [孙犁：长篇小说的结构](https://www.chinawriter.com.cn/n1/2022/0512/c404032-32420250.html)
- [长篇小说的结构问题](https://www.chinawriter.com.cn/n1/2021/0407/c404030-32071765.html)

### 2.6 Save the Cat: Use Beats As A Diagnostic Overlay

Blake Snyder 的《Save the Cat!》提供了一套商业编剧节拍语言。对当前系统最有价值的不是把完整 15 节拍和页码比例写死，而是：

- 在递归展开前先识别少量真正改变行动方向的重大转折；
- 用开端状态和结尾状态的可观察对照检查人物与世界是否真的发生转变；
- 检查故事中段是否改变目标、代价、紧迫性或故事线关系，而不是继续重复前半段动作。

这些原则只作为 Story Bible / Root / Macro Movement 的可选诊断视图。它们不修改当前树结构，不规定分支数、递归深度、集数位置或固定比例，也不应在每个节点重复套用完整电影节拍。

来源：

- [Save the Cat! - Michael Wiese Productions](https://mwp.com/product/save-the-cat/)
- [Save the Cat! official method overview](https://savethecat.com/)
- [Cracking the Midpoint](https://savethecat.com/about-the-beats/cracking-the-midpoint-the-false-victory)

## 3. Proposed Minimum Process

```text
Creative Intent / Tags / Character Input
→ ContentSpec
→ Story Concept Resolution
→ StoryBible Draft
→ Longform Readiness Review
→ Human approval
→ Root StoryPlanNode
→ Content-derived Macro Movement Map
→ Human approval of key nodes
→ Variable-depth recursive decomposition
→ Episode-ready Readiness Review
→ EpisodePlan
→ Bounded episode generation
→ Continuity / relationship / storyline / setup-payoff state update
```

这不是新增大型 Engine。v1 优先把以下内容作为现有 Story Bible、Story Plan Node 和审阅流程的规划视图或评估产物；只有离线验证证明收益后，才讨论正式 Schema 与 runtime。

## 4. Planning Views To Validate

### 4.1 Series Engine Profile

回答：什么机制可以持续产生有关联但不重复的新故事？

最小内容：

- recurring dramatic source;
- protagonist repeatable action;
- opposition response pattern;
- changing cost;
- state that must never reset;
- exhaustion condition.

`exhaustion condition` 很重要：当引擎只能重复旧动作时，系统应缩短计划或补充材料，而不是制造 filler。

### 4.2 Longform Capacity Assessment

回答：当前材料实际支持多大规模，依据是什么？

最小观察项：

- 可独立运转的宏观叙事运动；
- 每个运动的主要目标、对抗、局部回报和不可逆变化；
- 主线与支线的有效交叉点；
- 反派策略升级空间；
- 人物关系和身份变化空间；
- 重复风险与过早揭底风险；
- 有依据的容量区间与置信说明。

它不负责精确预测字数，也不能伪装成客观数学分数。

### 4.3 Macro Movement Map

宏观部分不固定叫“卷”“幕”或“阶段”，数量和深度由内容决定。每个部分至少回答：

- dramatic question;
- protagonist strategy;
- opposition strategy;
- major escalation/revelation/reversal;
- irreversible exit state;
- local payoff;
- obligation passed to later nodes.

如果两个相邻部分只有事件名称不同，但策略、代价和退出状态相同，应合并或重新设计。

### 4.4 Narrative Information Map

用于悬疑、秘密身份、误解和反转故事。每个关键信息单元建议区分：

- author truth;
- character knowledge by character;
- audience knowledge;
- evidence already observable;
- current hypothesis;
- concealment or false interpretation;
- planned reveal/reinterpretation;
- downstream consequence.

它是生成上下文的来源，不是第二套剧情事实。Episode Prompt 只接收当前节点允许知道的 bounded slice。

### 4.5 Antagonist Strategy Track

记录对手的独立目标、当前计划、资源、风险、已知信息、反制动作和策略改变。对手必须因主角行动而学习和适应，但不能拥有超出其信息范围的全知能力。

### 4.6 Relationship And Storyline State

人物关系网与故事线树保持分离但互相引用：

- Relationship Graph 记录人物间信任、权力、依赖、秘密和债务的状态；
- Storyline Graph 记录主线/支线的目标、活跃状态、关键节点、收束义务和对其他线的影响。

二者不能合并成一个含义模糊的图，也不能成为与 Story Bible/Continuity 冲突的第二事实源。

### 4.7 Setup / Payoff Ledger

当前自然语言引用应逐步验证为稳定生命周期：

```text
planned → planted → reinforced/reinterpreted → paid_off | intentionally_abandoned
```

每项需要稳定 ID、首次出现节点、当前意义、计划回收节点和实际回收证据。任何延期或放弃必须留原因。

## 5. Human Review Gates

### 5.1 StoryBible Readiness

批准前至少确认：

- 核心前提、主题、中心冲突与结局方向不互相矛盾；
- 系列故事引擎能产生多次状态变化，而不是重复动作；
- 主要人物与对手都有独立目标和可发展的轨迹；
- 主要故事线具有独立功能并会改变主线；
- 目标规模与内容容量没有明显失配。

### 5.2 Root Capacity Gate

根节点批准前至少确认：

- 它增加了宏观运动和容量依据，不只是复述总纲；
- 每个宏观运动有不同策略、代价和退出状态；
- 关键真相不会被过早消耗；
- 后续递归有明确但非固定层级的拆分依据。

### 5.3 Episode-ready Gate

叶节点进入 EpisodePlan 前至少确认：

- 集数范围内存在足够的可区分事件和状态变化；
- 前置状态、后置状态和因果前驱明确；
- 该叶子的揭示、回报和悬念义务清楚；
- 不依赖尚未批准的人物或事实；
- 不把同一冲突改写多次作为容量。

每个 Gate 最多允许一次有边界的重新规划建议；用户可以编辑、缩短范围或退回上层，不建立无限自动循环。

## 6. Knowledge Injection By Stage

不能把全部知识注入每一步。

| Stage | Bounded Knowledge Focus |
|---|---|
| Story Concept / Bible | 类型承诺、系列故事引擎、人物长期轨迹、中心冲突 |
| Root / Macro Movement | 长弧结构、升级/揭示/逆转、支线编织、反派策略、信息设计 |
| Recursive Node | 因果、状态变化、局部回报、前后节点义务 |
| EpisodePlan | 单集责任、Scene G/C/O、Hook、Cliffhanger、连续性切片 |
| Episode Draft | 可视行动、对白、人物声音、情绪执行 |
| QC | 只检索与待评维度和当前证据相关的知识 |

当前大陆 runtime bundle 只足以作为场景和单集基础约束。新增长篇知识资产先停留在 Research，未经固定实验不得进入 runtime bundle。

## 7. Validation Experiment

### 7.1 Variants

- A: 当前 StoryBible → Root → 递归拆分流程；
- B: 同一输入、模型和参数，增加人工可见的 Readiness Review 与有界长篇知识包后再生成 Root/Macro Movement。

### 7.2 Fixed Cases

至少覆盖：

- 调查/复仇悬疑；
- 多人物关系驱动的情感长篇；
- 世界规则驱动的类型长篇。

不直接生成 60 万字来验证规划是否合理。先验证规划，再生成 8-12 集的代表性切片，包括开端、中段压力和后段回收片段。

### 7.3 Human Evaluation

- story engine sustainability;
- macro movement distinctness;
- protagonist and antagonist strategy progression;
- information reveal integrity;
- subplot contribution;
- relationship/character trajectory;
- setup/payoff traceability;
- repetition and filler risk;
- target-capacity honesty;
- plan-to-script alignment.

### 7.4 Entry Rule

只有当 B 在至少 2/3 固定故事中被优先选择、没有明显单集质量回退、重复风险下降且 token/延迟增加可接受时，才进入最小 runtime 设计。模型自评或字段完整率不能单独作为通过证据。

## 8. Explicit Non-goals

- 不固定三幕、卷数、子节点数量或树深；
- 不新增 Agent、RAG、Skill Registry 或第二套 Story QC；
- 不自动生成整棵树并跳过人工批准；
- 不用模型估算替代人类容量判断；
- 不把公开作品剧情作为可复制模板；
- 不自动改写已生成历史内容；
- 不因为目标是中国大陆市场就降低来源真实性与版权边界。

## 9. Recommendation

当前不应立即消耗大量 token 生成完整 60 万字正文。下一步应先在现有流程中验证 Longform Readiness、Macro Movement 和 Narrative Information Map，确认内容容量与递归边界成立，再开展受控的长篇端到端生成。

这不会否定递归树方案。相反，它补上递归树目前缺少的“为什么这样拆、内容是否足够、每个分支承担什么不可替代功能”。
