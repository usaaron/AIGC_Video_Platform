# Prompt Evaluation Report - prompt_eval_minimal_v1

- Benchmark Dataset: `us_female_dark_romance`
- ContentSpec ID: `11efd202-0533-428b-9c17-e8beec0cb709`
- Overall Pass: `True`

## Overall Decision

- Best Variant: `strategy_v2_repeat`
- Why Keep It: `strategy_v2_repeat` is the strongest keep candidate because it leads on measurable comparison signals: average_latency_ms: 5.424 -> 2.986; repeat_validation_coverage: 1.000 -> 2.000.

## Notes

- Current Story QC remains a placeholder signal and must not be treated as a final script quality conclusion.

### Improvement Signals

- average_latency_ms: 5.424 -> 2.986
- repeat_validation_coverage: 1.000 -> 2.000

### Side Effects

- Baseline still misses some content-semantic checks, which creates room for future prompt optimization.
- Some content-semantic checks still fail, so the variant is stable but not yet strong on all benchmark expectations.
- Story QC remains placeholder-driven, so Story QC gains cannot yet be treated as final quality proof.
- Story QC remains placeholder-driven, so baseline QC numbers are not final quality truth.

### Next Optimization Targets

- Dialogue Quality: Replace generic lines with concrete, high-stakes phrasing.
- Hook: Strengthen the opening reveal or contradiction.
- Character Agency: Add an explicit choice or refusal beat for the protagonist.
- Hook realization: make the hook match the benchmark hook type more explicitly.
- Cliffhanger realization: make the ending pressure match the benchmark cliffhanger type more explicitly.

## Variant `prompt_v1`

- Prompt IDs: prompt.story_planning.benchmark.v1
- Prompt Versions: v1
- GenerationStrategy: `strategy.tiktok.prompt_eval.prompt_v1` (v1)
- Pass: `True`
- Decision: Baseline variant retained as the comparison anchor for later prompt and strategy changes.
- Recommended Action: Keep as the control variant so future prompt or strategy changes remain measurable.
- Recommended Variant: `False`
- Metrics: script=0.773, deterministic=0.800, story_qc=0.893, latency=5.424 ms
- Stability: title=1.000, hook=1.000, story_qc_range=0.000
- Recommendation Reason: Baseline variant remains the control reference for later prompt and strategy comparisons.
- Confidence Note: Baseline confidence is limited because Story QC still contains placeholder signals.

### Explainability

#### Notable Output Changes

- This is the baseline variant used as the reference for later comparisons.

#### Unchanged Dimensions

- baseline_reference

#### Side Effects

- Story QC remains placeholder-driven, so baseline QC numbers are not final quality truth.
- Baseline still misses some content-semantic checks, which creates room for future prompt optimization.

### Run 1

- Draft ID: `ae5cdff0-1d4c-455a-ba44-e82a68e038b0`
- Model: `mock` / `mock-script-generator`
- Latency: `5.424 ms`
- Story QC: `0.893` (placeholder)
- Script Score: `0.773`
- Title: mock_title_4afb0190
- Hook: mock_hook_4afb0190

#### Deterministic Checks

- `draft_schema_valid`: `True` | expected: DraftMasterScript instance | actual: DraftMasterScript
- `required_fields_complete`: `True` | expected: title, hook, synopsis, episode_goal, scenes and target duration must all be present | actual: title=True; hook=True; synopsis=True; episode_goal=True; scene_count=3
- `content_spec_requirement_applied`: `True` | expected: Draft should preserve content_spec_id and target_duration_seconds from the controlled generation request | actual: content_spec_id=11efd202-0533-428b-9c17-e8beec0cb709; target_duration_seconds=45
- `prompt_versions_recorded`: `True` | expected: v1 | actual: v1
- `generation_strategy_version_recorded`: `True` | expected: v1 | actual: v1
- `hook_presence_and_type`: `False` | expected: identity reveal | actual: mock_hook_4afb0190
- `cliffhanger_presence_and_type`: `False` | expected: public betrayal escalation | actual: final_scene_cliffhanger=True; ending_text=Escalate the conflict and land the cliffhanger ending. Use retrieved assets and keep pacing aligned with the short-form episode goal. Advance the cliffhanger beat clearly. Express the target emotion: suspense.
- `protagonist_agency_visible`: `True` | expected: Lead character should make a visible choice, refusal, reveal or public move | actual: Advance the hook beat clearly. | Express the target emotion: revenge. | Establish the hook and the public-facing conflict immediately. Use retrieved assets and keep pacing aligned with the short-form episode goal. | Advance the conflict beat clearly. | Express the target emotion: revenge. | Increase pressure on the protagonist and sharpen the episode goal. Use retrieved assets 
- `scene_count_matches_request`: `True` | expected: 3 | actual: 3
- `output_language_matches_request`: `True` | expected: en | actual: en

#### Story QC Dimensions

- `hook_quality`: score=2.500 | summary=Opening hook exists, but the conflict or viewer question is still soft.
- `character_agency`: score=2.500 | summary=The protagonist is present, but their agency is not explicit enough yet.
- `conflict_escalation`: score=4.500 | summary=The scenes build toward a stronger public or relational threat by the ending.
- `emotional_payoff`: score=4.500 | summary=The script sets up emotional expectation and lands meaningful turns between scenes.
- `cliffhanger_strength`: score=5.000 | summary=The ending creates strong unresolved pressure that should pull viewers into the next episode.

## Variant `prompt_v2`

- Prompt IDs: prompt.story_planning.benchmark.v2
- Prompt Versions: v2
- GenerationStrategy: `strategy.tiktok.prompt_eval.prompt_v2` (v1)
- Pass: `True`
- Decision: Compared with baseline `prompt_v1`, this variant improves 1 measurable signals without introducing a hard regression.
- Recommended Action: Keep this variant in the next optimization round and use it as a challenger or replacement candidate.
- Recommended Variant: `False`
- Metrics: script=0.773, deterministic=0.800, story_qc=0.893, latency=3.073 ms
- Stability: title=1.000, hook=1.000, story_qc_range=0.000
- Compared To: `prompt_v1`
- Recommendation Reason: Compared with baseline `prompt_v1`, this variant improves 1 measurable signals without introducing a hard regression.
- Confidence Note: Aggregate scores are very close, so keep this comparison as directional evidence rather than a decisive winner.

### Explainability

#### Notable Output Changes

- Prompt version changed from v1 to v2.
- Draft title changed between variants, indicating output wording or planning changed.
- Hook text changed between variants, indicating the opening prompt behavior shifted.

#### Story QC Dimension Deltas

- `character_agency`: 2.500 -> 2.500 (+0.000, unchanged)
  Summary: The protagonist is present, but their agency is not explicit enough yet.
  Scene Refs: 1
- `cliffhanger_strength`: 5.000 -> 5.000 (+0.000, unchanged)
  Summary: The ending creates strong unresolved pressure that should pull viewers into the next episode.
  Scene Refs: 3
  Evidence: Final emotional shift: suspense_to_suspense
- `conflict_escalation`: 4.500 -> 4.500 (+0.000, unchanged)
  Summary: The scenes build toward a stronger public or relational threat by the ending.
  Scene Refs: 1, 2, 3
  Evidence: Scene 1 purpose: Establish the hook and the public-facing conflict immediately.
- `emotional_payoff`: 4.500 -> 4.500 (+0.000, unchanged)
  Summary: The script sets up emotional expectation and lands meaningful turns between scenes.
  Scene Refs: 1, 2, 3
  Evidence: Scene 1 emotional shift: revenge_to_hook
- `hook_quality`: 2.500 -> 2.500 (+0.000, unchanged)
  Summary: Opening hook exists, but the conflict or viewer question is still soft.
  Scene Refs: 1
  Evidence: Hook: mock_hook_dcbcef77

#### Improved Metrics

- average_latency_ms: 5.424 -> 3.073

#### Unchanged Dimensions

- character_agency
- cliffhanger_strength
- conflict_escalation
- emotional_payoff
- hook_quality

#### Side Effects

- Story QC remains placeholder-driven, so Story QC gains cannot yet be treated as final quality proof.
- Some content-semantic checks still fail, so the variant is stable but not yet strong on all benchmark expectations.

#### Why Better

- Latency improved without changing the controlled pipeline shape, so the same chain now returns faster.

### Run 1

- Draft ID: `01d17df6-19e0-4281-8d88-b36e58bb78e9`
- Model: `mock` / `mock-script-generator`
- Latency: `3.073 ms`
- Story QC: `0.893` (placeholder)
- Script Score: `0.773`
- Title: mock_title_dcbcef77
- Hook: mock_hook_dcbcef77

#### Deterministic Checks

- `draft_schema_valid`: `True` | expected: DraftMasterScript instance | actual: DraftMasterScript
- `required_fields_complete`: `True` | expected: title, hook, synopsis, episode_goal, scenes and target duration must all be present | actual: title=True; hook=True; synopsis=True; episode_goal=True; scene_count=3
- `content_spec_requirement_applied`: `True` | expected: Draft should preserve content_spec_id and target_duration_seconds from the controlled generation request | actual: content_spec_id=11efd202-0533-428b-9c17-e8beec0cb709; target_duration_seconds=45
- `prompt_versions_recorded`: `True` | expected: v2 | actual: v2
- `generation_strategy_version_recorded`: `True` | expected: v1 | actual: v1
- `hook_presence_and_type`: `False` | expected: identity reveal | actual: mock_hook_dcbcef77
- `cliffhanger_presence_and_type`: `False` | expected: public betrayal escalation | actual: final_scene_cliffhanger=True; ending_text=Escalate the conflict and land the cliffhanger ending. Use retrieved assets and keep pacing aligned with the short-form episode goal. Advance the cliffhanger beat clearly. Express the target emotion: suspense.
- `protagonist_agency_visible`: `True` | expected: Lead character should make a visible choice, refusal, reveal or public move | actual: Advance the hook beat clearly. | Express the target emotion: revenge. | Establish the hook and the public-facing conflict immediately. Use retrieved assets and keep pacing aligned with the short-form episode goal. | Advance the conflict beat clearly. | Express the target emotion: revenge. | Increase pressure on the protagonist and sharpen the episode goal. Use retrieved assets 
- `scene_count_matches_request`: `True` | expected: 3 | actual: 3
- `output_language_matches_request`: `True` | expected: en | actual: en

#### Story QC Dimensions

- `hook_quality`: score=2.500 | summary=Opening hook exists, but the conflict or viewer question is still soft.
- `character_agency`: score=2.500 | summary=The protagonist is present, but their agency is not explicit enough yet.
- `conflict_escalation`: score=4.500 | summary=The scenes build toward a stronger public or relational threat by the ending.
- `emotional_payoff`: score=4.500 | summary=The script sets up emotional expectation and lands meaningful turns between scenes.
- `cliffhanger_strength`: score=5.000 | summary=The ending creates strong unresolved pressure that should pull viewers into the next episode.

## Variant `strategy_v2_repeat`

- Prompt IDs: prompt.story_planning.benchmark.v2
- Prompt Versions: v2
- GenerationStrategy: `strategy.tiktok.prompt_eval.strategy_v2` (v2)
- Pass: `True`
- Decision: Compared with baseline `prompt_v1`, this variant improves 2 measurable signals without introducing a hard regression.
- Recommended Action: Keep this variant in the next optimization round and use it as a challenger or replacement candidate.
- Recommended Variant: `True`
- Metrics: script=0.773, deterministic=0.800, story_qc=0.893, latency=2.986 ms
- Stability: title=1.000, hook=1.000, story_qc_range=0.000
- Compared To: `prompt_v1`
- Recommendation Reason: `strategy_v2_repeat` is the strongest keep candidate because it leads on measurable comparison signals: average_latency_ms: 5.424 -> 2.986; repeat_validation_coverage: 1.000 -> 2.000.
- Confidence Note: Aggregate scores are very close, so keep this comparison as directional evidence rather than a decisive winner.

### Explainability

#### Notable Output Changes

- Prompt version changed from v1 to v2.
- GenerationStrategy version changed from v1 to v2.
- Draft title changed between variants, indicating output wording or planning changed.
- Hook text changed between variants, indicating the opening prompt behavior shifted.

#### Story QC Dimension Deltas

- `character_agency`: 2.500 -> 2.500 (+0.000, unchanged)
  Summary: The protagonist is present, but their agency is not explicit enough yet.
  Scene Refs: 1
- `cliffhanger_strength`: 5.000 -> 5.000 (+0.000, unchanged)
  Summary: The ending creates strong unresolved pressure that should pull viewers into the next episode.
  Scene Refs: 3
  Evidence: Final emotional shift: suspense_to_suspense
- `conflict_escalation`: 4.500 -> 4.500 (+0.000, unchanged)
  Summary: The scenes build toward a stronger public or relational threat by the ending.
  Scene Refs: 1, 2, 3
  Evidence: Scene 1 purpose: Establish the hook and the public-facing conflict immediately.
- `emotional_payoff`: 4.500 -> 4.500 (+0.000, unchanged)
  Summary: The script sets up emotional expectation and lands meaningful turns between scenes.
  Scene Refs: 1, 2, 3
  Evidence: Scene 1 emotional shift: revenge_to_hook
- `hook_quality`: 2.500 -> 2.500 (+0.000, unchanged)
  Summary: Opening hook exists, but the conflict or viewer question is still soft.
  Scene Refs: 1
  Evidence: Hook: mock_hook_2a48806d

#### Improved Metrics

- average_latency_ms: 5.424 -> 2.986
- repeat_validation_coverage: 1.000 -> 2.000

#### Unchanged Dimensions

- character_agency
- cliffhanger_strength
- conflict_escalation
- emotional_payoff
- hook_quality

#### Side Effects

- Story QC remains placeholder-driven, so Story QC gains cannot yet be treated as final quality proof.
- Some content-semantic checks still fail, so the variant is stable but not yet strong on all benchmark expectations.

#### Why Better

- Latency improved without changing the controlled pipeline shape, so the same chain now returns faster.
- This variant was validated across more repeated runs, so we have stronger stability evidence.

### Run 1

- Draft ID: `cec2c8d4-bb39-4771-b448-0d188816921c`
- Model: `mock` / `mock-script-generator`
- Latency: `3.032 ms`
- Story QC: `0.893` (placeholder)
- Script Score: `0.773`
- Title: mock_title_2a48806d
- Hook: mock_hook_2a48806d

#### Deterministic Checks

- `draft_schema_valid`: `True` | expected: DraftMasterScript instance | actual: DraftMasterScript
- `required_fields_complete`: `True` | expected: title, hook, synopsis, episode_goal, scenes and target duration must all be present | actual: title=True; hook=True; synopsis=True; episode_goal=True; scene_count=3
- `content_spec_requirement_applied`: `True` | expected: Draft should preserve content_spec_id and target_duration_seconds from the controlled generation request | actual: content_spec_id=11efd202-0533-428b-9c17-e8beec0cb709; target_duration_seconds=45
- `prompt_versions_recorded`: `True` | expected: v2 | actual: v2
- `generation_strategy_version_recorded`: `True` | expected: v2 | actual: v2
- `hook_presence_and_type`: `False` | expected: identity reveal | actual: mock_hook_2a48806d
- `cliffhanger_presence_and_type`: `False` | expected: public betrayal escalation | actual: final_scene_cliffhanger=True; ending_text=Escalate the conflict and land the cliffhanger ending. Use retrieved assets and keep pacing aligned with the short-form episode goal. Advance the cliffhanger beat clearly. Express the target emotion: suspense.
- `protagonist_agency_visible`: `True` | expected: Lead character should make a visible choice, refusal, reveal or public move | actual: Advance the hook beat clearly. | Express the target emotion: revenge. | Establish the hook and the public-facing conflict immediately. Use retrieved assets and keep pacing aligned with the short-form episode goal. | Advance the conflict beat clearly. | Express the target emotion: revenge. | Increase pressure on the protagonist and sharpen the episode goal. Use retrieved assets 
- `scene_count_matches_request`: `True` | expected: 3 | actual: 3
- `output_language_matches_request`: `True` | expected: en | actual: en

#### Story QC Dimensions

- `hook_quality`: score=2.500 | summary=Opening hook exists, but the conflict or viewer question is still soft.
- `character_agency`: score=2.500 | summary=The protagonist is present, but their agency is not explicit enough yet.
- `conflict_escalation`: score=4.500 | summary=The scenes build toward a stronger public or relational threat by the ending.
- `emotional_payoff`: score=4.500 | summary=The script sets up emotional expectation and lands meaningful turns between scenes.
- `cliffhanger_strength`: score=5.000 | summary=The ending creates strong unresolved pressure that should pull viewers into the next episode.

### Run 2

- Draft ID: `4f9dd775-1527-45b5-a8ce-881e7d379573`
- Model: `mock` / `mock-script-generator`
- Latency: `2.94 ms`
- Story QC: `0.893` (placeholder)
- Script Score: `0.773`
- Title: mock_title_2a48806d
- Hook: mock_hook_2a48806d

#### Deterministic Checks

- `draft_schema_valid`: `True` | expected: DraftMasterScript instance | actual: DraftMasterScript
- `required_fields_complete`: `True` | expected: title, hook, synopsis, episode_goal, scenes and target duration must all be present | actual: title=True; hook=True; synopsis=True; episode_goal=True; scene_count=3
- `content_spec_requirement_applied`: `True` | expected: Draft should preserve content_spec_id and target_duration_seconds from the controlled generation request | actual: content_spec_id=11efd202-0533-428b-9c17-e8beec0cb709; target_duration_seconds=45
- `prompt_versions_recorded`: `True` | expected: v2 | actual: v2
- `generation_strategy_version_recorded`: `True` | expected: v2 | actual: v2
- `hook_presence_and_type`: `False` | expected: identity reveal | actual: mock_hook_2a48806d
- `cliffhanger_presence_and_type`: `False` | expected: public betrayal escalation | actual: final_scene_cliffhanger=True; ending_text=Escalate the conflict and land the cliffhanger ending. Use retrieved assets and keep pacing aligned with the short-form episode goal. Advance the cliffhanger beat clearly. Express the target emotion: suspense.
- `protagonist_agency_visible`: `True` | expected: Lead character should make a visible choice, refusal, reveal or public move | actual: Advance the hook beat clearly. | Express the target emotion: revenge. | Establish the hook and the public-facing conflict immediately. Use retrieved assets and keep pacing aligned with the short-form episode goal. | Advance the conflict beat clearly. | Express the target emotion: revenge. | Increase pressure on the protagonist and sharpen the episode goal. Use retrieved assets 
- `scene_count_matches_request`: `True` | expected: 3 | actual: 3
- `output_language_matches_request`: `True` | expected: en | actual: en

#### Story QC Dimensions

- `hook_quality`: score=2.500 | summary=Opening hook exists, but the conflict or viewer question is still soft.
- `character_agency`: score=2.500 | summary=The protagonist is present, but their agency is not explicit enough yet.
- `conflict_escalation`: score=4.500 | summary=The scenes build toward a stronger public or relational threat by the ending.
- `emotional_payoff`: score=4.500 | summary=The script sets up emotional expectation and lands meaningful turns between scenes.
- `cliffhanger_strength`: score=5.000 | summary=The ending creates strong unresolved pressure that should pull viewers into the next episode.
