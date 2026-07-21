# Script Creation Knowledge Research

## Purpose

本文件分析用户提供的五类外部写作材料摘要，提取可能改善 AI Comic Content OS Script Generation 质量的可复用知识原则。

当前边界：

- 本文件属于 Research，不是 Architecture 或 Implementation Specification
- 除 Source 1 的用户提供文章正文外，其余来源仅有摘要，未检查原始材料
- 所有结论默认是待验证假设，不是行业标准、Prompt 指令或 Story QC 规则
- 当前优先级仍是改善 Script Generation 质量，不扩展 Knowledge Runtime、RAG、Skill Registry 或 Agent

## 1. Source Classification

### Shared Usage Boundary

```yaml
usage_mode: reference_only
runtime_authority: none
prompt_authority: none
qc_authority: none
benchmark_ground_truth_authority: none
```

| Source | source_type | authority_level | confidence | Cultural / Platform Scope | Evidence Limitation |
|---|---|---|---|---|---|
| Dynamic Comic Script Format Practice | `practitioner_observation` | `informal` | `medium` | Chinese dynamic comic production | Full user-provided article, but author explicitly disclaims professional or commercial validation |
| Volcano Engine Script Format Reference | `vendor_format_reference_summary` | `vendor_specific_unverified` | `low_to_medium` | One vendor's production parsing context | Only a user-provided summary was reviewed; vendor source and current requirements were not verified |
| Professional Screenplay Formatting Reference | `educational_reference_summary` | `general_convention_unverified` | `medium` | Traditional screenplay education | No named source or edition; only broad conventions were provided |
| Web Novel Brain-Hole / Retention Techniques | `practitioner_observation_summary` | `informal` | `low_to_medium` | Chinese web-fiction practice | No dataset, platform experiment or original source was provided |
| Character and Antagonist Design Principles | `practitioner_analysis_summary` | `informal` | `medium` | Web-fiction character analysis | Concepts are plausible but no source, sample set or validation method was provided |

### Interpretation Rule

Confidence describes whether an observation is coherent enough to research, not whether it is proven effective. A `medium` item still cannot enter generation, QC or revision until validated against fixed scripts and target-market review.

## 2. Extracted Transferable Principles

### 2.1 Script Is Both Narrative and Production Communication

Sources 1 to 3 converge on a useful distinction: a script must communicate story meaning while also making scene execution understandable.

Potentially transferable principle:

> A structured script should make clear what changes in the story, what can be observed, who acts or speaks, and through which information channel the audience receives it.

This does not require adopting Chinese dynamic comic symbols, a vendor parser or strict film formatting.

### 2.2 Semantic Channels Should Be Distinguishable

Potential channels include:

- Scene context
- Visible action
- Spoken dialogue
- Voice-over
- Internal monologue
- On-screen text
- Flashback or montage intent

The reusable idea is channel separation, not a fixed syntax such as `△`, `VO` or `OS`.

Potential value:

- Reduces ambiguity for human review
- Makes dialogue and non-dialogue information distinguishable
- Supports future model-independent production handoff
- Allows evaluation of exposition modality

### 2.3 Visual Description Should Prefer Observable Evidence

Sources 1 and 3 support describing visible actions rather than relying only on abstract emotion or intent.

Potentially transferable principle:

> Important internal states should normally have observable dramatic evidence when the format depends on visual storytelling.

This does not mean every emotion requires a color, effect or camera instruction. Visual evidence can be a choice, refusal, physical action, changed relationship, prop interaction or altered scene state.

### 2.4 Scene Semantics Should Be Separated from Formatting

Sources 2 and 3 identify useful scene context such as scene number, location, time, interior/exterior, characters, action and dialogue.

Potentially transferable principle:

> Stable scene semantics should remain independent from any vendor-specific text layout.

The current `SceneCausality` already represents Goal / Conflict / Outcome. Formatting references do not justify replacing or duplicating it.

### 2.5 Hooks Establish Immediate Dramatic Pressure

Source 4 suggests that openings should quickly create conflict, emotional tension or an unanswered question.

Transferable core:

- The audience should understand why the current situation matters
- The opening should create a reason to continue
- The protagonist's immediate problem should become legible quickly

Rejected interpretation:

- A universal fixed number of seconds, words or lines
- A Chinese-platform retention formula
- Shock without story consequence

### 2.6 Escalation Requires State Change, Not Repetition

The proposed pressure → expectation → reversal → payoff pattern is useful only as a descriptive lens.

More general principle:

> Conflict escalation should increase cost, narrow options, change power or force a consequential decision.

Repeating a louder version of the same confrontation is not necessarily escalation. This principle is compatible with Scene Goal / Conflict / Outcome but is not yet a new rule.

### 2.7 Strong Premises Generate Obstacles from Goals

Source 4 distinguishes a static trait from a dramatic premise. “A character is powerful” does not itself create action; a goal that collides with another force does.

Potentially transferable principle:

> Character goals should produce obstacles, tradeoffs or relationship pressure that can sustain scene-level causality.

### 2.8 Cliffhangers Should Create Continuation Motivation

A useful cliffhanger does more than withhold arbitrary information. It can introduce:

- A new threat caused by prior action
- An unresolved consequential choice
- A reversal of apparent victory
- A question whose answer changes the relationship or goal

This remains a research hypothesis. It should not become a fixed ending template.

### 2.9 Characters Need Causal Motivation and Decision Logic

Source 5 offers a useful distinction between labels and behavioral logic.

Potentially transferable character dimensions:

- Desire: what the character seeks
- Fear: what outcome the character avoids
- Belief: what the character thinks is true or justified
- Contradiction: where values, behavior or needs conflict
- Decision pattern: how the character tends to choose under pressure

These dimensions may improve consistency, but adding them to a schema is not automatically beneficial. Their value must be tested against the current `motivation` and `description` fields first.

### 2.10 Antagonists Benefit from an Independent Worldview

The transferable idea is not a villain template. It is:

> An antagonist should have a coherent objective and worldview capable of producing understandable choices, even when those choices are harmful.

The protagonist-antagonist mirror concept may help test thematic contrast: similar starting conditions or goals can lead to different choices. It should remain optional and genre-dependent.

## 3. Future Knowledge Base Candidate Categories

To avoid category inflation, the five sources can be consolidated into six candidate domains.

| Candidate Category | Scope | Source Support | Possible Consumers | Status |
|---|---|---|---|---|
| `Visual Narrative Knowledge` | Observable action, expression evidence, visual information channels, scene readability | Sources 1, 2, 3 | Future generation evaluation, production handoff research | research_only |
| `Scene Construction Knowledge` | Scene context, Goal / Conflict / Outcome, state change, scene purpose | Sources 2, 3, 4 | Script Generation, Story QC, Revision | research_only |
| `Retention Mechanics Knowledge` | Hook, escalation, payoff, continuation motivation | Source 4 | Script Generation, Prompt Evaluation, Story QC | research_only |
| `Character Motivation Knowledge` | Desire, fear, belief, contradiction, pressure decisions | Source 5 | Character planning, consistency evaluation, Revision | research_only |
| `Relationship and Opposition Knowledge` | Protagonist-antagonist worldview, mirror relation, conflicting choices | Source 5 | Story planning, conflict evaluation | research_only |
| `Narrative Channel Knowledge` | Dialogue, VO, internal monologue, on-screen text, flashback, montage functions | Sources 1, 3 | Script readability research, future handoff mapping | research_only |

### Category Boundary Notes

- `Screenwriting Knowledge` is an umbrella research label, not necessarily a separate runtime category
- `Script Structure Knowledge` can contain Scene Construction and episodic structure without duplicating Visual Narrative Knowledge
- `Character Persona Knowledge` should remain focused on original fictional behavior, not real-person imitation
- `Retention Mechanics Knowledge` must be platform-scoped before use
- Production parsing knowledge should remain provider-neutral

## 4. Possible Future Knowledge Interaction

The supplied direction can be interpreted as:

```text
Governed Knowledge
↓
Bounded Creative Task / Skill Concept
↓
Prompt Builder
↓
LLM Generation
```

This is a conceptual responsibility chain, not a proposal for a new Skill Registry.

### Governed Knowledge

Answers:

- What principle may apply?
- What is its evidence and confidence?
- Which genre, platform, region and task does it fit?
- What counterexamples or exclusions exist?

### Bounded Creative Task / Skill Concept

Answers:

- How should one limited task apply the selected knowledge?
- What input and output does the task require?
- What should remain unchanged?

Examples may include scene planning, character consistency review or dialogue-function review. They remain Research concepts unless current components cannot represent the behavior cleanly.

### Prompt Builder

Should receive already selected, applicable and versioned constraints. It should not become the location where raw articles or ungoverned practitioner advice are pasted.

### LLM Generation

Executes the bounded task. It does not decide which source is authoritative and does not convert low-confidence observations into system truth.

### Cross-Component Reuse

If a knowledge item is eventually validated, the same `knowledge_id` could support:

- Generation: guide a bounded creative requirement
- Story QC: explain which principle was evaluated
- Revision: justify a targeted strategy
- Prompt Evaluation: compare whether a variant expresses the intended principle
- Benchmark: identify the expected capability without embedding prompt wording

No such integration is implemented by this document.

## 5. Current FinalMasterScript Gap Review

This section reports possible semantic gaps only. It does not recommend immediate schema changes.

### 5.1 Character Semantics

Current character representation includes name, role, description and motivation.

Possible gaps:

| Candidate Field | Potential Value | Current Overlap | Recommendation |
|---|---|---|---|
| `desire` | Makes the pursued outcome explicit | Often expressible in `motivation` | Validate before separating |
| `fear` | Explains avoidance and pressure behavior | Can appear in `description` / `motivation` | Candidate only |
| `belief` | Supports worldview and antagonist coherence | Not explicitly structured | Higher-value candidate for consistency experiments |
| `contradiction` | Supports internal conflict and non-flat behavior | Can be written in description | Candidate only |
| `decision_pattern` | Supports predictable but testable behavior under pressure | Not explicitly structured | Candidate for multi-scene consistency testing |

Risks of adding all fields now:

- Duplicate prose across fields
- Artificially rigid characters
- Increased Prompt length without quality gain
- Schema compliance mistaken for character depth

### 5.2 Scene Semantics

Current scenes already include purpose, setting, beat summary, emotional shift, emotional objective, actions, turning point, cliffhanger and Scene Goal / Conflict / Outcome.

Therefore Goal / Conflict / Outcome are not current schema gaps.

Possible remaining gaps:

| Gap | Why It May Matter | Likely Location |
|---|---|---|
| Focal character reference | Clarifies whose goal drives the scene | Stable story semantic candidate |
| Structured before/after emotional state | Makes emotional transition testable | Validate against current `emotional_shift` first |
| Action ownership | Identifies which character performs each action | Possible scene semantic or handoff concern |
| Scene entry/exit state | Supports continuity between scenes | Likely future continuity / series planning concern |
| Information channel | Distinguishes dialogue, VO, OS and on-screen text | Only if downstream production demonstrates need |
| Time-of-day and INT/EXT | Reduces production ambiguity | More likely Production Handoff than core story logic |

### 5.3 Production Semantics

Potential production gaps include:

- Visual consistency anchors
- Character appearance state
- Prop and wardrobe continuity
- Expression cues
- Spatial continuity
- Action visibility and feasibility

These fields should not automatically be added to `FinalMasterScript`. Most are better candidates for a future provider-neutral Production Handoff derived from stable story semantics.

Boundary:

```text
FinalMasterScript: what happens, why it happens, and what the audience must understand

Production Handoff: how stable story semantics are prepared for visual execution
```

### 5.4 Episodic and Series Semantics

The current `FinalMasterScript` represents one episode. It does not by itself define a complete series arc, episode order, long-term character progression or cross-episode continuity.

This is a planning-level gap, but it should not be solved by expanding every episode's `FinalMasterScript` with an entire series bible. A future series planning artifact should reference episode-level scripts while preserving `ContentSpec` and Script Generation boundaries.

## 6. Rejected Concepts

The following must not be adopted from the supplied references:

- Chinese dynamic comic symbols as mandatory syntax
- Vendor-specific parsing fields as the core architecture
- Strict film formatting as a substitute for story quality
- Fixed opening seconds, chapter length, episode count or update frequency
- Feilu, Fanqie, Jinjiang or other Chinese platform optimization rules
- Pressure / expectation / reversal / payoff as a universal formula
- A single cliffhanger template
- Villain archetype templates or fixed antagonist formulas
- Copying famous characters, plots, dialogue or worldview
- Chinese dialogue rhythm as an English-writing standard
- Directly pasting reference materials into Prompt Builder
- Treating schema-field completion as proof of script quality
- Adding every possible character or production field to `FinalMasterScript`
- Building Knowledge Runtime, RAG, vector storage, Skill Registry or Agents before validation

## 7. Possible Future Validation Experiments

All experiments should use fixed `ContentSpec`, model settings and evaluation artifacts. No experiment should modify Benchmark Ground Truth to fit its result.

### Experiment 1: Observable Action Clarity

Compare abstract emotional action descriptions with observable behavior descriptions.

Review:

- Human production comprehension
- Action ownership clarity
- Whether emotion remains understandable
- Whether prose becomes over-directed

### Experiment 2: Character Decision Consistency

Compare current character profiles against profiles that explicitly state belief and decision pattern.

Review:

- Cross-scene choice consistency
- Character agency
- Unexpected rigidity
- Prompt and completion token cost

### Experiment 3: Antagonist Worldview Coherence

Compare a generic antagonist motivation with a bounded worldview / goal conflict description.

Review:

- Whether antagonist actions remain causally understandable
- Whether conflict becomes less arbitrary
- Whether the protagonist-antagonist relationship gains thematic contrast
- Whether the result becomes expository

### Experiment 4: Retention Mechanism Separation

Evaluate Hook, Conflict Escalation, Payoff and Cliffhanger independently rather than as one retention score.

Review:

- Which dimension actually improves
- Whether one gain damages another
- Whether cliffhangers are caused by prior scenes
- Whether endings merely add unrelated information

### Experiment 5: Narrative Channel Necessity

Compare the same scene information delivered through action, dialogue, VO or internal monologue.

Review:

- Comprehension
- Emotional immediacy
- Redundancy
- Performance and production readability

### Experiment 6: Provider-Neutral Production Readability

Give the same structured scene to multiple human or adapter-oriented review contexts without adopting any vendor syntax.

Review:

- Missing stable semantics
- Vendor-specific assumptions
- Which details belong in `FinalMasterScript`
- Which details belong in Production Handoff

### Experiment 7: Series Planning Separation

On a small fixed multi-episode story, compare independent episode generation with generation guided by a compact series plan.

Review:

- Character continuity
- Cross-episode causality
- Setup and payoff tracking
- Whether episode scripts remain independently editable

This experiment should occur only after the current single-episode generation quality checkpoint is stable.

## 8. Research Conclusions

The most promising candidate knowledge domains are:

- Visual Narrative Knowledge
- Scene Construction Knowledge
- Retention Mechanics Knowledge
- Character Motivation Knowledge
- Relationship and Opposition Knowledge
- Narrative Channel Knowledge

The highest-potential current gap is not screenplay formatting. It is richer but bounded character decision logic combined with observable, causally meaningful scene action.

Before any implementation, the project should validate whether explicit belief / decision-pattern context improves fixed script outputs without causing rigidity or token inflation.

Roadmap impact: Research only. Current Script Generation quality priority remains unchanged.

## 9. Explicit Non-Implementation Confirmation

- No Knowledge runtime created
- No RAG or vector database created
- No Skill Registry or Agent system created
- No production code, schema, API, Prompt Builder or Generation Strategy changed
- No generation pipeline or runtime behavior changed
- No Roadmap priority changed
- No tests required because this task changes research documentation only
