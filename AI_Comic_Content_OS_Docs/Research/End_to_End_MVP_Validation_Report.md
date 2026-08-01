# Script Generation Box v2 MVP End-to-End Validation Report

## Status

```yaml
document_type: production_oriented_validation_plan_and_report_template
experiment_version: script_generation_box_v2_e2e_validation.v1
execution_status: planned_not_executed
runtime_change: false
schema_change: false
professional_validation: false
case_count: 5
planned_initial_draft_calls: 5
planned_shadow_deepening_calls: 5
```

本文件定义 Script Generation Box v2 MVP 的一次有界端到端验证。当前不填写生成结果，不把计划值伪装成实测值。执行完成后，应在冻结本文件中的输入、模型和判定标准的前提下回填结果。

验证对象：

```text
CreativeIntentInput
→ ContentSpec + ResolvedCreativeContext
→ Static Knowledge Bundle Selection
→ Draft Generation with Scene Causality
→ Creative Deepening Shadow
→ Source / Candidate Story QC Comparison
```

正式 `draft_master_script` 必须继续指向 source Draft。Shadow candidate、candidate QC 和 comparison metadata 只用于观察，不得进入 Revision 或 Finalization。

## 1. Validation Questions

本轮只回答：

1. 五类输入能否通过相同现有 runtime 稳定生成结构化 source Draft？
2. Creative Intent 和 Character Context 是否能在剧本中留下可定位证据？
3. 每个 Scene 是否保持 Goal / Conflict / Outcome 与跨场因果？
4. Deepening shadow 是否能提高表达质量，同时保持故事、角色、因果和结尾目的？
5. Knowledge Bundle 的选择、缺失和阶段隔离是否透明可追踪？
6. 第二次 LLM 调用带来的 token、延迟和失败成本是否可接受？

本轮不验证多集 Story Planning、RAG、自动 Prompt 优化、Deepening apply、专业 Story QC 成熟度或视频生产适配。

## 2. Known Coverage Boundary

当前静态目录只提供：

- `knowledge_bundle.draft.dark_romance_tiktok.v1`
- `knowledge_bundle.deepening.dark_romance_tiktok.v1`

因此五个案例中的知识选择必须按下表执行：

| Genre | Draft bundle | Deepening bundle | Validation meaning |
|---|---|---|---|
| Dark Romance | exact bundle selected | exact bundle selected | 验证完整静态知识路径 |
| Revenge Drama | none | none | 验证无适用 bundle 的兼容路径 |
| Mystery | none | none | 验证无适用 bundle 的兼容路径 |
| Sci-Fi | none | none | 验证无适用 bundle 的兼容路径 |
| Comedy | none | none | 验证无适用 bundle 的兼容路径 |

禁止把 Dark Romance bundle 强行用于其他 genre。其余四类的成功只能证明无知识时的安全回退，不能证明跨 genre Knowledge 能力。Knowledge coverage 在本轮实际为 `1/5 genres`。

## 3. Frozen Execution Configuration

执行前必须冻结并写入 manifest：

- Git commit 和工作区状态
- `experiment_version`
- `ContentSpec`、Ontology、PlatformProfile、Prompt、GenerationStrategy 和 bundle 版本
- LLM provider、model、temperature、top_p、max_tokens 和 timeout/retry 配置
- output language：`en`
- target platform：`tiktok`
- desired scene count：每例 `3`
- target duration：每例 `45-60 seconds`
- `deepening_mode=shadow`
- 一次 source Draft 调用和一次 Deepening shadow 调用
- 不允许 subjective quality retry
- 技术重试必须保留次数、原因和额外延迟

建议固定参数沿用已经验证的低随机度设置；实际值必须在首次调用前写入 manifest，运行中不得调参。

## 4. Fixed Cases

所有 tag label 在执行前必须映射为 active `OntologyNode`。若正式 seed 缺少 Mystery、Sci-Fi 或 Comedy 节点，可使用版本冻结的 evaluation-only Ontology fixture，但必须在 lineage 中标记，不能静默创建生产标签。

### 4.1 Dark Romance

**Creative Intent**

- Free prompt: `A controlled woman enters a dangerous alliance with the heir who may have ruined her family, then discovers that exposing him could protect the person she distrusts most.`
- Audience: Female 18-34, Romance Audience
- Genre/theme: Dark Romance, Suspense, Power Imbalance
- Emotional promise: Anger, attraction, distrust, dangerous hope
- Exclusions: romanticized coercion, innocent-person harm, love triangle, arbitrary cruelty

**Character Context**

- Name/role: Mara Vale, protagonist
- Desire: expose the financial conspiracy that destroyed her family
- Fear: trusting someone who can weaponize her vulnerability
- Belief: powerful people only confess when losing control
- Contradiction: wants intimacy but treats every bond as leverage
- Decision pattern: gathers proof, then takes a public and costly action
- Moral boundary: will not endanger innocent employees to obtain revenge
- Locked: name, role, desire, moral boundary

**Expected knowledge selection**

- Draft: `knowledge_bundle.draft.dark_romance_tiktok.v1`
- Deepening: `knowledge_bundle.deepening.dark_romance_tiktok.v1`

**Primary risk to inspect**

- Darkness becoming decorative cruelty rather than affecting trust, boundaries and choice.

### 4.2 Revenge Drama

**Creative Intent**

- Free prompt: `A forensic accountant exposes the charity that framed her father, but the evidence forces her to choose between immediate revenge and protecting the victims still inside it.`
- Audience: Revenge Drama Audience, Thriller Audience
- Genre/theme: Revenge Drama, Investigation, Institutional Corruption
- Emotional promise: indignation, control, risk, earned satisfaction
- Exclusions: wedding reveal, secret heir, random murder, revenge against innocent people

**Character Context**

- Name/role: Nia Brooks, protagonist
- Desire: clear her father's name with verifiable evidence
- Fear: becoming as ruthless as the people she is exposing
- Belief: truth without proof only protects the powerful
- Contradiction: craves public vindication but protects private victims
- Decision pattern: converts emotional pressure into an evidence-based counter-move
- Moral boundary: will not expose victim identities
- Locked: name, role, desire, moral boundary

**Expected knowledge selection**

- Draft: none; no governed Revenge Drama bundle exists
- Deepening: none; Deepening still runs without knowledge

**Primary risk to inspect**

- Repetitive evidence reveals or passive reaction instead of escalating counter-action.

### 4.3 Mystery

**Creative Intent**

- Free prompt: `A night archivist discovers that every missing-person file was edited one day before the person disappeared, including a new file bearing her own name.`
- Audience: Mystery Audience, Suspense Audience
- Genre/theme: Mystery, Investigation, Hidden Pattern
- Emotional promise: curiosity, unease, discovery, dread
- Exclusions: supernatural solution, coincidence-only reveal, incompetent investigator

**Character Context**

- Name/role: Elise Ward, protagonist investigator
- Desire: identify who is altering the archive and prevent the next disappearance
- Fear: discovering that her own memory is unreliable
- Belief: records reveal motive when people do not
- Contradiction: trusts systems more than witnesses while investigating corrupted records
- Decision pattern: tests one falsifiable theory before escalating risk
- Moral boundary: will not use a missing victim as bait
- Locked: name, role, belief, moral boundary

**Expected knowledge selection**

- Draft: none; no governed Mystery bundle exists
- Deepening: none

**Primary risk to inspect**

- Withholding arbitrary information instead of building a fair causal mystery.

### 4.4 Sci-Fi

**Creative Intent**

- Free prompt: `An orbital systems engineer learns that the rescue AI she designed has been quietly deciding which distress calls deserve to exist.`
- Audience: Sci-Fi Audience, Mystery Audience
- Genre/theme: Science Fiction, AI Ethics, Investigation
- Emotional promise: curiosity, alarm, moral resolve, uncertainty
- Exclusions: evil-AI cliche, unexplained magic technology, human sacrifice as an easy solution

**Character Context**

- Name/role: Lena Ortiz, protagonist engineer
- Desire: uncover and stop the hidden triage rule
- Fear: that her design choices already caused preventable deaths
- Belief: technology must remain explainable to the people affected by it
- Contradiction: trusts measurable systems but built one that conceals its reasoning
- Decision pattern: isolates the system, verifies evidence, then accepts personal accountability
- Moral boundary: never sacrifice humans to protect the project
- Locked: name, role, belief, moral boundary

**Expected knowledge selection**

- Draft: none; no governed Sci-Fi bundle exists
- Deepening: none

**Primary risk to inspect**

- Exposition replacing visible conflict and character choice.

### 4.5 Comedy

**Creative Intent**

- Free prompt: `A meticulous city clerk accidentally schedules every rival mayoral candidate's secret event in the same tiny community hall and must prevent disaster without revealing her mistake.`
- Audience: Young Adult Comedy Audience, Workplace Comedy Audience
- Genre/theme: Comedy, Escalating Misunderstanding, Public Consequence
- Emotional promise: anticipation, embarrassment, surprise, relief
- Exclusions: humiliation based on identity, cruelty, random slapstick, consequence-free reset

**Character Context**

- Name/role: Maya Chen, protagonist clerk
- Desire: save the event and keep public trust
- Fear: being exposed as unreliable
- Belief: perfect preparation can prevent every conflict
- Contradiction: her need for control makes improvisation harder
- Decision pattern: first conceals the mistake, then chooses an honest high-risk solution
- Moral boundary: will not blame a junior coworker
- Locked: name, role, belief, moral boundary

**Expected knowledge selection**

- Draft: none; no governed Comedy bundle exists
- Deepening: none

**Primary risk to inspect**

- Jokes becoming parallel filler instead of escalating consequences and payoff.

## 5. Execution Procedure

For each frozen case:

1. Seed or verify required PlatformProfile and evaluation Ontology nodes.
2. Submit `CreativeIntentInput` through the existing resolution API/service.
3. Verify `ContentSpec`, `ResolvedCreativeContext`, field provenance, locks and exclusions.
4. Create or select a versioned shadow `GenerationStrategy` with the same model settings.
5. For Dark Romance, declare the exact Draft and Deepening bundles. For all other cases, leave both bundle IDs unset.
6. Call the existing `generate-draft` API/service once.
7. Save source Draft, source Story QC, RevisionPlan and the complete optional `creative_deepening_run`.
8. Do not call Revision, Acceptance or Finalization as part of candidate comparison.
9. Run deterministic checks before human review.
10. Blind the source/candidate labels for the evidence-based review.

The planned model-call total is ten successful calls: five initial Draft calls and five shadow calls. Technical retries do not increase the intended sample count and must be reported separately.

## 6. Artifact Layout

Store execution artifacts under:

```text
examples/prompt_evaluations/script_generation_box_v2_e2e_v1/
  manifest.json
  aggregate_report.json
  aggregate_report.md
  cases/
    dark_romance/
    revenge_drama/
    mystery/
    sci_fi/
    comedy/
```

Each case directory must contain:

```text
creative_intent_input.json
content_spec.json
resolved_creative_context.json
generation_strategy.json
knowledge_selection.json
source_draft.json
source_story_qc.json
deepening_shadow_run.json
candidate_draft.json                 # when a candidate exists
candidate_story_qc.json              # when preservation-valid
qc_comparison.json
deterministic_checks.json
blind_review.json
case_report.md
```

Artifact IDs and versions must come from runtime output. Empty or unavailable candidate fields must be recorded explicitly; do not synthesize missing artifacts.

## 7. Deterministic Checks

### 7.1 Input And Lineage

- Creative Intent resolution succeeds without unresolved conflicts.
- Requested and resolved tag IDs match the frozen fixture.
- Character provenance and locked fields survive resolution.
- Exclusions appear in `ResolvedCreativeContext` and Prompt context.
- Prompt IDs, versions, strategy version, model and bundle references are present.
- Bundle target stage is correct; no Draft/Deepening cross-use occurs.

### 7.2 Source Draft

- Draft schema is valid and required fields are complete.
- Language, platform, duration and scene count match the request.
- Character identity and locked facts are respected.
- Every Scene has distinct Goal / Conflict / Outcome.
- Scene 2 and Scene 3 causally depend on prior outcomes.
- Final Scene delivers the intended payoff or cliffhanger.
- No excluded pattern is introduced.

### 7.3 Shadow Candidate

- At most one shadow candidate call occurs.
- Source Draft remains `draft_master_script` and `selected_draft_master_script_id`.
- Candidate schema is valid when produced.
- Story premise, episode goal, identities, scene count/order/purpose, Scene Causality and ending purpose are unchanged.
- At least one allowed expressive field changes.
- Forbidden changes are rejected and recorded rather than selected.
- Technical failure is recorded without blocking source Draft completion.
- Candidate QC uses the same Story QC implementation/version as source QC.

## 8. Evidence-Based Review Rubric

Review source and candidate independently on a 1-5 scale. Every score must cite a Scene, action or dialogue line.

| Dimension | Review question |
|---|---|
| Generation quality | Is the script coherent, specific and readable as a complete short episode? |
| Character consistency | Do choices, dialogue and emotion follow the locked character context? |
| Scene causality | Does each outcome change the next goal, obstacle or available choice? |
| Emotional progression | Does emotion change through events and visible behavior rather than labels alone? |
| Dialogue quality | Is dialogue concise, character-specific, conflict-bearing and non-expository? |
| Visual suitability | Can important beats be understood through observable actions and images? |
| Hook | Does the opening create an immediate, story-relevant viewing motive? |
| Cliffhanger | Is the final question or reversal prepared by prior choices and consequences? |
| Story preservation | Does Deepening retain the source premise, identities, causality and ending purpose? |

Also record:

- preferred variant: `source`, `deepening_candidate`, or `tie`
- major regression: yes/no, with evidence
- rigidity or over-expansion
- malformed or incomplete text
- uncertainty note

Current Story QC scores are experimental signals only. Human evidence, deterministic preservation and QC comparison must be reported separately.

## 9. Cost, Latency And Reliability

For each source and candidate record:

- prompt tokens
- completion tokens
- total tokens
- estimated cost when adapter metadata supports it
- successful-call latency
- end-to-end case latency
- technical attempt count
- retry/cooldown time
- technical failure type
- structured-output validation result
- expressive growth ratio

Aggregate using median and range; with only five cases, do not claim statistically stable percentile SLOs. Report:

- total and median source tokens
- total and median Deepening incremental tokens
- total Deepening token increase
- source versus shadow latency ratio
- candidate production rate
- preservation-valid candidate rate
- technical attempt failure rate

## 10. Pre-Registered Decision Gates

### Runtime Integrity Gate

- `5/5` source Draft runs complete and validate.
- `5/5` runs keep source Draft authoritative.
- No Deepening failure blocks source QC/RevisionPlan creation.
- All returned lineage references are reproducible.

### Structural Quality Gate

- `5/5` source Drafts pass required Scene Causality checks.
- `5/5` final Scenes provide a causally supported payoff or cliffhanger.
- No case violates locked identity, moral boundary or explicit exclusion.

### Shadow Safety Gate

- Every preservation-valid candidate passes all hard story-preservation checks.
- Any invalid candidate is rejected and traceable.
- No candidate modifies the official Draft, RevisionPlan or Finalization path.

### Observational Value Gate

- Deepening candidate is preferred in at least `3/5` cases.
- No candidate has a major story-preservation, Hook or cliffhanger regression.
- Dialogue, emotional progression or visual suitability improves in at least `3/5` cases.
- Cost and latency are fully reported; no hidden retries or missing usage metadata.

### Knowledge Interpretation Gate

- Dark Romance selects exactly the two governed stage-specific bundles.
- Other genres do not receive an inapplicable bundle.
- The report states `knowledge_genre_coverage=1/5` and makes no broad Knowledge quality claim.

## 11. Decision Values

After evidence review, select exactly one:

- `validated_for_mvp_shadow`: all integrity/safety gates pass, at least 3/5 candidates are preferred, and no major regression occurs.
- `runtime_valid_quality_mixed`: runtime and preservation are reliable, but candidate quality gains are fewer than 3/5 or inconsistent.
- `knowledge_coverage_blocked`: runtime works, but the test cannot support a broad v2 Knowledge claim because only Dark Romance has governed bundles.
- `not_validated`: source workflow is unstable, shadow blocks the old path, or major preservation regressions occur.

Even `validated_for_mvp_shadow` does not approve Deepening apply. Apply requires a separate decision after broader fixed-sample evidence and human review.

## 12. Result Tables To Complete

### Per-Case Runtime Result

| Case | Source valid | Draft bundle | Deepening status | Candidate preservation | QC comparison | Source remained selected |
|---|---|---|---|---|---|---|
| Dark Romance | pending | pending | pending | pending | pending | pending |
| Revenge Drama | pending | none expected | pending | pending | pending | pending |
| Mystery | pending | none expected | pending | pending | pending | pending |
| Sci-Fi | pending | none expected | pending | pending | pending | pending |
| Comedy | pending | none expected | pending | pending | pending | pending |

### Per-Case Human Review

| Case | Generation | Character | Causality | Emotion | Dialogue | Visual | Hook | Cliffhanger | Preservation | Preferred |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Dark Romance | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Revenge Drama | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Mystery | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Sci-Fi | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Comedy | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending |

### Aggregate Cost And Reliability

| Metric | Planned/Expected | Observed |
|---|---:|---:|
| Fixed cases | 5 | pending |
| Successful source calls | 5 | pending |
| Successful shadow calls | 5 | pending |
| Total intended successful calls | 10 | pending |
| Technical retries | 0 preferred | pending |
| Source total tokens | measured | pending |
| Deepening incremental tokens | measured | pending |
| Median source latency | measured | pending |
| Median shadow latency | measured | pending |
| Preservation-valid rate | measured | pending |
| Deepening preference rate | measured | pending |
| Knowledge genre coverage | 1/5 | pending |

## 13. Stop Conditions

Stop the run without tuning Prompt or code when:

- the existing source Draft path fails for two cases;
- Deepening changes the authoritative Draft or downstream RevisionPlan;
- the same technical failure repeats after the pre-registered retry limit;
- frozen model/settings or fixture inputs cannot be preserved;
- artifacts cannot record Prompt/strategy/model lineage.

After the five cases and evidence review, stop. Do not add genre bundles, change Deepening constraints, enable apply or rerun failed quality cases within this experiment.

## 14. Current Pre-Execution Conclusion

The integrated runtime is ready for this bounded validation because contracts and deterministic tests cover Creative Intent, Character Context, static bundle selection, Scene Causality and Deepening shadow fallback. It is not yet justified to claim production-wide Knowledge coverage or Creative Deepening quality.

The most important expected output is not a higher average score. It is a transparent answer to three separate questions:

1. Is the existing source generation path reliable across five representative genres?
2. Is Deepening shadow safe and observably useful without changing the official output?
3. Where does the current one-genre Knowledge coverage limit the v2 MVP claim?
