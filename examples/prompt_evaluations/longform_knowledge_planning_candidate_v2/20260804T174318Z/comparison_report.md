# Longform Knowledge Planning Candidate v2 Smoke Comparison

## Status

`mixed_positive_pending_broader_validation`

This is one same-input, real-model smoke comparison. It is not a formal Benchmark and does not authorize replacing the default `v1` bundle.

## Controlled Input

- Source project: `2688e98f-6d2c-4f47-8da2-4f4661075fa9`
- ContentSpec: `c325e7d3-b1eb-4fa7-a29c-beb01551aa6b`
- Target episode count: 334
- User characters: none
- Baseline: `strategy.cn_mainland.frontend_mvp.general.v1`
- Candidate: `strategy.cn_mainland.longform_knowledge_candidate.v2`

Both variants received the same persisted creative prompt, system tag labels, ContentSpec, model runtime, and target count.

## Review

| Dimension | Baseline v1 | Candidate v2 | Evidence-based finding |
|---|---:|---:|---|
| Sustainable story engine | 3.0 | 4.0 | Candidate explicitly defines an accumulating `调查 -> 发现 -> 抉择 -> 代价` engine and connects discoveries to narrower choices, relationship changes, and opponent response. Baseline has a strong central tension but less evidence that it can generate distinct long movements. |
| Macro movement distinction | 3.0 | 3.5 | Candidate supplies more independent change mechanisms, but neither Story Bible yet proves a complete macro movement map. Root-node comparison is still required. |
| Character long-arc credibility | 3.5 | 4.0 | Candidate gives the protagonist, helper, antagonist, rival, and witness distinct persistent struggles and costly trajectory turns. Baseline is coherent but concentrates most long-arc detail in three characters. |
| Parallel storyline consequence | 3.0 | 4.0 | Candidate's family-power line changes access, opposition, inheritance pressure, and evidence flow. Baseline subplots are relevant but more often explain or mirror the main investigation. |
| Causal coherence | 4.0 | 4.0 | Both versions connect evidence, trust, family power, and final public disclosure. Candidate adds more active counteraction without losing the central causal route. |
| Formula / rigidity safety | 4.5 | 3.5 | Candidate exposes its underlying method more visibly and risks making repeated cycles mechanical. It also leaks English craft terms into Chinese narrative fields. |
| Chinese language precision | 4.5 | 3.5 | Candidate contains `actively`, `setup`, and `payoff`, and uses `驱逐出境` where family expulsion is intended. Baseline reads more naturally in Chinese. |

Scores are 1-5 expert desk-review judgments for this sample only. They are not professional market validation.

## Preference

`candidate_v2_with_reservations`

Candidate v2 is preferred for longform planning capacity because it creates more independent sources of dramatic action and gives supporting lines consequences. The preference is not strong enough for production promotion because language precision and formula leakage regressed, and the comparison did not include recursive root or child nodes.

## Required Next Evidence

1. Keep default `v1` active and candidate `v2` in `draft` status.
2. Repeat the same fixed comparison on at least two materially different mainland longform premises.
3. Add root-node comparison to test macro movement distinction and non-balanced recursive decomposition.
4. Review Chinese terminology leakage and repetitive story-engine risk before any prompt adjustment.
5. Promote only if at least two of three stories improve longform capacity without major language, rigidity, or causal regression.

## Artifact Map

- `manifest.json`
- `baseline_v1_story_bible.json`
- `candidate_v2_story_bible.json`
