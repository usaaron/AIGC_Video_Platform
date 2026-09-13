# 单集路线图提示

编号：`planning.episode_item`。状态：`active_alternative_endpoint`。

来源：[backend/app/modules/script_engine/story_planning_service.py:11398](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11398)。符号：`StoryPlanningService._build_episode_plan_item_prompt`。

独立单集接口及服务内旧批量逐集路径使用；不是当前前端 chunk 主路径。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 11466 行

````text
This is the final episode of the leaf. Assign every remaining approved turning point and unit-story beat verbatim, complete the required local resolution, and carry the required handoff pressure into the ending.
````

### 片段 2 · 源码第 11470 行

````text
Assign only the remaining approved events whose causal position belongs in this episode. Leave later events available for later episodes.
````

### 片段 3 · 源码第 11477 行

````text
{market_contract}

SINGLE EPISODE ROADMAP CONTRACT
Create only Episode {episode_number} of the approved serialized comic story
leaf covering Episodes {node.planned_start_episode}-{node.planned_end_episode}.
Return one native JSON object representing this episode plan. Do not return an
episode_plans array, wrapper, prose scene, dialogue, Markdown, or explanation.
All human-readable values must follow the market contract above. Technical reference IDs
must be copied exactly.
{EPISODE_ROADMAP_LENGTH_TARGET_CONTRACT}
{STORY_LINE_EPISODE_DUTY_CONTRACT}
{EPISODE_HUMAN_READABLE_FIELDS_CONTRACT}
{EPISODE_DRAMATIC_DESIGN_CONTRACT}

Approved segment: {node.title}
Narrative purpose: {node.narrative_purpose}
Synopsis: {node.synopsis}
Entry state: {node.entry_state}
Central conflict: {node.central_conflict}
Segment script-body scale reference: {node.estimated_script_body_characters or '由剧情容量决定'}
Required local resolution: {node.unit_resolution or node.exit_state}
Required handoff pressure: {node.handoff_pressure or node.exit_state}
Allowed character_refs: {json.dumps(story_bible.character_refs, ensure_ascii=False)}
Allowed story_line_refs: {json.dumps([line.story_line_id for line in story_bible.story_lines], ensure_ascii=False)}
Allowed setup_refs: {json.dumps(node.setup_refs, ensure_ascii=False)}
Allowed payoff_refs: {json.dumps(node.payoff_refs, ensure_ascii=False)}

{decision_contract}

Immediately preceding accepted checkpoint:
{json.dumps(previous_checkpoint, ensure_ascii=False, separators=(',', ':'))}

Earlier accepted episode contributions; do not repeat their goal, payoff, exit state or
cliffhanger function. The latest entries include the immediate pressure handoff:
{json.dumps(prior_contributions, ensure_ascii=False, separators=(',', ':'))}

Durable continuity memory from the accepted roadmap prefix. Preserve active requirements,
unresolved setup obligations, open hooks and the latest state handoffs:
{json.dumps(continuity_memory, ensure_ascii=False, separators=(',', ':'))}

Remaining approved turning points; copy assigned values verbatim:
{json.dumps(remaining_turning_points, ensure_ascii=False, separators=(',', ':'))}

Remaining approved unit-story beats; copy assigned values verbatim:
{json.dumps(remaining_unit_beats, ensure_ascii=False, separators=(',', ':'))}

Required source_turning_points for this episode (copy exactly, no additions):
{json.dumps(required_turning_points, ensure_ascii=False, separators=(',', ':'))}

Required source_unit_story_beats for this episode (copy exactly, no additions):
{json.dumps(required_unit_beats, ensure_ascii=False, separators=(',', ':'))}

{knowledge_context}

Rules:
1. episode_number must be exactly {episode_number}.
1a. {EPISODE_TITLE_NAMING_CONTRACT}
1b. Provide a complete `synopsis` and concrete `locations` alongside the structural fields; the synopsis must describe the same causal events, not a generic summary.
2. entry_state must causally continue the preceding checkpoint. The episode must execute
   a distinct, story-native dramatic mechanism and end in a new observable state. The
   mechanism may be a pressure-action-payoff sequence, a relationship turn, a failed
   attempt with consequences, an information exchange, a pursuit/rescue, a delayed
   payoff or another approved form; do not force a fixed cycle when the episode's
   people and circumstances call for a different shape.
3. Use only the allowed reference IDs. story_line_refs must contain at least one allowed ID.
4. source_turning_points and source_unit_story_beats must exactly equal the two required
   lists assigned to this episode above. Never move, paraphrase, add, or repeat them.
5. episode_payoff must be a visible local result, not preparation or a future promise.
6. For serial_hook, cliffhanger and next_episode_obligation must arise from this episode's action and must
   not repeat an earlier hook function. For a finale, use the approved resolution rather than
   adding a false continuation. Before writing them, compare the earlier accepted
   episode_payoff, cliffhanger and ending_hook_type values above. Do not copy an earlier
   payoff or cliffhanger sentence; choose a distinct story-native action result and ending
   pressure without inventing an unrelated surprise. ending_hook_type must be only a short
   2-20 character Simplified-Chinese classification label, never a sentence or explanation.
7. Keep every still-active item in the durable continuity memory true. Do not silently drop
   an unresolved setup, open hook, character state, relationship state or story-line obligation.
7a. Do not turn an unresolved or suggest-only author decision into an episode fact. A story-specific
    待定 slot is a planning blocker, not permission to fill it with an unrelated or formulaic event.
8. {completion_rule}
9. Independently choose target_duration_seconds from {EPISODE_RUNTIME_MIN_SECONDS}-{EPISODE_RUNTIME_MAX_SECONDS}, planned_scene_count from
   {EPISODE_SCENE_MIN}-{EPISODE_SCENE_MAX}, planned_dialogue_line_count from {EPISODE_DIALOGUE_LINE_MIN}-{EPISODE_DIALOGUE_LINE_MAX}, and planned_shot_count from {EPISODE_SHOT_UNIT_MIN}-{EPISODE_SHOT_UNIT_MAX} according to this episode's dramatic load.
   Do not copy the preceding episode's production values by default and do not pad to
   imitate an even distribution.
10. Return a complete scene_execution_plan for this episode. This is the execution contract
   for a fast screenplay model; the screenplay model must not infer missing scene decisions.
   Every scene item must include scene_number, scene_heading, character_refs, scene_objective,
   opposition, information_shift, choice_or_cost, evidence_requirements, forbidden_changes,
   visible_action, turn_or_reveal, dialogue_objective, dialogue_line_target, shot_target and
   exit_state. Use concrete story events, not generic writing advice. Do not return layer_contracts;
   the service compiles that audit object locally.
11. Keep the combined human-readable roadmap fields within 250-650 Chinese characters. If the
    draft is longer, remove repeated upper-layer context and ornamental wording before returning;
    preserve the episode's distinct action, payoff, exit state and hook.

Return exactly these root fields:
episode_number, ending_mode, episode_title, target_duration_seconds, planned_scene_count, planned_shot_count, planned_dialogue_line_count, scene_execution_plan,
synopsis, locations, episode_goal, entry_state, central_conflict, protagonist_decision, reveal,
emotional_movement, stage_opposition, episode_payoff, pressure_escalation, setup_refs,
dramatic_units, protagonist_cost, payoff_refs, exit_state, cliffhanger, character_refs, story_line_refs,
continuity_requirements, source_turning_points, source_unit_story_beats, ending_hook_type,
next_episode_obligation, hook_payoff_target_episode.
        Return only the single JSON object.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_episode_plan_item_prompt(
        *,
        node: StoryPlanNode,
        story_bible: StoryBible,
        episode_number: int,
        accepted_plans: list[EpisodePlanGenerationItem],
        predecessor_plan: EpisodePlanGenerationItem | None,
        knowledge_context: str,
        planning_memory: EpisodePlanningContinuityMemory | None = None,
    ) -> str:
        assert node.planned_start_episode is not None
        assert node.planned_end_episode is not None
        previous = accepted_plans[-1] if accepted_plans else predecessor_plan
        used_turning_points = [
            value for item in accepted_plans for value in item.source_turning_points
        ]
        used_unit_beats = [
            value for item in accepted_plans for value in item.source_unit_story_beats
        ]
        remaining_turning_points = [
            value for value in node.turning_points if value not in used_turning_points
        ]
        remaining_unit_beats = [
            value for value in node.unit_story_beats if value not in used_unit_beats
        ]
        required_turning_points = StoryPlanningService._episode_item_event_assignment(
            node.turning_points,
            accepted_plans=accepted_plans,
            field_name="source_turning_points",
            start_episode=node.planned_start_episode,
            end_episode=node.planned_end_episode,
            episode_number=episode_number,
        )
        required_unit_beats = StoryPlanningService._episode_item_event_assignment(
            node.unit_story_beats,
            accepted_plans=accepted_plans,
            field_name="source_unit_story_beats",
            start_episode=node.planned_start_episode,
            end_episode=node.planned_end_episode,
            episode_number=episode_number,
        )
        prior_contributions = StoryPlanningService._compact_episode_plan_history(
            accepted_plans,
        )
        continuity_memory = StoryPlanningService._compact_episode_continuity_memory(
            accepted_plans,
            predecessor_plan=predecessor_plan,
            current_episode_number=episode_number,
            planning_memory=planning_memory,
        )
        previous_checkpoint = (
            {
                "episode_number": previous.episode_number,
                "exit_state": previous.exit_state,
                "pressure_escalation": previous.pressure_escalation,
                "next_episode_obligation": previous.next_episode_obligation,
            }
            if previous is not None
            else {
                "episode_number": None,
                "exit_state": node.entry_state,
                "pressure_escalation": node.central_conflict,
                "next_episode_obligation": "从批准剧情段的进入状态开始。",
            }
        )
        final_episode = episode_number == node.planned_end_episode
        completion_rule = (
            "This is the final episode of the leaf. Assign every remaining approved "
            "turning point and unit-story beat verbatim, complete the required local "
            "resolution, and carry the required handoff pressure into the ending."
            if final_episode
            else "Assign only the remaining approved events whose causal position belongs "
            "in this episode. Leave later events available for later episodes."
        )
        market_contract = StoryPlanningService._story_bible_market_contract_text(story_bible)
        decision_contract = _creative_decision_prompt_contract(
            list(getattr(story_bible, "creative_decisions", []) or [])
        )
        return f"""{market_contract}

SINGLE EPISODE ROADMAP CONTRACT
Create only Episode {episode_number} of the approved serialized comic story
leaf covering Episodes {node.planned_start_episode}-{node.planned_end_episode}.
Return one native JSON object representing this episode plan. Do not return an
episode_plans array, wrapper, prose scene, dialogue, Markdown, or explanation.
All human-readable values must follow the market contract above. Technical reference IDs
must be copied exactly.
{EPISODE_ROADMAP_LENGTH_TARGET_CONTRACT}
{STORY_LINE_EPISODE_DUTY_CONTRACT}
{EPISODE_HUMAN_READABLE_FIELDS_CONTRACT}
{EPISODE_DRAMATIC_DESIGN_CONTRACT}

Approved segment: {node.title}
Narrative purpose: {node.narrative_purpose}
Synopsis: {node.synopsis}
Entry state: {node.entry_state}
Central conflict: {node.central_conflict}
Segment script-body scale reference: {node.estimated_script_body_characters or '由剧情容量决定'}
Required local resolution: {node.unit_resolution or node.exit_state}
Required handoff pressure: {node.handoff_pressure or node.exit_state}
Allowed character_refs: {json.dumps(story_bible.character_refs, ensure_ascii=False)}
Allowed story_line_refs: {json.dumps([line.story_line_id for line in story_bible.story_lines], ensure_ascii=False)}
Allowed setup_refs: {json.dumps(node.setup_refs, ensure_ascii=False)}
Allowed payoff_refs: {json.dumps(node.payoff_refs, ensure_ascii=False)}

{decision_contract}

Immediately preceding accepted checkpoint:
{json.dumps(previous_checkpoint, ensure_ascii=False, separators=(',', ':'))}

Earlier accepted episode contributions; do not repeat their goal, payoff, exit state or
cliffhanger function. The latest entries include the immediate pressure handoff:
{json.dumps(prior_contributions, ensure_ascii=False, separators=(',', ':'))}

Durable continuity memory from the accepted roadmap prefix. Preserve active requirements,
unresolved setup obligations, open hooks and the latest state handoffs:
{json.dumps(continuity_memory, ensure_ascii=False, separators=(',', ':'))}

Remaining approved turning points; copy assigned values verbatim:
{json.dumps(remaining_turning_points, ensure_ascii=False, separators=(',', ':'))}

Remaining approved unit-story beats; copy assigned values verbatim:
{json.dumps(remaining_unit_beats, ensure_ascii=False, separators=(',', ':'))}

Required source_turning_points for this episode (copy exactly, no additions):
{json.dumps(required_turning_points, ensure_ascii=False, separators=(',', ':'))}

Required source_unit_story_beats for this episode (copy exactly, no additions):
{json.dumps(required_unit_beats, ensure_ascii=False, separators=(',', ':'))}

{knowledge_context}

Rules:
1. episode_number must be exactly {episode_number}.
1a. {EPISODE_TITLE_NAMING_CONTRACT}
1b. Provide a complete `synopsis` and concrete `locations` alongside the structural fields; the synopsis must describe the same causal events, not a generic summary.
2. entry_state must causally continue the preceding checkpoint. The episode must execute
   a distinct, story-native dramatic mechanism and end in a new observable state. The
   mechanism may be a pressure-action-payoff sequence, a relationship turn, a failed
   attempt with consequences, an information exchange, a pursuit/rescue, a delayed
   payoff or another approved form; do not force a fixed cycle when the episode's
   people and circumstances call for a different shape.
3. Use only the allowed reference IDs. story_line_refs must contain at least one allowed ID.
4. source_turning_points and source_unit_story_beats must exactly equal the two required
   lists assigned to this episode above. Never move, paraphrase, add, or repeat them.
5. episode_payoff must be a visible local result, not preparation or a future promise.
6. For serial_hook, cliffhanger and next_episode_obligation must arise from this episode's action and must
   not repeat an earlier hook function. For a finale, use the approved resolution rather than
   adding a false continuation. Before writing them, compare the earlier accepted
   episode_payoff, cliffhanger and ending_hook_type values above. Do not copy an earlier
   payoff or cliffhanger sentence; choose a distinct story-native action result and ending
   pressure without inventing an unrelated surprise. ending_hook_type must be only a short
   2-20 character Simplified-Chinese classification label, never a sentence or explanation.
7. Keep every still-active item in the durable continuity memory true. Do not silently drop
   an unresolved setup, open hook, character state, relationship state or story-line obligation.
7a. Do not turn an unresolved or suggest-only author decision into an episode fact. A story-specific
    待定 slot is a planning blocker, not permission to fill it with an unrelated or formulaic event.
8. {completion_rule}
9. Independently choose target_duration_seconds from {EPISODE_RUNTIME_MIN_SECONDS}-{EPISODE_RUNTIME_MAX_SECONDS}, planned_scene_count from
   {EPISODE_SCENE_MIN}-{EPISODE_SCENE_MAX}, planned_dialogue_line_count from {EPISODE_DIALOGUE_LINE_MIN}-{EPISODE_DIALOGUE_LINE_MAX}, and planned_shot_count from {EPISODE_SHOT_UNIT_MIN}-{EPISODE_SHOT_UNIT_MAX} according to this episode's dramatic load.
   Do not copy the preceding episode's production values by default and do not pad to
   imitate an even distribution.
10. Return a complete scene_execution_plan for this episode. This is the execution contract
   for a fast screenplay model; the screenplay model must not infer missing scene decisions.
   Every scene item must include scene_number, scene_heading, character_refs, scene_objective,
   opposition, information_shift, choice_or_cost, evidence_requirements, forbidden_changes,
   visible_action, turn_or_reveal, dialogue_objective, dialogue_line_target, shot_target and
   exit_state. Use concrete story events, not generic writing advice. Do not return layer_contracts;
   the service compiles that audit object locally.
11. Keep the combined human-readable roadmap fields within 250-650 Chinese characters. If the
    draft is longer, remove repeated upper-layer context and ornamental wording before returning;
    preserve the episode's distinct action, payoff, exit state and hook.

Return exactly these root fields:
episode_number, ending_mode, episode_title, target_duration_seconds, planned_scene_count, planned_shot_count, planned_dialogue_line_count, scene_execution_plan,
synopsis, locations, episode_goal, entry_state, central_conflict, protagonist_decision, reveal,
emotional_movement, stage_opposition, episode_payoff, pressure_escalation, setup_refs,
dramatic_units, protagonist_cost, payoff_refs, exit_state, cliffhanger, character_refs, story_line_refs,
continuity_requirements, source_turning_points, source_unit_story_beats, ending_hook_type,
next_episode_obligation, hook_payoff_target_episode.
        Return only the single JSON object."""
````

片段 SHA-256：`445f8dc286fca2671caa41d34bc9b6441e17ca085ae6d255fdaab5887b9f64a2`
