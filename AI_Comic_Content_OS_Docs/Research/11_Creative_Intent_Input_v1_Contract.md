# Creative Intent Input v1 - Research and Contract Design

## Status

```yaml
status: phase_1_implemented_full_contract_research
implementation_approved: phase_1_only
runtime_integrated: phase_1_minimal
schema_changed: true
api_changed: true
roadmap_priority_changed: false
```

本文最初定义未来创作输入层的最小边界。当前 Phase 1 已实现 `CreativeIntentInput`、`CharacterContext`、`ResolvedCreativeContext`、确定性 Resolution API 和 optional Draft Prompt 注入。本文其余 recommendation、Relationship、AI expansion、alias / unresolved tag 与完整 authoring lineage 仍是 Research，不创建第二套 Creative Brief、Tag 或 Ontology 系统。

## 1. Motivation and Current Problem

当前 `ContentSpec` 能稳定表达受众目标、商业目标、平台目标、故事目标、受控标签和紧凑 `CreativeBrief`。但它主要是标准化运行时规范，不是完整的用户创作表单。

当前缺口包括：

- 用户不能完整区分自由创意、结构化选择、明确排除和系统推荐。
- Data Intelligence 推荐信号与用户真实意图之间缺少确定性确认边界。
- 当前 `CharacterProfile` 只有 `name`、`role`、`description`、`motivation`，主要由 LLM 从剧情需要自由推断。
- 用户无法声明哪些角色字段必须保留，哪些字段允许 AI 补全。
- 人物关系是多角色之间的方向性状态，不适合压缩为单个角色描述或普通标签。
- 生成结果缺少从用户原始意图到最终 `ContentSpec` 和角色上下文的 authoring lineage。

这些缺口容易造成角色成为剧情工具、决策不一致、对白声音相似，以及未来跨集连续性弱。它们不能通过继续扩大 Master Prompt 可靠解决。

## 2. Design Principles

1. `Creative Intent` 回答用户想创作什么，`ContentSpec` 继续回答系统实际要生产什么。
2. 自由 Prompt 是输入证据，不是可以绕过解析直接进入 Master Prompt 的最高权限文本。
3. 结构化且明确锁定的用户选择优先于模糊自由文本。
4. Platform / Safety Hard Constraints 永远高于用户偏好和趋势建议。
5. Trending Tags 是时效性推荐，不等于 User Intent，也不进入稳定 Ontology 的定义本体。
6. 角色输入允许不完整，但 AI 只能补全明确允许扩展的空缺，不能静默重写锁定字段。
7. 角色心理字段是可审查设定，不是隐藏 Chain of Thought。
8. Relationship 应是独立的方向性对象，而不是塞入 Character description。
9. 所有重要冲突、舍弃和 AI 补全都必须可追踪。
10. v1 只定义 authoring contract，不新增 Engine、Agent、RAG、API 或运行时步骤。

## 3. Recommended Architecture

### 3.1 Authoring Flow

```text
Data Intelligence Recommendations / Trend Signals
+ User Free Creative Prompt
+ User Structured Tags
+ User Exclusions
+ User Character and Relationship Inputs
+ Platform and Safety Constraints
→ Creative Intent Resolution
→ Normalized ContentSpec
+ Referenced Character Context
+ Resolution Trace
→ Existing Script Generation
```

如果未来 Serialized Story Planning 通过独立 runtime-entry validation，完整方向可以演进为：

```text
Creative Intent
→ ContentSpec + Character Context
→ Story Blueprint
→ Episode Plan
→ Character Decision Context
→ Existing Episode Script Generation
```

Story Planning 当前仍被冻结为 Research Evidence，因此它不是 Creative Intent v1 的实现依赖，也不能因为本文而进入运行时。

### 3.2 Compatibility With Existing CreativeBriefInput

不建议新增一个与 `CreativeBriefInput` 平行的正式模型。未来最小实现应优先让现有 authoring contract 兼容以下逻辑区域：

- `free_creative_prompt`
- `audience_intent`
- `content_intent`
- `tag_selections`
- `trend_recommendations`
- `exclusions`
- `character_inputs`
- `relationship_inputs`
- `generation_constraints`
- `authoring_control`
- `request_metadata`

字段名称仅为研究建议。是否扩展、重命名或拆分现有 `CreativeBriefInput`，必须在实现阶段经过 Data Model 和 API compatibility review。

## 4. Creative Intent Input v1 Proposed Contract

### 4.1 Top-Level Contract

| Field | Purpose | Boundary |
|---|---|---|
| `schema_version` | authoring contract 版本 | 必须版本化，不复用 ContentSpec schema version |
| `free_creative_prompt` | 用户难以用标签表达的故事方向、氛围和创意组合 | 不原样直通 Master Prompt |
| `audience_intent` | 用户明确想服务的受众节点 | 不写入固定商业规模或效果承诺 |
| `content_intent` | Genre、Theme、Story Element、Emotion 等结构化意图 | 必须解析到统一 Ontology 或保持 unresolved |
| `tag_selections` | selected、added、excluded 的用户操作 | 用户选择和推荐来源必须分开保存 |
| `trend_recommendations` | Data Intelligence 提供的带时效建议 | 默认 `suggest_only`，未经接受不进入 ContentSpec |
| `exclusions` | 禁止标签、trope、关系模式和表达方式 | 独立约束层，不用负向字符串污染普通 tags |
| `character_inputs` | 用户角色设定和 AI 可补全边界 | 不等于已批准 Character runtime schema |
| `relationship_inputs` | 角色之间的方向性关系状态 | 独立于 Character Profile 和普通标签 |
| `generation_constraints` | 语言、平台、时长、场景数、内容分级 | 不能放宽 Platform / Safety hard constraints |
| `authoring_control` | 字段锁定、AI 补全许可和确认状态 | 防止 AI 静默改写用户设定 |
| `request_metadata` | 请求来源和追踪信息 | 不作为创作语义的垃圾桶 |

### 4.2 Free Creative Prompt

自由文本适合表达：

- 多种元素之间的关系，例如“黑暗浪漫中的复仇必须由吸血鬼身份秘密触发”。
- 用户期望的情绪体验和避免模板化的要求。
- 无法被现有 Ontology 精确表达的新创意。

它不适合直接决定：

- 平台、安全和内容分级硬约束。
- 已有结构化字段的值。
- 被用户明确排除的标签或模式。
- 已锁定角色身份、关系和行为边界。

解析器未来应从自由文本提取候选约束和 unresolved intent，展示映射结果。重大语义冲突必须请求用户确认，而不是依赖 LLM 猜测。

### 4.3 Audience Intent

Audience 使用可扩展 Ontology，不固定具体商业数据。候选层次包括：

- life stage：Teen、Young Adult、Adult；
- demographic intent：例如 Female 18-34，但必须遵守适用地区和合规边界；
- affinity：Romance Audience、Horror Audience、Fantasy Audience；
- viewing intent：快节奏反转、情绪陪伴、悬疑解谜等。

平台不是 Audience。TikTok、YouTube Shorts、Bilibili 属于 Platform Profile；“Netflix-style”更适合作为可解释风格参考或内容定位，不应伪装为平台受众事实。

### 4.4 Content Intent Categories

以下概念必须分开解析：

| Dimension | Question | Examples | Existing Ontology compatibility |
|---|---|---|---|
| Genre | 作品采用什么叙事类型？ | Romance, Horror, Mystery | `Genre` |
| Theme | 作品探讨什么命题？ | redemption, trust, cost of power | `Theme` |
| Story Element | 故事中包含什么可组合机制或对象？ | vampire, time travel, hidden identity | 优先解析到 `World`、`Character`、`Conflict`、`Twist` 等现有分类；暂不新增一级分类 |
| Emotion | 希望观众主要体验什么？ | fear, hope, anger, suspense | `Emotion` |
| Relationship Dynamic | 角色之间以什么张力互动？ | enemies-to-lovers, distrust, power imbalance | `Relationship` |
| Conflict Mechanism | 什么机制持续制造阻力？ | betrayal, survival, forbidden alliance | `Conflict` |
| Hook / Ending Function | 开头和结尾承担什么观看功能？ | contradiction hook, unresolved threat | `Hook`、`Cliffhanger`、`Twist` |

“Revenge”可能同时是情绪承诺、主题或冲突机制。Resolution 必须根据用户句义和用途选择分类，不能仅靠词面把同一概念复制到多个类别。

### 4.5 Trending Tags

Trending Tag 是 Data Intelligence 的推荐包装，不是新的 Ontology Node 类型。建议的研究性信息包括：

- `tag_id`
- `source_refs`
- `confidence`
- `recommendation_reason`
- `popularity_signal`
- `observed_at`
- `valid_until`
- `target_platforms`
- `target_regions`

`popularity_signal` 是特定时间、平台和地区下的观测值，不应写入稳定 Ontology 定义。即使趋势置信度很高，也不能覆盖用户排除项、锁定角色设定或 Platform constraints。

### 4.6 Constraint and Avoid Layer

排除输入应作为独立约束层：

- `excluded_tag_ids`：明确禁止的受控 Ontology 节点；
- `excluded_patterns`：无法由单个节点表达的 trope、结局、关系或表现方式；
- `content_boundaries`：暴力、性、恐怖强度等用户收紧项；
- `ending_constraints`：例如避免悲剧结局；
- `character_boundaries`：不能被 AI 改写的角色行为或关系底线。

用户可以收紧平台限制，但不能放宽平台或安全硬约束。

## 5. Precedence and Conflict Resolution

建议的确定性优先级为：

1. Platform / Safety Hard Constraints
2. User Exclusions and Content Boundaries
3. Explicit Structured Constraints and Locked Character Fields
4. Explicit Free-Prompt Constraints
5. User Selected / Added Tags
6. Accepted Data Intelligence Recommendations
7. Unaccepted Trending Recommendations
8. Traceable System Defaults

补充规则：

- 同一概念同时 selected 和 excluded 时，不生成结果，返回 `requires_user_resolution`。
- 结构化字段和自由 Prompt 对同一明确属性冲突时，以结构化字段作为候选权威，但重大语义冲突仍需用户确认。
- 推荐标签默认不能进入 resolved intent，除非用户接受或请求显式开启 recommendation fallback。
- AI 生成标签只能作为生成后分析标注，不得被倒写为原始 User Intent。
- 冲突处理必须输出 warning、选择结果和原因。

## 6. Character Profile v1 Proposed Authoring Contract

### 6.1 Purpose

Character Profile 回答“这个角色是谁”，而不是替代 Story Blueprint、Scene Causality 或 Character Decision Logic。用户可以只提供部分字段；AI 可以提出补全建议，但必须遵守字段级控制。

### 6.2 Candidate Structure

| Area | Candidate fields | Purpose |
|---|---|---|
| Identity | `character_ref`, `name`, `gender`, `age_or_range`, `species`, `occupation`, `role` | 稳定身份和故事职责 |
| Appearance | `hairstyle`, `physical_features`, `clothing_style`, `visual_identity` | 为未来 Character Asset consistency 提供输入，不包含镜头或模型 Prompt |
| External Personality | `public_traits`, `social_mask`, `speech_tendency` | 别人能观察到的性格和表达倾向 |
| Internal Psychology | `desire`, `fear`, `belief`, `contradiction` | 提供可审查的行为驱动力，不记录隐藏推理 |
| Background | `summary`, `important_events`, `current_situation` | 只保留影响当前选择和关系的信息 |
| Goals | `external_goal`, `internal_need` | 区分想取得的外部状态与需要发生的内部成长 |
| Behavior Boundary | `moral_boundaries`, `decision_pattern` | 声明通常不会做什么，以及压力下的选择倾向 |
| Relationships | `relationship_refs` | 引用独立 Relationship Object |
| Authoring Control | `locked_fields`, `ai_expandable_fields`, `confirmation_status` | 防止 AI 自由重写用户设定 |
| Provenance | `field_sources` | 区分 user_provided、ai_suggested、system_default |

### 6.3 User Authority and AI Expansion

- `locked_fields` 不允许 AI 修改、删除或用同义改写改变语义。
- AI 只能补全 `ai_expandable_fields` 中尚未提供的内容。
- AI 补全必须标记 `ai_suggested`，不能冒充用户输入。
- 与现有字段冲突的补全进入 suggestion / warning，不直接覆盖。
- 纯视觉字段未来可以服务 Asset / Production，但不应为了视频模型污染故事逻辑。
- `decision_pattern` 是倾向，不是绝对行为公式；违反倾向必须由可见压力、代价和后果支持。
- `moral_boundaries` 可以是自利或有条件的，不应强制角色道德正确。

这些字段与 `Research/10_Character_Decision_Logic_v1_Review.md` 的六字段实验候选兼容，但本文不批准该实验进入 runtime。

## 7. Relationship Object Recommendation

Relationship 建议未来作为独立对象，原因是：

- 一个角色可以与多个角色建立不同关系；
- A 对 B 的信任和 B 对 A 的信任可能不对称；
- 关系会随剧情状态变化，而 Character identity 相对稳定；
- 相同的 `Relationship` Ontology tag 不能表达具体双方和当前状态。

最小研究字段：

- `relationship_ref`
- `from_character_ref`
- `to_character_ref`
- `relationship_tag_ids`
- `public_relationship`
- `private_stance`
- `relationship_goal`
- `conflict_basis`
- `current_state`
- `locked_fields`
- `field_sources`

Relationship Object 保存故事语义，不保存每场对白、隐藏 Chain of Thought 或完整关系时间线。跨集关系状态属于未来 Story Planning / Continuity 研究，不在 v1 实现。

## 8. Tag Ontology and Signal Separation

不建议采用一个同时承担 Ontology、用户选择和趋势热度的单体 `Tag`：

```json
{
  "tag": "vampire",
  "category": "story_element",
  "source": "system",
  "popularity": 0.87
}
```

这里混合了稳定概念、使用来源和短期观测，难以版本化。推荐分为三层：

### Stable OntologyNode

- 定义稳定 `id`、label、category、description、aliases 和 active status。
- 不保存特定请求是否选中，也不保存短期 popularity。

### Intent Tag Association

- `tag_id`
- `intent_role`: selected / added / excluded / recommended / generated
- `source`: user / data_intelligence / system / post_generation_analysis
- `confidence`
- `reason`
- `source_refs`
- `status`: accepted / rejected / deferred / unresolved

### Trend Recommendation Signal

- `tag_id`
- `popularity_signal`
- `observed_at`
- `valid_until`
- `platform_scope`
- `region_scope`
- `evidence_refs`

来源不等于优先级。`source=data_intelligence` 且高 confidence 的标签仍然只是建议；`source=user` 的 generated annotation 也不能自动变成锁定创作要求。

## 9. Architecture Responsibility Boundaries

| Component | Question answered | Must not do |
|---|---|---|
| Creative Intent | What does the user want to create? | 不承担平台执行规范或详细剧本生成 |
| ContentSpec | What normalized content, commercial and platform requirements must be produced? | 不永久承载完整角色 Bible、关系时间线或原始 Prompt |
| Story Blueprint | What whole-story direction should be followed? | 不写场景、对白和镜头；当前 runtime 未批准 |
| Character Profile | Who are the characters? | 不决定每场具体行为 |
| Character Decision Logic | Why does this character choose under pressure? | 不成为隐藏推理、Agent 或固定行为公式；当前 runtime 未批准 |
| Script Generation | How is this episode written? | 不重新解释或覆盖用户锁定输入 |
| Story QC | What observable quality problems exist? | 不重写用户意图或替代 Resolution |
| Revision | What bounded execution problem should be fixed? | 不发明新的角色身份和关系事实 |

### ContentSpec Mapping Boundary

未来 Resolution 推荐产生两类输出：

1. 标准化 `ContentSpec`，承载 audience、platform、commercial、story goal、resolved tags 和 compact creative brief。
2. 带稳定引用的 Character / Relationship authoring context，供未来请求 mapper 或资产检索使用。

详细角色设定不应全部塞进 `ContentSpec.metadata`。如果验证证明 Script Generation 必须消费它，应先决定正式引用位置和版本兼容策略，而不是把任意字典变成长期契约。

## 10. Traceability Requirements

未来 authoring lineage 至少应保留：

- 原始 free creative prompt；
- recommended、trending、selected、added、excluded 和 generated tags 的区别；
- Ontology alias / unresolved 解析结果；
- 原始和 resolved generation constraints；
- 用户提供、锁定和允许 AI 补全的角色字段；
- AI suggestions、用户接受/拒绝结果；
- Relationship 输入和解析结果；
- conflict warnings 与用户确认；
- 最终 `ContentSpec` 引用；
- 如果未来批准，Character context 和 Story Blueprint 引用。

这些记录用于复现和评估创作选择，不代表本轮要实现数据库持久化。

## 11. Future Validation Experiments

实现前应优先完成固定样本验证：

1. **Resolution determinism**：同一输入重复解析得到相同 tags、constraints 和 warnings。
2. **Conflict safety**：selected/excluded、自由 Prompt/锁定字段冲突不会被静默吞掉。
3. **Recommendation isolation**：未接受的 Trending Tag 不进入最终 `ContentSpec`。
4. **Character lock preservation**：生成结果不改写锁定身份、目标和 moral boundary。
5. **Controllability A/B**：比较当前 ContentSpec 输入与 resolved Creative Intent 输入的意图执行率、意外元素率和人工偏好。
6. **Character quality A/B**：只有在现有 Character Decision Logic 有界实验获批时，验证决策可信度、角色区分度和节奏回退。
7. **Cost monitoring**：记录 Prompt token、延迟和 Schema failure，避免角色上下文造成不可控膨胀。

Benchmark 不应把某一种具体故事创意设为唯一正确答案，而应验证意图遵守、冲突处理、锁定字段保持和生成质量回退。

## 12. Non-Goals

Creative Intent Input v1 当前不包含：

- Pydantic / database schema；
- API 或前端；
- Creative Brief Resolver runtime；
- Prompt Builder 或 Generation Service 集成；
- Character Decision Logic runtime；
- Story Planning runtime；
- RAG、Knowledge Retrieval 或 Creative Skill Registry；
- 自动采用 Trending Tags；
- 自动创建未知 OntologyNode；
- Character Agent 或多 Agent 编排；
- Image / Video / Seedance 参数。

## 13. Recommendation

Creative Intent Input 已完成最小 Phase 1 runtime。后续仍应按以下有界顺序扩展，不能把完整 Research 一次性实现：

```text
Fixed authoring fixtures
→ Deterministic resolution and conflict tests
→ Controllability A/B
→ Minimal model/API proposal
→ Runtime integration decision
```

在进入实现前，应先证明它比当前 ContentSpec-only 输入更可控，并且不会削弱 Scene Causality、Hook、Cliffhanger 或输出稳定性。

## 14. Bounded Generation Compatibility Simulation

### 14.1 Scope

2026-07-21 使用三个固定模拟输入完成一次非 A/B、非正式 Benchmark 的真实模型兼容性检查：

- Dark Romance Revenge
- Supernatural Romance
- Sci-Fi Mystery

每案只生成一个三场景 Draft，使用当前 Prompt Builder、Scene Causality contract 和现有 Draft Generation Service。Creative Intent 没有接入 runtime；实验先把输入透明、有损地映射为现有 `ContentSpec`、`TagRef` 和 `CreativeBrief.generation_notes`。

Artifacts：

- `examples/creative_intent_simulation_v1/manifest.json`
- `examples/creative_intent_simulation_v1/compatibility_report.json`
- `examples/creative_intent_simulation_v1/compatibility_report.md`

### 14.2 Result

观察结论为 `compatible_with_lossy_mapping`：

- 三次生成全部成功并通过当前结构化 Draft schema。
- Genre、核心 premise、情绪方向、角色姓名、desire、fear 和 belief 在三案中均有明显执行证据。
- Contradiction 在能够转化为当场冲突时表现较好。
- Scene Causality 在三案中保持有效。
- Character appearance 主要进入描述，没有明显改变剧情行为。
- Moral boundary 被保留或复述，但没有被有代价的选择真正检验。
- Relationship 只能由模型从 story goal / generation notes 推断，不能保留方向性、authoring authority 或状态。
- User lock、字段 provenance 和 AI expansion boundary 无法由当前 runtime 强制执行。

Supernatural 样本暴露了角色职责缺失：用户只定义 Lucian，没有声明其 protagonist / counterpart role，也没有提供另一名敌人的完整 Profile；模型因此创建 The Hunter 并把她设为主角。Sci-Fi 样本则把 AI system 自动提升为会说话的 antagonist，说明未来输入需要区分 person、creature 和 system entity。

### 14.3 Mapping Findings

| Input | Current path | Finding |
|---|---|---|
| Free Prompt | `ContentSpec.story_goal` | 能进入 Prompt，但没有确定性 intent parsing |
| Audience / Genre / Theme / Element / Emotion | `TagRef` / CreativeBrief | 可表达，但多个节点只存在于实验 Ontology fixture |
| Character | `generation_notes` | 文本可见但类型、权重、锁定和 provenance 丢失 |
| Relationship | `story_goal` / `generation_notes` | 只能推断，不能作为独立方向性状态 |
| Constraints | PlatformGoal / request fields / notes | 平台、时长、语言、场景数可表达；rating / avoid 仍有缺口 |
| Trend Recommendation | 无 | 本次未测试，`TagRef` 也不足以表达时效和接受状态 |

当前意图被同时写入 story goal、tags、hook 和 generation notes。该重复有助于模型执行，但也造成 Prompt 权重不透明；由于本次不是 A/B，不能证明某一个输入通道单独产生了效果。

### 14.4 Implications

本次没有发现需要立即改变架构的证据，反而支持本文既有边界：

1. 先验证确定性 Creative Intent Resolution，再讨论 runtime integration。
2. Character 需要字段级 provenance、lock 和 AI-expandable 规则，不能长期依赖 generation notes。
3. Principal character role 必须明确；不完整输入应产生 warning 或确认请求。
4. Relationship 应独立建模，并区分方向性和当前状态。
5. 非人实体需要明确 entity type，避免模型自行决定其角色权限。
6. Moral boundary 的后续验证应关注压力下选择，而不是关键词是否出现。
7. 未来必须通过有界 controllability A/B 才能决定是否进入 Schema、API 或 Prompt Builder。

当前 Story QC 仍是 placeholder。Sci-Fi 样本存在多次可见调查选择，却得到 `character_agency=2.5`，说明当前 QC 分数不能作为 Creative Intent 执行质量的最终证据。

## 15. Creative Control Combined v1 Offline A/B

### 15.1 Scope And Isolation

2026-07-21 完成一次有界真实模型 A/B，用于检验额外结构化创作上下文是否能改善当前 Scene Causality 初稿。三个固定案例分别为 Dark Romance Revenge、Supernatural Romance 和 Sci-Fi Mystery；每个案例生成一个三场景 baseline 和一个 structured creative control 版本，共六次成功生成。

两组共享同一个 `ContentSpec`、模型、参数、TikTok PlatformProfile、语言、时长、场景数、GenerationStrategy、Prompt Library、Scene Causality contract 和 Draft schema。候选组只通过 evaluation-only Prompt Builder 子类追加冻结的 Creative Intent、两名主要角色档案和 Relationship Context；生产 Prompt Builder 与 runtime 未修改。

Artifacts：

- `examples/prompt_evaluations/creative_control_combined_v1/experiment_config.json`
- `examples/prompt_evaluations/creative_control_combined_v1/deterministic_checks.json`
- `examples/prompt_evaluations/creative_control_combined_v1/blind_review/blind_review_locked.json`
- `examples/prompt_evaluations/creative_control_combined_v1/comparison_report.json`
- `examples/prompt_evaluations/creative_control_combined_v1/comparison_report.md`

### 15.2 Result

预注册阈值全部通过，观察结论为 `validated_for_runtime_design`：

- Structured Creative Control 在 3/3 案例中获得盲评偏好。
- 角色一致性平均提升 `+1.167 / 5`，角色主动性平均提升 `+0.5 / 5`。
- Conflict Quality 平均提升 `+0.667`，Emotional Progression 与 Scene Causality 均提升 `+0.5`。
- Hook 平均持平，Cliffhanger 平均提升 `+0.167`，没有单案达到预设的明显回退线。
- 六个 Draft 全部通过 schema、三场景、语言、Scene Causality chain 和 final cliffhanger 确定性检查。
- Structured 版本完整保留了三案指定的主要角色名。
- 平均 prompt token 从 `5262.0` 增至 `5756.667`，增长 `9.401%`，低于预注册 `15%` 上限。
- 平均 total token 从 `7219.0` 增至 `8065.667`；平均延迟从 `46.238s` 增至 `54.721s`。

提升的主要证据不是 Profile 被复述，而是角色信息转化为行为：Mara 验证 metadata 后只接受解密钥匙而不恢复信任；Rhea 主动设计分离测试，并以 Lucian 的克制修正自己的信念；Lena 依据 evidence-first 决策模式把隐瞒预测提交 human oversight，同时 AURORA 保持“保护人类但限制信息”的矛盾逻辑。

### 15.3 Architecture Implication

本次结果支持进入最小 runtime contract design，但不等于批准直接实现现有实验注入方式。下一步设计应保持以下边界：

1. Creative Intent、Character Profile 与 Relationship Context 需要正式、版本化、可追踪的输入契约，不能长期依赖任意 Prompt JSON 或 `generation_notes`。
2. Resolution 仍应先处理 user lock、excluded tags、角色职责、非人 entity type 和语义冲突，再交给 Script Generation。
3. ContentSpec 继续作为标准化 runtime requirements contract；详细 Character / Relationship authoring context 应通过稳定引用或请求映射进入生成盒子，而不是污染 `ContentSpec.metadata`。
4. Scene Causality 保持现状。实验显示新增上下文可以改善角色驱动的因果关系，无需改动其 schema。
5. Runtime 实现前仍需单独评估 contract compatibility、旧请求 fallback、lineage、prompt size budget 和字段锁定执行。

### 15.4 Limitations

- 每个组合只成功生成一次，不是稳定性或重复运行研究。
- 评审为 mapping-concealed AI-assisted review，不是专业编剧验证；评审者参与过 fixture 设计，已在 provenance 中明确记录这一偏差风险。
- 三案及结构上下文均为 synthetic fixtures，不能证明跨 genre 或用户自由输入的泛化能力。
- Dark Romance 与 Supernatural 两组候选共享高度相似的剧情机制，不能证明 creative variety 提升。
- 当前 Story QC 仍是 placeholder，本次决策没有把其分数作为质量权威。
- 结果只验证“额外结构化上下文有价值”，不验证某个具体 schema、API 或 Prompt 注入格式已经成熟。

因此，Research 状态从“等待 controllability A/B”更新为“允许进入最小 runtime contract design”；生产实现、API、schema 和路线图优先级仍需独立决策。
