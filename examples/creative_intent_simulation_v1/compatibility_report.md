# Creative Intent Input v1 - Generation Compatibility Simulation

## Status

- Result: `compatible_with_lossy_mapping`
- Scope: three single real-model generations
- Formal A/B or Benchmark: no
- Runtime integration: no
- Prompt tuning: no
- Technical result: 3/3 Schema-valid generations, no retries

The current generation chain can carry Creative Intent through `ContentSpec`, tags and `CreativeBrief.generation_notes`. It cannot yet preserve typed character authority, directional relationships, trend provenance or field-level locks.

## Engineering Summary

| Metric | Result |
|---|---:|
| Successful generations | 3 |
| Average latency | 60.359 s |
| Average prompt tokens | 5,747.333 |
| Average completion tokens | 2,641.333 |
| Average total tokens | 8,388.667 |
| Technical failures | 0 |

Model: `openai_compatible / gpt-5.6-sol`, temperature `0.6`, top_p `0.9`, max tokens `4000`.

## Input Representation

| Input | Current compatibility | Main loss |
|---|---|---|
| Free Prompt | `story_goal`; fully visible to Prompt Builder | No deterministic intent parsing |
| Audience / Genre / Theme / Element / Emotion | `TagRef` plus CreativeBrief fields | Required fixture-only Ontology nodes |
| Platform / duration / language / scene count | Typed current paths | Rating and avoid semantics are not typed |
| Character Profile | Flattened into `generation_notes` | No typed identity, psychology, provenance or lock enforcement |
| Relationship | Story goal or `generation_notes` | No directional object or state |
| Trending Tags | Not tested | `TagRef` cannot hold source, time validity or acceptance status |

## Case Findings

### Dark Romance Revenge

The output strongly reflects dark romance, revenge, public exposure and conspiracy. Mara remains calm, analytical and distrustful; she chooses to verify evidence rather than accept either man's account. Her appearance and refusal to harm innocents are copied into the generated CharacterProfile.

The limitation is behavioral: the moral boundary is never tested by a costly choice. The former-lover relationship and Adrian's identity are inferred by the model rather than controlled by a Relationship Object.

### Supernatural Romance

The output strongly reflects fantasy romance, vampire identity, enemy dependence, fear and attraction. Lucian's cold/protective behavior, fear of losing control, belief about humans and need/rejection contradiction all affect the scenes.

The major ambiguity is role ownership. The user did not specify Lucian's story role or provide the human enemy, so the model created “The Hunter” and made her the protagonist. This is plausible writing but weak user control.

### Sci-Fi Mystery

The output strongly reflects science-fiction investigation, concealed AI behavior, curiosity and fear. Lena's logical investigation, belief about technology and concern for human safety appear in actions and dialogue.

The system also became a speaking antagonist even though the input did not define whether it was a character, tool or system entity. Lena's moral boundary is respected, but it is not pressure-tested against a sacrifice decision.

## Cross-Case Conclusions

Information that clearly influenced generation:

- Genre and central premise in all three cases.
- Character names, motivations, fears and beliefs.
- Contradictions when they could be converted into scene conflict.
- Emotional movement and Scene Causality.

Information that was weak or lost:

- Moral boundaries were repeated more often than dramatized.
- Appearance affected descriptions, not story behavior.
- Relationships had no typed direction, authority or state.
- User locks and field provenance could not be enforced.
- Intent was duplicated across tags, story goal, hook and notes, so this non-A/B simulation cannot attribute causality to a single input channel.
- Trend recommendations and explicit avoid tags were not exercised.

Story QC remains placeholder evidence. In particular, the Sci-Fi draft received `2.5` for character agency despite several visible investigative choices, so the QC score is not reliable proof of intent adherence.

## Future Considerations

1. Validate a deterministic Creative Intent Resolver before runtime Prompt integration.
2. Keep stable Ontology separate from time-bound trend signals.
3. Require principal-character role resolution and field-level lock/provenance rules.
4. Use an independent directional Relationship Object.
5. Distinguish person, creature and system entities.
6. Avoid uncontrolled duplication and weighting of the same intent across Prompt channels.
7. Evaluate moral boundaries through observable pressured decisions.
8. Require a later bounded controllability A/B before approving runtime integration.

This simulation supports continuing the Research contract. It does not approve Schema, API, Prompt Builder or runtime changes.
