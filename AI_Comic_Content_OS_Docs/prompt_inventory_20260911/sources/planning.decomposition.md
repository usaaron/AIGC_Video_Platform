# 递归拆分主提示

编号：`planning.decomposition`。状态：`active_main`。

来源：[backend/app/modules/script_engine/story_planning_service.py:11006](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11006)。符号：`StoryPlanningService._build_decomposition_prompt`。

后续递归主路径；顶层技术根无作者指令/指定数量时走本地编译而不调用此提示。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 11036 行

````text
Return exactly {requested_child_count} children because the creator explicitly requested that count for this branch.
````

### 片段 2 · 源码第 11040 行

````text
Choose between 2 and {maximum_child_count} children according to genuine narrative boundaries. First identify the ordered dramatic movements, then let that movement count determine the number of children. The local signal analysis suggests {narrative_count_hypothesis} as a starting hypothesis, not a quota. Override it when multiple signals belong to one causal movement or when one movement contains several independent choices and payoffs. Do not default to 4 or any other fixed count such as 2 or 3, and do not imitate sibling branch counts or depths unless their narrative load is genuinely comparable.
````

### 片段 3 · 源码第 11054 行

````text
Derive the first real dramatic movements directly from the approved Story Bible. Do not restate the whole-story premise as a child.
````

### 片段 4 · 源码第 11058 行

````text
Copy every Parent turning point verbatim into exactly one child's turning_points. You may add child-level turning points, but must not omit, weaken, merge, or paraphrase an approved parent turning point.
````

### 片段 5 · 源码第 11131 行

````text
{item.character_ref}={item.name}（{item.role}）
````

### 片段 6 · 源码第 11136 行

````text
{item.character_ref}：外部目标={item.external_goal}；内在需要={item.internal_need or '未指定'}；起点={item.starting_state}；目标状态={item.target_state}；保护特质={'、'.join(item.protected_traits) or '未指定'}；关键转折={'、'.join(item.key_turning_points) or '未指定'}
````

### 片段 7 · 源码第 11146 行

````text
{item.relationship_id}：{item.source_character_ref}->{item.target_character_ref}；类型={item.relationship_type}；初始={item.initial_state}；目标={item.target_direction}；{'锁定' if item.locked else '可演化'}
````

### 片段 8 · 源码第 11155 行

````text
{line.story_line_id}《{line.title}》：{getattr(line, 'premise', '未指定')}；计划收束={getattr(line, 'planned_resolution', '未指定')}
````

### 片段 9 · 源码第 11163 行

````text
{item.stage_id}《{item.title}》：目标={item.stage_goal}；阶段对手/门槛={item.stage_opposition}；阶段回报={item.stage_payoff}；升级={item.escalation_to_next}
````

### 片段 10 · 源码第 11169 行

````text
未提供；只组织已确认内容，未决定的高影响剧情保留为结构槽位。
````

### 片段 11 · 源码第 11174 行

````text
{market_contract}

You are decomposing one approved long-story planning node into content-driven contiguous child nodes for a serialized comic.
Return planning JSON only. Do not write episode prose or dialogue.
All human-readable output values must follow the market contract above.
{STORY_TREE_LENGTH_TARGET_CONTRACT}
{STORY_LINE_PLANNING_CONTRACT}

Parent node: {parent.node_id} v{parent.version}
Parent range: episodes {parent.planned_start_episode}-{parent.planned_end_episode}
Parent purpose: {parent.narrative_purpose}
Parent synopsis: {parent.synopsis}
Parent conflict: {parent.central_conflict}
Parent turning points that must be preserved verbatim: {json.dumps(preserved_turning_points, ensure_ascii=False)}
Parent exit state: {parent.exit_state}
Local narrative signal counts for deciding child boundaries (evidence, not quotas):
{json.dumps(narrative_signal_counts, ensure_ascii=False, separators=(',', ':'))}
Planning lineage and adjacent continuity boundaries (binding):
{json.dumps(continuity_context or {}, ensure_ascii=False, separators=(',', ':'))}
Approved Story Bible premise: {story_bible.core_premise}
Approved series goal: {getattr(story_bible, 'series_goal', '未指定')}
Approved theme: {getattr(story_bible, 'theme', '未指定')}
Approved central conflict: {getattr(story_bible, 'central_conflict', '未指定')}
Approved Story Bible ending direction: {story_bible.ending_direction}
World rules: {'；'.join(getattr(story_bible, 'world_rules', [])) or '未指定'}
Allowed character_refs: {'、'.join(allowed_character_refs) or '未指定'}
Canonical character registry: {character_registry}
Whole-story character arcs: {character_arcs}
Whole-story relationship directions: {relationships}
Allowed story_line_refs: {'、'.join((line.story_line_id for line in relevant_story_lines)) or '未指定'}
Story lines with planned resolutions: {story_lines}
Approved short-drama escalation ladder: {escalation_ladder}
Major setup/payoff refs: {'；'.join(relevant_setup_payoff_refs) or '未指定'}
Locked facts: {'；'.join(getattr(story_bible, 'locked_facts', [])) or '未指定'}
Avoid patterns: {'；'.join(getattr(story_bible, 'avoid_patterns', [])) or '未指定'}
Hard planning leaf policy: every episode_ready child must cover {MIN_EPISODE_READY_SPAN}-{max_episode_ready_span} episodes. Every expandable child must cover at least 16 episodes. Never return a child covering 1-7 or 13-15 episodes.

{decision_contract}

{knowledge_context}

Author control for this decomposition turn:
{author_instruction_text}
Treat explicit author content as a high-priority creative instruction. Use it to organize branch emphasis,
event order, relationship focus, or pacing when compatible with approved facts and structural contracts.
Do not interpret missing detail as permission to choose new identities, secrets, betrayals, deaths, relationship
outcomes, theme conclusions or endings. A structural slot may state its required function and remain 待定.

Requirements:
1. {child_count_contract} Their episode ranges must be contiguous, ordered, cover the parent range exactly, and never overlap.
1a. A child boundary is justified only by a real development change: a new actionable goal,
opposition regime, irreversible character choice, relationship-state change, reveal/payoff cluster,
or completed local conflict that causes the next movement. Several signals inside the same causal
movement belong in one child; unrelated movements must not be compressed merely to keep the count low.
2. Preserve exact causal handoffs: the first child entry_state must copy the parent entry_state verbatim; each later child entry_state must copy the previous sibling exit_state verbatim; the final child exit_state must copy the parent exit_state verbatim.
3. Episode count is a hard readiness gate: use episode_ready only for a {MIN_EPISODE_READY_SPAN}-{max_episode_ready_span} episode child and expand only for a child of at least 16 episodes. If an initial allocation would create a 1-7 or 13-15 episode fragment, coordinate it with adjacent siblings here: move the corresponding events, decisions, turning points, state transitions and body-budget weight together until every child is valid. Never repair this by changing episode numbers alone.
4. Copy character_refs only from the Allowed character_refs list, and story_line_refs only from the Allowed story_line_refs list. Do not invent, translate, or rename IDs. Do not invent a separate main premise.
5. Do not force equal depth across future branches. The returned recommendation is content-driven, not a fixed global hierarchy.
6. Do not divide episode ranges evenly by default. Allocate each child's span according to its conflict density, number of meaningful turning points, state-change complexity, character/relationship work, and setup/payoff load. Equal spans are acceptable only when the narrative load is genuinely comparable.
7. Child body-character estimates are relative scale weights, not quotas or final allocations. Express every weight as a whole positive integer of at least 300 (for example 300, 450, 700); the backend will rescale the sibling weights to the parent's final body-text budget. Allocate them by dramatic depth: enacted conflict, reversals, difficult choices, relationship changes, and payoff work justify more body text than connective or transitional material. Do not derive them from episode span alone and do not repeat the full parent estimate in every child.
8. {turning_point_contract}
9. If this decomposition contains episode 1, episode 1 cannot be pure arrival, exposition, setup, or daily routine. Preserve an immediate active disruption or exposure threat, a consequential protagonist response, and unresolved end pressure from the approved parent events.
10. A child is not a restatement of the parent. Keep narrative_purpose to one focused function and make synopsis describe only the new event chain, choice, consequence, and state change owned by that child.
11. Sibling titles, conflicts, turning points, and exit states must be materially distinct. Each child must make the next child necessary; parallel summaries with renamed stages are invalid.
12. Do not divide the parent into fixed equal quotas. Preserve natural dramatic boundaries wherever they comply with the hard {MIN_EPISODE_READY_SPAN}-{max_episode_ready_span} episode leaf window. If a coherent movement needs at least 16 episodes, keep it as an expandable intermediate child and let the next recursive pass find its internal dramatic boundaries. Different branches may therefore have different child counts and recursive depths.
13. Treat world rules, locked facts, canonical identities, protected character traits, relationship directions, planned story-line resolutions, and avoid patterns as binding constraints. A child may causally evolve an unlocked state, but must not silently contradict, rename, merge, or prematurely resolve it.
14. Preserve the approved short-drama escalation ladder in order. Each child must serve one or more concrete stage goals, opponents/barriers, and visible payoffs. Do not spend a long branch merely approaching the final opponent: resolve a reachable stage opponent or barrier, deliver a real reward, then let its consequence expose a stronger next pressure.
15. Every child must own a complete structural movement; unit_story_beats must contain 4-12 distinct approved
events or explicit functional slots covering trigger, goal/action, escalation, consequential choice or reversal,
payoff, and resulting state change. Make events concrete only when supported by confirmed author
content. For an unresolved story-specific fact, state the dramatic function and mark its content 待定 instead of
borrowing a familiar plot template. unit_resolution states what the child must settle; handoff_pressure states what follows.
16. Episode Plans downstream may distribute and stage approved events, but may not invent the missing core plot.
For an episode-ready child, every content decision required for its episodes must be confirmed before script generation;
structural slots are not permission for the roadmap or script model to fill them silently.
17. Do not repeat a previous sibling's resolved movement or preempt the next sibling's
entry requirement. Keep every child inside the ancestor and adjacent boundaries supplied
above; if a boundary must change, move the complete causal movement and state handoff,
never just an episode number.
18. Keep each child transport-compact: use 4-6 turning_points and 4-6 unit_story_beats,
write concise production-ready prose, and do not repeat the parent or Story Bible context
inside child fields. Completeness and causal specificity matter more than ornamental detail.
19. Treat the ranges above as target density for the combined narrative fields of each child,
not as schema maxima. If a child exceeds its target range, compress repetition before returning;
do not pad a short child with copied parent or Story Bible material.

Exact child object fields:
title, narrative_purpose, synopsis, entry_state, central_conflict, turning_points,
emotional_direction, exit_state, unit_story_beats, unit_resolution, handoff_pressure,
character_refs, story_line_refs, setup_refs, payoff_refs,
estimated_episode_count, estimated_script_body_characters, planned_start_episode,
planned_end_episode, decomposition_reason, recommended_next_step.
Use these exact names. Never emit id, conflict, episode_start, episode_end, or
body_character_estimate. The top-level object contains only children.

Return only JSON matching the provided schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @classmethod
    def _build_decomposition_prompt(
        cls,
        *,
        parent: StoryPlanNode,
        story_bible: StoryBible,
        requested_child_count: int | None,
        max_episode_ready_span: int,
        continuity_context: dict[str, object] | None = None,
        knowledge_context: str,
        author_instruction: str = "",
    ) -> str:
        is_technical_root = (
            getattr(parent, "decomposition_reason", None)
            == TECHNICAL_STORY_ROOT_MARKER
        )
        parent_span = cls._story_plan_node_episode_span(parent)
        maximum_child_count = min(
            12,
            parent_span // MIN_EPISODE_READY_SPAN,
        )
        narrative_signal_counts = _decomposition_narrative_signal_counts(
            parent,
            story_bible,
        )
        narrative_count_hypothesis = _narrative_decomposition_child_count(
            parent,
            story_bible,
        )
        child_count_contract = (
            f"Return exactly {requested_child_count} children because the creator "
            "explicitly requested that count for this branch."
            if requested_child_count is not None
            else (
                f"Choose between 2 and {maximum_child_count} children according to "
                "genuine narrative boundaries. First identify the ordered dramatic "
                "movements, then let that movement count determine the number of "
                "children. The local signal analysis suggests "
                f"{narrative_count_hypothesis} as a starting hypothesis, not a quota. "
                "Override it when multiple signals belong to one causal movement or "
                "when one movement contains several independent choices and payoffs. "
                "Do not default to 4 or any other fixed count such as 2 or 3, and do "
                "not imitate sibling branch counts or depths unless their narrative "
                "load is genuinely comparable."
            )
        )
        preserved_turning_points = [] if is_technical_root else parent.turning_points
        turning_point_contract = (
            "Derive the first real dramatic movements directly from the approved Story "
            "Bible. Do not restate the whole-story premise as a child."
            if is_technical_root
            else (
                "Copy every Parent turning point verbatim into exactly one child's "
                "turning_points. You may add child-level turning points, but must not "
                "omit, weaken, merge, or paraphrase an approved parent turning point."
            )
        )
        if is_technical_root:
            relevant_story_lines = list(story_bible.story_lines)
            relevant_character_refs = set(story_bible.character_refs)
            relevant_escalation_stages = list(
                getattr(story_bible, "escalation_stages", [])
            )
            relevant_setup_payoff_refs = list(story_bible.major_setup_payoff_refs)
        else:
            requested_story_line_refs = set(
                getattr(parent, "story_line_refs", [])
            )
            relevant_story_lines = [
                line
                for line in story_bible.story_lines
                if not requested_story_line_refs
                or line.story_line_id in requested_story_line_refs
            ]
            relevant_character_refs = set(getattr(parent, "character_refs", []))
            for line in relevant_story_lines:
                relevant_character_refs.update(getattr(line, "character_refs", []))
            if not relevant_character_refs:
                relevant_character_refs.update(story_bible.character_refs)
            parent_stage_context = " ".join(
                [
                    getattr(parent, "title", ""),
                    parent.narrative_purpose,
                    parent.synopsis,
                    parent.central_conflict,
                    *parent.turning_points,
                    *getattr(parent, "unit_story_beats", []),
                ]
            ).casefold()
            relevant_escalation_stages = [
                stage
                for stage in getattr(story_bible, "escalation_stages", [])
                if stage.stage_id.casefold() in parent_stage_context
                or stage.title.casefold() in parent_stage_context
            ] or list(getattr(story_bible, "escalation_stages", []))
            parent_setup_payoff_refs = set(
                getattr(parent, "setup_refs", [])
            ) | set(getattr(parent, "payoff_refs", []))
            relevant_setup_payoff_refs = [
                reference
                for reference in story_bible.major_setup_payoff_refs
                if reference in parent_setup_payoff_refs
            ]
        relevant_registry = [
            item
            for item in story_bible.character_registry
            if item.character_ref in relevant_character_refs
        ]
        relevant_character_arcs = [
            item
            for item in story_bible.character_arc_targets
            if item.character_ref in relevant_character_refs
        ]
        relevant_relationships = [
            item
            for item in story_bible.relationships
            if item.source_character_ref in relevant_character_refs
            and item.target_character_ref in relevant_character_refs
        ]
        allowed_character_refs = [
            character_ref
            for character_ref in story_bible.character_refs
            if character_ref in relevant_character_refs
        ]
        character_registry = "；".join(
            f"{item.character_ref}={item.name}（{item.role}）"
            for item in relevant_registry
        ) or "未指定"
        character_arcs = "；".join(
            (
                f"{item.character_ref}：外部目标={item.external_goal}；"
                f"内在需要={item.internal_need or '未指定'}；"
                f"起点={item.starting_state}；目标状态={item.target_state}；"
                f"保护特质={'、'.join(item.protected_traits) or '未指定'}；"
                f"关键转折={'、'.join(item.key_turning_points) or '未指定'}"
            )
            for item in relevant_character_arcs
        ) or "未指定"
        relationships = "；".join(
            (
                f"{item.relationship_id}：{item.source_character_ref}->"
                f"{item.target_character_ref}；类型={item.relationship_type}；"
                f"初始={item.initial_state}；目标={item.target_direction}；"
                f"{'锁定' if item.locked else '可演化'}"
            )
            for item in relevant_relationships
        ) or "未指定"
        story_lines = "；".join(
            (
                f"{line.story_line_id}《{line.title}》："
                f"{getattr(line, 'premise', '未指定')}；"
                f"计划收束={getattr(line, 'planned_resolution', '未指定')}"
            )
            for line in relevant_story_lines
        )
        escalation_ladder = "；".join(
            (
                f"{item.stage_id}《{item.title}》：目标={item.stage_goal}；"
                f"阶段对手/门槛={item.stage_opposition}；"
                f"阶段回报={item.stage_payoff}；升级={item.escalation_to_next}"
            )
            for item in relevant_escalation_stages
        ) or "未指定"
        author_instruction_text = author_instruction.strip() or "未提供；只组织已确认内容，未决定的高影响剧情保留为结构槽位。"
        market_contract = cls._story_bible_market_contract_text(story_bible)
        decision_contract = _creative_decision_prompt_contract(
            list(getattr(story_bible, "creative_decisions", []) or [])
        )
        return f"""{market_contract}

You are decomposing one approved long-story planning node into content-driven contiguous child nodes for a serialized comic.
Return planning JSON only. Do not write episode prose or dialogue.
All human-readable output values must follow the market contract above.
{STORY_TREE_LENGTH_TARGET_CONTRACT}
{STORY_LINE_PLANNING_CONTRACT}

Parent node: {parent.node_id} v{parent.version}
Parent range: episodes {parent.planned_start_episode}-{parent.planned_end_episode}
Parent purpose: {parent.narrative_purpose}
Parent synopsis: {parent.synopsis}
Parent conflict: {parent.central_conflict}
Parent turning points that must be preserved verbatim: {json.dumps(preserved_turning_points, ensure_ascii=False)}
Parent exit state: {parent.exit_state}
Local narrative signal counts for deciding child boundaries (evidence, not quotas):
{json.dumps(narrative_signal_counts, ensure_ascii=False, separators=(',', ':'))}
Planning lineage and adjacent continuity boundaries (binding):
{json.dumps(continuity_context or {}, ensure_ascii=False, separators=(',', ':'))}
Approved Story Bible premise: {story_bible.core_premise}
Approved series goal: {getattr(story_bible, 'series_goal', '未指定')}
Approved theme: {getattr(story_bible, 'theme', '未指定')}
Approved central conflict: {getattr(story_bible, 'central_conflict', '未指定')}
Approved Story Bible ending direction: {story_bible.ending_direction}
World rules: {'；'.join(getattr(story_bible, 'world_rules', [])) or '未指定'}
Allowed character_refs: {'、'.join(allowed_character_refs) or '未指定'}
Canonical character registry: {character_registry}
Whole-story character arcs: {character_arcs}
Whole-story relationship directions: {relationships}
Allowed story_line_refs: {'、'.join(line.story_line_id for line in relevant_story_lines) or '未指定'}
Story lines with planned resolutions: {story_lines}
Approved short-drama escalation ladder: {escalation_ladder}
Major setup/payoff refs: {'；'.join(relevant_setup_payoff_refs) or '未指定'}
Locked facts: {'；'.join(getattr(story_bible, 'locked_facts', [])) or '未指定'}
Avoid patterns: {'；'.join(getattr(story_bible, 'avoid_patterns', [])) or '未指定'}
Hard planning leaf policy: every episode_ready child must cover {MIN_EPISODE_READY_SPAN}-{max_episode_ready_span} episodes. Every expandable child must cover at least 16 episodes. Never return a child covering 1-7 or 13-15 episodes.

{decision_contract}

{knowledge_context}

Author control for this decomposition turn:
{author_instruction_text}
Treat explicit author content as a high-priority creative instruction. Use it to organize branch emphasis,
event order, relationship focus, or pacing when compatible with approved facts and structural contracts.
Do not interpret missing detail as permission to choose new identities, secrets, betrayals, deaths, relationship
outcomes, theme conclusions or endings. A structural slot may state its required function and remain 待定.

Requirements:
1. {child_count_contract} Their episode ranges must be contiguous, ordered, cover the parent range exactly, and never overlap.
1a. A child boundary is justified only by a real development change: a new actionable goal,
opposition regime, irreversible character choice, relationship-state change, reveal/payoff cluster,
or completed local conflict that causes the next movement. Several signals inside the same causal
movement belong in one child; unrelated movements must not be compressed merely to keep the count low.
2. Preserve exact causal handoffs: the first child entry_state must copy the parent entry_state verbatim; each later child entry_state must copy the previous sibling exit_state verbatim; the final child exit_state must copy the parent exit_state verbatim.
3. Episode count is a hard readiness gate: use episode_ready only for a {MIN_EPISODE_READY_SPAN}-{max_episode_ready_span} episode child and expand only for a child of at least 16 episodes. If an initial allocation would create a 1-7 or 13-15 episode fragment, coordinate it with adjacent siblings here: move the corresponding events, decisions, turning points, state transitions and body-budget weight together until every child is valid. Never repair this by changing episode numbers alone.
4. Copy character_refs only from the Allowed character_refs list, and story_line_refs only from the Allowed story_line_refs list. Do not invent, translate, or rename IDs. Do not invent a separate main premise.
5. Do not force equal depth across future branches. The returned recommendation is content-driven, not a fixed global hierarchy.
6. Do not divide episode ranges evenly by default. Allocate each child's span according to its conflict density, number of meaningful turning points, state-change complexity, character/relationship work, and setup/payoff load. Equal spans are acceptable only when the narrative load is genuinely comparable.
7. Child body-character estimates are relative scale weights, not quotas or final allocations. Express every weight as a whole positive integer of at least 300 (for example 300, 450, 700); the backend will rescale the sibling weights to the parent's final body-text budget. Allocate them by dramatic depth: enacted conflict, reversals, difficult choices, relationship changes, and payoff work justify more body text than connective or transitional material. Do not derive them from episode span alone and do not repeat the full parent estimate in every child.
8. {turning_point_contract}
9. If this decomposition contains episode 1, episode 1 cannot be pure arrival, exposition, setup, or daily routine. Preserve an immediate active disruption or exposure threat, a consequential protagonist response, and unresolved end pressure from the approved parent events.
10. A child is not a restatement of the parent. Keep narrative_purpose to one focused function and make synopsis describe only the new event chain, choice, consequence, and state change owned by that child.
11. Sibling titles, conflicts, turning points, and exit states must be materially distinct. Each child must make the next child necessary; parallel summaries with renamed stages are invalid.
12. Do not divide the parent into fixed equal quotas. Preserve natural dramatic boundaries wherever they comply with the hard {MIN_EPISODE_READY_SPAN}-{max_episode_ready_span} episode leaf window. If a coherent movement needs at least 16 episodes, keep it as an expandable intermediate child and let the next recursive pass find its internal dramatic boundaries. Different branches may therefore have different child counts and recursive depths.
13. Treat world rules, locked facts, canonical identities, protected character traits, relationship directions, planned story-line resolutions, and avoid patterns as binding constraints. A child may causally evolve an unlocked state, but must not silently contradict, rename, merge, or prematurely resolve it.
14. Preserve the approved short-drama escalation ladder in order. Each child must serve one or more concrete stage goals, opponents/barriers, and visible payoffs. Do not spend a long branch merely approaching the final opponent: resolve a reachable stage opponent or barrier, deliver a real reward, then let its consequence expose a stronger next pressure.
15. Every child must own a complete structural movement; unit_story_beats must contain 4-12 distinct approved
events or explicit functional slots covering trigger, goal/action, escalation, consequential choice or reversal,
payoff, and resulting state change. Make events concrete only when supported by confirmed author
content. For an unresolved story-specific fact, state the dramatic function and mark its content 待定 instead of
borrowing a familiar plot template. unit_resolution states what the child must settle; handoff_pressure states what follows.
16. Episode Plans downstream may distribute and stage approved events, but may not invent the missing core plot.
For an episode-ready child, every content decision required for its episodes must be confirmed before script generation;
structural slots are not permission for the roadmap or script model to fill them silently.
17. Do not repeat a previous sibling's resolved movement or preempt the next sibling's
entry requirement. Keep every child inside the ancestor and adjacent boundaries supplied
above; if a boundary must change, move the complete causal movement and state handoff,
never just an episode number.
18. Keep each child transport-compact: use 4-6 turning_points and 4-6 unit_story_beats,
write concise production-ready prose, and do not repeat the parent or Story Bible context
inside child fields. Completeness and causal specificity matter more than ornamental detail.
19. Treat the ranges above as target density for the combined narrative fields of each child,
not as schema maxima. If a child exceeds its target range, compress repetition before returning;
do not pad a short child with copied parent or Story Bible material.

Exact child object fields:
title, narrative_purpose, synopsis, entry_state, central_conflict, turning_points,
emotional_direction, exit_state, unit_story_beats, unit_resolution, handoff_pressure,
character_refs, story_line_refs, setup_refs, payoff_refs,
estimated_episode_count, estimated_script_body_characters, planned_start_episode,
planned_end_episode, decomposition_reason, recommended_next_step.
Use these exact names. Never emit id, conflict, episode_start, episode_end, or
body_character_estimate. The top-level object contains only children.

Return only JSON matching the provided schema."""
````

片段 SHA-256：`012633a8da02cab5e11ae1315c4260ab4baeb627783d548446633a5cd67c3712`
