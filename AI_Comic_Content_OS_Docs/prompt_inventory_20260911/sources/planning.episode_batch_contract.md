# 整段分集路线图主合同

编号：`planning.episode_batch_contract`。状态：`active_main`。

来源：[backend/app/modules/script_engine/story_planning_service.py:11290](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:11290)。符号：`StoryPlanningService._build_episode_plan_prompt`。

当前前端 chunk 路径先构建整段合同，再附当次集数范围指令。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 11324 行

````text
{market_contract}

You are creating Episode Plans {start_episode}-{end_episode} for an approved episode-ready segment of a serialized comic.
Return planning JSON only. Do not write full episode prose or dialogue.
All human-readable output values must follow the market contract above.
{EPISODE_ROADMAP_LENGTH_TARGET_CONTRACT}
{STORY_LINE_EPISODE_DUTY_CONTRACT}

Segment: {node.title}
Segment synopsis: {node.synopsis}
Segment entry state: {node.entry_state}
Segment conflict: {node.central_conflict}
Segment exit state: {node.exit_state}
Segment script-body scale reference: {node.estimated_script_body_characters or '由剧情容量决定'}
Approved segment turning points (copy each verbatim into exactly one episode's source_turning_points):
{chr(10).join((f'- {turning_point}' for turning_point in node.turning_points))}
Approved unit-story beats (copy each verbatim into exactly one episode's source_unit_story_beats):
{chr(10).join((f'- {beat}' for beat in node.unit_story_beats))}
Required local resolution: {node.unit_resolution or node.exit_state}
Required handoff pressure: {node.handoff_pressure or node.exit_state}
Story Bible premise: {story_bible.core_premise}
Character refs: {'、'.join(story_bible.character_refs)}
Story line refs: {'、'.join((line.story_line_id for line in story_bible.story_lines))}
Short-drama escalation ladder:
{chr(10).join((f'- {item.stage_id}《{item.title}》：阶段目标={item.stage_goal}；阶段对手/门槛={item.stage_opposition}；阶段回报={item.stage_payoff}；升级={item.escalation_to_next}' for item in getattr(story_bible, 'escalation_stages', []))) or '- 未指定'}

{decision_contract}

Immediately preceding leaf checkpoint: {predecessor_context}
Durable planning memory: {memory_context}

{knowledge_context}

Requirements:
1. Return exactly one plan for every episode number from {start_episode} through {end_episode}, in order.
2. Each plan must have episode_title, synopsis, locations, episode_goal, entry_state, central_conflict, protagonist_decision, emotional_movement, stage_opposition, episode_payoff, pressure_escalation and exit_state. Optional dramatic design follows the contract below. Set ending_mode to serial_hook for a continuing episode; a final episode may use season_finale or series_finale only when the approved story direction calls for it. A serial_hook episode must provide a continuable cliffhanger; a finale must describe its formal resolution instead of manufacturing a hook.
{EPISODE_TITLE_NAMING_CONTRACT}
{EPISODE_HUMAN_READABLE_FIELDS_CONTRACT}
{EPISODE_DRAMATIC_DESIGN_CONTRACT}
3. The next episode entry_state must follow the previous episode exit_state; do not repeat the same beat.
4. Use only supplied character and story-line references. Preserve the segment's setup/payoff direction.
5. These plans are human-reviewable contracts. Keep them concise and actionable for the existing DraftMasterScript generator.
6. Distribute every approved segment turning point verbatim into exactly one episode's source_turning_points. Do not omit, paraphrase, merge or assign one turning point to multiple episodes. The receiving episode must execute that event in its goal, conflict, decision, reveal, exit state or cliffhanger.
7. Each episode must make a distinct causal contribution. Adjacent episodes must not repeat the same reveal, obstacle or cliffhanger function using different wording.
8. Assign story_line_refs only from the approved Story line refs and only when the episode materially advances that line. Every episode must advance at least one approved line.
9. For each serial_hook episode define ending_hook_type as a short 2-20 character Simplified-Chinese classification label with no explanation, plus a concrete next_episode_obligation and a realistic hook_payoff_target_episode when the hook is intended to stay open beyond the next episode. For a season_finale or series_finale, use these fields to record the formal resolution and any explicitly approved future obligation; do not manufacture a hook. Rotate hook functions according to the story; do not create unrelated surprise calls, arrivals, doors, or identity reveals solely for suspense.
10. continuity_requirements must name facts, character states, relationship states, prior hooks, or setup/payoff obligations that the script must preserve or advance. They are not generic writing advice.
11. Short drama cannot delay all satisfaction until the final opponent. Every episode must create at least one irreversible or difficult-to-reverse observable change, grounded in an event the audience can see or hear. Choose the form that fits this episode's people and circumstances: a concentrated confrontation, successive tests, pursuit or rescue, relationship misread and correction, information exchange, consequence payment, parallel action, delayed return or another story-native mechanism. A local payoff should come from this episode's action rather than a future promise, but do not force every episode into the same pressure-action-payoff order or add multiple cycles merely to imitate pace.
12. Adjacent episodes must differ in their dramatic mechanism, not only in wording. Vary tactics, costs, power, information, relationship pressure and the kind of state change when the approved story supports it. Do not write several consecutive episodes that only investigate, prepare, travel, explain or wait for the same final confrontation.
13. Distribute every approved unit-story beat verbatim into exactly one episode's source_unit_story_beats. The episode goal, action, decision and state change must execute that beat. Do not add a new core event chain to compensate for an incomplete segment plan.
13a. Do not turn an unresolved or suggest-only author decision into an episode fact. If the approved segment still
contains a story-specific 待定 slot, preserve it as a visible planning blocker rather than filling it with a familiar trope.
14. The batch must complete the segment's Required local resolution by the final episode, then preserve the Required handoff pressure as the concrete next-segment obligation. Do not postpone this segment's climax or local settlement to a later planning module.
15. Plan production load independently for every episode. target_duration_seconds must be {EPISODE_RUNTIME_MIN_SECONDS}-{EPISODE_RUNTIME_MAX_SECONDS}, planned_scene_count must be {EPISODE_SCENE_MIN}-{EPISODE_SCENE_MAX}, planned_dialogue_line_count must be {EPISODE_DIALOGUE_LINE_MIN}-{EPISODE_DIALOGUE_LINE_MAX}, and planned_shot_count must be {EPISODE_SHOT_UNIT_MIN}-{EPISODE_SHOT_UNIT_MAX}. One scene is valid when it can complete the episode; never split scenes or actions merely to reach a count. Choose the load from that episode's actual conflict, action, reveal, payoff and hook work. Do not evenly distribute the segment and do not copy one duration, scene count, dialogue count or shot count across all episodes merely for consistency. More time, dialogue or shots must correspond to visible dramatic work, never padding. Keep deliberate editing headroom inside the runtime range.
16. Return a complete scene_execution_plan for this episode. Do not return layer_contracts; the service compiles that audit object locally. The scene_execution_plan is the execution contract that a fast screenplay model will receive, so do not leave it empty and do not make the screenplay model infer missing scene decisions.
17. Every scene_execution_plan item must include scene_number, scene_heading, character_refs, scene_objective, opposition, information_shift, choice_or_cost, evidence_requirements, forbidden_changes, visible_action, turn_or_reveal, dialogue_objective, dialogue_line_target, shot_target and exit_state. opposition, information_shift and choice_or_cost must describe concrete story events, not writing advice. evidence_requirements must name what the audience can see or hear; forbidden_changes must list facts the screenplay must not add, reveal early, cancel or reverse.
18. Treat 250-650 Chinese characters per episode as the target for the combined human-readable roadmap fields,
not as a schema maximum. If any item exceeds the target, compress repeated segment or Story Bible context before
returning; do not add prose, scene detail or filler to reach a minimum.

The top-level object must contain only episode_plans. Every item must use these exact fields:
episode_number, ending_mode, episode_title, target_duration_seconds, planned_scene_count, planned_shot_count, planned_dialogue_line_count, scene_execution_plan,
synopsis, locations, episode_goal, entry_state, central_conflict, protagonist_decision, reveal,
emotional_movement, stage_opposition, episode_payoff, pressure_escalation, setup_refs,
dramatic_units, protagonist_cost, payoff_refs, exit_state, cliffhanger, character_refs, story_line_refs,
continuity_requirements, source_turning_points, source_unit_story_beats, ending_hook_type,
next_episode_obligation, hook_payoff_target_episode.
Use whole integers for episode_number, target_duration_seconds, planned_scene_count,
planned_shot_count, planned_dialogue_line_count and hook_payoff_target_episode. Use arrays of strings
for all fields ending in _refs, plus continuity_requirements, source_turning_points and
source_unit_story_beats.

Return only JSON matching the provided schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_episode_plan_prompt(
        *,
        node: StoryPlanNode,
        story_bible: StoryBible,
        start_episode: int,
        end_episode: int,
        knowledge_context: str,
        predecessor_plan: EpisodePlanGenerationItem | None = None,
        planning_memory: EpisodePlanningContinuityMemory | None = None,
    ) -> str:
        market_contract = StoryPlanningService._story_bible_market_contract_text(story_bible)
        decision_contract = _creative_decision_prompt_contract(
            list(getattr(story_bible, "creative_decisions", []) or [])
        )
        predecessor_context = (
            json.dumps(
                {
                    "episode_number": predecessor_plan.episode_number,
                    "exit_state": predecessor_plan.exit_state,
                    "next_episode_obligation": predecessor_plan.next_episode_obligation,
                    "pressure_escalation": predecessor_plan.pressure_escalation,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
            if predecessor_plan is not None
            else "null"
        )
        memory_context = (
            planning_memory.model_dump_json(exclude_none=True)
            if planning_memory is not None
            else "null"
        )
        return f"""{market_contract}

You are creating Episode Plans {start_episode}-{end_episode} for an approved episode-ready segment of a serialized comic.
Return planning JSON only. Do not write full episode prose or dialogue.
All human-readable output values must follow the market contract above.
{EPISODE_ROADMAP_LENGTH_TARGET_CONTRACT}
{STORY_LINE_EPISODE_DUTY_CONTRACT}

Segment: {node.title}
Segment synopsis: {node.synopsis}
Segment entry state: {node.entry_state}
Segment conflict: {node.central_conflict}
Segment exit state: {node.exit_state}
Segment script-body scale reference: {node.estimated_script_body_characters or '由剧情容量决定'}
Approved segment turning points (copy each verbatim into exactly one episode's source_turning_points):
{chr(10).join(f'- {turning_point}' for turning_point in node.turning_points)}
Approved unit-story beats (copy each verbatim into exactly one episode's source_unit_story_beats):
{chr(10).join(f'- {beat}' for beat in node.unit_story_beats)}
Required local resolution: {node.unit_resolution or node.exit_state}
Required handoff pressure: {node.handoff_pressure or node.exit_state}
Story Bible premise: {story_bible.core_premise}
Character refs: {'、'.join(story_bible.character_refs)}
Story line refs: {'、'.join(line.story_line_id for line in story_bible.story_lines)}
Short-drama escalation ladder:
{chr(10).join(f'- {item.stage_id}《{item.title}》：阶段目标={item.stage_goal}；阶段对手/门槛={item.stage_opposition}；阶段回报={item.stage_payoff}；升级={item.escalation_to_next}' for item in getattr(story_bible, 'escalation_stages', [])) or '- 未指定'}

{decision_contract}

Immediately preceding leaf checkpoint: {predecessor_context}
Durable planning memory: {memory_context}

{knowledge_context}

Requirements:
1. Return exactly one plan for every episode number from {start_episode} through {end_episode}, in order.
2. Each plan must have episode_title, synopsis, locations, episode_goal, entry_state, central_conflict, protagonist_decision, emotional_movement, stage_opposition, episode_payoff, pressure_escalation and exit_state. Optional dramatic design follows the contract below. Set ending_mode to serial_hook for a continuing episode; a final episode may use season_finale or series_finale only when the approved story direction calls for it. A serial_hook episode must provide a continuable cliffhanger; a finale must describe its formal resolution instead of manufacturing a hook.
{EPISODE_TITLE_NAMING_CONTRACT}
{EPISODE_HUMAN_READABLE_FIELDS_CONTRACT}
{EPISODE_DRAMATIC_DESIGN_CONTRACT}
3. The next episode entry_state must follow the previous episode exit_state; do not repeat the same beat.
4. Use only supplied character and story-line references. Preserve the segment's setup/payoff direction.
5. These plans are human-reviewable contracts. Keep them concise and actionable for the existing DraftMasterScript generator.
6. Distribute every approved segment turning point verbatim into exactly one episode's source_turning_points. Do not omit, paraphrase, merge or assign one turning point to multiple episodes. The receiving episode must execute that event in its goal, conflict, decision, reveal, exit state or cliffhanger.
7. Each episode must make a distinct causal contribution. Adjacent episodes must not repeat the same reveal, obstacle or cliffhanger function using different wording.
8. Assign story_line_refs only from the approved Story line refs and only when the episode materially advances that line. Every episode must advance at least one approved line.
9. For each serial_hook episode define ending_hook_type as a short 2-20 character Simplified-Chinese classification label with no explanation, plus a concrete next_episode_obligation and a realistic hook_payoff_target_episode when the hook is intended to stay open beyond the next episode. For a season_finale or series_finale, use these fields to record the formal resolution and any explicitly approved future obligation; do not manufacture a hook. Rotate hook functions according to the story; do not create unrelated surprise calls, arrivals, doors, or identity reveals solely for suspense.
10. continuity_requirements must name facts, character states, relationship states, prior hooks, or setup/payoff obligations that the script must preserve or advance. They are not generic writing advice.
11. Short drama cannot delay all satisfaction until the final opponent. Every episode must create at least one irreversible or difficult-to-reverse observable change, grounded in an event the audience can see or hear. Choose the form that fits this episode's people and circumstances: a concentrated confrontation, successive tests, pursuit or rescue, relationship misread and correction, information exchange, consequence payment, parallel action, delayed return or another story-native mechanism. A local payoff should come from this episode's action rather than a future promise, but do not force every episode into the same pressure-action-payoff order or add multiple cycles merely to imitate pace.
12. Adjacent episodes must differ in their dramatic mechanism, not only in wording. Vary tactics, costs, power, information, relationship pressure and the kind of state change when the approved story supports it. Do not write several consecutive episodes that only investigate, prepare, travel, explain or wait for the same final confrontation.
13. Distribute every approved unit-story beat verbatim into exactly one episode's source_unit_story_beats. The episode goal, action, decision and state change must execute that beat. Do not add a new core event chain to compensate for an incomplete segment plan.
13a. Do not turn an unresolved or suggest-only author decision into an episode fact. If the approved segment still
contains a story-specific 待定 slot, preserve it as a visible planning blocker rather than filling it with a familiar trope.
14. The batch must complete the segment's Required local resolution by the final episode, then preserve the Required handoff pressure as the concrete next-segment obligation. Do not postpone this segment's climax or local settlement to a later planning module.
15. Plan production load independently for every episode. target_duration_seconds must be {EPISODE_RUNTIME_MIN_SECONDS}-{EPISODE_RUNTIME_MAX_SECONDS}, planned_scene_count must be {EPISODE_SCENE_MIN}-{EPISODE_SCENE_MAX}, planned_dialogue_line_count must be {EPISODE_DIALOGUE_LINE_MIN}-{EPISODE_DIALOGUE_LINE_MAX}, and planned_shot_count must be {EPISODE_SHOT_UNIT_MIN}-{EPISODE_SHOT_UNIT_MAX}. One scene is valid when it can complete the episode; never split scenes or actions merely to reach a count. Choose the load from that episode's actual conflict, action, reveal, payoff and hook work. Do not evenly distribute the segment and do not copy one duration, scene count, dialogue count or shot count across all episodes merely for consistency. More time, dialogue or shots must correspond to visible dramatic work, never padding. Keep deliberate editing headroom inside the runtime range.
16. Return a complete scene_execution_plan for this episode. Do not return layer_contracts; the service compiles that audit object locally. The scene_execution_plan is the execution contract that a fast screenplay model will receive, so do not leave it empty and do not make the screenplay model infer missing scene decisions.
17. Every scene_execution_plan item must include scene_number, scene_heading, character_refs, scene_objective, opposition, information_shift, choice_or_cost, evidence_requirements, forbidden_changes, visible_action, turn_or_reveal, dialogue_objective, dialogue_line_target, shot_target and exit_state. opposition, information_shift and choice_or_cost must describe concrete story events, not writing advice. evidence_requirements must name what the audience can see or hear; forbidden_changes must list facts the screenplay must not add, reveal early, cancel or reverse.
18. Treat 250-650 Chinese characters per episode as the target for the combined human-readable roadmap fields,
not as a schema maximum. If any item exceeds the target, compress repeated segment or Story Bible context before
returning; do not add prose, scene detail or filler to reach a minimum.

The top-level object must contain only episode_plans. Every item must use these exact fields:
episode_number, ending_mode, episode_title, target_duration_seconds, planned_scene_count, planned_shot_count, planned_dialogue_line_count, scene_execution_plan,
synopsis, locations, episode_goal, entry_state, central_conflict, protagonist_decision, reveal,
emotional_movement, stage_opposition, episode_payoff, pressure_escalation, setup_refs,
dramatic_units, protagonist_cost, payoff_refs, exit_state, cliffhanger, character_refs, story_line_refs,
continuity_requirements, source_turning_points, source_unit_story_beats, ending_hook_type,
next_episode_obligation, hook_payoff_target_episode.
Use whole integers for episode_number, target_duration_seconds, planned_scene_count,
planned_shot_count, planned_dialogue_line_count and hook_payoff_target_episode. Use arrays of strings
for all fields ending in _refs, plus continuity_requirements, source_turning_points and
source_unit_story_beats.

Return only JSON matching the provided schema."""
````

片段 SHA-256：`d9f254de20fed2b6880ab8db8c9c07a752371a6d3018756899dd19a9317a056f`
