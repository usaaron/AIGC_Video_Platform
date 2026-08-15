# Serialized Story Planning Contract v1.1 Candidate and Validation Record

## Status and Boundary

> Historical status note (2026-08-05): the `not approved` conclusion below applies to this fixed four-episode Story Blueprint / Episode Plan experiment. A later product decision approved a different, human-reviewed Story Bible → level-free recursive StoryPlanNode → EpisodePlan runtime slice for China-mainland longform work. This document remains evidence about over-constraint and Hook/Cliffhanger regression, not the authority for current runtime status; see `14_Script_Engine.md` and `21_Current_Status_Checklist.md`.

This document records the first Serialized Story Planning v1 real-model A/B result, analyzes its failure mode, defines a reduced-constraint v1.1 candidate, and records the completed bounded revalidation.

Current decision: **`revise_planning_concept`**.

Current status:

- The first v1 A/B is complete; this fixed four-episode planning contract was not approved for direct runtime integration.
- Story Blueprint and Episode Plan remain documentation-level experimental contracts.
- The v1.1 bounded revalidation is complete. Planned v1.1 was preferred in both retained cases and corrected the primary repetition failure, but aggregate Hook and Cliffhanger remained below Direct.
- This experimental Story Planning contract is frozen as positive research evidence and was not adopted as the later longform runtime contract.
- Existing `ContentSpec`, Prompt Builder, Generation Service, Story QC, Revision, Acceptance and `FinalMasterScript` behavior remain unchanged.
- Fixtures are synthetic evaluation inputs, not production data or Benchmark Ground Truth.

The historical artifact uses prompt/version labels containing `v1.1-bounded`. Those are evaluation-tool identifiers created for the first run; they do not mean that the contract defined in this document had already passed validation.

Evidence:

- `examples/prompt_evaluations/serialized_story_planning_real_ab_v1_bounded/comparison_report.json`
- `examples/prompt_evaluations/serialized_story_planning_real_ab_v1_bounded/comparison_report.md`
- `examples/prompt_evaluations/serialized_story_planning_real_ab_v1_bounded/blind_review/blind_review_locked.json`
- `examples/prompt_evaluations/serialized_story_planning_real_ab_v1_1_bounded/comparison_report.json`
- `examples/prompt_evaluations/serialized_story_planning_real_ab_v1_1_bounded/comparison_report.md`

## 1. First A/B Result

The first experiment generated three four-episode stories in Direct and Planned variants, for 24 real-model generations. Planned was preferred for Dark Romance and Revenge Drama; Direct was preferred for Supernatural Romance.

| Signal | Result |
|---|---:|
| Planned story preferences | 2 of 3 |
| Overall average | `4.611 -> 4.667` (`+0.056`) |
| Setup/payoff completion | `+1.000` |
| Repetition control | `+0.667` |
| Serialization quality | `+0.267` |
| Hook strength | `-1.000` |
| Cliffhanger quality | `-1.000` |
| Conflict escalation | `-0.333` |
| Total token change | `+6.837%` |
| Prompt token change | `+31.785%` |
| Prompt character change | `+63.670%` |

This result supports one narrow conclusion: planning improved long-range traceability more reliably than it improved readable episode quality. The observed overall gain is too small, and the commercial-quality regressions are too important, to justify runtime integration.

The review was one blinded AI review, not independent professional or audience validation. Each variant was generated once, so stability was not measured.

## 2. Failure-Mode Analysis

### 2.1 Necessary Planning Constraints

The first experiment provides positive evidence for preserving:

- Stable whole-story direction
- Character arc destinations
- Cross-episode entry and exit states
- Setup/payoff references
- Episode-level narrative responsibility
- Information reveal obligations

These constraints explain the strongest gains in setup/payoff, repetition control and serialization quality.

### 2.2 Over-Specified Dramatic Execution

The v1 Episode Plan mixed two different responsibilities:

1. Defining what must change in the story.
2. Prescribing exactly how the episode must create that change.

Fields such as `central_conflict`, exact `protagonist_decision`, `reveal` and `cliffhanger` collectively specified much of the episode's concrete dramatic machinery. This reduced the model's freedom to find a stronger opening, escalation pattern, reversal and ending.

The problem was not that the Script Generator ignored the plan. In the Supernatural Romance case, it followed the plan too faithfully.

### 2.3 Repeated Conflict and Consequence Mechanisms

The Supernatural Romance fixture repeatedly prescribed the following adjacent pattern:

`medical emergency`
→ rescue choice
→ Rowan loses memory
→ relationship must be reconstructed

Memory remained a valid series concern, but the plan reused both:

- A **conflict mechanism**: urgent rescue under supernatural pressure.
- A **consequence mechanism**: Rowan loses another memory.

Recurring motifs are not automatically repetitive. A silver tag, journal or phrase can recur while its dramatic function changes. Repetition occurs when adjacent episodes use the same pressure, choice, cost and state transition.

### 2.4 Loss of Hook and Cliffhanger Freedom

The planned variant's average Hook and Cliffhanger scores each fell by `1.000`. The v1 plan often supplied a specific end reveal or object-based turn, leaving the generator to execute an answer rather than invent the most compelling episode opening and continuation pressure.

The v1.1 candidate therefore preserves an episode's continuation responsibility but returns the following decisions to Script Generation:

- Exact opening contradiction
- Concrete threat or obstacle
- Physical event
- Reversal device
- Final reveal wording and staging

### 2.5 Separate Shared Output Issue

Malformed or truncated synopsis endings appeared in both variants. This is a shared bounded-output issue and must not be attributed to Story Planning or addressed by this contract revision.

## 3. Story Blueprint v1.1 Candidate

Purpose: answer **“What story are we telling?”** at whole-story level.

The Story Blueprint remains compact and stable. It describes direction and long-range promises, not episode execution.

| Field | Responsibility | Must not contain |
|---|---|---|
| `core_premise` | State the conflict-bearing serialized proposition | Scene lists, dialogue or promotional copy |
| `series_dramatic_promise` | State the cumulative experience and resolution promised to the audience | Per-episode tasks or commercial metrics |
| `central_conflict` | Define the durable incompatible goals, pressure and stakes | Every temporary obstacle |
| `theme` | Define the meaning-level question tested by choices | Moral instructions or forced dialogue |
| `ending_direction` | Define the intended resolution state and emotional promise | A fully written ending scene |
| `character_arc_targets` | Define starting conditions and intended changes for principal characters | Full biographies or fixed performances |
| `major_setup_payoff_refs` | Give important long-range promises stable reference IDs | Every prop or incidental callback |

The Blueprint must not contain scenes, dialogue, camera instructions, production prompts, model syntax or episode-by-episode conflict devices.

## 4. Episode Plan v1.1 Candidate

Purpose: answer **“Why must this episode exist, and what state change must it produce?”**

| Field | Requirement | Constraint boundary |
|---|---|---|
| `episode_number` | Identify deterministic sequence position | Not release scheduling metadata |
| `episode_purpose` | State the episode's unique narrative responsibility | Not a scene list or exact plot |
| `entry_state` | Record inherited facts, relationships, resources and unresolved pressure | Not a recap of all earlier scripts |
| `required_state_change` | State what must become true, false, lost, gained or newly urgent | Must define an effect, not its physical mechanism |
| `protagonist_decision` | Define the meaningful choice function and consequence the protagonist must own | Not exact choreography or dialogue |
| `planned_reveal` | Define the information obligation and who may learn it | Not exact staging unless a setup/payoff requires it |
| `setup_refs` | Identify Blueprint promises introduced or advanced | Not untracked free-text foreshadowing |
| `payoff_refs` | Identify earlier promises fulfilled or transformed | Not superficial callbacks |
| `exit_state` | Define the continuity state inherited by the next episode | Not a prose synopsis |
| `escalation_requirement` | Optionally define the type of increased pressure or continuation responsibility | Must not prescribe the exact threat or cliffhanger |
| `emotional_requirement` | Optionally define the emotional effect or relationship movement | Must not prescribe acting or exact emotional beats |

### 4.1 Changes From v1

- `episode_goal` becomes `episode_purpose` to emphasize narrative responsibility.
- `central_conflict` is removed from the plan. The generator chooses the episode's concrete conflict mechanism within Blueprint and state constraints.
- `required_state_change` becomes the central causal obligation.
- `reveal` becomes `planned_reveal`, limited to information timing and setup/payoff obligations.
- Required `emotional_movement` becomes optional `emotional_requirement`.
- Exact `cliffhanger` is removed. Optional `escalation_requirement` defines only the ending's function.
- `protagonist_decision` states the consequential choice and ownership, not a fixed action sequence.

### 4.2 Required Causal Chain

`entry_state`
→ generator selects dramatic pressure
→ protagonist owns a consequential decision
→ `required_state_change`
→ `exit_state`
→ next episode inherits the consequence

The plan protects continuity and causality while leaving dramatic execution open.

### 4.3 Creative Freedom Reserved for Script Generation

Episode Script Generation owns:

- Opening Hook execution
- Specific conflict mechanism
- Physical event selection
- Exact reversal device
- Dialogue
- Scene construction
- Cliffhanger execution
- Concrete emotional expression

An Episode Plan may say, “End with a credible new threat to trust.” It should not dictate the exact object, attacker, line of dialogue or reveal unless one is required to pay off a tracked setup.

## 5. Adjacent Plan Repetition Review

Before a future offline run, review adjacent Episode Plans for reuse of:

| Check | Question |
|---|---|
| Primary conflict mechanism | Do adjacent plans force the same kind of confrontation, rescue, chase, hearing or discovery? |
| Sacrifice/consequence mechanism | Do they repeatedly charge the same cost, such as memory loss, arrest or relationship rupture? |
| Reveal type | Do they repeatedly reveal another file, identity, traitor or hidden rule? |
| State transition | Do they repeatedly move trust to distrust, safety to danger or evidence to erasure without progression? |
| Evidence/threat device | Do they repeatedly depend on the same recording, message, document, supernatural object or remote sabotage? |

This is an offline fixture-review checklist, not a production validator.

A recurring motif is acceptable when its function evolves. For example, a journal may first establish a rule, later contradict a memory, and finally carry a voluntary promise. It becomes repetitive when it triggers the same conflict and consequence each time.

## 6. Revised Documentation Fixtures

These compact fixtures demonstrate v1.1 responsibility-level planning. They are not reusable plots, production data or Benchmark Ground Truth.

### 6.1 Dark Romance Control Fixture

#### ContentSpec Summary

- Audience: US women 18-34 who prefer tense romance, moral conflict and consequential choices
- Platform: TikTok-oriented vertical serialized fiction
- Language: English
- Duration: 90 seconds per episode
- Story goal: A crisis negotiator must determine whether a secretive heir is her enemy, shield or both
- Constraints: protagonist agency; coercion is not proof of love; no wedding, livestream or missing-relative plot

#### Story Blueprint

| Field | Fixture value |
|---|---|
| `core_premise` | Crisis negotiator Mara Voss accepts a four-night security contract from reclusive heir Elias Rook and discovers that threats against him connect to a fatal decision from her first case. |
| `series_dramatic_promise` | A dangerous investigation turns mutual suspicion into evidence-based trust without requiring Mara to surrender her ability to refuse. |
| `central_conflict` | Mara needs Elias's archive to clear her record; Elias needs her to identify an insider, but each may be manipulating the investigation. |
| `theme` | Trust is meaningful only when both people retain the power to refuse. |
| `ending_direction` | The architect of both crises is exposed; both leads accept costly transparency and a conditional alliance. |
| `character_arc_targets` | Mara moves from total self-reliance to evidence-based trust without giving up control. Elias moves from protective secrecy to costly transparency. |
| `major_setup_payoff_refs` | `DR-S1`: disabled panic system; `DR-S2`: redacted negotiation record; `DR-S3`: Mara's private safeguard. |

#### Episode Plans

| Episode | Purpose | Entry state | Required state change | Protagonist decision | Planned reveal | Setup/payoff | Exit state | Optional requirements |
|---:|---|---|---|---|---|---|---|---|
| 1 | Establish mutual suspicion and a shared, verifiable threat | Mara's reputation is damaged; the contract is tightly limited | The threat becomes personal to Mara, and each lead learns the other will act independently | Mara chooses to investigate while preserving a credible exit | The current threat is connected to Mara's first case and requires internal access | Introduce `DR-S1`, `DR-S2` | Both leads are implicated or targeted by the same operation | Escalation: create a credible reason neither can dismiss the other; exact Hook and ending free |
| 2 | Convert suspicion into controlled cooperation | The archive and first-case evidence may be compromised | Evidence is jointly verifiable, but one private safeguard becomes vulnerable | Mara establishes reciprocal verification rather than accepting blind trust or withdrawing | A key record was manipulated and does not prove what either lead assumed | Develop/pay partial `DR-S2`; introduce `DR-S3` | Cooperation exists under mutual controls; the insider can pressure that arrangement | Emotional: accusation to unsettled cooperation; exact conflict free |
| 3 | Test whether the alliance survives costly truth | A safeguard has been compromised and suspicion returns | The leads identify insider access, while Mara's own past error becomes material evidence | Mara chooses transparent risk over defensive concealment | The insider is linked to security controls and the original case | Advance `DR-S1`, `DR-S3`; partial payoff `DR-S1` | The alliance is rebuilt through reciprocal exposure, and the antagonist must act openly | Escalation: create public or institutional pressure without prescribing its device |
| 4 | Resolve the investigation through reciprocal agency | The antagonist can still control the official narrative | The antagonist is exposed; both leads lose protection but retain agency and verified trust | Mara chooses a complete accountable record over private vindication | The original and current crises belong to the same dependency scheme | Complete `DR-S2`, `DR-S3` | Central case resolved; a conditional relationship path remains | Emotional: mutual risk to guarded trust; continuation may arise from consequence, not an exact reveal |

Review result: the Dark Romance direction remains valid, but exact alarms, vault actions, publication mechanics and final reveal devices have been removed from the plan.

### 6.2 Supernatural Romance Primary Fixture

#### ContentSpec Summary

- Audience: English-speaking viewers who prefer supernatural mystery, restrained romance and identity conflict
- Platform: TikTok-oriented vertical serialized fiction
- Language: English
- Duration: 90 seconds per episode
- Story goal: A paramedic who hears final memories works with an immortal stranger whose identity is being consumed by a supernatural exchange
- Constraints: romance grows through choices and shared cost; supernatural rules remain consistent; no destiny-mate shortcut

#### Story Blueprint

| Field | Fixture value |
|---|---|
| `core_premise` | Paramedic Nia Calder hears a dying patient's final memory and finds immortal archivist Rowan inside it, while an entity exchanges human survival for stolen memory. |
| `series_dramatic_promise` | Nia and Rowan reconstruct trust while uncovering a supernatural economy that makes memory, rescue and consent inseparable. |
| `central_conflict` | Nia refuses to abandon people in danger; Rowan fears that opposing the exchange will erase the evidence and identity needed to defeat it. |
| `theme` | Love is not perfect remembrance; it is the choice to know someone again. |
| `ending_direction` | They break the entity's isolated-sacrifice rule through reciprocal consent, while accepting that some memories cannot be restored. |
| `character_arc_targets` | Nia learns responsibility does not require solitary sacrifice. Rowan chooses present trust over control of the past. |
| `major_setup_payoff_refs` | `SR-S1`: silver emergency tag; `SR-S2`: blank journal page; `SR-S3`: phrase “remember me forward.” |

#### Episode Plans

| Episode | Purpose | Entry state | Required state change | Protagonist decision | Planned reveal | Setup/payoff | Exit state | Optional requirements |
|---:|---|---|---|---|---|---|---|---|
| 1 | Establish the exchange and create an ethical bond | Nia hides her ability; Rowan tracks unexplained losses alone | Nia and Rowan become causally linked; one life is preserved; the entity notices their interference | Nia prioritizes a life after preserving available evidence; the exact rescue method is free | Rowan's losses and Nia's ability are connected by an external exchange | Introduce `SR-S1`, `SR-S2` | A patient lives; Rowan lacks one critical fact; Nia is marked by the exchange | Escalation: a new threat to verification or trust; exact Hook and cliffhanger free |
| 2 | Test trust without repeating rescue followed by memory loss | Both are linked and possess incomplete but independently stored evidence | They verify that the entity manipulates relational evidence; Rowan grants Nia bounded trust; no new memory loss is required | Nia follows a risky lead while protecting Rowan's consent and an independent verification path | The entity can counterfeit or reroute relational evidence | Develop `SR-S1`, `SR-S2`; introduce `SR-S3`; partial payoff `SR-S2` | Trust is based on a verified choice; one record is compromised; both retain current memories | Emotional: suspicion to provisional trust to destabilized certainty; conflict device free |
| 3 | Force a choice between recovering the past and protecting future autonomy | Current memories are intact; a restoration path exists; the entity has leverage | They reject restoration that transfers its cost to another and lose access to part of the recoverable past | Both choose present consent over complete recovered identity | Silver tags route stolen memories, and the exchange exploits isolated sacrifice | Advance `SR-S1`, `SR-S3`; partial payoff `SR-S1` | The rule is understood; the restoration path is reduced or lost; their present relationship remains intact but threatened | Escalation: target their future shared identity rather than stage another rescue |
| 4 | Resolve the exchange through reciprocal agency | They understand the rule but cannot restore every loss | The entity loses control; incomplete memory remains; a shared future becomes possible | They consent to reciprocal risk without one person owning the other's identity | The exchange persists only while loss is involuntary or borne alone | Complete `SR-S1`, `SR-S2`, `SR-S3` | Central exchange is broken; new shared memories can be preserved | Emotional: anticipatory loss to reciprocal trust to bittersweet renewal; exact payoff and continuation execution free |

Mechanism review:

- Episode 1 may contain a rescue because it establishes the premise.
- Episode 2 must not require another rescue or another Rowan memory loss.
- Episode 3 uses temptation and forfeited restoration, a different conflict and consequence.
- Episode 4 uses reciprocal consent and incomplete recovery, not a repeated sacrifice.
- Memory, tags and journals remain motifs, but their dramatic functions progress.

### 6.3 Revenge Drama Control Fixture

#### ContentSpec Summary

- Audience: English-speaking viewers who prefer strategic revenge, institutional conflict and earned reversals
- Platform: TikTok-oriented vertical serialized fiction
- Language: English
- Duration: 90 seconds per episode
- Story goal: A structural engineer must expose the developer who framed her without endangering residents
- Constraints: evidence-driven revenge; protagonist protects vulnerable people; no public-wedding or secret-heir device

#### Story Blueprint

| Field | Fixture value |
|---|---|
| `core_premise` | Disgraced engineer Tessa Ward audits the developer who framed her and discovers his newest tower repeats the defect that ended her career. |
| `series_dramatic_promise` | Tessa transforms personal revenge into public accountability while defeating a system that treats resident safety as negotiable. |
| `central_conflict` | Tessa needs internal proof, but immediate exposure could cause panic and leave residents inside an unsafe tower. |
| `theme` | Justice without responsibility can reproduce the harm it condemns. |
| `ending_direction` | Tessa enables a safe evacuation, releases independently verified evidence and rejects a settlement that repairs only her reputation. |
| `character_arc_targets` | Tessa moves from reputation-focused revenge to public-accountability leadership. Hale moves from certainty to sacrificing allies and exposing his fear. |
| `major_setup_payoff_refs` | `RV-S1`: altered load-test record; `RV-S2`: evacuation plan; `RV-S3`: Tessa's unsigned calculation. |

#### Episode Plans

| Episode | Purpose | Entry state | Required state change | Protagonist decision | Planned reveal | Setup/payoff | Exit state | Optional requirements |
|---:|---|---|---|---|---|---|---|---|
| 1 | Shift Tessa's objective from clearing her name to preventing current harm | Tessa is discredited and has temporary internal access | A repeat safety risk becomes credible; Tessa delays personal vindication to investigate it | Tessa prioritizes resident safety over the easiest reputation evidence | The current tower reproduces a material pattern from the earlier failure | Introduce `RV-S1`, `RV-S3` | Tessa has partial safety evidence; the company detects scrutiny | Escalation: immediate pressure on access or evidence; exact device free |
| 2 | Verify the framing while making premature exposure dangerous | Tessa has partial proof; residents do not know the risk | The substitution behind her framing is established, and a safe response becomes necessary before release | Tessa rejects silence without triggering an uncontrolled response | Her unsigned work was transformed into a certified falsification | Develop `RV-S1`, `RV-S3`; introduce `RV-S2`; partial payoff `RV-S3` | Tessa has framing evidence and a narrow protection window | Emotional: vindication to disciplined responsibility; exact bargain or threat free |
| 3 | Make public safety visibly cost Tessa her fastest revenge | The official response path is compromised; records are at risk | Residents gain a credible route toward safety; Tessa accepts a personal or legal cost; institutional complicity becomes visible | Tessa chooses a bounded sacrifice that protects residents and preserves evidence | The falsification depended on both corporate and oversight participation | Advance `RV-S1`, `RV-S2`; partial payoff `RV-S1` | Most residents can act safely; Tessa is under direct pressure; antagonists believe they can contain the record | Escalation: pressure becomes public or institutional; exact arrest/sabotage mechanism free |
| 4 | Complete safe exposure and accountable justice | Remaining residents and evidence are both vulnerable | Residents are safe; evidence is independently preserved; accountability no longer depends on Tessa alone | Tessa chooses public verification over a private restoration of status | The earlier and current failures are part of the same corrupted process | Complete `RV-S1`, `RV-S2`, `RV-S3` | Central case resolves through public accountability; broader consequences may remain | Continuation may expose scope, not repeat another building emergency |

Review result: the accountability arc and setup/payoff chain remain, while exact deal, arrest, locked-floor, encryption-key and final-project-list devices are no longer prescribed.

## 7. Bounded v1.1 Revalidation Design

No generation is performed by this documentation task.

### 7.1 Cases and Variants

Use exactly two four-episode cases:

1. **Primary:** Supernatural Romance, selected because it exposed the v1 repetition and rigidity failure.
2. **Control:** Revenge Drama, selected because Planned previously had the strongest positive score delta (`+0.444`) and provides a non-romance-mechanism control despite its relationship elements.

For each case compare:

- **Direct:** `ContentSpec summary -> Episode Script`
- **Planned v1.1:** `Same ContentSpec summary -> Story Blueprint -> current v1.1 Episode Plan -> Episode Script`

Total: 16 real generations, one generation per episode and variant. Do not repeat failed creative outputs; retry only technical failures under the pre-registered provider retry policy.

### 7.2 Controlled Settings

Keep identical across variants:

- Model/provider: the same available model for the full run
- Temperature, top-p, maximum tokens and reasoning effort
- `PlatformProfile`
- English output
- 90-second target duration
- Three scenes per episode
- Output schema
- ContentSpec summary
- Episode order and compact continuity-summary format
- Generation order policy

The first experiment used `openai_compatible`, `gpt-5.6-sol`, temperature `0.6`, top-p `0.9`, max tokens `4000` and reasoning effort `low`. Reuse that profile if available; if not, record one replacement profile before any generation and use it consistently.

The only intended difference is the revised planning context. Do not tune prompts after seeing outputs.

### 7.3 Evaluation

Use blinded pairwise review with 1-5 scores and episode evidence for:

- Setup/payoff completion
- Adjacent-episode repetition control
- Character consistency and growth
- Cross-episode causality
- Hook strength
- Cliffhanger quality
- Conflict and consequence variety
- Perceived rigidity
- Overall story preference
- Major single-episode regression

Record prompt tokens, completion tokens, total tokens, prompt characters and latency separately. AcceptanceDecision, Story QC or a single aggregate score must not be the sole judgment.

### 7.4 Decision Criteria

Proceed toward runtime contract design only if all are true:

1. Supernatural Romance no longer repeats rescue followed by memory loss across adjacent episodes.
2. Its setup/payoff result is preserved or improved relative to Direct and does not materially regress from the first Planned result.
3. Hook and Cliffhanger quality are restored to parity with Direct or have only a minor evidence-justified difference.
4. Revised Planned remains preferred in the Revenge Drama control.
5. Neither story contains a major single-episode regression.
6. Creative variety improves and the plan is not mechanically visible.
7. Planning context does not materially exceed the first experiment's prompt-token or prompt-character overhead.

If any mandatory criterion fails, stop Story Planning tuning at this checkpoint and investigate another Script Generation bottleneck. Do not automatically run another A/B or weaken the criteria after seeing results.

Suggested decision labels:

- `validated_for_runtime_contract_design`
- `revalidation_failed_stop_planning_tuning`

### 7.5 Completed Revalidation Result

The bounded v1.1 revalidation completed 16 successful generations across Supernatural Romance and Revenge Drama.

- Planned v1.1 was preferred in `2/2` retained stories.
- Overall average changed from `4.409` to `4.669` (`+0.259`).
- Setup/Payoff improved `+0.65`, Repetition Control `+0.90`, Character Decision Consistency `+0.30`, and Cross-Episode Causality `+0.35`.
- The Supernatural Romance rescue-to-memory-loss repetition failure was corrected.
- Hook remained `-0.20` and Cliffhanger `-0.10` below Direct in aggregate.
- No major single-episode regression was recorded.
- The blind comparison used one AI reviewer, not independent human or professional validation.

Because Hook and Cliffhanger parity was a mandatory gate, the final decision remains **`revise_planning_concept`**. Runtime integration is not approved, and Story Planning tuning stops at this checkpoint.

## 8. Architecture Boundary

The hypothesis remains:

`ContentSpec`
→ Story Blueprint
→ Episode Plan
→ Existing Episode Script Pipeline

Responsibilities remain separate:

| Component | Responsibility |
|---|---|
| `ContentSpec` | Audience, platform, commercial and creative requirements |
| Story Blueprint | Stable whole-story direction and long-range obligations |
| Episode Plan | Episode responsibility, required state change and continuity handoff |
| Script Generation | Concrete Hook, conflict, scenes, dialogue, reversal, emotion and Cliffhanger |
| Story QC | Quality evaluation; plan adherence is not automatically quality |
| Revision | Bounded local correction, not series replanning |
| Acceptance | Whether a revision solved its target, not whether planning is valid |
| `FinalMasterScript` | Formal detailed output for one episode; unchanged |

No new Engine, Agent, RAG system, Skill Registry or runtime contract is justified by the first A/B.

## 9. Risks and Open Questions

- Reducing constraints may restore creativity but weaken continuity or setup/payoff.
- Effect-level plan language may remain ambiguously interpreted.
- One generation per variant does not establish stability.
- One AI blind reviewer does not establish professional or audience preference.
- The first experiment's planning context was not compact: prompt tokens rose `31.785%` and prompt characters `63.670%`.
- Direct generation may still win on immediate commercial beats even if planning wins on long-range structure.
- Shared synopsis truncation remains unresolved and should be isolated from planning judgments.

## 10. Recommendation

Keep the final decision as **`revise_planning_concept`** and freeze Story Planning tuning.

The v1.1 revalidation confirms that reduced planning constraints can improve Setup/Payoff, repetition control, cross-episode causality and character-decision consistency. It still fails the mandatory Hook / Cliffhanger parity gate and has only one AI reviewer. Preserve the contract and artifacts as research evidence, do not integrate them into runtime, and investigate a different Script Generation bottleneck unless a future task explicitly reopens Story Planning.

## 11. Explicit Non-Implementation Confirmation

- No production code changed
- No schema or API changed
- No Prompt Builder or Generation Service changed
- No Story QC, Revision, Acceptance or Scene Causality behavior changed
- No runtime Story Planning integration implemented
- No Knowledge runtime, Skill Registry or Agent system introduced
- No roadmap priority changed
- No tests required for this documentation-only contract revision
