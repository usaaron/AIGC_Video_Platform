# 分块路线图范围与交接指令

编号：`planning.episode_chunk`。状态：`active_main`。

来源：[backend/app/modules/script_engine/story_planning_service.py:10609](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:10609)。符号：`StoryPlanningService._build_segmented_episode_roadmap_prompt`。

名称有 RECOVERY，但当前分块主路径使用；只覆盖输出数量，不改故事合同。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 10640 行

````text
This chunk reaches the end of the leaf. It must assign every approved turning point and unit-story beat from the original contract that is not already present in accepted_plans.
````

### 片段 2 · 源码第 10644 行

````text
Assign only approved events whose causal position belongs in this chunk; leave later events for later episode numbers.
````

### 片段 3 · 源码第 10647 行

````text
SEGMENTED EPISODE ROADMAP RECOVERY
The full approved leaf still covers these episodes as one logical contract:
{json.dumps(all_episode_numbers, ensure_ascii=False)}.

Generate only this transport-sized chunk now, with exactly {len(current_episode_numbers)}
complete episode plan objects in this exact order:
{json.dumps(current_episode_numbers, ensure_ascii=False)}.

Minimal continuity checkpoint from the immediately preceding episode:
{json.dumps(previous_state, ensure_ascii=False, separators=(',', ':'))}

Approved turning points already assigned in earlier chunks:
{json.dumps(used_turning_points, ensure_ascii=False, separators=(',', ':'))}

Approved unit-story beats already assigned in earlier chunks:
{json.dumps(used_unit_story_beats, ensure_ascii=False, separators=(',', ':'))}

Do not repeat any source_turning_points or source_unit_story_beats already present in
the used lists above. The first entry_state in this chunk must causally follow the supplied
previous exit_state when a checkpoint is present. {final_requirement}

Every item must retain all exact Episode Plan fields and use only approved character,
story-line, setup and payoff references. This recovery changes transport size only; it
must not invent a different plot, omit the leaf resolution, or move its handoff pressure.

Original full-leaf contract:
<full_leaf_contract>
{contract_prompt}
</full_leaf_contract>

For this recovery call only, replace every response-count or full-range output
instruction inside full_leaf_contract with the current chunk range above. Preserve all
story, continuity, reference, language, field, and quality constraints unchanged.
Return only one JSON object whose only top-level field is episode_plans.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_segmented_episode_roadmap_prompt(
        *,
        contract_prompt: str,
        all_episode_numbers: list[int],
        current_episode_numbers: list[int],
        accepted_plans: list[EpisodePlanGenerationItem],
    ) -> str:
        previous_plan = accepted_plans[-1] if accepted_plans else None
        previous_state = (
            {
                "episode_number": previous_plan.episode_number,
                "exit_state": previous_plan.exit_state,
                "next_episode_obligation": previous_plan.next_episode_obligation,
                "pressure_escalation": previous_plan.pressure_escalation,
            }
            if previous_plan is not None
            else None
        )
        used_turning_points = [
            turning_point
            for item in accepted_plans
            for turning_point in item.source_turning_points
        ]
        used_unit_story_beats = [
            beat
            for item in accepted_plans
            for beat in item.source_unit_story_beats
        ]
        final_chunk = current_episode_numbers[-1] == all_episode_numbers[-1]
        final_requirement = (
            "This chunk reaches the end of the leaf. It must assign every approved "
            "turning point and unit-story beat from the original contract that is not "
            "already present in accepted_plans."
            if final_chunk
            else "Assign only approved events whose causal position belongs in this chunk; "
            "leave later events for later episode numbers."
        )
        return f"""SEGMENTED EPISODE ROADMAP RECOVERY
The full approved leaf still covers these episodes as one logical contract:
{json.dumps(all_episode_numbers, ensure_ascii=False)}.

Generate only this transport-sized chunk now, with exactly {len(current_episode_numbers)}
complete episode plan objects in this exact order:
{json.dumps(current_episode_numbers, ensure_ascii=False)}.

Minimal continuity checkpoint from the immediately preceding episode:
{json.dumps(previous_state, ensure_ascii=False, separators=(',', ':'))}

Approved turning points already assigned in earlier chunks:
{json.dumps(used_turning_points, ensure_ascii=False, separators=(',', ':'))}

Approved unit-story beats already assigned in earlier chunks:
{json.dumps(used_unit_story_beats, ensure_ascii=False, separators=(',', ':'))}

Do not repeat any source_turning_points or source_unit_story_beats already present in
the used lists above. The first entry_state in this chunk must causally follow the supplied
previous exit_state when a checkpoint is present. {final_requirement}

Every item must retain all exact Episode Plan fields and use only approved character,
story-line, setup and payoff references. This recovery changes transport size only; it
must not invent a different plot, omit the leaf resolution, or move its handoff pressure.

Original full-leaf contract:
<full_leaf_contract>
{contract_prompt}
</full_leaf_contract>

For this recovery call only, replace every response-count or full-range output
instruction inside full_leaf_contract with the current chunk range above. Preserve all
story, continuity, reference, language, field, and quality constraints unchanged.
Return only one JSON object whose only top-level field is episode_plans."""
````

片段 SHA-256：`708c5a6d5b528313a4e3ebfa823ec4fb60072c6bf23e5d1470dd30cecb3b47b7`
