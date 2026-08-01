# Creative Knowledge Bootstrap v1

## Status

- Stage: research asset bootstrap
- Runtime status: not integrated
- Knowledge item count: 36
- Version: `v1`
- Scope: Script Generation quality research only

This bootstrap converts verifiable storytelling sources into a small set of governed, reusable knowledge assets. It does not create a Knowledge runtime, retrieval service, RAG pipeline, Prompt Builder integration, scoring rule, or automatic writing formula.

## Source Admission Policy

Every item must identify a real source title, author or organization, URL or publication reference, source type, authority level, and extraction confidence. An item is admitted only when the source itself or a reliable publication record can be checked.

Source authority does not automatically make a principle universal. Each item therefore records `when_to_use`, `when_not_to_use`, and source-scope limitations. TikTok sources in this batch are advertising and creator-marketing resources; they are evidence for short-form presentation hypotheses, not proof of universal scripted-drama retention rules.

The user-provided dynamic-comic article is admitted as a complete practitioner observation with an identifiable title, date, site, and byline in the supplied text. The summarized Volcano Engine, screenplay-guide, web-novel, and villain-design references are not converted into individual items because their original documents and bibliographic details were not available for verification.

## Knowledge Domains

| Domain | Items | Intended future consumers | Current status |
|---|---:|---|---|
| Story Structure | 6 | Draft Generation, Creative Deepening, Story QC | Research only |
| Character Design | 6 | Character context, Draft Generation, Story QC, Revision | Research only |
| Conflict and Emotion | 6 | Draft Generation, Creative Deepening, Story QC | Research only |
| Genre Blueprint | 6 | Creative Intent resolution, future retrieval, generation | Research only |
| Short-form / TikTok Storytelling | 6 | Platform-aware generation and evaluation | Research only |
| Visual Narrative for AI Comic | 6 | Script Generation and future production handoff | Research only |

## Item Index

### Story Structure

- `knowledge.story.complete_action.v1`
- `knowledge.story.causal_sequence.v1`
- `knowledge.story.organic_build.v1`
- `knowledge.story.information_withholding.v1`
- `knowledge.story.scene_value_change.v1`
- `knowledge.story.reversal_recognition.v1`

### Character Design

- `knowledge.character.desire_drives_action.v1`
- `knowledge.character.action_learning_cycle.v1`
- `knowledge.character.change_under_struggle.v1`
- `knowledge.character.choice_reveals_character.v1`
- `knowledge.character.relationship_definition.v1`
- `knowledge.character.motivation_interrelationship.v1`

### Conflict and Emotion

- `knowledge.conflict.impeded_desire.v1`
- `knowledge.conflict.progressive_cost.v1`
- `knowledge.conflict.expectation_result_gap.v1`
- `knowledge.emotion.audience_participation.v1`
- `knowledge.reveal.prepared_surprise.v1`
- `knowledge.payoff.logical_necessity.v1`

### Genre Blueprint

- `knowledge.genre.romance.central_relationship.v1`
- `knowledge.genre.dark_romance.power_and_boundary.v1`
- `knowledge.genre.revenge.injury_retaliation_cost.v1`
- `knowledge.genre.mystery.legible_solution.v1`
- `knowledge.genre.scifi.cognitive_estrangement.v1`
- `knowledge.genre.supernatural.reality_departure.v1`

### Short-form / TikTok Storytelling

- `knowledge.platform.tiktok.early_hook.v1`
- `knowledge.platform.tiktok.hook_body_close.v1`
- `knowledge.platform.tiktok.visual_entry.v1`
- `knowledge.platform.tiktok.text_clarity.v1`
- `knowledge.platform.tiktok.sound_function.v1`
- `knowledge.platform.tiktok.framework_adaptation.v1`

### Visual Narrative for AI Comic

- `knowledge.visual.observable_action.v1`
- `knowledge.visual.scene_context.v1`
- `knowledge.visual.panel_closure.v1`
- `knowledge.visual.word_image_complement.v1`
- `knowledge.visual.channel_separation.v1`
- `knowledge.visual.montage_compression.v1`

## Source Register

| Source | Author / organization | Source type | Usage in this batch |
|---|---|---|---|
| *Poetics* | Aristotle; translated by S. H. Butcher in the linked edition | foundational dramatic theory | Story unity and reversal/recognition |
| *The Anatomy of Story* | John Truby | professional screenwriting book | Organic structure, desire, learning, relationship design, payoff |
| *Story* | Robert McKee | professional screenwriting book | Scene value, pressure choice, progressive conflict, expectation gap |
| *The Art of Dramatic Writing* | Lajos Egri | professional dramatic-writing book | Motivation, interrelationships, conflict |
| RWA romance definitions and judging material | Romance Writers of America | professional association guidance | Romance audience contract |
| “Dark romance: an introduction” | Katie Deane | peer-reviewed research article | Dark-romance category and boundary cautions |
| *Revenge Tragedy: Aeschylus to Armageddon* | John Kerrigan | scholarly monograph | Revenge as injury, retaliation, and consequence |
| *Talking About Detective Fiction* | P. D. James | professional craft/history book | Mystery solution and clue legibility |
| “On the Poetics of the Science Fiction Genre” | Darko Suvin | scholarly article | Cognitive estrangement and speculative difference |
| “Ghost Stories” | Encyclopedia.com reference article | scholarly reference | Supernatural departure from mimetic reality |
| TikTok For Business creative resources | TikTok | platform research and guidance | Bounded short-form hypotheses |
| BBC Writersroom screenplay format | BBC Writersroom | professional production guide | Visible action and scene context |
| *Understanding Comics* | Scott McCloud | professional comics theory | Sequential closure and word-image relationship |
| “漫剧剧本怎么写？漫剧基本格式是什么？范例来了！” | 六耳咪咪 | practitioner observation | Channel separation and montage compression |

## Governance Notes

- Knowledge assets are references, not executable rules.
- `confidence` reflects confidence in the extraction, not proof of commercial effectiveness.
- Genre items describe minimum audience contracts or useful engines, not mandatory plots.
- Platform items require future fixed-fixture A/B validation before runtime use.
- Practitioner observations must remain visibly lower-authority than professional or scholarly sources.
- Future Prompt, Story QC, Revision, Benchmark, and Creative Deepening work should cite `knowledge_id`, not duplicate source text.

## Validation Before Runtime Use

1. Select a small subset of items for one quality dimension.
2. Compare a source-free baseline against a knowledge-guided variant using fixed ContentSpecs and identical model settings.
3. Review readable quality, instruction adherence, rigidity, token/latency cost, and regressions.
4. Promote only items whose contribution is observable and reproducible.
5. Keep rejected or inconclusive items as research assets; do not silently tune the benchmark or rewrite their sources.

## Explicit Non-Goals

- No runtime Knowledge Base
- No retrieval or vector database
- No RAG
- No Creative Skill Registry
- No Agent workflow
- No Prompt Builder change
- No Story QC rule change
- No schema or API change

