# Creative Knowledge System v1 - Architecture Research

## Status

```yaml
status: research_only
implementation_approved: false
runtime_integrated: false
schema_changed: false
api_changed: false
roadmap_priority_changed: false
```

本文收口未来 Creative Knowledge、Creative Skill 和 Knowledge Retrieval 的职责。它建立在现有 `Script Knowledge Framework`、`ScriptIndustryKnowledge` 和 Knowledge Base 设计之上，不创建第二套 Knowledge Base，也不批准 Knowledge Runtime、RAG 或 Skill Registry。

相关现有研究：

- `Research/06_Script_Knowledge_Framework.md`
- `Research/11_Creative_Intent_Input_v1_Contract.md`
- `Research/Script_Creation_Knowledge_Research.md`
- `11_KnowledgeBase.md`

## 1. Why Creative Knowledge Is Needed

当前系统能够通过 ContentSpec、Prompt Library 和 LLM 生成结构化剧本，但模型仍主要依赖通用预训练知识和 Prompt 中的局部说明。这个方式存在以下质量上限：

- Prompt 可以要求“强 Hook”，但不能稳定说明什么 Hook 适用于当前类型、角色和平台。
- Scene Causality 可以要求 Goal / Conflict / Outcome，却不能独立提供场景升级、代价和结果设计的专业模式。
- Character Profile 可以描述人物，却不能自动提供经过治理的动机、压力决策和关系变化知识。
- Story QC 可以定位问题，但专业判断仍缺少统一来源、适用范围和版本依据。
- Revision 可以执行受控修改，但缺少“为什么这种改法适用”的专业依据。
- 单纯扩大 Prompt 会导致知识散落、版本不可追踪、适用范围不清和上下游判断不一致。

Creative Knowledge System 的目的不是让知识自动写剧本，而是把可复用的专业创作原则变成：

- 可治理；
- 可版本化；
- 可检索；
- 可引用；
- 可验证；
- 可被 Generation、Story QC 和 Revision 共同复用的知识资产。

### Data, Knowledge, Rules and Prompts

| Concept | Meaning | Example |
|---|---|---|
| Data | 对作品、用户或平台现象的记录 | 某类 Hook 在一组样本中的完成率信号 |
| Knowledge | 带来源、适用范围和限制的专业原则 | 开场矛盾应快速形成具体观看问题 |
| Rule | 某个模块对知识的确定性实现 | Final scene 必须标记 payoff 或 cliffhanger |
| Prompt | 向当前模型表达任务的版本化执行工件 | 要求模型为当前场景生成具体冲突 |
| Creative Skill | 将一组知识应用到有边界任务的方法 | 根据 Scene Goal 诊断 Conflict 是否只是描述 |

Data 不能直接成为普遍知识；Knowledge 不能自动成为硬规则；Prompt 也不应成为知识唯一存储位置。

## 2. Creative Knowledge Taxonomy

v1 建议使用有限、面向 Script Generation 的知识分类。分类是治理维度，不是要求一次实现全部。

### 2.1 Scene Pattern Knowledge

回答：一个场景怎样产生有效变化？

候选内容：

- Goal / Conflict / Outcome
- active obstacle vs descriptive obstacle
- choice, cost and consequence
- scene entry / exit state
- turning point
- causal handoff to the next scene
- removable-scene and filler anti-patterns

它与当前 Scene Causality 最直接对齐，适合成为首个验证域。

### 2.2 Character and Relationship Knowledge

回答：角色为什么以这种方式选择，关系为什么产生持续张力？

候选内容：

- external goal, fear, belief and contradiction
- decision pattern and moral boundary
- active agency
- pressure-driven deviation
- protagonist/opponent differentiation
- directional relationship stance
- trust, power and dependency change

它不能替代 Character Profile。Character Profile 保存角色事实，Character Knowledge 提供设计与评审原则。

### 2.3 Story Structure and Serialization Knowledge

回答：整部故事和多集推进应如何分配责任？

候选内容：

- premise and central conflict
- setup/payoff obligations
- reveal timing
- episode purpose
- escalation across episodes
- character arc and ending direction
- continuity state transitions

Serialized Story Planning 当前未通过 runtime-entry gate，因此该知识域只能继续 Research，不能借知识名义绕过冻结结论。

### 2.4 Conflict and Escalation Knowledge

回答：压力怎样升级而不是重复？

候选内容：

- obstacle escalation
- cost escalation
- power reversal
- public, relational and status consequences
- incompatible goals
- conflict repetition anti-patterns

### 2.5 Emotional Progression and Payoff Knowledge

回答：如何建立情绪期待并交付有因果依据的回报？

候选内容：

- emotional expectation
- pressure and release
- reversal and payoff
- emotional state transition
- earned satisfaction
- melodrama without causal support anti-patterns

### 2.6 Hook, Cliffhanger and Retention Knowledge

回答：如何形成观看动力和下一集问题？

候选内容：

- contradiction, threat, promise and unanswered question
- immediate specificity
- reveal vs unresolved pressure
- earned cliffhanger
- continuation motivation
- fake mystery and attached twist anti-patterns

Retention Knowledge 只能表示叙事机制，不应承诺商业结果或复制平台爆款公式。

### 2.7 Dialogue and Character Voice Knowledge

回答：台词如何同时服务角色、冲突和节奏？

候选内容：

- dialogue intent
- information density
- subtext
- character differentiation
- interruption and pressure
- speakability and subtitle clarity
- exposition, slogan and same-voice anti-patterns

### 2.8 Genre Blueprint Knowledge

回答：不同类型通常承诺什么体验，哪些惯例可调整，哪些反模式应避免？

候选内容：

- genre promise
- expected relationship or conflict dynamics
- compatible emotional progression
- convention, variation and subversion
- genre-specific failure modes

Genre Blueprint 不是固定剧情模板，也不能复制具体作品。

### 2.9 Platform and Culture Knowledge

回答：创作原则在特定平台、地区和语言中如何调整？

候选内容：

- platform pacing and clarity
- duration-sensitive information density
- audience comprehension
- region and culture applicability
- policy and monetization boundaries

平台硬约束继续属于 `PlatformProfile`。Creative Knowledge 只提供创作适配经验，不能覆盖 PlatformProfile。

### 2.10 Visual Narrative Knowledge

回答：故事语义如何保持可见、可演和可生产？

候选内容：

- visible action
- expression cue
- spatial clarity
- visual reveal
- VO / internal thought restraint
- literary abstraction anti-patterns

该知识域只服务剧本可视化，不引入镜头生成、Seedance 参数或 Media Production runtime。

## 3. Knowledge vs Creative Skill

### Creative Knowledge

Creative Knowledge 是声明性的，回答：

> 什么专业原则适用，为什么适用，何时不适用？

它至少应包含 principle、rationale、applicability、limitations、source 和 confidence。它不规定某次任务必须按固定步骤执行，也不直接持有完整 Prompt。

### Creative Skill

Creative Skill 是程序性的任务框架，回答：

> 如何把选定知识应用到一个有边界的创作或评审任务？

未来候选 Skill 可以是：

- Scene Conflict Diagnosis
- Character Decision Consistency Review
- Hook Planning
- Cliffhanger Strengthening
- Dialogue Differentiation Review

一个 Skill 如果未来获批，至少应声明：

- `skill_id` and version
- purpose
- typed input assumptions
- expected output
- bounded application steps
- guardrails
- referenced `knowledge_id` values
- evaluation criteria
- implementation status

### Prompt and LLM Boundary

```text
Creative Knowledge
→ Creative Skill / Bounded Task Framework
→ Prompt Builder
→ LLMAdapter
```

- Knowledge 是受治理来源。
- Skill 是应用方法。
- Prompt 是当前任务的执行表达。
- LLM 是可替换执行器，不是知识真相来源。

当前不建立 Creative Skill Registry。只有当某个任务无法通过现有 GenerationStrategy、Story QC、RevisionStrategy 和 Prompt Library 清晰表达，并且有固定验证证据时，才考虑正式 Skill contract。

## 4. Proposed Creative Knowledge Object

以下只是文档级候选，不是 Pydantic 或数据库 Schema。

### 4.1 Minimum Fields

| Field | Purpose |
|---|---|
| `schema_version` | Knowledge contract version |
| `knowledge_id` | Stable identifier such as `scene.outcome.state_change.v1` |
| `version` | Item version independent from schema version |
| `title` | Human-readable title |
| `category` | Controlled taxonomy category |
| `principle` | Concise professional principle |
| `rationale` | Why the principle matters |
| `applicability` | Platforms, regions, languages, genres, audiences, story stages and QC dimensions |
| `limitations` | When it should not be applied or should be adapted |
| `examples` | Short abstract positive examples, not copied works |
| `anti_patterns` | Observable failure patterns |
| `source_refs` | Traceable sources and evidence classification |
| `confidence` | Confidence in the knowledge claim |
| `validation_status` | research / candidate / validated / rejected / deprecated |
| `implementation_status` | research_only / retrieval_candidate / consumed / retired |
| `related_knowledge_ids` | Related or prerequisite knowledge |
| `conflicting_knowledge_ids` | Known tension requiring selection or adaptation |
| `validation_refs` | Benchmark or experiment evidence |

### 4.2 Source Reference

Each source reference should distinguish:

- `source_type`: professional_reference, platform_guidance, practitioner_observation, internal_experiment or market_observation;
- `reference`;
- `authority_level`;
- `usage_mode`;
- `license_or_usage_note`;
- `reviewed_at`.

Low-authority practitioner observations may support Research but cannot independently promote an item to validated status.

### 4.3 Example Candidate

```json
{
  "schema_version": "creative_knowledge.v1",
  "knowledge_id": "scene.outcome.state_change.v1",
  "version": "v1",
  "title": "Scene Outcome Changes Story State",
  "category": "scene_pattern",
  "principle": "A scene outcome should materially change information, power, commitment, risk or available choices.",
  "rationale": "A changed state gives the next scene a causal reason to exist and reduces filler.",
  "applicability": {
    "platforms": ["platform_independent"],
    "genres": ["all_with_exceptions"],
    "story_stages": ["episode_generation", "story_qc", "revision"],
    "dimensions": ["scene_causality", "conflict_escalation"]
  },
  "limitations": [
    "Atmospheric or intentionally static scenes may require a subtler emotional or informational state change."
  ],
  "examples": [
    "The protagonist fails to obtain evidence but publicly commits to an accusation, increasing future risk."
  ],
  "anti_patterns": [
    "The scene ends with the same goal, information and available choices with which it began."
  ],
  "source_refs": [],
  "confidence": "candidate",
  "validation_status": "candidate",
  "implementation_status": "research_only",
  "related_knowledge_ids": ["scene.causality.handoff.v1"],
  "conflicting_knowledge_ids": [],
  "validation_refs": ["scene_causality_real_ab_v1"]
}
```

The empty `source_refs` means this candidate cannot yet be promoted beyond Research without source review. Internal A/B evidence validates system behavior, not the universal truth of the principle.

## 5. Knowledge Retrieval Context

Future Knowledge Retrieval should depend on five required context groups:

1. **User Tags**: only final resolved and accepted tags, not unaccepted recommendations.
2. **Platform**: `PlatformProfile` ID/version plus region, language and hard constraints.
3. **Genre**: resolved primary and secondary Genre references.
4. **Story Goal**: normalized goal or premise summary, not raw untrusted Prompt alone.
5. **Character Design**: confirmed Character Profile / relationship references or concise approved summaries.

Additional filters may include excluded tags, target audience, culture cluster, story stage and requested task. These five groups should not receive equal authority:

- Platform and exclusions act as hard applicability filters.
- Genre limits convention and anti-pattern relevance.
- User tags and story goal rank creative relevance.
- Character design selects character, relationship, dialogue and decision knowledge.

### 5.1 Conceptual Retrieval Query

```text
Resolved User TagRefs
+ PlatformProfile ID / Version / Region / Language
+ Genre Refs
+ Normalized Story Goal
+ Confirmed Character / Relationship Context
+ Excluded Tags / Patterns
+ Requested Task
→ Knowledge Retrieval Query
```

The raw Creative Prompt and raw Trending Tags should not independently drive retrieval. They must first pass Creative Intent Resolution and user confirmation.

### 5.2 Retrieval Stages

1. Filter inactive, incompatible, excluded, unlicensed or low-authority items.
2. Apply platform, region, language and genre applicability.
3. Rank against user tags, story goal, character design and requested task.
4. Detect conflicting knowledge and require an explicit strategy decision.
5. Return a bounded Knowledge Bundle rather than all matching items.
6. Record query inputs, selected `knowledge_id` versions, rejection reasons and consuming task.

Retrieval must not dump long knowledge text directly into Prompt. A bounded Skill or existing task component should translate selected principles into current constraints.

## 6. Future Integration Flow

### 6.1 Generation

```text
Creative Intent Resolution
→ ContentSpec + Confirmed Character Context
→ Knowledge Retrieval
→ Bounded Knowledge Bundle
→ Existing GenerationStrategy / Future Creative Skill
→ Prompt Builder
→ LLMAdapter
→ DraftMasterScript
```

If Story Blueprint is later independently approved, it can consume the same ContentSpec, Character Context and relevant Knowledge Bundle. This document does not approve that runtime.

### 6.2 Story QC and Revision

```text
DraftMasterScript + ContentSpec Context
→ QC-task Knowledge Retrieval
→ Story QC evidence + knowledge_refs
→ RevisionStrategy with inherited knowledge_refs
→ Controlled Revision
```

Generation and QC may use the same `knowledge_id`, but they have different tasks. QC identifies observable violations; Revision applies bounded change. Neither should silently reinterpret user intent.

### 6.3 Lineage

Future lineage should preserve:

- retrieval query context version;
- selected and rejected `knowledge_id` versions;
- consuming module or Skill;
- Prompt / GenerationStrategy version;
- output artifact IDs;
- validation or evaluation result.

This lineage enables later Prompt Evaluation to ask whether using a knowledge item improved output, without claiming automatic learning.

## 7. Relationship With Existing Architecture

| Component | Responsibility | Non-overlap boundary |
|---|---|---|
| ContentSpec | Defines normalized user intent plus production, commercial and platform requirements | Does not store professional writing methods or full source material |
| Story Blueprint | Defines whole-story direction, ending direction, arcs and setup/payoff obligations | Does not write episode scenes; currently Research-only |
| Character Profile | Defines who characters are and which facts or boundaries are confirmed | Does not prescribe every decision or store general character-writing theory |
| Creative Knowledge | Defines applicable professional storytelling principles and limitations | Does not execute tasks or generate scripts |
| Creative Skill | Defines how selected knowledge is applied to one bounded task | Does not own knowledge truth, user intent or orchestration architecture |
| Script Generation | Creates the episode script from approved inputs and strategy | Does not silently rewrite ContentSpec or Character facts |
| Story QC | Evaluates observable quality using evidence and applicable knowledge | Does not generate the original script or replace Finalization |
| Revision | Applies controlled improvements from QC and Strategy | Does not invent new user intent or character identity |

The architecture remains modular boxes. Creative Knowledge and Creative Skill are capability concepts, not Agents.

## 8. Initial Knowledge Priority

### Option A - Story Structure First

- Expected impact: high for serialization, setup/payoff and whole-story coherence.
- Current risk: high. Serialized Story Planning has positive evidence but failed the strict Hook / Cliffhanger runtime gate.
- Timing: defer until the planning concept has a new bounded validation proposal.

### Option B - Character Knowledge First

- Expected impact: high for decision credibility, dialogue differentiation and continuity.
- Current risk: medium-high. Character Decision Logic A/B has not started, and confirmed Character Input has no runtime contract.
- Timing: second candidate after bounded character validation.

### Option C - Scene Pattern First

- Expected impact: medium-high and directly observable in current Drafts.
- Current risk: lowest. Scene Causality is implemented, validated and already provides evidence fields.
- Validation fit: strong. Goal / Conflict / Outcome, state change, causal handoff and filler can be checked with fixed samples.
- Timing: recommended first Creative Knowledge candidate domain if implementation is later approved.

### Option D - Platform Knowledge First

- Expected impact: medium for pacing, clarity and retention fit.
- Current risk: medium because platform observations are volatile and easily confused with hard rules.
- Existing coverage: PlatformProfile already owns hard constraints and basic recommendations.
- Timing: fourth; use as an adaptation overlay, not the foundation of story quality.

### Recommended Order

```text
1. Scene Pattern Knowledge
2. Character and Relationship Knowledge
3. Story Structure / Serialization Knowledge
4. Platform and Culture Adaptation Knowledge
```

This order optimizes for verifiability and current architectural readiness, not theoretical importance.

## 9. Validation Before Implementation

Before any Knowledge runtime is approved:

1. Select 3 to 5 candidate Scene Pattern items with reviewed sources.
2. Freeze item versions, applicability and anti-patterns.
3. Build fixed positive, negative and exception fixtures.
4. Verify retrieval precision from user tags, platform, genre, story goal and character context.
5. Compare current generation against one bounded knowledge-guided variant.
6. Check quality gain, rigidity, token cost, latency and new regressions.
7. Confirm QC and Revision can cite the same knowledge without responsibility overlap.

Do not implement a broad Registry before one knowledge category proves measurable value.

## 10. Non-Goals

Creative Knowledge System v1 Research does not include:

- production models or database tables;
- Knowledge Retrieval service;
- RAG or vector database;
- Creative Skill Registry;
- Agent or multi-agent orchestration;
- automatic source ingestion or automatic truth promotion;
- Prompt auto-generation or self-modification;
- Story Planning runtime;
- Character Decision runtime;
- platform trend crawling;
- Media Production or Seedance knowledge injection.

## 11. Recommendation

Creative Knowledge is needed to raise the quality ceiling and make Generation, Story QC and Revision share a professional, traceable basis. However, it should remain a governed view of existing `ScriptIndustryKnowledge`, not a new subsystem.

If implementation is later approved, start with a tiny Scene Pattern candidate set and prove retrieval relevance plus measurable quality impact. Do not begin with a full Knowledge Base, all story theories, or a Creative Skill marketplace.
