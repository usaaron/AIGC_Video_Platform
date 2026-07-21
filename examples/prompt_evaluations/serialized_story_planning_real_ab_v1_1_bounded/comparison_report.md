# Serialized Story Planning v1.1 - Bounded Real A/B Revalidation

## Decision

**`revise_planning_concept`**

Planned v1.1 fixed the primary Supernatural Romance repetition failure, preserved Setup/Payoff, and remained preferred in the Revenge Drama control. It does not pass the strict runtime-entry gate because aggregate Hook and Cliffhanger scores remain `0.20` and `0.10` below Direct.

No additional tuning is performed in this task.

## Fixed Configuration

| Setting | Value |
|---|---|
| Provider | `openai_compatible` |
| Model | `gpt-5.6-sol` |
| Temperature | `0.6` |
| Top-p | `0.9` |
| Max tokens | `4000` |
| Reasoning effort | `low` |
| Output language | `en` |
| Platform profile | `tiktok_benchmark_v1` |
| Episode duration | `90s` |
| Episodes per story | `4` |
| Scenes per episode | `3` |
| Successful generations | `16` |

Episodes 1-3 use `serialized_story_planning_offline_ab.v1.1-revalidation`. Episode 4 uses the symmetric technical patch `serialized_story_planning_offline_ab.v1.1-revalidation.final-scene-flag-patch1` for both variants.

The Episode 4 correction only explains that the unchanged Schema uses `cliffhanger=true` as its final payoff-or-continuation marker. It does not prescribe a new threat or creative device. Superseded technical attempts remain under `technical_history/`.

## Review Method

Candidate identities were hidden while scores and evidence were written to `blind_review/blind_review_locked.json`. Only then was `blind_key.json` opened.

Reviewer: **one AI reviewer (Codex)**. This is not human, project-owner, audience, or professional screenwriter validation.

## Pairwise Results

| Story | Direct | Planned v1.1 | Delta | Preferred |
|---|---:|---:|---:|---|
| Supernatural Romance | 4.300 | 4.706 | +0.406 | Planned v1.1 |
| Revenge Drama | 4.519 | 4.631 | +0.112 | Planned v1.1 |
| Aggregate | 4.409 | 4.669 | +0.259 | Planned v1.1 |

### Supernatural Romance

The previous failure is meaningfully corrected:

- Episode 1 establishes rescue and memory cost.
- Episode 2 changes to counterfeit relational evidence and independent verification; current memories remain intact.
- Episode 3 changes to a restoration offer that would consume another person's identity.
- Episode 4 attacks the protagonists' future bond and resolves the isolated-sacrifice rule through reciprocal consent.

Memory, the silver tag, blank journal, and “remember me forward” remain recurring motifs, but they no longer trigger the same dramatic mechanism.

| Dimension | Direct | Planned | Delta |
|---|---:|---:|---:|
| Setup/Payoff | 4.2 | 5.0 | +0.8 |
| Repetition control | 3.5 | 4.8 | +1.3 |
| Character decisions | 4.5 | 4.8 | +0.3 |
| Cross-episode causality | 4.3 | 4.8 | +0.5 |
| Conflict variety | 4.1 | 4.8 | +0.7 |
| Hook | 4.7 | 4.6 | -0.1 |
| Cliffhanger | 4.5 | 4.6 | +0.1 |

The prior Planned Setup/Payoff score of `5.0` is preserved. There is no major single-episode regression.

### Revenge Drama

Planned v1.1 preserves the control-case advantage. Its unsigned calculation, evacuation plan, legal sacrifice, institutional complicity, and public release form one causal accountability chain. Direct has stronger immediate action and Episode 5 pressure but repeats demolition and occupant-rescue mechanics across Episodes 3-4.

| Dimension | Direct | Planned | Delta |
|---|---:|---:|---:|
| Setup/Payoff | 4.3 | 4.8 | +0.5 |
| Repetition control | 3.8 | 4.3 | +0.5 |
| Character decisions | 4.7 | 5.0 | +0.3 |
| Cross-episode causality | 4.7 | 4.9 | +0.2 |
| Hook | 4.9 | 4.6 | -0.3 |
| Cliffhanger | 4.8 | 4.5 | -0.3 |

There is no major single-episode regression, but Direct remains stronger for immediate commercial pressure.

## Aggregate Change

Planning-oriented dimensions improve substantially:

- Setup/Payoff: `+0.65`
- Repetition control: `+0.90`
- Unique episode responsibility: `+0.40`
- Conflict variety: `+0.40`
- Cross-episode causality: `+0.35`
- Character decision consistency: `+0.30`
- Exit/entry continuity: `+0.20`

Remaining regressions:

- Hook strength: `-0.20`
- Cliffhanger quality: `-0.10`
- Rigidity freedom: `-0.10`
- Creative variety: `-0.05`

The planning-benefit average rises from `4.356` to `4.788`. Creative quality rises slightly from `4.463` to `4.550`, but the specific Hook/Cliffhanger gate still fails.

## Engineering Cost

| Metric | Direct | Planned v1.1 | Change |
|---|---:|---:|---:|
| Prompt tokens | 25,619 | 24,789 | -3.240% |
| Completion tokens | 15,899 | 15,080 | -5.151% |
| Total tokens | 41,518 | 39,869 | -3.972% |
| Prompt characters | 33,120 | 49,428 | +49.239% |
| Observed latency | 454.658s | 822.291s | +80.859% |
| Latency excluding one 300s 429 cooldown | 454.658s | 522.291s | +14.876% |

Compared with the prior Planned outputs for the same two cases, planning-context characters decreased from `17,214` to `15,572` (`-9.539%`). Total prompt characters increased `12.296%` because creative-freedom and technical-contract instructions are now explicit.

Provider-reported token counts vary materially between calls and are observational. Prompt characters and the explicit planning-context count are the more direct context-size evidence.

## Decision Gate

| Criterion | Result |
|---|---|
| Supernatural repetition corrected | Pass |
| Setup/Payoff preserved or improved | Pass |
| Hook and Cliffhanger at least parity | **Fail** |
| Planned remains preferred in Revenge control | Pass |
| No major single-episode regression | Pass |
| No obvious plotting rigidity | Pass |
| Planning context not materially expanded | Pass |

Because all criteria were mandatory, runtime contract design is not approved.

## Runtime Recommendation

Do not implement runtime Story Planning yet. Preserve this evidence and stop tuning in this task. Any further experiment requires separate approval and should target the remaining commercial-beat deficit without sacrificing the verified long-range gains. Independent human review should occur before production adoption.

## Boundaries

- No production code changed
- No Schema or API changed
- No runtime integration added
- No Story QC changed
- No Revision or Acceptance changed
- No Scene Causality changed
- No extra tuning after the result
