# Serialized Story Planning v1 - Offline A/B Validation Report

## Decision

**revise planning concept**

Planning is promising but is not yet approved for runtime integration.

The Planned variant was preferred in Dark Romance and Revenge Drama. The Direct variant was preferred in Supernatural Romance, where the fixed plan repeated the same rescue-and-memory-loss mechanism across three episodes. This is direct evidence of the requested over-planning / rigidity risk.

## Experiment Setup

| Setting | Value |
|---|---|
| Provider | `openai_compatible` |
| Model | `gpt-5.6-sol` |
| Temperature | `0.6` |
| Top-p | `0.9` |
| Max tokens | `4000` |
| Reasoning effort | `low` |
| Prompt version | `serialized_story_planning_offline_ab.v1.1-bounded` |
| Strategy | `strategy.serialized_story_planning.offline_ab.v1.1` |
| Language | `en` |
| Platform profile | `tiktok_benchmark_v1` |
| Stories | `3` |
| Episodes per story/variant | `4` |
| Scenes per episode | `3` |
| Total real generations | `24` |

The default reasoning attempt was technically aborted after repeated provider `524` responses and was excluded. The bounded experiment used one consistent profile for every Direct and Planned generation.

## Generated Story Sets

- Dark Romance Direct: `dark_romance/direct/`
- Dark Romance Planned: `dark_romance/planned/`
- Supernatural Romance Direct: `supernatural_romance/direct/`
- Supernatural Romance Planned: `supernatural_romance/planned/`
- Revenge Drama Direct: `revenge_drama/direct/`
- Revenge Drama Planned: `revenge_drama/planned/`

All paths are relative to:

`examples/prompt_evaluations/serialized_story_planning_real_ab_v1_bounded/`

## Blind Review Method

Candidate identities were hidden during review. Scores and evidence were saved to `blind_review/blind_review_locked.json` before `blind_review/blind_key.json` was read.

This was one AI reviewer, not an independent professional human panel. Scores are engineering signals only.

## Pairwise Results

| Story | Direct average | Planned average | Preferred | Main reason |
|---|---:|---:|---|---|
| Dark Romance | 4.556 | 4.889 | Planned | Stronger long-range evidence chain and reciprocal character progression |
| Supernatural Romance | 4.889 | 4.278 | Direct | Planned repeated rescue → memory loss and became mechanically visible |
| Revenge Drama | 4.389 | 4.833 | Planned | Better episode differentiation, setup/payoff and accountability arc |

### Dark Romance

Planned strengths:

- Panic button, recording, exit code and escrow form a traceable setup/payoff chain.
- Mara's autonomy remains stable while trust changes through evidence and reciprocal sacrifice.
- Each episode changes both evidence and relationship state.

Direct strengths:

- Stronger immediate hooks and more aggressive cliffhangers.
- Clear refusal to treat coercion as romance or absolution.

Risk:

- Direct repeatedly escalates through another hidden file, authorization layer or cleanup threat.
- Planned has a lower-stakes final continuation question and malformed synopsis endings.

### Supernatural Romance

Direct strengths:

- Future murder, memory vial, identity double and Archivist create varied escalation.
- Present choice versus stolen memory produces an earned emotional ending.
- Stronger hook, cliffhanger and long-term retention signal.

Planned strengths:

- Silver tag, blank journal and “remember me forward” are easy to trace.
- Ethical motivation and voluntary choice remain stable.

Regression:

- Episodes 1-3 repeat rescue followed by Rowan's memory loss.
- The shared archive resolution has limited earlier causal preparation.
- This is a material story-level rigidity failure even though individual episodes remain structurally valid.

### Revenge Drama

Planned strengths:

- Unsigned calculation, drill map and altered load file have distinct setup/payoff roles.
- Tessa moves from personal vindication to public accountability through observable decisions.
- Episodes have clear discovery, planning, sacrifice and payoff responsibilities.

Direct strengths:

- Strong immediate visual stakes and continuation pressure.
- Maya consistently protects residents over her reputation.

Risk:

- Direct repeats another defective building or remote sabotage escalation.
- Some engineering solutions feel driven by convenience rather than established capability.
- Planned is more procedural than emotionally intimate.

## Aggregate Quality Change

| Category | Direct | Planned | Delta |
|---|---:|---:|---:|
| Overall mean across all dimensions | 4.611 | 4.667 | +0.056 |
| Story coherence | 4.556 | 4.667 | +0.111 |
| Character consistency and growth | 4.750 | 4.917 | +0.167 |
| Serialization quality | 4.600 | 4.867 | +0.267 |
| Commercial quality | 4.600 | 4.333 | -0.267 |

Strongest improvements:

- Setup/payoff completion: `+1.000`
- Repetition control: `+0.667`

Largest regressions:

- Hook strength: `-1.000`
- Cliffhanger quality: `-1.000`
- Conflict escalation: `-0.333`

Planning therefore improved long-range structure more than total readable quality. The overall mean gain was only `+0.056/5`.

## Engineering Cost

| Metric | Direct | Planned | Change |
|---|---:|---:|---:|
| Total tokens | 39,259 | 41,943 | +6.837% |
| Prompt tokens | 17,156 | 22,609 | +31.785% |
| Completion tokens | 22,103 | 19,334 | -12.528% |
| Total latency | 702.920s | 552.826s | -21.353% |
| Prompt characters | 40,267 | 65,905 | +63.670% |
| Successful generations | 12/12 | 12/12 | Equal |

The total token increase is modest in this experiment, but planning context is not compact. The latency reduction is observational and must not be assumed to generalize.

## Success Criteria

Passed:

- Planned preferred in at least 2/3 stories.
- No major single-episode structural regression.
- Character consistency/growth improved in aggregate.
- Setup/payoff completion improved.
- Planned preferred overall.
- Total token increase was observationally acceptable.

Not passed or incomplete:

- Commercial quality was not preserved: Hook and Cliffhanger averages fell.
- Supernatural Romance had a material story-level rigidity regression.
- Independent professional human review was not completed.
- Stability across repeated generations was not tested.

## Required Revision Before Runtime

1. Keep Story Blueprint direction and setup/payoff references.
2. Make Episode Plans responsibility-focused rather than repeatedly prescribing one conflict mechanism.
3. Preserve creative freedom for Hook, Cliffhanger and escalation realization.
4. Check adjacent plans for repeated dramatic mechanisms during offline validation.
5. Compress planning context before runtime contract design.
6. Obtain independent human review of the existing blinded artifacts.
7. Treat malformed synopsis endings as a separate shared output-quality issue.

No automatic second A/B is started by this report.

## Boundary Confirmation

- No production code changed.
- No schema changed.
- No API changed.
- No Prompt Builder or Generation Service changed.
- No Story QC, Revision, Acceptance or Finalization behavior changed.
- No runtime Story Planning integration was introduced.
