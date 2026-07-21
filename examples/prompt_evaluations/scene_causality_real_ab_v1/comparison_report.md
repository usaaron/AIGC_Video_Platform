# Scene Causality Real LLM A/B v1

## Decision

`validated_for_next_step`

Two of three improved drafts were clearly preferred, and no candidate showed a major structural regression. This is an observational development review, not professional screenwriter validation.

## Fixed Conditions

- Model: `openai_compatible / gpt-5.6-sol`
- Parameters: `temperature=0.6`, `top_p=0.9`, `max_tokens=4000`
- Output: English, 3 scenes, 45-second target
- Platform Profile: `tiktok_benchmark_v1`
- Baseline: Prompt `v2-baseline`, Prompt Builder `v0.1-ab-baseline`
- Improved: Prompt `v3-scene-causality`, Prompt Builder `v0.2`
- Samples: one generation per variant for each of three fixed ContentSpecs

## Scores

| Dataset | Variant | Causal | Agency | Escalation | Filler | Earned Ending | Overall | Preferred |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| US Female Dark Romance | Baseline | 5 | 5 | 5 | 5 | 5 | 5 | Yes |
| US Female Dark Romance | Improved | 5 | 5 | 5 | 5 | 4 | 4 | No |
| Supernatural Romance | Baseline | 3 | 4 | 3 | 3 | 5 | 3 | No |
| Supernatural Romance | Improved | 5 | 5 | 5 | 5 | 4 | 4 | Yes |
| Revenge Drama | Baseline | 4 | 5 | 4 | 4 | 4 | 4 | No |
| Revenge Drama | Improved | 5 | 5 | 5 | 5 | 5 | 5 | Yes |

## Pairwise Findings

### US Female Dark Romance

The baseline is preferred. Both drafts form complete causal chains, but the baseline makes Elena's keycard theft enable the boardroom breach, then makes her publication directly expose her mother's location. The improved countdown is coherent but more mechanical and verbose.

### Supernatural Romance

The improved draft is preferred. The baseline inserts a flashback after the altar betrayal; that scene explains an earlier event rather than advancing from its outcome. The improved version moves forward from evidence control, to Mara's public choice, to hunter retaliation. Its tradeoff is a slower opening and a less surprising final reveal.

### Revenge Drama

The improved draft is preferred. The signed agreement triggers Ethan's rebuttal, which forces Ava to release the recording, which triggers a board review where the hidden first page becomes an earned reversal. The baseline's mystery-husband reveal is compelling but less prepared by the prior evidence chain.

## Aggregate Result

- Improved preferred: 2/3
- Major structural regressions: 0
- Average causal clarity: `4.0 -> 5.0`
- Average conflict escalation: `4.0 -> 5.0`
- Average filler reduction: `4.0 -> 5.0`
- Average overall preference: `4.0 -> 4.333`
- Average earned ending: `4.667 -> 4.333`
- Average total tokens: `7488.667 -> 8687.0` (`+16.0%`)

## Limitations

Both variants use the current structured schema, so baseline outputs also contain SceneCausality fields; the experiment isolates instruction strength rather than schema presence. One sample per variant cannot remove model variance. Explicit causality also increased verbosity and did not consistently improve cliffhanger surprise.

## Recommendation

Keep Scene Causality v1 unchanged for the next checkpoint. Do not tune the prompt from this single bounded A/B; retain token cost, possible mechanical plotting, and ending quality as recorded risks for future validation.
