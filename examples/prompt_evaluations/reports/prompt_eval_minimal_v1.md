# Prompt Evaluation Report - prompt_eval_minimal_v1

- Benchmark Dataset: `us_female_dark_romance`
- ContentSpec ID: `3b7331b9-789e-4500-afe2-ffeef79c6fca`
- Overall Pass: `True`

## Overall Decision

- Best Variant: `strategy_v2_repeat`
- Why Keep It: `strategy_v2_repeat` is the strongest keep candidate because it leads on measurable comparison signals: average_latency_ms: 4.054 -> 2.596; repeat_validation_coverage: 1.000 -> 2.000.

## Notes

- Current Story QC remains a placeholder signal and must not be treated as a final script quality conclusion.

### Improvement Signals

- average_latency_ms: 4.054 -> 2.596
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
- Metrics: script=0.773, deterministic=0.800, story_qc=0.893, latency=4.054 ms
- Stability: title=1.000, hook=1.000, story_qc_range=0.000

### Explainability

#### Notable Output Changes

- This is the baseline variant used as the reference for later comparisons.

#### Side Effects

- Story QC remains placeholder-driven, so baseline QC numbers are not final quality truth.
- Baseline still misses some content-semantic checks, which creates room for future prompt optimization.

### Run 1

- Draft ID: `3df3341e-0d93-4f3e-add9-218ce866378b`
- Model: `mock` / `mock-script-generator`
- Latency: `4.054 ms`
- Story QC: `0.893` (placeholder)
- Script Score: `0.773`
- Title: mock_title_78398600
- Hook: mock_hook_78398600

#### Deterministic Checks

- `draft_schema_valid`: `True` | expected: DraftMasterScript instance | actual: DraftMasterScript
- `required_fields_complete`: `True` | expected: title, hook, synopsis, episode_goal, scenes and target duration must all be present | actual: title=True; hook=True; synopsis=True; episode_goal=True; scene_count=3
- `content_spec_requirement_applied`: `True` | expected: Draft should preserve content_spec_id and target_duration_seconds from the controlled generation request | actual: content_spec_id=3b7331b9-789e-4500-afe2-ffeef79c6fca; target_duration_seconds=45
- `prompt_versions_recorded`: `True` | expected: v1 | actual: v1
- `generation_strategy_version_recorded`: `True` | expected: v1 | actual: v1
- `hook_presence_and_type`: `False` | expected: identity reveal | actual: mock_hook_78398600
- `cliffhanger_presence_and_type`: `False` | expected: public betrayal escalation | actual: final_scene_cliffhanger=True; ending_text=Escalate the conflict and land the cliffhanger ending. Use retrieved assets and keep pacing aligned with the short-form episode goal. Advance the cliffhanger beat clearly. Express the target emotion: suspense.
- `protagonist_agency_visible`: `True` | expected: Lead character should make a visible choice, refusal, reveal or public move | actual: Advance the hook beat clearly. | Express the target emotion: revenge. | Establish the hook and the public-facing conflict immediately. Use retrieved assets and keep pacing aligned with the short-form episode goal. | Advance the conflict beat clearly. | Express the target emotion: revenge. | Increase pressure on the protagonist and sharpen the episode goal. Use retrieved assets 
- `scene_count_matches_request`: `True` | expected: 3 | actual: 3
- `output_language_matches_request`: `True` | expected: en | actual: en

## Variant `prompt_v2`

- Prompt IDs: prompt.story_planning.benchmark.v2
- Prompt Versions: v2
- GenerationStrategy: `strategy.tiktok.prompt_eval.prompt_v2` (v1)
- Pass: `True`
- Decision: Compared with baseline `prompt_v1`, this variant improves 1 measurable signals without introducing a hard regression.
- Recommended Action: Keep this variant in the next optimization round and use it as a challenger or replacement candidate.
- Metrics: script=0.773, deterministic=0.800, story_qc=0.893, latency=2.724 ms
- Stability: title=1.000, hook=1.000, story_qc_range=0.000
- Compared To: `prompt_v1`

### Explainability

#### Notable Output Changes

- Prompt version changed from v1 to v2.
- Draft title changed between variants, indicating output wording or planning changed.
- Hook text changed between variants, indicating the opening prompt behavior shifted.

#### Improved Metrics

- average_latency_ms: 4.054 -> 2.724

#### Side Effects

- Story QC remains placeholder-driven, so Story QC gains cannot yet be treated as final quality proof.
- Some content-semantic checks still fail, so the variant is stable but not yet strong on all benchmark expectations.

#### Why Better

- Latency improved without changing the controlled pipeline shape, so the same chain now returns faster.

### Run 1

- Draft ID: `fd7c9ad6-1881-4318-9cf8-4b363920fcf4`
- Model: `mock` / `mock-script-generator`
- Latency: `2.724 ms`
- Story QC: `0.893` (placeholder)
- Script Score: `0.773`
- Title: mock_title_b9830a41
- Hook: mock_hook_b9830a41

#### Deterministic Checks

- `draft_schema_valid`: `True` | expected: DraftMasterScript instance | actual: DraftMasterScript
- `required_fields_complete`: `True` | expected: title, hook, synopsis, episode_goal, scenes and target duration must all be present | actual: title=True; hook=True; synopsis=True; episode_goal=True; scene_count=3
- `content_spec_requirement_applied`: `True` | expected: Draft should preserve content_spec_id and target_duration_seconds from the controlled generation request | actual: content_spec_id=3b7331b9-789e-4500-afe2-ffeef79c6fca; target_duration_seconds=45
- `prompt_versions_recorded`: `True` | expected: v2 | actual: v2
- `generation_strategy_version_recorded`: `True` | expected: v1 | actual: v1
- `hook_presence_and_type`: `False` | expected: identity reveal | actual: mock_hook_b9830a41
- `cliffhanger_presence_and_type`: `False` | expected: public betrayal escalation | actual: final_scene_cliffhanger=True; ending_text=Escalate the conflict and land the cliffhanger ending. Use retrieved assets and keep pacing aligned with the short-form episode goal. Advance the cliffhanger beat clearly. Express the target emotion: suspense.
- `protagonist_agency_visible`: `True` | expected: Lead character should make a visible choice, refusal, reveal or public move | actual: Advance the hook beat clearly. | Express the target emotion: revenge. | Establish the hook and the public-facing conflict immediately. Use retrieved assets and keep pacing aligned with the short-form episode goal. | Advance the conflict beat clearly. | Express the target emotion: revenge. | Increase pressure on the protagonist and sharpen the episode goal. Use retrieved assets 
- `scene_count_matches_request`: `True` | expected: 3 | actual: 3
- `output_language_matches_request`: `True` | expected: en | actual: en

## Variant `strategy_v2_repeat`

- Prompt IDs: prompt.story_planning.benchmark.v2
- Prompt Versions: v2
- GenerationStrategy: `strategy.tiktok.prompt_eval.strategy_v2` (v2)
- Pass: `True`
- Decision: Compared with baseline `prompt_v1`, this variant improves 2 measurable signals without introducing a hard regression.
- Recommended Action: Keep this variant in the next optimization round and use it as a challenger or replacement candidate.
- Metrics: script=0.773, deterministic=0.800, story_qc=0.893, latency=2.596 ms
- Stability: title=1.000, hook=1.000, story_qc_range=0.000
- Compared To: `prompt_v1`

### Explainability

#### Notable Output Changes

- Prompt version changed from v1 to v2.
- GenerationStrategy version changed from v1 to v2.
- Draft title changed between variants, indicating output wording or planning changed.
- Hook text changed between variants, indicating the opening prompt behavior shifted.

#### Improved Metrics

- average_latency_ms: 4.054 -> 2.596
- repeat_validation_coverage: 1.000 -> 2.000

#### Side Effects

- Story QC remains placeholder-driven, so Story QC gains cannot yet be treated as final quality proof.
- Some content-semantic checks still fail, so the variant is stable but not yet strong on all benchmark expectations.

#### Why Better

- Latency improved without changing the controlled pipeline shape, so the same chain now returns faster.
- This variant was validated across more repeated runs, so we have stronger stability evidence.

### Run 1

- Draft ID: `6a3aa66a-9bac-4a55-b020-2e33b80f2826`
- Model: `mock` / `mock-script-generator`
- Latency: `2.638 ms`
- Story QC: `0.893` (placeholder)
- Script Score: `0.773`
- Title: mock_title_b11e1a8c
- Hook: mock_hook_b11e1a8c

#### Deterministic Checks

- `draft_schema_valid`: `True` | expected: DraftMasterScript instance | actual: DraftMasterScript
- `required_fields_complete`: `True` | expected: title, hook, synopsis, episode_goal, scenes and target duration must all be present | actual: title=True; hook=True; synopsis=True; episode_goal=True; scene_count=3
- `content_spec_requirement_applied`: `True` | expected: Draft should preserve content_spec_id and target_duration_seconds from the controlled generation request | actual: content_spec_id=3b7331b9-789e-4500-afe2-ffeef79c6fca; target_duration_seconds=45
- `prompt_versions_recorded`: `True` | expected: v2 | actual: v2
- `generation_strategy_version_recorded`: `True` | expected: v2 | actual: v2
- `hook_presence_and_type`: `False` | expected: identity reveal | actual: mock_hook_b11e1a8c
- `cliffhanger_presence_and_type`: `False` | expected: public betrayal escalation | actual: final_scene_cliffhanger=True; ending_text=Escalate the conflict and land the cliffhanger ending. Use retrieved assets and keep pacing aligned with the short-form episode goal. Advance the cliffhanger beat clearly. Express the target emotion: suspense.
- `protagonist_agency_visible`: `True` | expected: Lead character should make a visible choice, refusal, reveal or public move | actual: Advance the hook beat clearly. | Express the target emotion: revenge. | Establish the hook and the public-facing conflict immediately. Use retrieved assets and keep pacing aligned with the short-form episode goal. | Advance the conflict beat clearly. | Express the target emotion: revenge. | Increase pressure on the protagonist and sharpen the episode goal. Use retrieved assets 
- `scene_count_matches_request`: `True` | expected: 3 | actual: 3
- `output_language_matches_request`: `True` | expected: en | actual: en

### Run 2

- Draft ID: `303f8910-72b6-49f2-9b4b-de3fffbd4a54`
- Model: `mock` / `mock-script-generator`
- Latency: `2.554 ms`
- Story QC: `0.893` (placeholder)
- Script Score: `0.773`
- Title: mock_title_b11e1a8c
- Hook: mock_hook_b11e1a8c

#### Deterministic Checks

- `draft_schema_valid`: `True` | expected: DraftMasterScript instance | actual: DraftMasterScript
- `required_fields_complete`: `True` | expected: title, hook, synopsis, episode_goal, scenes and target duration must all be present | actual: title=True; hook=True; synopsis=True; episode_goal=True; scene_count=3
- `content_spec_requirement_applied`: `True` | expected: Draft should preserve content_spec_id and target_duration_seconds from the controlled generation request | actual: content_spec_id=3b7331b9-789e-4500-afe2-ffeef79c6fca; target_duration_seconds=45
- `prompt_versions_recorded`: `True` | expected: v2 | actual: v2
- `generation_strategy_version_recorded`: `True` | expected: v2 | actual: v2
- `hook_presence_and_type`: `False` | expected: identity reveal | actual: mock_hook_b11e1a8c
- `cliffhanger_presence_and_type`: `False` | expected: public betrayal escalation | actual: final_scene_cliffhanger=True; ending_text=Escalate the conflict and land the cliffhanger ending. Use retrieved assets and keep pacing aligned with the short-form episode goal. Advance the cliffhanger beat clearly. Express the target emotion: suspense.
- `protagonist_agency_visible`: `True` | expected: Lead character should make a visible choice, refusal, reveal or public move | actual: Advance the hook beat clearly. | Express the target emotion: revenge. | Establish the hook and the public-facing conflict immediately. Use retrieved assets and keep pacing aligned with the short-form episode goal. | Advance the conflict beat clearly. | Express the target emotion: revenge. | Increase pressure on the protagonist and sharpen the episode goal. Use retrieved assets 
- `scene_count_matches_request`: `True` | expected: 3 | actual: 3
- `output_language_matches_request`: `True` | expected: en | actual: en
