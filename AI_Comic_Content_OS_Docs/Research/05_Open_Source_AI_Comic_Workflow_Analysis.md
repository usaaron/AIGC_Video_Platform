# 05 Open Source AI Comic Workflow Analysis

## 1. Research Purpose

### 1.1 Research Goal

This document studies selected open-source AI comic and AI short-drama workflow projects to identify reusable design ideas for AI Comic Content OS.

The research does not propose copying any implementation wholesale. It focuses on extracting patterns that may improve:

- Content Intelligence
- Script Quality
- Workflow Orchestration
- Quality Optimization
- Asset consistency
- Future production handoff design

AI Comic Content OS is not intended to become another one-click video generator. Its current MVP remains a content-planning system whose final product is a high-quality, structured `FinalMasterScript`.

The current boundary remains:

`Data Intelligence`
-> `ContentSpec`
-> `Knowledge Base`
-> `Asset Retrieval`
-> `Script Generation Box`
-> `FinalMasterScript`

Storyboard, voice, animation, video generation, and composition remain part of the future Media Production Phase.

### 1.2 Research Method and Limits

Research date: 2026-07-18.

This analysis is based on each project's public repository, README, documented workflow, and visible repository structure. It is not a full source-code audit, security review, license review, or production benchmark.

Repository claims such as quality, automation level, provider support, or production readiness are treated as project self-descriptions unless independently verified. Before reusing code, a separate technical and license review is required.

### 1.3 Projects Reviewed

1. [cumob-ai](https://github.com/66964432/cumob-ai)
2. [manga-script-master](https://github.com/snailzsh/manga-script-master)
3. [Toonflow](https://github.com/cuiyucheng0104-afk/Toonflow)
4. [xiakeman-ai-short-drama](https://github.com/XiakeMan777/xiakeman-ai-short-drama)
5. [Douyin-Micro-Horror-Studio](https://github.com/Xiao-rx/Douyin-Micro-Horror-Studio)
6. [screen-creative-skills](https://github.com/GongLingRui/screen-creative-skills)
7. [Micro-Drama-Skills](https://github.com/zhaihao118/Micro-Drama-Skills) as a production-workflow comparison reference
8. [awesome-ai-persona-skills](https://github.com/momozi1996/awesome-ai-persona-skills)

## 2. Project Overview

### 2.1 cumob-ai

Source: [66964432/cumob-ai](https://github.com/66964432/cumob-ai)

#### Project Positioning

`cumob-ai` positions itself as a multimedia AI generation platform and an assistant for AI comics, storyboards, video prompts, voice, translation, and video composition. Its public documentation emphasizes simplifying a multi-provider workflow into a user-facing one-click experience.

#### Main Workflow

The documented workflow is approximately:

Theme or user parameters
-> story and storyboard generation
-> image generation
-> translation and voice synthesis
-> video workflow
-> multimedia preview and export

The platform integrates several external services, including Coze workflows, image-generation providers, translation, and voice synthesis.

#### Key Technical and Design Ideas

- A web interface makes a long-running generation workflow visible to users.
- Server-Sent Events provide streaming progress updates.
- Batch requests, rate limits, timeout handling, retries, and connection reuse are treated as first-class operational concerns.
- Provider credentials and configuration are separated from the main user workflow.
- Generated images, audio, and video are presented together as coordinated artifacts.

#### Strengths

- Strong user feedback for long-running tasks.
- Useful operational patterns for retries, progress, concurrency, and provider failure handling.
- Demonstrates the value of presenting multiple generated artifact types in one project context.
- Supports configurable styles, emotions, and languages at the interface level.

#### Limitations for AI Comic Content OS

- The primary product direction is one-click multimedia generation rather than evidence-driven script quality.
- Provider workflows and production concerns appear closer to the center of the product than `ContentSpec`, evaluation, or script lineage.
- Some documented service and UI files are large, which may indicate concentration of workflow responsibility and higher maintenance risk.
- The public description does not show an equivalent to the current Benchmark, Prompt Evaluation, Story QC explainability, or controlled Finalization Gate.

#### Relevance

The most relevant ideas are operational, not architectural: streaming progress, retry visibility, task status, provider error isolation, and artifact presentation. These should only be reconsidered when a future long-running production interface is needed.

### 2.2 manga-script-master

Source: [snailzsh/manga-script-master](https://github.com/snailzsh/manga-script-master)

#### Project Positioning

`manga-script-master` is a compact creative skill for producing short-form comic scripts and AI storyboard prompts. Its repository externalizes the method primarily as a `SKILL.md`, with evaluation material also present.

#### Main Workflow

The documented workflow is approximately:

Theme and genre selection
-> platform and generation-tool context
-> character cards and visual anchors
-> episode script with timed scenes
-> storyboard prompt table
-> optional video-oriented prompts
-> quality checklist

#### Key Technical and Design Ideas

- Creative guidance is externalized as a reusable skill rather than being scattered through application code.
- Genre-specific rhythm models represent different emotional payoff patterns.
- Character cards combine role, personality, flaw, visual anchors, and reusable image-generation tags.
- Episode scripts use time ranges, visible actions, dialogue, hooks, and next-episode questions.
- A quality checklist verifies opening conflict, visualized emotion, dialogue length, pacing, ending hooks, and consistency anchors.
- Storyboard prompts are treated as a transformation of the script rather than as the script itself.

#### Strengths

- Clear separation between character definition, episode writing, and storyboard prompt production.
- Strong practical emphasis on visual consistency through fixed anchors and repeated descriptors.
- Genre rhythm models make tacit creative assumptions explicit.
- The checklist provides a simple and inspectable quality gate.
- Its skill-based packaging demonstrates that creative methods can be versioned outside business code.

#### Limitations for AI Comic Content OS

- Knowledge, instructions, formulas, platform defaults, and tool-specific prompt rules are largely combined in one skill artifact.
- The genre formulas are prescriptive and primarily reflect Chinese short-form content assumptions; they cannot become universal Ontology rules without research and Benchmark validation.
- The workflow does not expose a domain contract comparable to `ContentSpec`, `MasterScript`, or full lineage.
- The checklist is useful but is not a replacement for evidence-linked Story QC.
- Tool-specific defaults, especially video-generation defaults, conflict with the current adapter-first and Phase 2 boundary.

#### Relevance

The strongest reusable ideas are modular creative skills, genre blueprints, visual anchors, and transformation-specific quality checklists. These ideas should be normalized into Knowledge Base records and evaluated before they influence Prompt Builder or Story QC.

### 2.3 Toonflow

Source: [cuiyucheng0104-afk/Toonflow](https://github.com/cuiyucheng0104-afk/Toonflow)

#### Project Positioning

`Toonflow` positions itself as a complete AI comic production platform that prioritizes story adaptation and storyboard quality over simple API forwarding. It documents a path from novel or script to directorial treatment, storyboard decomposition, asset prompts, and platform-oriented video prompts.

#### Main Workflow

The documented workflow supports two main routes:

Novel
-> story analysis
-> character and structure design
-> complete script
-> director alignment
-> storyboard decomposition
-> asset prompts
-> platform-specific storyboard artifacts

or:

Existing script
-> story and character extraction
-> director alignment
-> storyboard decomposition
-> asset prompts
-> platform-specific storyboard artifacts

#### Key Technical and Design Ideas

- Screenwriting, directing, and storyboarding methods are packaged as separate skills.
- The system creates distinct artifacts for scripts, asset lists, director alignment, and storyboards.
- Character records include a character bible and arc-oriented information.
- Storyboard records include narrative purpose, camera information, dialogue, sound, duration, and platform mode.
- A provider system abstracts several text, image, and video providers.
- A multi-agent structure routes work to story analysis, director alignment, storyboard, asset prompt, and supervision agents.
- The documented workflow includes memory/checkpoint concepts and quality supervision.

#### Strengths

- Takes the story-to-storyboard transformation seriously as a professional process.
- Shows the value of separating script, directorial interpretation, assets, and platform output.
- Provider abstraction aligns with the project's adapter principle.
- Artifact-specific storage supports traceability better than a single unstructured output.
- The distinction between narrative purpose and visual execution is useful for future production handoffs.

#### Limitations for AI Comic Content OS

- The multi-agent topology introduces routing, memory, tool, and state complexity before there is evidence that it improves script quality.
- Skill prompts, professional knowledge, orchestration, and agent behavior may become difficult to evaluate independently if not governed by stable contracts.
- The project extends deeply into storyboard and video-platform formatting, which is outside the current MVP.
- Its production methods and platform formats require separate validation for TikTok overseas audiences.
- A chat- and agent-oriented interface can make deterministic Benchmark reproduction and lineage more difficult.

#### Relevance

Toonflow is the strongest reference for skill decomposition, intermediate artifacts, provider abstraction, and production handoff. Its agent architecture should be studied as an orchestration experiment, not adopted as the default architecture.

### 2.4 xiakeman-ai-short-drama

Source: [XiakeMan777/xiakeman-ai-short-drama](https://github.com/XiakeMan777/xiakeman-ai-short-drama)

#### Project Positioning

`xiakeman-ai-short-drama` positions itself as a production workbench for AI comics and short drama. It moves ideas, novels, or scripts through structured production materials, assets, storyboards, video generation, voice, subtitles, and local composition.

#### Main Workflow

The documented capability sequence is approximately:

Idea, novel, or script
-> structured script materials
-> character, scene, clothing, and prop assets
-> storyboard and shot sheet
-> video prompts and generation tasks
-> voice, subtitles, sound, and music
-> local composition and delivery package

#### Key Technical and Design Ideas

- Asset preparation is explicit and precedes storyboard/video generation.
- Characters, scenes, clothes, props, and consistency references are managed as related production resources.
- Storyboard, Shot Sheet, and video prompt are separate output representations.
- Local and cloud model services can participate in the workflow.
- Batch generation and local FFmpeg-based composition are supported as production capabilities.
- The repository offers web, server, Docker, and desktop-oriented delivery paths.

#### Strengths

- Strong asset-first production framing.
- Recognizes that character, clothing, props, and scenes need consistency references.
- Separates shot planning from generation execution.
- Demonstrates practical handoff artifacts needed by a production team.
- Supports deployment flexibility and local production tooling.

#### Limitations for AI Comic Content OS

- The project is positioned around a particular video-production workflow and Seedance-oriented use cases.
- Media production breadth may obscure script-quality measurement and data-driven content planning.
- The public repository has limited visible history, so maintainability and production maturity require further validation.
- The documented workflow does not show the same Benchmark-first capability validation or controlled script revision lineage.
- Directly adopting the production data model would risk contaminating `FinalMasterScript` with provider-specific needs.

#### Relevance

The key lesson is to prepare reusable assets and explicit handoff packages before video generation. For AI Comic Content OS, this supports the future use of Handoff Mappers rather than changing `FinalMasterScript` for each media provider.

### 2.5 Douyin-Micro-Horror-Studio

Source: [Xiao-rx/Douyin-Micro-Horror-Studio](https://github.com/Xiao-rx/Douyin-Micro-Horror-Studio)

#### Project Positioning

`Douyin-Micro-Horror-Studio` is a semi-automated workflow for micro-horror comics and short drama. It explicitly keeps expensive or quality-sensitive media steps under human control rather than forcing every step through an API.

#### Main Workflow

The documented workflow is approximately:

Project configuration
-> season arc and first-episode outline
-> detailed episode script
-> world and character settings
-> character and scene visual anchors
-> storyboard and prompts
-> externally generated shot videos
-> voice and composition
-> operational materials
-> later episode batches

#### Key Technical and Design Ideas

- The workflow is resumable and supports checkpoints.
- Human operators can confirm, retry, or skip selected stages.
- Expensive image and video generation may be performed in external tools based on budget and quality requirements.
- Generated artifacts are organized into stable project directories by production stage.
- Fixed settings and visual anchors are preserved separately from per-episode outputs.
- Provider keys and model configuration are separated from the repository example configuration.

#### Strengths

- Realistic human-in-the-loop design for costly and subjective steps.
- Resumability and explicit stage artifacts support operational recovery.
- Distinguishes stable series settings from episode-specific work.
- Cost awareness prevents blind one-click generation.
- The project directory acts as a transparent artifact ledger for creators.

#### Limitations for AI Comic Content OS

- The workflow is specialized for Douyin/Red Fruit micro-horror and should not define TikTok overseas rules.
- A single workflow script and desktop application can concentrate responsibilities and make domain components harder to replace.
- File-system stage folders provide operational visibility but are not a substitute for typed domain models and lineage.
- The public repository has a very short visible history, so generalized claims require validation.
- Operations materials and video production are outside the current MVP.

#### Relevance

The most valuable ideas are human quality gates, resumability, stable artifact organization, and separation of fixed series settings from episode outputs. These can inform future execution and handoff design without adopting the genre- or platform-specific workflow.

### 2.6 Screen-Creative-Skills Analysis

Sources:

- Primary reference: [screen-creative-skills](https://github.com/GongLingRui/screen-creative-skills)
- Production-workflow comparison: [Micro-Drama-Skills](https://github.com/zhaihao118/Micro-Drama-Skills)

#### 2.6.1 Project Positioning

`screen-creative-skills` presents itself as a collection of professional screenplay creation and evaluation capabilities. Its public catalog separates source-material screening, story analysis, character analysis, screenplay evaluation, drama planning, drama creation, series analysis, workflow support, and result processing. Its most relevant contribution to this project is therefore **professional creative capability decomposition**, not one-click media production.

The three approaches have different centers of gravity:

| System | Primary decomposition unit | Typical flow | Main concern |
|---|---|---|---|
| `Micro-Drama-Skills` | Production-stage skill | Script and character design -> storyboard -> media generation -> project submission | Production workflow skillization |
| `screen-creative-skills` | Professional creative capability | Source evaluation -> story analysis -> planning -> creation -> screenplay evaluation | Professional creative capability skillization |
| AI Comic Content OS | Governed module and versioned data contract | Data Intelligence -> `ContentSpec` -> generation -> Story QC -> controlled revision -> `FinalMasterScript` | Content intelligence, explainable quality improvement, lineage, and Benchmark validation |

`Micro-Drama-Skills` groups broad tasks around production stages and extends into image, video, and submission workflows. `screen-creative-skills` goes deeper into the professional work inside script development by separating analysis, planning, creation, and evaluation responsibilities.

AI Comic Content OS should not become either repository's runtime architecture. It already has typed objects, adapters, controlled finalization, evaluation, lineage, and stable module boundaries. The useful lesson is how professional creative work can be decomposed into bounded, testable capabilities inside those existing boundaries.

#### 2.6.2 Skill Decomposition Insight

A prompt-only approach tends to collapse knowledge, task definition, workflow, output requirements, and evaluation criteria into one model instruction:

Prompt
-> LLM

This is quick to prototype, but it makes capability ownership unclear. It also makes version comparison, evidence tracing, reuse, and independent evaluation difficult because a prompt change may alter several responsibilities at once.

A more governable future direction is:

Knowledge
-> Creative Skill
-> Prompt
-> LLM

In this sequence:

- **Knowledge** contains governed storytelling principles, applicability, sources, confidence, examples, and anti-patterns.
- **Creative Skill** describes a bounded professional capability such as story diagnosis, hook planning, character-agency evaluation, or revision planning. It defines purpose, typed inputs, expected outputs, evaluation criteria, and referenced knowledge.
- **Prompt** is a versioned execution artifact assembled or retrieved for a particular model task.
- **LLM** remains a replaceable implementation behind `LLMAdapter`.

For AI Comic Content OS, `Creative Skill` is currently a research concept, not a new registry, engine, agent, or public workflow. Any future implementation must first prove that the capability cannot be represented cleanly through the existing Knowledge Base, Prompt Library, Story QC, Revision Strategy, and evaluation contracts.

#### 2.6.3 Relationship With AI Comic Content OS

| Existing capability | Future compatibility with creative-skill decomposition | Boundary |
|---|---|---|
| Knowledge Base | Supplies versioned professional principles and applicability constraints referenced by a creative capability | Knowledge must not be duplicated as hidden prompt text |
| Prompt Library | Supplies versioned prompt templates selected or composed for the capability | A prompt is an execution artifact, not the capability itself |
| Story QC | Can apply bounded screenplay-analysis and evaluation capabilities to explicit dimensions and evidence | Story QC remains the problem-identification boundary and must stay explainable |
| Revision Strategy | Can translate a diagnosed problem into a bounded improvement goal, method, protected scope, and future `knowledge_refs` | Revision remains controlled improvement, not autonomous regeneration |

This relationship preserves the existing principle `Knowledge Before Prompt`. Professional methods should be governed once, referenced by the relevant capability, and then expressed through model-specific prompts only at execution time.

#### 2.6.4 What Can Be Borrowed

The following ideas are suitable for future validation within existing modules:

1. **Creative workflow decomposition**
   - Separate analysis, planning, creation, and evaluation so that each capability has a clear responsibility and can be benchmarked independently.
2. **Screenplay analysis capability**
   - Treat structural analysis, character analysis, plot-keypoint extraction, and source-material evaluation as distinct professional tasks rather than one generic script prompt.
3. **Evaluation skills**
   - Keep evaluation separate from generation and define explicit inputs, dimensions, evidence, and outputs. This aligns with Story QC Explainability and Prompt Evaluation.
4. **Planning skills**
   - Preserve planning as a deliberate step before prose or scene generation. This aligns with `ContentSpec`, `CreativeBrief`, and future knowledge-aware planning rather than direct prompt-to-script generation.
5. **Declared dependencies and workflow examples**
   - Document which capability depends on which inputs and prior outputs without turning the dependency graph into a new orchestration system.

These are patterns to adapt and validate, not implementations to copy.

#### 2.6.5 What Should Not Be Adopted Now

The current Capability Optimization Phase should explicitly avoid:

- Building a large skill marketplace or `Skill Registry` before concrete reuse and Benchmark value are demonstrated.
- Introducing a multi-agent system to coordinate creative capabilities that existing modules and services can already perform.
- Replacing `ContentSpec`, Prompt Library, `LLMAdapter`, Story QC, Revision, or the Script Engine Box Contract with repository-specific skill execution conventions.
- Automating the entire creative workflow before individual analysis, planning, evaluation, and revision capabilities are credible.
- Treating a large skill catalog as evidence of quality without fixed Benchmark results, reproducibility, and regression detection.
- Importing assumptions from Chinese production workflows without validating TikTok, overseas audience, genre, culture, and commercial applicability.

#### 2.6.6 Current Architecture and Roadmap Impact

This research does not change the current roadmap. Revision Quality Improvement remains the active priority, and future Knowledge or Skill design remains deferred until after the Script Generation checkpoint.

The finding only refines a possible long-term capability model:

Knowledge
-> Creative Skill
-> Prompt
-> LLM

Before any implementation, a proposed creative capability must identify:

- Which existing module owns it.
- Which knowledge it references.
- Which typed input and output contracts it uses.
- Which fixed Benchmark verifies its value.
- Why the existing module cannot support it without an additional abstraction.

### 2.7 awesome-ai-persona-skills Analysis

Source: [momozi1996/awesome-ai-persona-skills](https://github.com/momozi1996/awesome-ai-persona-skills)

#### 2.7.1 Project Positioning

`awesome-ai-persona-skills` is a collection of persona-oriented Agent Skills. Its public repository includes celebrity or fictional personas, novelist and media-creator styles, emotional and social capabilities, director personas, and multi-agent groups. The repository describes its approach as persona distillation: packaging identity, mental models, expression patterns, decision tendencies, values, limitations, and source material into reusable Skill files.

A sampled novelist Skill contains more than a style label. It includes metadata, an identity card, a response workflow, mental models, decision heuristics, expression characteristics, values and anti-patterns, internal tensions, capability limits, and research references. This demonstrates a potentially useful method for externalizing behavior constraints, but it does not independently prove character consistency or screenplay quality.

The three skillization directions should remain distinct:

| Reference | Primary unit | Main contribution | Relevance to AI Comic Content OS |
|---|---|---|---|
| `Micro-Drama-Skills` | Production-stage skill | Production workflow skillization | Future Media Production handoff research |
| `screen-creative-skills` | Professional analysis, planning, creation, or evaluation capability | Professional creative capability skillization | Future script capability decomposition |
| `awesome-ai-persona-skills` | Persona, behavior, or expression capability | Persona and character-behavior skillization | Future character intelligence research |
| AI Comic Content OS | Governed domain object and replaceable capability | Evidence-driven script generation and quality control | Current stable architecture |

AI Comic Content OS should not reproduce named real-person personas or adopt the repository's agent runtime. The reusable idea is narrower: represent a fictional character's stable motivations, choices, speech tendencies, emotional boundaries, contradictions, and prohibited behaviors as structured, versioned creative constraints.

#### 2.7.2 Character Intelligence Value

Current character descriptions can state who a character is, but reliable serial storytelling also requires rules for how that character behaves under pressure. Character intelligence should help answer:

- Which motivation wins when two goals conflict?
- What kind of choice will the character initiate rather than merely react to?
- Which risks will the character accept or refuse?
- How does the character speak when calm, threatened, ashamed, or dominant?
- Which emotional or moral boundary would the character not cross without an explicit arc event?
- Which contradiction makes the character complex without making behavior arbitrary?

The relevant future relationships are:

| Current capability | Potential persona contribution | Required boundary |
|---|---|---|
| Character Asset | Hold canonical identity, motivation hierarchy, decision patterns, speech patterns, emotional boundaries, contradictions, and version | Continue using the unified `Asset` model; do not create an isolated persona database |
| Story QC | Compare scene evidence with established motivation, agency, dialogue, and emotional boundaries | QC must cite the conflicting scene and character constraint rather than make a generic consistency claim |
| Revision Strategy | Turn a detected inconsistency into a bounded correction while protecting canonical traits and completed arc events | Revision must not silently replace the character personality or rewrite unrelated scenes |

This would allow character consistency to become testable. For example, Story QC could identify that a normally decisive protagonist becomes passive in Scene 2 without a narrative cause; Revision Strategy could then restore an active choice while preserving the character's speech pattern and emotional boundary.

#### 2.7.3 Future Creative Skill Layer

The prior research direction remains:

Knowledge
-> Creative Skill
-> Prompt
-> LLM

Future creative capabilities may include:

- Story Structure Skill
- Genre Writing Skill
- Character Persona Skill
- Dialogue Skill
- Revision Skill

These labels describe possible bounded capabilities, not modules approved for implementation. A future Character Persona Skill would reference governed fictional-character knowledge and assets, expose typed inputs and outputs, and produce constraints for Prompt Builder or evaluation. It would not inject an uncontrolled persona prompt directly into the model.

The responsibility split should remain:

- Knowledge records why a storytelling or character principle applies.
- Creative Skill defines the bounded professional task and its evaluation contract.
- Prompt is the versioned execution artifact.
- `LLMAdapter` executes the prompt without owning character truth.

#### 2.7.4 What Can Be Borrowed

The following concepts are suitable for future research and Benchmark validation:

- **Reusable creative capabilities:** Package one stable responsibility instead of repeating persona instructions across prompts.
- **Structured persona definition:** Separate identity, motivation, decision heuristics, expression patterns, values, anti-patterns, tensions, and capability limits.
- **Behavior consistency:** Describe how a character chooses and reacts under different pressures, not only surface traits or biography.
- **Skill modularization:** Keep character behavior constraints separable from story structure, genre method, dialogue execution, and revision logic.
- **Explicit limitation and source sections:** Preserve uncertainty, applicability, provenance, and known failure modes instead of presenting persona assumptions as facts.

For this project, all borrowed concepts must be adapted to fictional characters, overseas audience requirements, controlled retrieval, and fixed Benchmark evaluation.

#### 2.7.5 What Should Not Be Copied

The current project should explicitly avoid:

- Building or importing a large Skill marketplace or `Skill Registry`.
- Injecting an entire persona file into every generation Prompt without relevance checks, versioning, token limits, or conflict resolution.
- Treating imitation of a real person, living author, public figure, or protected fictional IP as the definition of character intelligence.
- Replacing `ContentSpec`, Character Asset, Prompt Library, Story QC, Revision Strategy, or `LLMAdapter` with persona files.
- Introducing multi-agent persona debates, director teams, or autonomous character agents into the stable Script Generation pipeline.
- Assuming that style imitation proves motivation consistency, character agency, dialogue quality, cultural fit, or commercial value.
- Copying persona claims without separate provenance, license, rights, cultural, and safety review.

#### 2.7.6 Roadmap Impact

This research does not change the current roadmap or authorize implementation.

The script-generation capability sequence remains:

Revision Quality Improvement
-> Script Generation checkpoint
-> Future Knowledge / Skill design

Character Persona Skill remains a future research candidate after the current Revision and Script Generation checkpoint. No Character Intelligence module, Skill Registry, agent workflow, or persona injection mechanism should be implemented now.

## 3. Design Pattern Extraction

### 3.1 Prompt and Skill Management

#### Observed Patterns

- `manga-script-master` packages creative methodology as a reusable skill.
- Toonflow separates screenwriting, directing, storyboarding, and provider-oriented generation skills.
- The other projects expose configurable prompts or provider parameters but focus more heavily on end-to-end application workflows.
- `Micro-Drama-Skills` packages broad production stages as reusable skills.
- `screen-creative-skills` decomposes professional creative work into screening, analysis, planning, creation, and evaluation capabilities.
- `awesome-ai-persona-skills` externalizes identity, mental models, decision tendencies, expression patterns, values, anti-patterns, limits, and references as persona-oriented skills.

#### Reusable Lesson

Creative capabilities should be modular, named, versioned, and independently evaluable. A useful skill boundary represents a stable task such as story planning, character development, dialogue revision, or storyboard handoff.

However, a skill file must not become an uncontrolled container for:

- industry knowledge
- platform assumptions
- Prompt templates
- provider instructions
- workflow routing
- quality rules

For AI Comic Content OS, the correct mapping remains:

- professional principles -> `ScriptIndustryKnowledge`
- reusable Prompt assets -> Prompt Library
- contextual selection -> Prompt Retrieval
- composition -> Prompt Builder
- execution parameters -> `GenerationStrategy`
- quality verification -> Story QC and Prompt Evaluation

#### Recommendation

Adopt the modular skill concept, but normalize it into existing governed objects. Do not import a monolithic skill as the new source of truth.

Treat `Knowledge -> Creative Skill -> Prompt -> LLM` as a future capability model, not a new runtime architecture. Any future creative skill should have typed inputs, typed outputs, knowledge references, and an independent evaluation method before implementation.

### 3.2 Production Pipeline

#### Observed Pattern

The reviewed production-oriented projects represent production as multiple transformations rather than a single model call. The common sequence is:

Story input
-> script
-> character and scene preparation
-> storyboard or shot representation
-> image/video generation
-> voice and composition

Several repositories also produce intermediate files or records for every stage.

#### Comparison With Current Architecture

AI Comic Content OS currently stops deliberately at:

`ContentSpec`
-> `MasterScript`

The future Media Production Phase may continue with:

`ScriptGenerationResult`
-> Handoff Mapper
-> Storyboard request
-> media asset requests
-> provider adapter
-> production artifacts

This is compatible with the external pattern while preserving the current phase boundary.

#### Recommendation

Adopt explicit stage artifacts and handoff contracts later. Do not move storyboard fields, camera prompts, or provider syntax into `MasterScript` merely because external tools combine them.

### 3.3 Asset Management

#### Observed Patterns

- `manga-script-master` uses fixed visual descriptors and signature objects as character anchors.
- Toonflow stores character bibles, asset prompts, and storyboard records separately.
- Xiakeman treats characters, scenes, clothes, props, and consistency references as production assets.
- Douyin-Micro-Horror-Studio separates fixed settings and visual anchors from per-episode outputs.

#### Reusable Lesson

Character consistency is not only a prompt problem. It requires stable identity, visual anchors, reusable references, and controlled episode-level variation.

#### Comparison With Current Architecture

The current unified `Asset` model is the correct base. Future character, scene, wardrobe, prop, voice, and visual-reference assets should remain differentiated by `asset_type` rather than becoming isolated libraries with incompatible schemas.

Potential future asset metadata may include:

- canonical identity reference
- visual anchor descriptors
- continuity scope
- allowed variations
- episode usage history
- source and version
- provider-neutral reference identifiers

These are research recommendations, not current data-model changes.

### 3.4 Genre Template and Story Blueprint

#### Observed Patterns

- `manga-script-master` defines genre rhythm formulas and timing expectations.
- Douyin-Micro-Horror-Studio encodes a specific genre and platform production SOP.
- Toonflow externalizes screenwriting and directing methods into skills.

#### Reusable Lesson

Genre templates can expose useful expectations for:

- emotional promise
- hook type
- conflict escalation
- reveal cadence
- protagonist agency
- cliffhanger behavior
- episode continuity

But genre templates are hypotheses, not universal rules.

#### Comparison With Current Architecture

The correct future representation should distribute responsibilities:

- Ontology identifies governed genre, emotion, audience, and narrative tags.
- Knowledge Base stores evidence-backed genre knowledge and applicability.
- `ContentSpec` declares the selected content intent.
- `GenerationStrategy` defines how that intent is generated.
- Story QC evaluates whether the output fulfills the selected expectations.
- Benchmark verifies whether the blueprint improves outcomes for a specific platform, region, audience, and genre.

#### Recommendation

Research genre blueprints as versioned knowledge records with explicit applicability. Do not hardcode Chinese short-drama timing formulas into TikTok core logic.

### 3.5 Agent and Workflow Orchestration

#### Observed Patterns

- Toonflow uses decision agents, sub-agents, memory, tools, and supervision.
- The other projects generally use fixed workflows, services, skills, scripts, or UI-guided stages.

#### Should AI Comic Content OS Introduce Agents?

Not at the current stage.

The current modular-box architecture is more appropriate because it provides:

- explicit typed inputs and outputs
- deterministic test boundaries
- versioned lineage
- easier Benchmark reproduction
- replaceable adapters
- clearer responsibility separation
- lower operational and debugging complexity

Agent orchestration would only be justified if a validated capability cannot be expressed through the current boxes and bounded workflows. Even then, an agent should operate behind a stable interface and must not become the owner of `ContentSpec`, Prompt Retrieval, Story QC, or Finalization.

#### Agent Ideas Worth Borrowing Without Adding Agents

- task-specific capability separation
- explicit tool permissions
- checkpoints
- independent quality supervision
- bounded retries
- preserved intermediate artifacts

These can all be implemented through ordinary services, policies, adapters, and evaluation without introducing autonomous agents.

## 4. What AI Comic Content OS Should Adopt

The following table records potential adoption ideas only. It does not authorize implementation or roadmap changes.

| External Idea | Source Project | Potential Adoption | Current Module |
|---|---|---|---|
| Externalized creative skill definitions | manga-script-master, Toonflow | Normalize reusable creative methods into versioned Prompt and Knowledge assets | Knowledge Base, Prompt Library |
| Genre-specific story blueprint | manga-script-master, Douyin-Micro-Horror-Studio | Research as applicability-scoped knowledge and validate against fixed Benchmark cases | Ontology, `ContentSpec`, Script Knowledge Framework |
| Character visual anchors | manga-script-master, Xiakeman, Douyin-Micro-Horror-Studio | Store provider-neutral identity and continuity metadata on unified assets | Asset Module, future Character assets |
| Character bible and arc record | Toonflow | Retrieve structured character intent without embedding it permanently in Prompt text | Asset Retrieval, Creative Brief, Knowledge Base |
| Asset-first production planning | Xiakeman, Toonflow | Resolve reusable character, scene, wardrobe, and prop references before future media generation | Asset Retrieval, future production handoff |
| Separate script, director, and storyboard artifacts | Toonflow | Preserve transformation boundaries through Handoff Mappers rather than expanding `MasterScript` | Script Engine Box Contract, Media Production Phase |
| Human confirmation gates | Douyin-Micro-Horror-Studio | Use review gates for expensive, subjective, or low-confidence future operations | Developer Options, future Media Production Phase |
| Resumable staged workflow | Douyin-Micro-Horror-Studio | Preserve stage status and artifact lineage for long-running future jobs | Lineage, future job execution |
| Explicit production artifact ledger | Toonflow, Douyin-Micro-Horror-Studio | Keep generated artifacts traceable by type, source, version, and stage | `ScriptGenerationResult.generated_artifacts`, future handoff |
| Provider abstraction | Toonflow, cumob-ai, Xiakeman | Continue adapter-first integration and keep provider syntax outside domain models | `LLMAdapter`, future media adapters |
| Streaming task progress and retries | cumob-ai | Reconsider for future long-running integration and production jobs | API operations, future job execution |
| Transformation-specific quality checklist | manga-script-master, Toonflow | Convert validated checklist items into evidence-linked evaluation dimensions | Story QC, Benchmark, Prompt Evaluation |
| Budget-aware external execution | Douyin-Micro-Horror-Studio | Allow manual or external-tool handoffs instead of requiring every media step to call an API | Cost Quality placeholder, future Media Production Phase |
| Production workflow skillization | Micro-Drama-Skills | Use as a Phase 2 reference for bounded media-production handoffs, not as a current MVP workflow | Future Media Production Phase |
| Professional creative capability decomposition | screen-creative-skills | Separate analysis, planning, creation, and evaluation responsibilities within existing modules and validate each independently | Knowledge Base, Prompt Library, Story QC, Revision Strategy |
| Structured fictional-character behavior constraints | awesome-ai-persona-skills | Research versioned motivation, decision, speech, emotional-boundary, tension, and anti-pattern constraints without copying named personas | Character Asset, Story QC, Revision Strategy |

## 5. What AI Comic Content OS Should Not Adopt

### 5.1 One-Click Generation as the Core Architecture

A one-click interface can be useful, but a one-click architecture hides intermediate decisions and failures. It conflicts with the project's need for:

- `ContentSpec` as the source of truth
- explainable quality evaluation
- controlled revision
- complete lineage
- independent Benchmark testing

If a one-click interface is introduced later, it should call the same governed boxes and expose their artifacts rather than bypassing them.

### 5.2 Premature Video Generation

The external projects show that video generation rapidly introduces provider syntax, visual continuity, voice, composition, cost, retries, and asset management. Implementing these now would divert effort from the current bottlenecks:

- Story QC credibility
- revision quality
- Data Intelligence quality
- Prompt Evaluation reliability

The Media Production Phase should remain deferred.

### 5.3 Excessive Agent Complexity

Agents can make workflow diagrams appear flexible while reducing reproducibility. Current risks include:

- hidden routing decisions
- non-deterministic state transitions
- difficult lineage reconstruction
- duplicated Prompt logic
- harder unit testing
- unclear responsibility boundaries

The project should retain modular boxes and bounded services until Benchmark evidence demonstrates a specific need for agent behavior.

### 5.4 UI-First Development

Several external tools invest heavily in workbenches, desktop applications, or multimedia previews. These are valuable product layers, but they do not prove content quality.

AI Comic Content OS should not build a large UI before its evaluation and script-quality capabilities become credible. A future UI should reveal existing contracts and evaluation evidence rather than becoming the location of business rules.

### 5.5 Hardcoded Genre or Platform Formulas

Rules designed for Douyin, Red Fruit, Chinese micro-horror, or a particular generation model must not be hardcoded into core logic. They may enter Research and later become:

- a scoped `PlatformProfile`
- a versioned Knowledge record
- a governed Ontology tag
- a Benchmark hypothesis

Only validated knowledge should affect generation or evaluation.

### 5.6 Provider-Specific Fields in Core Objects

Storyboard formats, Seedance references, model prompt limits, and provider-specific camera syntax should not enter `ContentSpec` or `FinalMasterScript`. They belong behind future Handoff Mappers and media-generation adapters.

### 5.7 File Trees as the Only Source of Truth

Organized production directories are useful for users, but file naming alone cannot replace typed models, versioning, persistence, and lineage. Exported directories should be views of governed artifacts, not the canonical system state.

## 6. Impact on Current Roadmap

This research does not change the current roadmap or priorities.

### 6.1 Generation Pipeline

No immediate change recommended.

The external workflows support the decision to preserve explicit intermediate artifacts and replaceable providers. The current `ContentSpec`-to-`FinalMasterScript` chain remains the correct MVP boundary.

### 6.2 Story QC

Potential future research inputs:

- transformation-specific checklists
- scene purpose and camera-observable action
- genre-specific pacing hypotheses
- character continuity checks

These should enter the Script Knowledge Framework and fixed Benchmark experiments before becoming implementation rules.

### 6.3 Revision Quality Improvement

Potential future recommendations:

- preserve protected dimensions during targeted revision
- maintain stable character and setting anchors
- record modified scenes and downstream artifact invalidation
- include human approval when revision confidence is low

These ideas are compatible with bounded, explainable revision but do not alter the current implementation priority or Phase 3 design process.

### 6.4 Data Intelligence

External projects provide limited evidence for data-driven content analysis. This reinforces that Data Intelligence remains a distinctive capability of AI Comic Content OS rather than a feature to copy from these production tools.

Potential future analysis may test whether genre blueprint features improve `ContentSpecDraft` quality, but external formulas must not be treated as ground truth.

### 6.5 Media Production Phase

The strongest future references are:

- asset-first preparation
- visual anchors
- separate storyboard and provider artifacts
- resumable jobs
- human approval gates
- provider abstraction
- budget-aware execution

Before Media Production begins, these should inform Handoff Mapper and adapter design. They should not trigger implementation during the current Capability Optimization Phase.

## 7. Architectural Alignment Check

### 7.1 Documentation Driven Development

Aligned.

This document records external observations and recommendations as Research only. It does not change Architecture or Code. Any future adoption must follow:

Research
-> Architecture Decision
-> Data Contract
-> Implementation
-> Benchmark Validation

### 7.2 Script Engine Box Contract

Aligned.

The recommended ideas preserve the Script Generation Box boundary. External storyboard, asset, and media requirements should consume `ScriptGenerationResult` through future Handoff Mappers rather than access Draft, Prompt Builder, Story QC, or Revision internals.

### 7.3 Modular Replaceable Components

Aligned.

Provider abstraction, staged artifacts, and modular creative skills support replaceability. The research explicitly rejects provider-specific fields in core domain objects and rejects agent routing as a replacement for stable contracts.

### 7.4 Stable Baseline Principle

Aligned.

No external pattern should be adopted directly into the stable generation pipeline. A candidate improvement must have:

- a defined capability objective
- a fixed Benchmark or evaluation method
- backward-compatible contracts where possible
- regression tests
- documentation synchronization
- a new version baseline after validation

### 7.5 Current Architecture Decision

No architecture change is recommended from this research.

The current default remains:

- retain modular boxes
- retain `ContentSpec` as the source of truth
- retain the controlled Script Engine lineage
- retain adapters for external providers
- defer media production
- require Benchmark evidence before capability changes

## 8. Consolidated Conclusions

1. The external projects confirm that AI comic production is a staged workflow with distinct script, asset, storyboard, and media artifacts.
2. The most reusable near-term idea is governed creative-method externalization, not one-click generation.
3. Visual anchors and stable character/scene references are important future Asset capabilities, but they should remain provider-neutral.
4. Genre blueprints are useful as research hypotheses and Knowledge records, not hardcoded universal formulas.
5. Human review, checkpoints, resumability, and budget-aware execution are credible patterns for the future Media Production Phase.
6. Multi-agent orchestration is not justified for the current system; modular boxes remain easier to test, trace, replace, and benchmark.
7. The reviewed projects provide relatively little evidence for Data Intelligence, Benchmark-first optimization, or evidence-linked Story QC. These remain differentiating core assets of AI Comic Content OS.
8. `Micro-Drama-Skills` demonstrates production workflow skillization by packaging broad production stages such as script preparation, storyboard and media generation, and project submission as executable skills. This is primarily relevant to the future Media Production Phase.
9. `screen-creative-skills` demonstrates professional creative capability skillization by separating screening, screenplay analysis, planning, creation, and evaluation into reusable capabilities. This is more directly relevant to future improvements in Knowledge Base, Prompt Library, Story QC, and Revision Strategy.
10. A useful future direction is `Knowledge -> Creative Skill -> Prompt`: Knowledge remains governed and reusable, a creative skill defines the bounded professional task, and the prompt remains a versioned execution artifact. Possible future capabilities include Story Structure, Genre Writing, Character Persona, Dialogue, and Revision Skills, but none is approved for implementation by this research.
11. `awesome-ai-persona-skills` demonstrates persona and character-behavior capability skillization. Its most reusable pattern is the structured separation of identity, motivation, decision heuristics, expression patterns, values, anti-patterns, tensions, limitations, and sources, not named-person imitation or agent orchestration.
12. Character Persona Skill should remain a future research concept mapped onto Character Asset, Story QC, and Revision Strategy. It does not justify a Skill Registry, uncontrolled persona injection, multi-agent expansion, or architecture replacement.
13. No current roadmap priority should change as a result of this research. Revision Quality Improvement remains active, followed by a Script Generation checkpoint before any future Knowledge or Skill design.

## 9. Future Research Backlog

The following are research candidates only:

- Define a provider-neutral visual-anchor metadata proposal for unified `Asset` records.
- Compare genre blueprint claims against the existing overseas TikTok Benchmark datasets.
- Study how fixed series bibles should be retrieved without duplicating `ContentSpec`.
- Define artifact invalidation rules when a revised script changes characters, scenes, or continuity.
- Evaluate human approval gates for low-confidence revision and future expensive media jobs.
- Compare fixed service orchestration with agent orchestration using reproducibility, latency, lineage completeness, and quality metrics before reconsidering agents.
- Conduct a separate license and code-quality review before any source-level reuse.
