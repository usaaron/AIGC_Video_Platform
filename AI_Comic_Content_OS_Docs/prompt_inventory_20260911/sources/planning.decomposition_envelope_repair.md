# 剧情拆分 children 容器修复

编号：`planning.decomposition_envelope_repair`。状态：`active_conditional_repair`。

来源：[backend/app/modules/script_engine/story_planning_service.py:10476](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10476)。符号：`StoryPlanningService._build_decomposition_envelope_repair_prompt`。

防平铺单节点、字符串 JSON、复制节点凑数。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 10483 行

````text
CRITICAL DECOMPOSITION SHAPE REPAIR
The previous response did not form a valid collection of child node objects. A
decomposition is not one flat node and children must not contain quoted JSON strings.
Return one JSON object whose only top-level key is "children". The value
must be an array of 2-12 distinct, contiguous child node objects. Do not wrap the flat
node as a one-item array, copy it repeatedly, or emit node fields at the top level.
If the API schema shows a StoryPlanNodeChildOutput definition, that definition is only
the array item contract; it is never the response root. Begin the response exactly with
{"children":[{ and close every child plus the outer array and object.

Each child must use exactly these fields:
title, narrative_purpose, synopsis, entry_state, central_conflict, turning_points,
emotional_direction, exit_state, unit_story_beats, unit_resolution, handoff_pressure,
character_refs, story_line_refs, setup_refs, payoff_refs,
estimated_episode_count, estimated_script_body_characters, planned_start_episode,
planned_end_episode, decomposition_reason, recommended_next_step.

Structured failure:
{json.dumps(validation_error.errors(include_input=False, include_url=False), ensure_ascii=False, separators=(',', ':'))}

Incorrect responses, usable only as source material for real child movements:
{json.dumps(source_responses, ensure_ascii=False, separators=(',', ':'))}

Original decomposition constraints:
{contract_prompt}

Final shape check before returning: the response has exactly one top-level field,
children is a JSON array, and children contains at least two complete objects.
Return only {"children":[...]} with at least two complete children.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_decomposition_envelope_repair_prompt(
        *,
        contract_prompt: str,
        source_responses: dict[str, object],
        validation_error: ValidationError,
    ) -> str:
        return f"""CRITICAL DECOMPOSITION SHAPE REPAIR
The previous response did not form a valid collection of child node objects. A
decomposition is not one flat node and children must not contain quoted JSON strings.
Return one JSON object whose only top-level key is "children". The value
must be an array of 2-12 distinct, contiguous child node objects. Do not wrap the flat
node as a one-item array, copy it repeatedly, or emit node fields at the top level.
If the API schema shows a StoryPlanNodeChildOutput definition, that definition is only
the array item contract; it is never the response root. Begin the response exactly with
{{"children":[{{ and close every child plus the outer array and object.

Each child must use exactly these fields:
title, narrative_purpose, synopsis, entry_state, central_conflict, turning_points,
emotional_direction, exit_state, unit_story_beats, unit_resolution, handoff_pressure,
character_refs, story_line_refs, setup_refs, payoff_refs,
estimated_episode_count, estimated_script_body_characters, planned_start_episode,
planned_end_episode, decomposition_reason, recommended_next_step.

Structured failure:
{json.dumps(validation_error.errors(include_input=False, include_url=False), ensure_ascii=False, separators=(',', ':'))}

Incorrect responses, usable only as source material for real child movements:
{json.dumps(source_responses, ensure_ascii=False, separators=(',', ':'))}

Original decomposition constraints:
{contract_prompt}

Final shape check before returning: the response has exactly one top-level field,
children is a JSON array, and children contains at least two complete objects.
Return only {{"children":[...]}} with at least two complete children."""
````

片段 SHA-256：`eef949df2c3cdc1d177815106c2813e0970fb0939664887be85a327488a9eba9`
