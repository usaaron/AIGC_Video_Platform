# Creative Deepening Pipeline v1 - Architecture Review

## 1. Research Status

```yaml
document_type: architecture_research
implementation_status: shadow_v1_implemented
runtime_status: observational_shadow_only
roadmap_status: bounded_runtime_validation
scope: script_generation_only
```

本文件最初用于评估 `Creative Deepening` 是否应成为 Script Generation Box 内部的候选阶段。后续已批准并实现最小 shadow runtime：生成一次候选、执行确定性 preservation checks、记录 change trace，并使用同一 Story QC 生成观察性 comparison metadata。`apply` 仍未批准，候选不替换正式 Draft，也不创建新的 Engine、Agent、Skill Registry 或 Knowledge runtime。

以下设计讨论保留其实施前研究语境；如与当前 runtime 状态冲突，以正式 `02_Data_Model.md`、`05_API_Design.md`、`14_Script_Engine.md` 为准。

历史状态说明（2026-08-05）：本文中继续冻结 Story Planning 的结论针对当时的四集规划实验，不否定后续已经实现的人工受控、可变深度长篇规划切片。Creative Deepening 当前仍默认关闭，不参与中国大陆基础长剧本主流程。

当前直接证据来自：

- `examples/prompt_evaluations/creative_control_combined_v1/comparison_report.json`
- `examples/prompt_evaluations/creative_control_combined_v1/blind_review/blind_review_locked.json`

该有界实验中，Structured Creative Control 在 3/3 案例中被偏好；角色一致性、角色主动性、冲突质量、情绪推进和 Scene Causality 均有观察性提升，平均 Prompt Token 增长为 `9.401%`。这证明 Creative Intent、Character Profile 和 Relationship Context 对初稿有直接价值，但没有证明第二次 Creative Deepening 调用一定进一步提升质量。

因此本文必须区分：

1. **已验证**：结构化创作输入值得进入最小 runtime contract design。
2. **待验证**：对结构正确初稿进行一次有边界的创意深化，是否比直接进入 Story QC 更好。

## 2. Motivation

当前 Scene Causality 能保证每场具有 Goal / Conflict / Outcome，并形成因果链；Structured Creative Control 能让角色目标、信念、矛盾和关系方向更明显地影响选择。这两项能力提高了初稿的结构正确性与角色可控性，但仍不自动保证：

- 对白具有稳定角色声音、潜台词和关系张力；
- 情绪通过可见行为逐步累积，而不是由标签或说明句直接声明；
- 场景动作既可视化又具有戏剧功能；
- 同一剧情事实以更高信息密度、更少解释性对白表达；
- Scene intensity 与前后场景形成明确变化，而不是机械重复 Goal / Conflict / Outcome；
- 剧本已达到专业编剧或下游制作质量。

当前 `Story QC` 能定位问题但专业评分仍有限；`RuleBasedRevisionExecutor` 能受控修补已识别问题，但不适合承担广泛的创意表达提升。若把所有创意打磨都塞入 Revision，会让“定向修复”逐渐退化为“任意重写”，破坏已有 bounded revision 边界。

Creative Deepening 的研究价值在于评估是否需要一个单次、有边界、保留故事不变量的表达强化步骤，把“结构正确的初稿”提升为“更具角色、情绪与视觉表达力的候选稿”。在 Media Production 尚未实现的当前阶段，不应把这种候选稿直接称为 production-ready，只能称为 production-suitable script candidate。

## 3. Recommended Position

推荐的未来候选顺序为：

```text
Creative Intent Resolution
→ Character / Relationship Context
→ Draft Generation with Scene Causality
→ Creative Deepening (single bounded pass)
→ Story QC
→ Revision Decision / Strategy / Executor
→ Re-QC / Acceptance
→ Finalization
```

推荐位置是 **Option A：Draft → Deepening → QC → Revision**，但只有在离线 A/B 通过后才允许进入 runtime design。

### 3.1 Option A: Draft → Deepening → QC → Revision

优点：

- Story QC 评估的是准备进入正式质量闭环的 enriched draft，而不是中途版本。
- Deepening 可以处理跨维度表达质量，不需要伪装成某个 QC 扣分项。
- Revision 继续只消费 QC evidence，修复少量已识别问题。
- 只需要一轮正式 QC，不引入重复质量判定。

风险：

- Deepening 在 QC 前运行，必须依赖确定性不变量检查防止内容漂移。
- 如果初稿本身存在结构错误，深化可能放大错误；因此 schema、Scene Causality 与硬约束必须先通过。
- 第二次模型调用会增加 token、延迟和失败面。

结论：三个选项中责任边界最清晰，是推荐的验证方向。

### 3.2 Option B: Draft → QC → Revision → Deepening

优点：

- Deepening 接收到已修复局部问题的版本。
- 可以避免深化明显不合格的 Draft。

风险：

- Deepening 位于 Re-QC / Acceptance 之后时可能重新引入回退，却没有后续质量检查。
- 如果再增加 QC，就形成额外循环和更高复杂度。
- 最后一步广泛改写会削弱 Revision trace、AcceptanceDecision 与 Finalization lineage 的可信度。

结论：不推荐。除非 Deepening 后重新 QC，否则违反现有 Finalization 边界；重新 QC 又会增加不必要流程。

### 3.3 Option C: Draft → QC → Deepening → Revision

优点：

- Deepening 可以利用 QC evidence 选择重点。
- 可以避免对已经很强的维度进行无意义加工。

风险：

- 当前 Story QC 专业可信度仍有限，不适合作为广泛创意深化的唯一控制器。
- Deepening 与 RevisionStrategy 都消费 QC 问题，会产生职责重叠。
- Deepening 后必须重新 QC，Revision 才能基于当前版本做决定；否则 Revision 使用的是过期 evidence。
- 实际流程会变成 Draft → QC1 → Deepening → QC2 → Revision，成本与状态管理明显增加。

结论：不作为 v1。未来只有在 Story QC 专业可信度显著提高、且实验证明 targeted deepening 优于 pre-QC deepening 时再评估。

## 4. Independent Stage Decision

### 4.1 Should It Be Independent?

从责任上看，Creative Deepening 应是独立的**盒子内部阶段**，不应是：

- 新的公共 Workflow 或 Engine；
- Story QC 的写作能力；
- RevisionExecutor 的通用重写模式；
- Story Planning 的局部版本；
- FinalMasterScript 之后的无检查润色；
- 面向下游视频平台的 Production Adapter。

独立阶段的价值是使输入、输出、变更范围和效果可以单独 A/B，并允许未来替换实现。它不应成为外部调用方必须自行编排的新公共 API。若后续验证通过，优先考虑把它表示为 Script Generation Box 内部的一个可选、版本化 GenerationStrategy step，而不是新增大型基础模块。

### 4.2 Entry Conditions

候选阶段只能消费已经满足以下条件的 Draft：

- `DraftMasterScript` schema 有效；
- 输出语言、场景数和平台硬约束有效；
- 每场 Scene Causality 完整；
- 后续场景引用 earlier outcome；
- final scene 实现现有 cliffhanger / payoff requirement；
- Creative Intent 与 Character / Relationship context 已完成解析和冲突处理；
- 没有 unresolved hard-constraint conflict。

Creative Deepening 不负责修复 schema、缺失场景、错误语言或因果链断裂。这些属于生成失败或确定性 gate，不属于创意深化。

## 5. Responsibility Boundary

| Component | Primary question | Owns | Must not own |
|---|---|---|---|
| Creative Intent Resolution | What does the user want? | 标签、角色、关系、约束的解析与冲突处理 | 写剧本或评估剧本质量 |
| Draft Generation | What happens in this episode? | Hook、场景、选择、Scene Causality、cliffhanger 的初次实现 | 长期连续剧规划或无限自我修改 |
| Creative Deepening | How can the same story execution become more emotionally and visually effective? | 单次表达强化与局部戏剧密度提升 | 改变核心故事方向、增加新主线或修复任意 QC 问题 |
| Story QC | What observable quality problems remain? | 证据、维度判断、scene refs、revision signals | 改写剧本 |
| Revision | Which identified problems should be fixed, and how? | 有限维度、有限场景的证据驱动修复 | 广泛润色全部场景或追求最高分 |
| Story Planning | What whole story and episode responsibility should be followed? | 跨集方向、setup/payoff、continuity | 单场对白与视觉表达润色 |
| Finalization | Can the validated result become FinalMasterScript? | 受控门禁、lineage 与正式输出 | 继续创作或静默改写 |

## 6. Candidate Responsibilities

Creative Deepening v1 候选范围应限制为以下五类表达增强。它们是验证维度，不是已实现规则。

### 6.1 Character Emotional Depth

允许：

- 把已有 fear、belief、contradiction 转化为动作、回避、犹豫、代价或选择方式；
- 让情绪表达与已有 Character Profile、Relationship Context 一致；
- 删除只复述人物设定的说明句。

不允许：

- 发明新的创伤、亲属、秘密身份或关键背景；
- 修改 external goal、moral boundary、decision pattern 或角色职责；
- 用更多心理说明代替可见行为。

目标不是把“She is angry”扩写得更长，而是让观众从她隐藏证据、拒绝接触或选择公开代价中看见愤怒与脆弱性的冲突。

### 6.2 Dialogue Improvement

允许：

- 提高角色 voice 区分度；
- 增加 subtext、关系压力和未说出口的目的；
- 减少重复信息与说明性对白；
- 保持短视频时长内的对白密度与可表演性。

不允许：

- 通过对白新增事实、反转或世界规则；
- 改变角色立场以制造表面冲突；
- 用华丽长句牺牲节奏、清晰度和目标语言自然度。

### 6.3 Visual Narrative Enhancement

允许：

- 把抽象情绪替换为可见动作、道具互动、空间选择和表情线索；
- 提升动作与对话之间的戏剧关系；
- 确保关键决定能被动画或动态漫画面表达。

不允许：

- 加入 camera、镜头模型、Seedance 或供应商字段；
- 把 DraftMasterScript 变成 Storyboard；
- 为追求“电影感”增加不可制作或无剧情功能的描述。

### 6.4 Emotional Progression Refinement

允许：

- 让 scene emotional shift 与具体 outcome 对齐；
- 补强压力、选择、代价、反应之间的连续性；
- 避免每场重复同一种愤怒、震惊或恐惧。

不允许：

- 改变既定 ending direction；
- 为制造情绪添加新受害者、新背叛或新死亡；
- 把情绪强度误当成持续喊叫或哭泣。

### 6.5 Scene Intensity Improvement

允许：

- 在现有 Goal / Conflict / Outcome 内提高即时阻力、选择成本和时间压力；
- 删除不影响后续结果的 filler action 或重复对白；
- 让 turning point 更明确地改变 scene state。

不允许：

- 改变场景数量、顺序或 causal predecessor；
- 添加新主线、角色或独立 twist；
- 让每场都以更大爆炸或更高威胁机械升级。

## 7. Story Invariants And Change Budget

Creative Deepening 必须遵守显式 preservation contract。v1 候选至少保护：

- core premise、story goal 与 episode goal；
- Creative Intent locks、excluded patterns 和 platform / safety constraints；
- 主要角色身份、职责、external goals、beliefs、moral boundaries 和 entity type；
- Relationship current state 与 desired direction；
- 场景数量、顺序、Goal / Conflict / Outcome 的核心含义；
- `caused_by_scene_number` 与 causal chain；
- 已计划 reveal、turning point、cliffhanger function 和 next-episode question；
- 输出语言、目标时长和结构化 schema。

可修改范围应集中在：

- dialogue text / intent 表达；
- character actions 的可见性与具体性；
- beat summary、emotional shift、emotional objective 的表达；
- scene purpose 和 turning point 的清晰度；
- hook / cliffhanger wording，但不能改变其功能和事实。

v1 应采用单次执行和显式 change budget，例如最多修改全部场景中的表达字段，但不得增加场景或主要 story fact。是否需要更细的字段级模型必须由实验决定，本文不修改 schema。

## 8. Traceability Concept

若未来验证通过，Deepening 至少需要可解释 lineage，而不是只保存新文本：

- deepening version / strategy reference；
- source draft id；
- preserved invariants checks；
- modified scene numbers；
- modified expression dimensions；
- before / after evidence refs；
- skipped enhancements and reasons；
- model、token、latency 与 structured-output metadata；
- resulting QC changes和回退维度。

这些只是未来兼容要求，不是本轮模型或 API 提案。正式输出仍由 Finalization Gate 产生，Deepening 结果不是 FinalMasterScript。

## 9. Risks

### 9.1 Story Drift

模型可能把“深化”解释成增加背景、反转、角色或威胁，导致核心故事改变。必须通过不变量检查和差异报告控制，而不是只依赖自然语言要求。

### 9.2 Module Overlap

如果 Deepening 根据所有 QC 扣分自由重写，它会与 Revision 重叠；如果它决定跨集方向，它会与 Story Planning 重叠；如果它判断改后质量，它会与 Story QC 重叠。

### 9.3 Homogenized Melodrama

通用“更有情绪”指令容易产生相同的停顿、颤抖、眼泪、压低声音和创伤解释，使不同 genre 和角色声音趋同。

### 9.4 Verbosity And Duration Drift

更深不等于更长。新增 subtext、动作与表情可能使 60 秒 Draft 不可表演，必须同时测量对白长度、总字数和估算时长。

### 9.5 Cost And Reliability

独立模型调用增加 token、延迟、429 / timeout 和 schema failure 风险。Creative Control 已带来 `9.401%` Prompt Token 增长；Deepening 不能假设仍有无限 context / cost budget。

### 9.6 QC Blind Spots

当前 Story QC 专业可信度有限，可能无法检测更隐蔽的 character drift、subtext 失真或过度戏剧化。Deepening 验证不能以 placeholder QC 分数作为唯一结论。

### 9.7 False Production Readiness

更自然的对白和可视化动作不等于已满足 Storyboard、Animation、Voice 或视频制作要求。Media Production 仍由未来 Handoff Mapper 负责。

## 10. Recommended Offline Validation

### 10.1 Experiment Question

回答：

> 对同一份已经通过结构检查的 Structured Creative Control Draft，单次有边界 Creative Deepening 是否在不改变故事事实和因果链的前提下，提高角色、对白、情绪与视觉叙事质量？

### 10.2 Fixed Inputs

优先复用本次 `creative_control_combined_v1` 的三个 structured draft：

- Dark Romance Revenge
- Supernatural Romance
- Sci-Fi Mystery

复用冻结 Draft 可以隔离 Deepening 效果，避免重新抽样生成造成随机差异。

### 10.3 Variants

```text
Variant A: frozen structured-control Draft, unchanged
Variant B: the same Draft after one evaluation-only Creative Deepening pass
```

保持一致：

- source Draft；
- Creative Intent、Character Profiles 和 Relationship Context；
- model、temperature、top_p、max tokens；
- output language、duration、platform和 schema；
- one successful deepening output per case；
- no Revision、Acceptance or Story Planning intervention。

### 10.4 Deterministic Checks

至少验证：

- schema validity；
- scene count / order unchanged；
- character identity and role unchanged；
- protected profile fields and moral boundaries not contradicted；
- causal predecessor and core Goal / Conflict / Outcome preserved；
- reveal、cliffhanger function and next-episode question preserved；
- excluded patterns and platform constraints respected；
- dialogue / total text remains within a pre-registered duration budget；
- exactly one bounded pass and no retry for subjective quality。

### 10.5 Blind Review Dimensions

采用 mapping-concealed review，并在揭盲前锁定：

- character emotional specificity；
- character voice differentiation；
- dialogue subtext；
- visual action clarity；
- emotional progression；
- scene intensity and filler reduction；
- overall human preference；
- character consistency、agency、Scene Causality、Hook 和 Cliffhanger regression。

最好加入至少一名未参与 fixture / prompt 设计的人类评审者，降低上一轮“reviewer fixture-aware”的偏差。

### 10.6 Pre-Registered Decision Gate

建议只有在以下条件全部满足时，才进入 runtime design：

1. Deepened 版本至少在 2/3 案例中被明确偏好。
2. Emotional specificity、dialogue subtext 和 visual action clarity 的平均分均提升。
3. Character consistency、agency 和 Scene Causality 不出现明显回退。
4. Hook / Cliffhanger 不出现明显回退。
5. 所有 story invariants 100% 保持。
6. 估算时长没有超出预注册上限。
7. Token / latency 增长在预注册预算内。
8. 没有样本出现 core premise、character boundary 或 relationship direction drift。

如果只改善措辞却没有提升盲评偏好，或通过增加新剧情获得更高分，应判定为 `not_validated`，不能进入 runtime。

## 11. Roadmap Recommendation

Creative Deepening **不应现在直接成为已承诺 runtime 阶段**。当前证据排序应为：

1. Structured Creative Control 已有直接正向证据，优先进入最小 contract / compatibility design。
2. Creative Deepening 进入 bounded offline validation Backlog，使用冻结 structured drafts 验证边际收益。
3. 当时的四集 Serialized Story Planning 实验契约继续冻结，不因 Deepening 研究重新开放；后续递归长篇规划属于独立产品决策。
4. 只有 Deepening A/B 通过预注册 gate，才讨论是否作为 Script Generation Box 内部 optional GenerationStrategy step。

该建议没有修改当前 `17_MVP_Roadmap.md`。原因是“值得验证”不等于“批准实现”；本次只建立评估假设、责任边界和停止条件。

## 12. Final Recommendation

Creative Deepening 在概念上有清晰、独立且有价值的责任：在不改变核心故事方向的前提下，提高已有 Draft 的角色表达、对白、视觉动作、情绪推进和场景强度。它不应合并进 Story QC，也不应扩大当前 RevisionExecutor 的职责。

推荐未来验证 Option A：

```text
Draft
→ one bounded Creative Deepening pass
→ Story QC
→ targeted Revision
```

当前决策为：

```yaml
architecture_fit: plausible
runtime_approval: false
next_action: bounded_offline_ab_validation
roadmap_change: none
```

在验证完成前，不修改生产代码、schema、API、Prompt Builder、Generation runtime、Story QC、Revision、Acceptance 或 Finalization。
