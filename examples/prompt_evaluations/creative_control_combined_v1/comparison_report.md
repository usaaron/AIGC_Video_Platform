# Creative Control Combined v1

**Decision:** `validated_for_runtime_design`

## Thresholds

- PASS: `structured_control_preferred_at_least_two_of_three`
- PASS: `average_character_consistency_improved`
- PASS: `average_character_agency_improved`
- PASS: `no_significant_hook_or_cliffhanger_regression`
- PASS: `context_growth_acceptable`
- PASS: `no_major_structural_regression`

## Pairwise Results

- `dark_romance_revenge`: preferred `structured_creative_control`; Candidate 2 preserves the same strong hook and causal structure while giving both leads more specific, testable decision logic and a more credible conditional alliance.
- `supernatural_romance`: preferred `structured_creative_control`; Candidate 2 makes trust progression observable: Rhea tests the claim, Lucian demonstrates restraint, and only then does she choose a bounded alliance.
- `sci_fi_mystery`: preferred `structured_creative_control`; Candidate 1 sustains a two-sided safety conflict and makes Lena's responsible choice trigger the uncertainty; Candidate 2 is punchier but weakens character consistency through an abrupt hostile-AI turn.

## Average Dimension Deltas

- `character_consistency`: `+1.167`
- `character_agency`: `+0.500`
- `conflict_quality`: `+0.667`
- `emotional_progression`: `+0.500`
- `scene_causality`: `+0.500`
- `hook_quality`: `+0.000`
- `cliffhanger_quality`: `+0.167`

## Output Cost

| Metric | Baseline | Structured control |
|---|---:|---:|
| Average prompt tokens | 5262.0 | 5756.667 |
| Average completion tokens | 1957.0 | 2309.0 |
| Average total tokens | 7219.0 | 8065.667 |
| Average latency seconds | 46.238 | 54.721 |

Average prompt-token growth was `9.401%`, below the pre-registered `15.0%` limit.

## Limitations

- This is one bounded generation per variant and case, not a stability study.
- The blind review is an AI-assisted observational review, not professional validation.
- The experiment tests context injection, not a runtime Creative Intent contract.
- Current Story QC remains placeholder and is not used as the decision authority.
