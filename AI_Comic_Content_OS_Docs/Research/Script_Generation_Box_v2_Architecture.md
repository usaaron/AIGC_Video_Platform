# Script Generation Box v2 - Architecture Consolidation

## Status

```yaml
document_type: architecture_consolidation_research
architecture_target: script_generation_box_v2
runtime_integrated: creative_intent_static_knowledge_deepening_shadow
schema_approved: additive_v2_shadow_contracts
api_approved: creative_intent_resolution_only
professional_validation: false
roadmap_change: false
```

This document consolidates recent Script Generation evidence into one coherent target architecture. Creative Intent, Character Context, static knowledge, and Creative Deepening shadow were subsequently implemented through existing services. It does not approve dynamic Knowledge Retrieval, Creative Deepening apply, or the earlier fixed four-episode Story Planning contract as a direct runtime replacement. The existing authoritative QC, revision, acceptance-shadow, and finalization path remains unchanged.

Historical status note (2026-08-05): `Story Planning runtime` in the paragraph above refers to the earlier fixed four-episode planning proposal. A later China-mainland product decision approved a different, human-reviewed Story Bible → level-free recursive StoryPlanNode → EpisodePlan slice. Dynamic Knowledge Retrieval and Creative Deepening apply remain unapproved; current runtime authority is `14_Script_Engine.md`.

The v2 direction preserves the long-term box contract:

```text
ScriptGenerationRequest
-> Script Generation Box
-> ScriptGenerationResult
```

All capabilities described below remain internal to that box or upstream request mapping. They must not become steps that every external caller is required to orchestrate.

## 1. Evidence And Current State

Recent validation establishes different levels of evidence, not one uniform runtime approval:

| Capability | Evidence | Current conclusion |
|---|---|---|
| Scene Causality | Implemented contract, deterministic tests, and bounded real-model A/B | Validated and integrated for first-draft scene construction |
| Structured Creative Intent | Three-case offline controllability comparison | Minimal Phase 1 deterministic contract and API implemented |
| Character / Relationship Context | Included in the same three-case comparison and preferred in 3/3 cases | Character Context Phase 1 implemented; Relationship Context remains Research |
| Creative Knowledge Bootstrap | Bounded, source-grounded knowledge assets created | Static exact-ID Draft / Deepening projection implemented; dynamic retrieval and broad selection quality remain unimplemented |
| Knowledge-Guided Creative Deepening | One fixed offline comparison plus shadow runtime contracts and deterministic checks | Shadow observation implemented; apply is not production-ready |
| Serialized Story Planning v1.1 | Improved setup/payoff, continuity, and repetition control, but lost Hook / Cliffhanger parity | Frozen historical evidence; not adopted unchanged by the later recursive longform workflow |

The current production runtime is still:

```text
ContentSpec
-> Prompt Retrieval
-> Prompt Builder
-> LLMAdapter
-> DraftMasterScript
-> StoryQCReport
-> RevisionDecision / RevisionStrategy / RevisionPlan
-> RevisionExecutor
-> Re-QC
-> AcceptanceDecision (shadow)
-> Finalization Gate
-> FinalMasterScript
```

Script Generation Box v2 is therefore a target consolidation, not a description of already deployed behavior.

## 2. Consolidated Target Flow

The smallest coherent future direction is:

```text
Creative Intent + Character / Relationship Context
-> deterministic Creative Intent Resolution
-> normalized ContentSpec + governed character context + lineage
-> task-scoped Knowledge Selection for Draft Generation
-> Draft Generation with Scene Causality
-> deterministic Draft validity and preservation checks
-> optional single-pass Creative Deepening
-> Story QC
-> targeted Revision
-> Re-QC
-> Acceptance
-> Finalization Gate
-> FinalMasterScript
```

This flow has three distinct zones:

1. **Input control** decides what the user wants and resolves conflicts before generation.
2. **Creative construction** generates and, if separately validated, deepens one bounded Draft.
3. **Quality control** evaluates, repairs identified defects, measures revision effectiveness, and finalizes.

The zones exchange versioned artifacts and lineage. They do not silently absorb each other's responsibilities.

## 3. Module Boundaries

### 3.1 Creative Intent

**Answers:** What does the user want to create?

Responsibilities:

- preserve the free creative prompt, selected tags, added tags, exclusions, and user locks;
- preserve user-supplied character and relationship facts;
- distinguish user intent from system recommendations and trends;
- expose major semantic conflicts for deterministic resolution or user review;
- retain authoring provenance.

Must not:

- become the runtime script specification;
- override platform or safety constraints;
- contain professional writing methods;
- generate scenes, dialogue, or Story Blueprint content;
- allow AI expansion to overwrite user-locked character facts.

### 3.2 ContentSpec

**Answers:** What normalized content, audience, platform, commercial, and creative requirements must be produced?

Responsibilities:

- remain the normalized runtime requirements contract and single source of truth for generation requirements;
- hold resolved story goal, audience, platform, language, duration, scene count, Hook / Cliffhanger intent, and approved tags;
- carry compact generation requirements derived from Creative Intent Resolution;
- reference governed character or knowledge context when formal contracts are later approved.

Must not:

- store the raw authoring session as arbitrary metadata;
- become a full Character Bible or relationship timeline;
- store Creative Knowledge source material;
- decide how a professional principle is applied;
- absorb downstream QC or revision results.

### 3.3 Knowledge Selection

**Answers:** Which small set of applicable, source-grounded principles should support this specific task?

Responsibilities:

- select by task, ContentSpec, confirmed tags, platform, genre, story goal, and governed character context;
- filter by applicability, confidence, validation status, region, and known limitations;
- return a bounded, versioned bundle with `knowledge_id` and source lineage;
- keep Generation, Deepening, and QC bundles separate;
- record why each item was selected.

Must not:

- inject the complete Knowledge Base into every Prompt;
- turn low-authority observations into universal rules;
- replace Prompt Retrieval or Prompt Builder;
- create story facts, character identity, or user intent;
- become an autonomous reasoner, Agent, or hidden optimization loop.

`Knowledge Selection` is a conceptual capability within the existing Knowledge Base / retrieval direction. This document does not approve a new service, vector database, or RAG subsystem.

### 3.4 Draft Generation

**Answers:** How should the requested episode be written as a structurally valid first Draft?

Responsibilities:

- consume normalized ContentSpec, approved character context, GenerationStrategy, PlatformProfile, Prompt assets, and a bounded generation knowledge bundle;
- establish Hook, scene purpose, Goal / Conflict / Outcome, causal links, protagonist action, and intended payoff or cliffhanger;
- produce a schema-valid DraftMasterScript in the requested language and scene count;
- preserve complete generation lineage.

Must not:

- resolve raw user-input conflicts;
- retrieve every available knowledge domain;
- perform broad post-draft polishing under the name of generation;
- judge its own professional quality;
- rewrite repeatedly until a score is maximized.

Scene Causality remains part of Draft Generation. It is not a separate public module.

### 3.5 Creative Deepening

**Answers:** How can the same valid story execution become more emotionally, visually, and verbally effective without changing its direction?

Candidate responsibilities:

- strengthen visible character choice and emotional specificity;
- improve dialogue voice, subtext, and economy;
- replace abstract emotion with observable action;
- increase pressure through existing obstacles and consequences;
- improve Hook and cliffhanger presentation without changing their purpose;
- preserve story facts, scene order, causal links, identity, and user locks.

Must not:

- repair invalid schema or broken Scene Causality;
- create a new central conflict, reveal, character, or ending direction;
- perform Story Planning;
- consume QC deductions and compete with targeted Revision;
- run more than one pass by default;
- silently exceed a declared change, duration, token, or latency budget.

Creative Deepening is an optional shadow candidate stage. Current evidence and deterministic tests support runtime observation, not replacement of the authoritative Draft.

### 3.6 Story QC

**Answers:** What quality problems are present, where is the evidence, and why do they matter for this request?

Responsibilities:

- evaluate the current Draft against explicit dimensions and applicable knowledge;
- identify score reasons, deductions, scene references, evidence, and revision signals;
- distinguish deterministic failures from qualitative weaknesses;
- preserve knowledge references and confidence limitations;
- remain independent from the generation and revision decision.

Must not:

- rewrite the Draft;
- select the final Prompt or GenerationStrategy;
- decide which problems are worth changing in the current revision round;
- claim professional authority while its scoring remains partially placeholder;
- become a second Acceptance or Finalization Gate.

### 3.7 Revision

**Answers:** Which identified problems should be fixed now, how should they be fixed, and what scope must be protected?

Responsibilities:

- convert QC evidence into RevisionDecision, RevisionStrategy, and RevisionPlan;
- select at most one or two high-impact dimensions per bounded round;
- preserve deferred and protected dimensions;
- enforce scene scope and record RevisionExecutionTrace;
- apply deterministic controlled changes through RevisionExecutor;
- keep legacy compatibility where structured strategy is unavailable.

Must not:

- perform broad creative enhancement without a QC-identified target;
- change the whole story direction;
- run an unlimited optimization loop;
- decide whether its own output is successful;
- replace Draft Generation or Creative Deepening.

### 3.8 Acceptance

**Answers:** Did the bounded revision solve the intended problem without unacceptable regression?

Responsibilities:

- compare original and revised QC evidence for selected dimensions;
- measure targeted improvement, regression, protected-dimension stability, and scene alignment;
- produce an explainable AcceptanceDecision;
- enforce bounded stop semantics when a future policy is explicitly approved;
- remain observational in the current shadow integration.

Must not:

- decide whether the script is professionally excellent;
- replace Story QC;
- rewrite content;
- maximize scores through additional rounds;
- replace the Finalization Gate.

### 3.9 Finalization Gate

Finalization remains the formal output boundary. Acceptance asks whether the revision was useful; Finalization asks whether the complete, traceable result is allowed to become FinalMasterScript. Script Generation Box v2 does not merge or remove either responsibility.

## 4. Task-Scoped Knowledge Usage

Knowledge must be routed by consumer task. A single universal bundle would create Prompt bloat, contradictory advice, weak attribution, and responsibility overlap.

### 4.1 Draft Generation Bundle

Generation should receive only principles needed to construct the episode correctly:

- Scene Goal / Conflict / Outcome and causal progression;
- protagonist desire, consequential choice, and relationship pressure;
- genre promise and central conflict patterns relevant to resolved tags;
- platform-appropriate Hook and ending function;
- visual observability required for an AI comic script.

Generation should not receive:

- detailed revision methods;
- QC scoring language or deduction thresholds;
- many alternative screenplay frameworks at once;
- long examples that invite plot copying;
- Creative Deepening instructions about line-level polish.

Recommended initial size for validation: a bounded 5-8 item bundle, selected before Prompt construction and recorded in lineage. This is an experiment budget, not a permanent architecture constant.

### 4.2 Creative Deepening Bundle

Deepening should receive only principles that improve expression while preserving the Draft:

- character choice and motivation made visible;
- dialogue economy, voice, and subtext;
- emotional progression through action;
- visual readability and word-image complement;
- progressive scene pressure using existing conflict;
- Hook / cliffhanger presentation without purpose changes.

It should not receive whole-story structure, new genre engines, alternative endings, or setup/payoff instructions that require changing story direction.

The first validation used 10 manually selected items. That bundle is frozen evidence, not a validated default. Further validation should test whether a smaller bundle can retain quality gains while reducing token and verbosity cost.

### 4.3 Story QC Bundle

QC should receive evaluative knowledge aligned to the dimensions actually being scored:

- an applicable principle;
- observable positive and negative indicators;
- applicability and `when_not_to_use` limits;
- confidence and source authority;
- evidence requirements for assigning a deduction.

QC should not receive generation examples as desired outputs, creative rewriting methods, or platform claims without validated applicability. It must cite `knowledge_id` rather than embedding untraceable theory in rubric code.

### 4.4 Knowledge Isolation Rules

1. Resolve user intent before knowledge selection.
2. Platform and safety hard constraints always override creative knowledge.
3. User exclusions and locked character facts cannot be relaxed by knowledge.
4. Each consumer receives its own bounded bundle and selection reasons.
5. Knowledge used for Generation does not automatically become QC authority.
6. Knowledge used by QC does not automatically authorize Revision to modify that dimension.
7. Low-authority practitioner observations remain reference-only until separately validated.
8. All used `knowledge_id` values and versions must be traceable in evaluation artifacts and future lineage.

## 5. Story Planning Position

Serialized Story Planning remains a future optional extension, not a default v2 stage.

The v1.1 bounded revalidation produced useful gains in:

- setup/payoff traceability;
- cross-episode continuity;
- repetition control;
- character-decision consistency.

It did not satisfy the mandatory Hook / Cliffhanger parity gate. The plans constrained local dramatic execution enough to reduce episode-level commercial force. Therefore Story Planning must not be inserted between ContentSpec and every episode Draft in the current target runtime.

If future work explicitly reopens it, the position should be:

```text
ContentSpec + governed character context
-> optional minimal Story Blueprint
-> optional Episode Plan
-> existing Draft Generation
```

Conditions for reconsideration:

- the request is explicitly serialized rather than a single episode;
- planning remains minimal and controls continuity, not line-level execution;
- Hook and cliffhanger responsibility remains with episode generation;
- direct versus planned generation is compared with blind review;
- Hook / Cliffhanger parity and single-episode quality are mandatory gates;
- token, latency, plan/script divergence, and rigidity are measured.

Story Planning is not a dependency for Creative Intent, Knowledge Selection, Creative Deepening, Story QC, or Revision.

## 6. Runtime Readiness Matrix

The architecture must distinguish runtime presence from professional maturity.

| Capability | Runtime state | Evidence state | v2 treatment |
|---|---|---|---|
| ContentSpec normalization | Integrated | Stable baseline | Keep as normalized runtime contract |
| Prompt Retrieval / Prompt Builder / LLMAdapter | Integrated | Real adapter and generation path validated | Preserve; consume only approved contracts |
| Scene Causality | Integrated | Bounded A/B plus deterministic coverage | Keep inside Draft Generation |
| Structured Draft output | Integrated | Schema and retry path validated | Keep as mandatory intermediate artifact |
| Creative Intent Resolution | Phase 1 integrated | Input-control A/B positive in 3/3 cases plus deterministic tests | Keep minimal exact-ID resolver; advanced authoring remains Research |
| Character / Relationship Context | Character Context Phase 1 integrated | Positive combined input-control evidence | Keep Character provenance/locks; Relationship Context remains Research |
| Creative Knowledge assets | Research assets plus bounded runtime projection | Source integrity established; one downstream positive signal | Keep bounded and governed; broader coverage remains unvalidated |
| Static Knowledge Selection | Draft and Deepening shadow runtime integrated | Exact strategy ID plus tag / platform / stage checks are deterministic and tested | Keep optional; run bounded quality validation before expansion |
| Dynamic Knowledge Retrieval | Not integrated | Manual/static selection only | RAG, ranking, and automatic routing remain out of scope |
| Creative Deepening | Shadow integrated | One-sample quality evidence plus deterministic preservation coverage | Keep observational; apply remains blocked until multi-sample gate passes |
| Story QC Explainability | Integrated | Structured evidence available | Keep; professional scoring credibility remains limited |
| Revision Planner / Executor | Integrated | Controlled scope and trace covered | Keep; creative execution remains rule-based and limited |
| Acceptance | Shadow integrated | Deterministic evaluator and calibration evidence | Keep observational; does not block Finalization |
| Finalization Gate | Integrated | Stable lineage boundary | Unchanged |
| Serialized Story Planning | Not integrated | Positive continuity evidence, failed Hook / Cliffhanger gate | Freeze as future optional extension |

### 6.1 Validated And Stable

- normalized ContentSpec-based generation path;
- replaceable LLMAdapter boundary;
- structured DraftMasterScript;
- Scene Causality contract;
- Story QC explainability data shape;
- controlled Revision contracts and executor scope;
- Acceptance shadow observation;
- Finalization Gate and lineage.

This classification does not claim that QC scoring or rule-based revision has reached professional creative quality.

### 6.2 Needs More Validation Or Contract Work

- Creative Intent Resolution contract, precedence rules, and mapper;
- Character / Relationship Context contract and user-lock semantics;
- task-specific Knowledge Selection relevance and bundle-size control;
- Knowledge-Guided Creative Deepening across multiple Drafts and genres;
- text completeness, verbosity, duration, latency, and provider-failure controls for Deepening;
- knowledge-aware QC credibility and calibration.

### 6.3 Research Only

- the earlier fixed four-episode Serialized Story Planning runtime proposal;
- Creative Skill Layer or Skill Registry;
- automatic Knowledge learning;
- vector RAG or autonomous knowledge reasoning;
- LLM-based RevisionExecutor;
- multi-round optimization;
- Agents or multi-agent creative workflow.

## 7. Adoption Sequence And Gates

Script Generation Box v2 should be adopted through evidence gates, not as one architecture rewrite.

### Checkpoint 1: Input Contract Consolidation

Define the minimal, versioned Creative Intent and Character / Relationship Context mapping into the existing box. Validate precedence, exclusions, user locks, lineage, and backward compatibility. Do not add Creative Deepening at this checkpoint.

### Checkpoint 2: Knowledge Selection Validation

Use the existing source-grounded assets and fixed fixtures to compare no-knowledge versus small task-specific bundles. Measure relevance, contradictions, Prompt growth, output quality, and evidence attribution. Manual selection remains acceptable for validation; a retrieval runtime is not required to prove value.

### Checkpoint 3: Creative Deepening Revalidation

Repeat the bounded A/B/C over at least three different genres or Drafts. Require story-preservation checks, text completeness, controlled expansion, no duration regression, and independent or blind review. Only then decide whether Deepening becomes an optional GenerationStrategy step.

### Checkpoint 4: QC Knowledge Credibility

Introduce only separately validated evaluative knowledge into fixed QC dimensions. Compare evidence precision, reviewer agreement, false deductions, and Revision signal usefulness. Do not assume Generation knowledge is automatically suitable for QC.

Each checkpoint must finish with validation artifacts, documentation sync, tests where code changes exist, a clear Git commit, and a version baseline before the next major capability change.

## 8. Risks And Controls

| Risk | Required control |
|---|---|
| Prompt and context bloat | Task-specific bundle limits and token reporting |
| Conflicting knowledge | Applicability filters, precedence, and selection reasons |
| Story drift during Deepening | Frozen story invariants and deterministic preservation checks |
| Verbosity or duration drift | Explicit change budget and readable text-completeness checks |
| Knowledge authority inflation | Source authority, confidence, validation status, and `when_not_to_use` |
| QC circularity | Separate generation and evaluation bundles; do not score mere compliance with injected wording |
| Module overlap | Enforce the responsibility boundaries in Section 3 |
| Cost and provider instability | Bounded calls, no subjective retries, latency/failure reporting, resumable offline tests |
| Premature Story Planning | Keep frozen until Hook / Cliffhanger parity is independently demonstrated |
| Public API fragmentation | Keep all new stages behind the future ScriptGenerationRequest / Result box contract |

## 9. Consolidation Decision

The v2 target architecture is coherent only if it is interpreted as staged internal capability evolution:

```text
Controlled Inputs
-> Task-Scoped Knowledge
-> Causal Draft Generation
-> Optional Bounded Creative Deepening
-> Evidence-Based QC
-> Targeted Revision
-> Revision Acceptance
-> Finalization
```

The immediate architecture priority is not a new Engine or workflow framework. With minimal input control, static task-scoped knowledge, and Creative Deepening shadow implemented, the next checkpoint is bounded Deepening quality validation; apply remains unapproved.

The earlier Story Planning experiment remains serialized-story research evidence and did not enter this Script Generation Box v2 target unchanged. The later China-mainland recursive planning workflow is governed separately by `14_Script_Engine.md` and must still prove longform capacity without reducing Hook, Cliffhanger, or episode-level quality.

## 10. Non-Goals And Confirmation

This consolidation does not:

- modify production code, schemas, APIs, Prompt Builder, or runtime behavior;
- approve Knowledge Retrieval, RAG, Creative Skill Registry, Agent, or new Engine implementation;
- approve Creative Deepening for production;
- reopen Serialized Story Planning;
- alter Story QC, Revision, Acceptance, Finalization, or FinalMasterScript;
- change the current roadmap priority by itself.

It provides one shared architecture reference for deciding the next bounded capability checkpoint without confusing research evidence with runtime maturity.
