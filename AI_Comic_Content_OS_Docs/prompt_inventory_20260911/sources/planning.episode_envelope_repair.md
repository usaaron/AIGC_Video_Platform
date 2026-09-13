# 分集 episode_plans 容器与数量修复

编号：`planning.episode_envelope_repair`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:10549](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10549)。符号：`StoryPlanningService._build_episode_plan_envelope_repair_prompt`。

包含场景执行蓝图要求；保留原故事范围。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 10569 行

````text
The response was empty or invalid JSON.
````

### 片段 2 · 源码第 10573 行

````text
CRITICAL EPISODE ROADMAP SHAPE REPAIR
The previous response did not form a usable Episode roadmap. Return one JSON object
whose only top-level key is "episode_plans". episode_plans must be a native JSON array,
never an empty array and never an array of quoted JSON strings.

Return exactly {expected_count} complete episode plan objects for these episode numbers,
in this exact order: {json.dumps(expected_episode_numbers, ensure_ascii=False)}.

Each episode object must use exactly these fields:
episode_number, ending_mode, episode_title, synopsis, locations, episode_goal, entry_state, central_conflict, protagonist_decision,
reveal, emotional_movement, stage_opposition, episode_payoff, pressure_escalation, dramatic_units, protagonist_cost,
setup_refs, payoff_refs, exit_state, cliffhanger, character_refs, story_line_refs,
continuity_requirements, source_turning_points, source_unit_story_beats,
ending_hook_type, next_episode_obligation, hook_payoff_target_episode, scene_execution_plan.

scene_execution_plan must contain one complete item per planned scene with scene_number,
scene_heading, character_refs, scene_objective, opposition, information_shift, choice_or_cost,
evidence_requirements, forbidden_changes, visible_action, turn_or_reveal, dialogue_objective,
dialogue_line_target, shot_target and exit_state.

Set ending_mode to serial_hook for a continuing episode. A season_finale or series_finale
must use the approved formal resolution and must not fabricate a continuation cliffhanger.

Structured failure:
{failure}

Previous response, usable only when it contains recoverable episode content:
{json.dumps(source_response, ensure_ascii=False, separators=(',', ':'))}

Original Episode roadmap constraints:
{contract_prompt}

Final shape check: the response starts with {"episode_plans":[{, contains exactly
{expected_count} objects, covers every requested episode once, and closes the array and
outer object. Return only the corrected JSON object.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_episode_plan_envelope_repair_prompt(
        *,
        contract_prompt: str,
        source_response: object,
        validation_error: ValidationError | None,
        structured_error: LLMStructuredOutputError | None,
        coverage_error: _EpisodePlanCoverageError | None,
        expected_episode_numbers: list[int],
    ) -> str:
        failure = (
            json.dumps(
                validation_error.errors(include_input=False, include_url=False),
                ensure_ascii=False,
                separators=(",", ":"),
            )
            if validation_error is not None
            else str(
                coverage_error
                or structured_error
                or "The response was empty or invalid JSON."
            )
        )
        expected_count = len(expected_episode_numbers)
        return f"""CRITICAL EPISODE ROADMAP SHAPE REPAIR
The previous response did not form a usable Episode roadmap. Return one JSON object
whose only top-level key is "episode_plans". episode_plans must be a native JSON array,
never an empty array and never an array of quoted JSON strings.

Return exactly {expected_count} complete episode plan objects for these episode numbers,
in this exact order: {json.dumps(expected_episode_numbers, ensure_ascii=False)}.

Each episode object must use exactly these fields:
episode_number, ending_mode, episode_title, synopsis, locations, episode_goal, entry_state, central_conflict, protagonist_decision,
reveal, emotional_movement, stage_opposition, episode_payoff, pressure_escalation, dramatic_units, protagonist_cost,
setup_refs, payoff_refs, exit_state, cliffhanger, character_refs, story_line_refs,
continuity_requirements, source_turning_points, source_unit_story_beats,
ending_hook_type, next_episode_obligation, hook_payoff_target_episode, scene_execution_plan.

scene_execution_plan must contain one complete item per planned scene with scene_number,
scene_heading, character_refs, scene_objective, opposition, information_shift, choice_or_cost,
evidence_requirements, forbidden_changes, visible_action, turn_or_reveal, dialogue_objective,
dialogue_line_target, shot_target and exit_state.

Set ending_mode to serial_hook for a continuing episode. A season_finale or series_finale
must use the approved formal resolution and must not fabricate a continuation cliffhanger.

Structured failure:
{failure}

Previous response, usable only when it contains recoverable episode content:
{json.dumps(source_response, ensure_ascii=False, separators=(',', ':'))}

Original Episode roadmap constraints:
{contract_prompt}

Final shape check: the response starts with {{"episode_plans":[{{, contains exactly
{expected_count} objects, covers every requested episode once, and closes the array and
outer object. Return only the corrected JSON object."""
````

片段 SHA-256：`6f1aba390cb764acfde91b5baab1c6bf695bdc8c48e2978091033204f4535e59`
