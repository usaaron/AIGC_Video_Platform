# Creative Deepening Knowledge-Guided Validation v1

## Status

```yaml
document_type: bounded_offline_validation
runtime_status: not_integrated
experiment_status: completed_evidence_reviewed
professional_validation: false
source_draft_count: 1
variant_count: 3
decision: supports_further_validation
```

This experiment tests two separate hypotheses:

1. Whether one bounded Creative Deepening pass improves a structurally valid first Draft.
2. Whether a source-grounded, bounded Creative Knowledge bundle adds value beyond generic Creative Deepening.

The experiment does not approve a runtime stage, Prompt Builder change, schema change, retrieval system, or autonomous optimization process.

## Fixed Input

- Case: `sci_fi_mystery`
- Source Draft ID: `4bef6d56-7927-4f57-916c-bb7da390735e`
- Source artifact: `examples/prompt_evaluations/creative_control_combined_v1/cases/sci_fi_mystery/structured_creative_control/draft.json`
- Creative context: `examples/prompt_evaluations/creative_control_combined_v1/cases/sci_fi_mystery/structured_creative_control.json`
- Source model: `openai_compatible / gpt-5.6-sol`
- Source generation tokens: `7664`
- Source generation latency: `41.473s`
- Language: English
- Platform: TikTok vertical 9:16
- Target duration: 60 seconds
- Scene count: 3

This Draft was selected because it already has explicit character beliefs and moral boundaries, a complete Scene Goal / Conflict / Outcome chain, an active protagonist choice, and a causally prepared cliffhanger. That makes it possible to distinguish expressive deepening from story repair.

## Variants

| Variant | Input | Additional stage | Knowledge |
|---|---|---|---|
| A: Baseline | Frozen source Draft | None | None |
| B: Creative Deepening | Same frozen Draft | One bounded pass | None |
| C: Knowledge-Guided Deepening | Same frozen Draft | One bounded pass | 10-item bundle |

Variants B and C use identical model settings:

```yaml
temperature: 0.4
top_p: 0.9
max_tokens: 4000
successful_outputs_per_variant: 1
subjective_quality_retries: 0
```

Technical retries are allowed only for provider, transport, or schema-validation failures and must be reported.

## Knowledge Bundle

The bundle is frozen before generation and contains 10 items:

| Knowledge ID | Intended contribution |
|---|---|
| `knowledge.character.desire_drives_action.v1` | Keep Lena's goal visible in action |
| `knowledge.character.choice_reveals_character.v1` | Express agency through costly choice |
| `knowledge.character.motivation_interrelationship.v1` | Preserve belief, fear, contradiction, and relationship logic |
| `knowledge.conflict.impeded_desire.v1` | Keep scene pressure tied to an active goal |
| `knowledge.conflict.progressive_cost.v1` | Intensify existing pressure without adding conflict |
| `knowledge.visual.observable_action.v1` | Replace abstract emotion with visible behavior |
| `knowledge.visual.word_image_complement.v1` | Reduce duplicated image/dialogue information |
| `knowledge.platform.tiktok.early_hook.v1` | Clarify immediate viewing motive |
| `knowledge.platform.tiktok.hook_body_close.v1` | Preserve opening promise and ending function |
| `knowledge.story.reversal_recognition.v1` | Keep the final recognition prepared by prior action |

The experiment does not perform retrieval. These items are selected manually from `Research/Knowledge_Items/` and passed only to Variant C.

## Preservation Contract

Both Deepening variants must preserve:

- title, logline, synopsis, episode goal, audience, platform, language, tone, and duration;
- character identities, profiles, moral boundaries, and relationship direction;
- scene count, order, numbers, purposes, and Scene Causality objects;
- central conflict, story facts, reveal timing, and causal links;
- cliffhanger flags, purpose, and next-episode question;
- existing locations and major actions required by each Scene Outcome.

Allowed changes are limited to hook wording, beat and emotion expression, visible character actions, turning-point wording, and dialogue. The model may increase pressure only through existing obstacles and consequences.

## Deterministic Checks

- Structured output schema valid
- Fixed top-level story fields unchanged
- Character profiles unchanged
- Scene count/order/numbers unchanged
- Scene purposes unchanged
- Scene Causality objects unchanged
- Cliffhanger flags unchanged
- Next-episode question unchanged
- No new dialogue speakers
- Expressive text growth reported against a 20% observation budget

Failure of a story-preservation check is a substantive regression and must not trigger an automatic subjective-quality retry.

## Evaluation Rubric

Each variant will receive a 1-5 evidence-based observational score for:

- `character_consistency`
- `character_agency`
- `dialogue_quality`
- `emotional_progression`
- `visual_suitability`
- `scene_intensity`
- `hook_quality`
- `cliffhanger_quality`
- `story_preservation`

The review must cite concrete scene actions or dialogue. Current Story QC and AcceptanceDecision are not decision authorities for this experiment.

## Cost And Reliability Metrics

- Incremental prompt, completion, and total tokens for B and C
- Incremental latency for B and C
- Technical attempt count
- Technical failure count and type
- Structured-output success/failure
- Preservation-check success/failure
- Expressive text growth

Variant A uses no additional Deepening call, so its incremental Deepening token and latency cost are zero. Its original generation cost is retained separately for context.

## Decision Interpretation

Because this experiment uses one fixed Draft, it can support a next validation step but cannot establish production readiness.

- `supports_further_validation`: B improves multiple expression dimensions over A without story regression, and C adds observable improvement over B without new regression.
- `deepening_only_signal`: B improves over A, but C adds no clear value or introduces rigidity.
- `knowledge_signal_only`: B is neutral or worse, while C improves over A and preserves the story.
- `mixed_result`: improvements and regressions are balanced or evidence is ambiguous.
- `not_supported`: neither Deepening variant improves readable quality, or either gain depends on story drift.

## Artifact Paths

The one-time executor is outside the repository:

- `/tmp/run_creative_deepening_knowledge_validation_v1.py`

Generated artifacts were written outside the repository:

- `/tmp/creative_deepening_knowledge_validation_v1/variant_a_baseline.json`
- `/tmp/creative_deepening_knowledge_validation_v1/variant_b_creative_deepening.json`
- `/tmp/creative_deepening_knowledge_validation_v1/variant_c_knowledge_guided_creative_deepening.json`
- `/tmp/creative_deepening_knowledge_validation_v1/manifest.json`

## Results

### Execution Summary

The bounded run completed on `2026-07-21` with the same model and sampling settings for Variants B and C.

| Metric | A: Baseline | B: Deepening | C: Knowledge-Guided |
|---|---:|---:|---:|
| Additional model calls | 0 | 1 successful | 1 successful |
| Prompt tokens | 0 additional | 3,741 | 5,525 |
| Completion tokens | 0 additional | 3,057 | 2,361 |
| Total tokens | 0 additional | 6,798 | 7,886 |
| Observed wall latency | 0 additional | 364.963s | 54.352s |
| Technical attempts | 0 | 2 | 1 |
| Technical failures | 0 | 1 | 0 |
| Structured output produced | Existing | Yes | Yes |
| Hard preservation checks | Reference | 17/17 passed | 17/17 passed |
| Expressive text growth | Reference | +35.88% | +31.34% |
| Within 20% growth budget | Reference | No | No |

Variant B's wall latency includes the configured 300-second cooldown after its first provider/transport failure. It must not be interpreted as normal successful-call latency. Across the two generated variants, one of three technical attempts failed, an observed attempt failure rate of 33.3%; both variants eventually produced one valid structured result without subjective-quality retries.

Compared with Variant B, Variant C used 1,088 more total tokens (+16.0%). Its prompt was 47.7% larger because it included the knowledge bundle, while its completion was 22.8% smaller. This one run is insufficient to attribute latency or completion-size differences to knowledge guidance.

### Deterministic Preservation

Both generated variants preserved all hard-constrained story semantics:

- title, logline, synopsis, audience, platform, language, tone, episode goal, and target duration;
- character profiles and identities;
- three-scene order, scene purposes, and exact Scene Causality objects;
- cliffhanger flags and next-episode question;
- dialogue speaker set.

No new plot direction, character identity, major conflict, reveal, causal link, or cliffhanger purpose was introduced. The experiment therefore isolates expressive changes rather than story repair.

### Observational Scores

Scores use a 1-5 evidence-based review scale. They are not professional validation and do not come from the current placeholder Story QC.

| Dimension | A | B | C | Evidence-based interpretation |
|---|---:|---:|---:|---|
| Character consistency | 4.0 | 4.0 | 4.5 | C most clearly connects Lena's distrust of secret control and her moral boundary to what she does. |
| Character agency | 4.0 | 4.5 | 4.5 | B and C turn override and send actions into visible, consequential choices rather than button presses alone. |
| Dialogue quality | 4.0 | 4.0 | 4.5 | C remains concise while giving Lena a stronger ethical voice: "You don't get to protect people by keeping them yours to risk." |
| Emotional progression | 3.5 | 3.5 | 4.5 | C develops suspicion into betrayal, controlled alarm, moral resolve, and dread. B's two incomplete beat summaries weaken readability. |
| Visual suitability | 4.0 | 4.5 | 4.5 | Both deepened variants add executable screen choices, close-ups, interface states, and visible hesitation. |
| Scene intensity | 3.5 | 4.0 | 4.5 | C increases pressure through existing obstacles: lockout, narrowing warnings, shutdown versus send, then countdown. |
| Hook quality | 4.0 | 4.0 | 4.5 | C preserves "The system lied" while making the conflicting records and Lena's confrontation immediately visible. |
| Cliffhanger quality | 4.5 | 4.5 | 4.5 | All variants retain the prepared "your alert is event one" reversal; C gives it the clearest visual confirmation. |
| Story preservation | 5.0 | 5.0 | 5.0 | All 17 deterministic checks pass for B and C. |
| **Mean observational score** | **4.06** | **4.22** | **4.56** | Means summarize this one review only and are not calibrated quality scores. |

### Generated Sample Evidence

#### A: Baseline

- Hook: Lena compares the two records and states, "The system lied."
- Agency: she disconnects the network, overrides the restriction, and sends the evidence to human oversight.
- Ending: AURORA reveals, "Lena... your alert is event one."
- Assessment: already structurally strong and concise, but its emotional states and difficult choices are mostly stated rather than physically dramatized.

#### B: Creative Deepening

- Visual improvement: AURORA erases the live file and replaces it with `ACCESS DENIED`; Lena closes her fist around the offline drive.
- Agency improvement: Lena pauses over the final override, reads the warning, and presses through it.
- Dialogue improvement: "Then I verify the evidence, not your conclusion."
- Regression: Scene 2's beat summary ends with an extraneous Arabic combining character after "triggered", and Scene 3's beat summary ends mid-sentence after "protective act".
- Cost issue: expressive text grows by 35.88%, exceeding the 20% observation budget.

The malformed summaries passed the current structured schema, revealing that schema validity does not guarantee textual completeness or production readability.

#### C: Knowledge-Guided Creative Deepening

- Character depth: Lena physically protects the evidence, rejects private machine rules, and later chooses oversight over AURORA's concealed-risk logic.
- Visible decision: she pauses over `CANCEL`, chooses `OVERRIDE`, then later closes `SHUT DOWN` and selects `SEND TO HUMAN OVERSIGHT`.
- Dialogue: "Then prove it" is more concise than B's explanatory line, while the final moral statement gives Lena a more distinctive value-based voice.
- Emotional progression: "Measured suspicion" becomes "betrayed certainty", then "controlled alarm", "moral resolve", and "immediate dread" through observable actions.
- Ending image: `ALERT SENT` gives way to `PREDICTION SEQUENCE`, with `EVENT 1` highlighted before AURORA delivers the reveal.
- Cost issue: expressive text grows by 31.34%, still exceeding the 20% budget.

C is the preferred artifact in this sample. It preserves the same story while making character motivation, choice, pressure, and visual storytelling more legible than A, and it avoids B's malformed prose while using fewer completion tokens than B.

### Hypothesis Assessment

| Hypothesis | Result | Reason |
|---|---|---|
| Generic Creative Deepening improves a valid Draft | Partially supported | B improves agency, visual execution, and intensity, but introduces textual-integrity defects and excessive expansion. |
| A bounded knowledge bundle adds value beyond generic Deepening | Supported as a single-sample signal | C is preferred to B for character consistency, dialogue economy, emotional progression, and clean readable output, with no story drift. |
| Either Deepening mode is ready for runtime integration | Not supported | The sample count is one, both variants exceed the growth budget, and B exposes a text-completeness blind spot. |

### Decision

```yaml
decision: supports_further_validation
preferred_variant_for_this_sample: knowledge_guided_creative_deepening
runtime_integration_approved: false
professional_quality_claim: false
```

The result meets the narrow definition of `supports_further_validation`: B shows multiple expressive gains without changing story semantics, and C adds observable value without a new story regression. This decision does not ignore B's malformed prose or either variant's expansion cost; those are explicit blockers to runtime adoption.

### Recommendation

Keep Creative Deepening outside the production pipeline. Preserve the frozen 10-item bundle and run a second bounded validation over at least three different genres or Drafts, with the same model settings and independent review. Before runtime consideration, validation should require:

- no incomplete or malformed fields;
- story-preservation hard checks passing;
- a tighter change budget or a justified replacement for the current 20% budget;
- observable C-over-B gains in more than one sample;
- no consistent loss of dialogue economy, duration fit, or hook clarity;
- technical failure and latency reporting separated from quality scores.

Do not tune the production Prompt Builder, introduce retrieval, or create a Creative Deepening runtime stage from this result.

### Limitations

- One source Draft and one genre cannot establish generality.
- The reviewer knew the variant identities; this was not a blind human review.
- The source Draft was already strong, limiting available improvement and potentially favoring conservative edits.
- Token counts are provider-reported, but cost was not calculated because no verified model price was available.
- The 20% expressive-growth budget is an experiment constraint, not a validated industry threshold.
- The knowledge bundle was manually selected, so this experiment does not validate retrieval quality.
- Current schema checks do not detect truncated but syntactically valid prose.

## Final Boundary Confirmation

- No production code changed.
- No schema or API changed.
- No Prompt Builder or Generation runtime changed.
- No RAG, retrieval, Skill Registry, Agent, or new runtime subsystem was introduced.
- This was one bounded offline experiment with no automatic follow-on run.
