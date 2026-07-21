# Character Decision Logic v1 - Architecture Review and Offline Validation Design

## Status and Boundary

This document reviews the current character path and defines one bounded offline experiment. It is Research, not an approved runtime contract.

Current recommendation: **run one fixed six-generation A/B before considering runtime design**.

Current boundaries:

- Serialized Story Planning remains frozen. Its v1.1 evidence is positive for long-range structure, but it did not pass the strict Hook / Cliffhanger runtime-entry gate.
- No production model, Schema, API, Prompt Builder, Generation Service, Story QC, Revision, Acceptance or Finalization behavior changes in this work.
- Character Decision Logic must remain compact. It is not a Character Bible, Character Agent, Knowledge runtime or personality taxonomy.
- The proposed fields and fixtures below are experiment inputs only.

## 1. Current Character Flow

### 1.1 Origin and Input

The current `ContentSpec` does not contain a formal character contract. It supplies audience and commercial goals, platform goal, story goal, tags and a compact `CreativeBrief` (`backend/app/modules/content_spec/models.py:68-91`). Character identity and behavior therefore begin indirectly through story requirements rather than through explicit character decisions.

The `OrchestratorService` requests a generic character asset from the first two `ContentSpec` tags (`backend/app/modules/orchestrator/service.py:72-90`). Retrieval matches the asset by type, platform and tags (`backend/app/modules/retrieval/service.py:97-149`). This can select a relevant reusable asset, but it does not establish a character's goal, fear, belief or pressure response.

### 1.2 Prompt Serialization

`ScriptGenerationService` serializes the full `ContentSpec`, `CreativeBrief`, platform profile, generation strategy and retrieved candidates into `PromptBuildContext` (`backend/app/modules/script_engine/generation_service.py:177-274`). The current retrieved-candidate prompt payload includes ID, type, score, title and matched tags, but not the candidate summary or `AssetContent` behavior payload (`backend/app/modules/script_engine/generation_service.py:187-203`).

`TemplatePromptBuilder` appends those values plus one generic instruction: the protagonist must make a visible choice, refusal or public move (`backend/app/modules/script_engine/prompt_builder.py:79-107`; `backend/app/modules/script_engine/generation_service.py:249-253`). The current Prompt Library sample asks for a dramatic episode and Scene Goal / Conflict / Outcome, but does not provide a character decision contract (`examples/script_engine/prompt_library_sample.json:31-56`).

The model enum reserves a `character_development` Prompt type (`backend/app/modules/script_engine/models.py:14-23`), but the current sample Generation Strategy selects only Story Planning and TikTok optimization steps (`examples/script_engine/generation_strategy_sample.json:12-33`). A reserved Prompt category is not an implemented character decision capability.

### 1.3 LLM Output and Mapping

The real LLM must generate each `CharacterProfile` with only:

- `name`
- `role`
- `description`
- `motivation`

This contract is defined in `backend/app/modules/master_script/models.py:55-61` and embedded in `LLMGeneratedDraftMasterScript` at `backend/app/modules/master_script/models.py:309-324`.

After structured-output validation, the service copies each generated profile into `DraftMasterScript` without deriving or checking decision behavior (`backend/app/modules/script_engine/generation_service.py:418-479`). In the Mock path, the draft currently contains no characters (`backend/app/modules/script_engine/generation_service.py:398-415`).

### 1.4 Scene Causality

`SceneCausality` requires Goal / Conflict / Outcome and a cross-scene causal link (`backend/app/modules/master_script/models.py:64-82`). The Prompt Builder describes `goal` as the focal character's immediate objective (`backend/app/modules/script_engine/prompt_builder.py:109-120`).

This answers **what the focal character wants in the scene**, but not:

- why that goal follows from the character's belief or fear;
- why the character chooses this action instead of an easier alternative;
- whether the choice respects a moral boundary;
- whether pressure changes later decisions credibly.

The current validators confirm scene ordering and state change, not motivation-to-decision consistency (`backend/app/modules/master_script/models.py:15-37`, `73-82`).

### 1.5 Story QC

Current Story QC does not evaluate decision credibility. `character_agency` looks for action keywords such as `reveal`, `refuse`, `choose` and `confront`, then reports whether the protagonist visibly changes the scene (`backend/app/modules/script_engine/story_qc.py:159-218`).

The underlying Character Consistency rubric currently passes when any scene has a purpose, and Character Agency primarily checks whether a scene purpose contains `reveal` or `expose` (`evaluation/story_rubric.py:96-106`). Neither check compares actions with `CharacterProfile.motivation`, beliefs, fears, boundaries or prior choices. Because `PlaceholderStoryQC` still labels its report `placeholder`, these scores remain experimental signals rather than professional character evaluation (`backend/app/modules/script_engine/story_qc.py:30-95`).

### 1.6 Revision

The Planner can select `character_agency` and produce an evidence-scoped strategy such as replacing a reactive beat with an irreversible protagonist decision (`backend/app/modules/script_engine/revision_planner.py:66-150`, `269-315`). This improves control over **where** to patch agency.

The rule-based Executor does not repair character identity or decision consistency. Its character action appends “The lead makes an irreversible choice” to a scene purpose (`backend/app/modules/script_engine/revision_executor.py:463-471`). It does not read or update character motivation, compare alternatives, test moral boundaries or reconcile a contradiction. Revision can therefore strengthen visible agency but cannot currently explain or repair an implausible decision without inventing new identity information.

### 1.7 FinalMasterScript

Finalization copies `revised_draft_master_script.characters` unchanged into `MasterScript` (`backend/app/modules/master_script/service.py:87-118`). The final object preserves the same four character fields and Scene Causality, but no decision contract or decision trace. This is correct for the current boundary: an offline explainability trace should not be added to `FinalMasterScript` without separate validation.

### 1.8 Free-Inference Points

Character behavior currently depends mainly on free LLM inference at these points:

1. Creating principal characters from story goals, tags, a generic asset title and prompt context.
2. Converting one free-text `motivation` into scene goals, choices and dialogue.
3. Distinguishing protagonist and opponent pressure responses.
4. Deciding which easier alternatives a character would reject.
5. Changing behavior after a consequence without a stable belief, fear or boundary reference.
6. Maintaining consistency across scenes or future episodes.

## 2. System-Level Bottlenecks

The primary bottleneck is not missing appearance or biography. It is the absence of a compact **decision filter** between character description and scene action.

| Bottleneck | Current effect | Why current components do not solve it |
|---|---|---|
| Motivation is broad | A plausible goal can still lead to a convenient action | `motivation` does not state belief, fear, alternative rejection or boundary |
| Agency is behavior-only | Any forceful action may score as agency | QC detects visible verbs, not decision credibility |
| Opponent is under-constrained | Opponents can become reveal dispensers or generic obstacles | No independent decision pattern is supplied or checked |
| Change lacks a baseline | Later behavior can shift because the plot needs it | No stable decision logic exists against which change can be explained |
| Revision lacks identity evidence | A patch can make action stronger but less believable | Executor changes scene text, not character logic |
| Final output lacks rationale | Reviewers cannot distinguish motivated choice from plot convenience | Four profile fields survive, but no evaluation-side decision evidence exists |

## 3. Candidate Field Evaluation

| Candidate | Problem solved | Stability | Character-level fit | Over-constraint / duplication risk | v1 decision |
|---|---|---|---|---|---|
| `external_goal` | Gives choices a concrete desired state | Stable for one episode or short arc; may change after major outcomes | Yes, when horizon is declared | Can duplicate `motivation` if written as a reason rather than an objective | **Include** |
| `internal_need` | Describes latent growth required for an arc | Often changes slowly across a series | More suitable to arc planning than one bounded episode | Encourages explanatory psychology and overlaps contradiction / theme | Defer |
| `fear` | Explains avoided outcomes and why easier options may be rejected | Usually stable until confronted or revised by events | Yes | Can become a repetitive trigger if every scene activates it | **Include** |
| `belief` | Provides a worldview filter for interpreting pressure | Stable, but may change through earned evidence | Yes | A slogan can make behavior mechanical | **Include** |
| `contradiction` | Creates a tradeoff between what the character wants and how they protect themselves | Stable enough for a short arc | Yes | Can be inferred from goal, fear and belief; must remain one concise tension | **Include** for the experiment |
| `decision_pattern` | Differentiates how characters choose under pressure | Stable tendency, not an absolute rule | Yes | If written as “always,” it removes surprise and growth | **Include** as a tendency |
| `moral_boundary` | Defines what a character normally refuses, making boundary crossings meaningful | Stable until a costly, explained breach | Yes | Not every genre needs a noble boundary; must allow conditional or self-serving limits | **Include** |
| `pressure_trigger` | Identifies pressure likely to distort behavior | Often scene- or relationship-specific | Usually not stable enough for the core contract | Duplicates fear plus scene conflict and can prescribe plot devices | Defer |
| `relationship_stance` | Helps relationship-specific choices and trust progression | Expected to change with events | Better as relationship or current-state context | Multiplies fields by relationship and drifts toward a Character Bible | Defer |

## 4. Recommended Minimal v1 Contract

The offline candidate should add exactly six one-sentence fields for the protagonist and principal opponent:

```yaml
external_goal: The concrete story state the character is actively trying to create.
fear: The consequential outcome the character is trying to prevent.
belief: The assumption or value used to interpret pressure.
contradiction: The tension between desire, self-protection, belief or behavior.
decision_pattern: The character's usual choice tendency under pressure, not an absolute rule.
moral_boundary: The action or cost the character normally refuses to accept.
```

Contract rules:

- Keep the existing `name`, `role`, `description` and `motivation` identical in A and B.
- Define `external_goal` at the single-episode horizon for this experiment.
- Each new value is one sentence and must affect possible choices.
- Do not include exact scene actions, dialogue, outcomes, plot twists or camera direction.
- The protagonist and opponent must have independently actionable goals and distinguishable decision patterns.
- A boundary may be conditional or morally compromised; it must not automatically make a character virtuous.
- Behavior may violate the usual pattern or boundary only when the script supplies visible pressure, cost and consequence.

Why six fields are still minimal: `external_goal`, `fear` and `belief` explain the choice filter; `contradiction` creates dramatic tradeoff; `decision_pattern` differentiates behavior; `moral_boundary` makes the cost of deviation reviewable. `internal_need`, `pressure_trigger` and `relationship_stance` are excluded because they either belong to longer-form planning or duplicate scene state.

This is not a proposed Pydantic model. Runtime placement should not be decided until the A/B shows measurable value.

## 5. Lightweight Decision Trace

### Recommendation

Use a decision trace in the offline review, but keep it as a reviewer-authored sidecar artifact. Do not add it to the generation output schema or ask the model for unrestricted reasoning.

For at most one major decision per scene, the reviewer records:

```yaml
scene_number: 2
character_name: Example Name
current_goal: Concise objective visible in the scene.
perceived_threat: Threat the script shows the character responding to.
available_choices:
  - Observable plausible alternative one.
  - Observable plausible alternative two.
chosen_action: Action taken in the script.
decision_reason: Concise link to supplied goal, fear, belief, contradiction or boundary.
cost_or_tradeoff: Cost accepted or value put at risk.
resulting_state_change: Consequence visible by scene end.
evidence_refs:
  - Scene 2 action or dialogue excerpt identifier.
```

Rules:

- This is a concise, user-reviewable rationale, not hidden chain-of-thought.
- The reviewer may only use supplied character context and observable script evidence.
- If no credible reason or alternative can be found, record `unresolved` rather than inventing one.
- Trace completeness is evidence for evaluation, not an automatic quality score.
- The trace should not enter `FinalMasterScript`; it may later inform evaluation artifacts if validated.

This sidecar design keeps the Draft schema identical across A and B and avoids turning psychological explanation into dialogue.

## 6. Component Boundaries

| Component | Question answered | Character Decision Logic boundary |
|---|---|---|
| `ContentSpec` | What content, audience, platform and commercial result is required? | Remains unchanged; offline fixtures sit outside runtime |
| Scene Causality | How does one scene outcome cause later pressure? | Unchanged; it does not explain why a character chooses the causal action |
| Character Decision Logic | Why does this character choose this action under this pressure and state? | Compact decision filter only |
| Story Planning | What is the long-term direction and episode responsibility? | Frozen and excluded from this experiment |
| Story QC | What quality problems are observable? | Future credibility dimensions are research candidates only |
| Revision | What bounded local change should be applied? | Must not invent a new character identity; unchanged now |
| Acceptance | Did a targeted revision work? | Not a judge of character design; unchanged |
| Knowledge | What professional principles may guide character design? | Future source only; no retrieval or runtime now |

Possible future Story QC dimensions, contingent on A/B evidence:

- `decision_credibility`
- `motivation_consistency`
- `decision_consequence_alignment`

They should compare concrete scene evidence with declared character logic. They must not become keyword checks or a second hidden LLM judge by default.

## 7. Bounded Offline Real-Model A/B

### 7.1 Fixed Cases

Reuse the three existing Scene Causality evaluation ContentSpecs without editing them:

1. `examples/prompt_evaluations/scene_causality_real_ab_v1/us_female_dark_romance/content_spec.json`
2. `examples/prompt_evaluations/scene_causality_real_ab_v1/supernatural_romance/content_spec.json`
3. `examples/prompt_evaluations/scene_causality_real_ab_v1/revenge_drama/content_spec.json`

Before generation, create one synthetic, human-reviewed protagonist profile and one principal opposing-character profile per case. Lock the six profiles before revealing any A/B output. These are evaluation fixtures, not production character assets or Benchmark Ground Truth.

### 7.2 Variants

**Variant A - Current Profile Context**

- Receives the fixed `name`, `role`, `description` and `motivation` for both characters.
- Uses the current Scene Causality and output schema.

**Variant B - Character Decision Logic v1**

- Receives the exact same four base fields.
- Adds the six-field compact decision contract for both characters.
- Uses the same Scene Causality and output schema.

The current production runtime does not formally accept pre-authored character profiles. Therefore this experiment is an evaluation-only prompt wrapper that isolates the value of richer character context; it is not a runtime integration test.

### 7.3 Fixed Generation Conditions

Keep identical across variants:

- Provider and model
- Temperature, `top_p`, max tokens and reasoning effort
- Platform profile, language, target duration and scene count
- ContentSpec and Creative Brief
- Prompt instructions except the compact decision-contract section
- Scene Causality contract
- `LLMGeneratedDraftMasterScript` output schema
- Generation order, timeout and retry policy

Run exactly six successful generations: one A and one B for each case. Do not generate repetitions unless a call fails technically. Preserve failed attempts and retry reasons separately. Use a predeclared order such as Dark A/B, Supernatural A/B, Revenge A/B; do not reorder after seeing quality.

### 7.4 Blind Review

Hide variant identity and lock candidate order before review. Prefer one project-owner or professional human review; a second reviewer may resolve a declared tie, but no automatic iterative tuning follows.

Score each pair from 1 to 5 on:

| Dimension | Review question |
|---|---|
| Decision credibility | Do choices follow from goal, fear and belief rather than plot convenience? |
| Character consistency | Does behavior remain coherent, with changes caused by events? |
| Character agency | Do both protagonist and opponent actively create consequences? |
| Character differentiation | Do they use distinct values, strategies and pressure responses? |
| Dramatic quality | Do choices increase conflict, tradeoff and emotional credibility without becoming mechanical? |
| Hook preservation | Is opening pressure no weaker because of the added context? |
| Pacing preservation | Does the script avoid psychological exposition and slower scene movement? |
| Scene Causality preservation | Do decisions still produce clear Goal / Conflict / Outcome and later consequences? |
| Overall human preference | Which script is more convincing and watchable? |

Dialogue is observational only. Record whether it becomes more character-specific and whether characters unnaturally explain their psychology. Do not score or tune Dialogue Quality as a new capability in this task.

### 7.5 Decision-Trace Evidence

For each blind candidate, annotate major scene decisions using the sidecar format in Section 5. Compare:

- percentage of scenes with an evidence-supported decision reason;
- boundary violations with and without visible pressure and cost;
- choices that produce the documented scene outcome;
- protagonist/opponent decision-pattern overlap;
- unresolved traces where the plot supplies no credible reason.

The trace supports review explanations; it must not expose private model reasoning or replace human preference.

### 7.6 Engineering Evidence

Record per generation:

- prompt characters and, when available, prompt tokens;
- completion tokens and total tokens;
- latency;
- schema or output failures;
- decision-context character count;
- retry count and provider errors.

Proposed bounded-cost guardrail: Variant B prompt context should add no more than 20% prompt tokens, or no more than 25% prompt characters when provider token accounting is unavailable. Treat these as experiment gates, not permanent runtime policy.

## 8. Success and Stop Criteria

Move only to a separate runtime-contract design review when all are true:

1. Variant B is clearly preferred in at least two of three stories.
2. Aggregate Decision Credibility, Character Consistency and Character Differentiation improve.
3. No individual story loses more than `0.5` on Hook, Pacing or Scene Causality, and the aggregate of each preservation dimension does not fall by more than `0.2`.
4. Both principal characters remain active; gains do not come only from strengthening the protagonist.
5. No candidate relies on repeated self-explanation of fear, belief or contradiction.
6. The six-field context stays within the bounded-cost guardrail.
7. No major schema, truncation or output-validity regression is attributable to the contract.

Suggested result labels:

- `validated_for_runtime_contract_design`
- `mixed_result_freeze_research`
- `not_validated`

If only one story improves, results conflict across core dimensions, or a major preservation gate fails, freeze Character Decision Logic research and move to another Script Generation bottleneck. Do not repeatedly tune fields or thresholds against the same six outputs.

## 9. Git Checkpoint Assessment

Inspection date: 2026-07-21.

Current Git state:

- `HEAD`: `fc2172b fix: tighten protected-dimension acceptance safety`
- Existing stable tags: `generation-pipeline-v1.0.0`, `script-generation-quality-loop-v1.0.0`
- Working tree at inspection: 23 tracked files changed and 10 untracked paths
- Scene Causality implementation, tests and real A/B artifacts are present in the working tree
- Serialized Story Planning v1, v1 bounded and v1.1 bounded artifacts, including `technical_history`, are present and must be retained
- The v1.1 report records 16 successful outputs and a final `revise_planning_concept` decision

The evidence is preserved on disk but the current mixed working tree is not a clean reproducible checkpoint. Before running Character Decision Logic A/B:

1. Review and separate the existing Scene Causality production change, tests and relevant docs from research-only artifacts.
2. Save a tested Scene Causality / current Script Generation baseline in a clear commit.
3. Save Story Planning scripts, reports, blind-review files and `technical_history` as a separate research/evidence checkpoint if they are intended to be versioned.
4. Confirm `git status --short`, `git diff --check` and the appropriate test baseline before tagging any capability checkpoint.
5. Start Character Decision Logic fixtures and outputs only after that boundary is clean.

Do not use `git add .` blindly while unrelated changes remain. No commit, tag, push, deletion or artifact rewrite is performed by this review.

## 10. Runtime Recommendation

Do not implement Character Decision Logic in runtime yet.

The architecture gap is real: current generation has no explicit bridge from broad motivation to credible, differentiated choices. The six-field candidate is small enough to test without introducing a subsystem, and the evaluation can reuse the existing single-episode Scene Causality fixtures and Draft schema.

Approve at most one bounded six-generation A/B after establishing a clean Git checkpoint. If it passes every quality, preservation and cost gate, perform a separate review to decide where a backward-compatible runtime contract would belong. If it is mixed, freeze the research rather than tuning indefinitely.

## Explicit Non-Implementation Confirmation

- No production code changed
- No Schema or API changed
- No Prompt Builder or Generation Service changed
- No Scene Causality, Story QC, Revision, Acceptance or Finalization behavior changed
- No Story Planning tuning or runtime integration resumed
- No Character Agent, Character Bible subsystem, Knowledge Retrieval, RAG or Skill Registry introduced
- No tests required for this research-only review
