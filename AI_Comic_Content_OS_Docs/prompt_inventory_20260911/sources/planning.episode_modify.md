# 单集路线图修改与重写提示

编号：`planning.episode_modify`。状态：`active_editor`。

来源：[backend/app/modules/script_engine/story_planning_service.py:8129](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:8129)。符号：`StoryPlanningService._build_episode_plan_item_modification_prompt`。

保留集号、引用和源事件；返回完整执行蓝图。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 8144 行

````text
在不改变本集因果职责的前提下，整体重写本集路线图，使其更具体、更适合短剧拍摄。
````

### 片段 2 · 源码第 8147 行

````text
重写所有可编辑叙事字段，重新组织本集的动作、选择、可见回报和结尾压力；不得改变本集在剧情段中的位置。
````

### 片段 3 · 源码第 8151 行

````text
只调整用户要求涉及的叙事字段，保留未涉及的因果事实和上下集交接。
````

### 片段 4 · 源码第 8168 行

````text
No text selection was provided. Infer the smallest affected roadmap fields from the instruction.
````

### 片段 5 · 源码第 8171 行

````text
The author selected this exact passage inside the episode roadmap as the primary target.
Source field: {selection_context.source_field}
Selected text:
{selection_context.selected_text}
Text immediately before the selection:
{selection_context.before_text or '(none)'}
Text immediately after the selection:
{selection_context.after_text or '(none)'}
Treat the selection as the precise target. If changing it breaks the preceding checkpoint,
episode payoff, exit state or next-episode obligation, update only those dependent fields too.
````

### 片段 6 · 源码第 8181 行

````text
{market_contract}

You are revising one episode roadmap item in a serialized short drama.
Return exactly one native JSON object matching the EpisodePlanGenerationItem schema. Do not
return an episode_plans wrapper, screenplay prose, dialogue, Markdown, or explanation.
All human-readable values must follow the market contract above.
{EPISODE_ROADMAP_LENGTH_TARGET_CONTRACT}
{STORY_LINE_EPISODE_DUTY_CONTRACT}
{EPISODE_HUMAN_READABLE_FIELDS_CONTRACT}
{EPISODE_DRAMATIC_DESIGN_CONTRACT}

User instruction:
{resolved_instruction}

Document selection context:
{selection_contract}

Revision mode: {revision_mode}
{revision_rule}

Approved Story Bible premise: {story_bible.core_premise}
Approved characters: {json.dumps(story_bible.character_refs, ensure_ascii=False)}
Approved story lines: {json.dumps([line.story_line_id for line in story_bible.story_lines], ensure_ascii=False)}
Approved segment: {node.title}
Segment synopsis: {node.synopsis}
Segment entry state: {node.entry_state}
Segment conflict: {node.central_conflict}
Segment exit state: {node.exit_state}
Required local resolution: {node.unit_resolution or node.exit_state}
Required handoff pressure: {node.handoff_pressure or node.exit_state}
Ending mode: {current_plan.ending_mode.value}; serial_hook requires a causal cliffhanger,
while season_finale/series_finale must use the approved formal resolution without a
manufactured continuation hook.

Immediately preceding checkpoint:
{json.dumps(previous_checkpoint, ensure_ascii=False, separators=(',', ':'))}

Durable continuity memory from the accepted roadmap prefix:
{json.dumps(continuity_memory, ensure_ascii=False, separators=(',', ':'))}

Current approved roadmap item (identity, references and source assignments are immutable):
{current_plan.model_dump_json(exclude={'scene_execution_plan'})}

Immutable values that must be copied exactly:
- episode_number: {current_plan.episode_number}
- character_refs: {json.dumps(current_plan.character_refs, ensure_ascii=False)}
- story_line_refs: {json.dumps(current_plan.story_line_refs, ensure_ascii=False)}
- setup_refs: {json.dumps(current_plan.setup_refs, ensure_ascii=False)}
- payoff_refs: {json.dumps(current_plan.payoff_refs, ensure_ascii=False)}
- source_turning_points: {json.dumps(current_plan.source_turning_points, ensure_ascii=False)}
- source_unit_story_beats: {json.dumps(current_plan.source_unit_story_beats, ensure_ascii=False)}

{knowledge_context}

Requirements:
1. Keep episode_number exactly {current_plan.episode_number}; target_duration_seconds must be {EPISODE_RUNTIME_MIN_SECONDS}-{EPISODE_RUNTIME_MAX_SECONDS}, planned_scene_count {EPISODE_SCENE_MIN}-{EPISODE_SCENE_MAX}, planned_dialogue_line_count {EPISODE_DIALOGUE_LINE_MIN}-{EPISODE_DIALOGUE_LINE_MAX}, and planned_shot_count {EPISODE_SHOT_UNIT_MIN}-{EPISODE_SHOT_UNIT_MAX}.
1a. If the defining action, choice or reversal changes, update episode_title too.
{EPISODE_TITLE_NAMING_CONTRACT}
1b. If the revision changes where the episode happens or its causal summary, update `locations` and/or `synopsis`; otherwise preserve them exactly.
2. Continue causally from the preceding checkpoint and produce a distinct, story-native dramatic mechanism with an observable exit state. The episode may use a pressure-action-payoff sequence, a relationship turn, a failed attempt with consequences, an information exchange, a pursuit/rescue, a delayed payoff or another approved form; do not force a fixed cycle when the episode's people and circumstances call for a different shape. For serial_hook use a concrete cliffhanger; for season_finale or series_finale use the approved formal resolution and do not invent a continuation hook.
3. Preserve every still-active continuity requirement, unresolved setup, open hook and state
   handoff in the durable memory. Do not fix a local sentence by contradicting an earlier fact.
4. Preserve the approved segment's local resolution and handoff pressure; do not invent a new plot chain or postpone this episode's contribution.
5. Copy every immutable value above exactly. Keep all narrative values concise and production-ready. ending_hook_type must be only a 2-20 character Simplified-Chinese classification label with no explanation.
6. Return a complete `scene_execution_plan` with exactly planned_scene_count scenes. Each
   scene must include scene_number, scene_heading, character_refs, scene_objective,
   opposition, information_shift, choice_or_cost, evidence_requirements,
   forbidden_changes, visible_action, turn_or_reveal, dialogue_objective,
   dialogue_line_target, shot_target and exit_state. Preserve the approved scene count,
   dialogue/shot totals and immutable character references.
7. Keep the combined human-readable roadmap fields within 250-650 Chinese characters. If the
   revision runs long, shorten repeated upper-layer context before returning; preserve the
   episode's distinct causal contribution and handoff.
8. Return only the complete JSON object matching the authoritative schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_episode_plan_item_modification_prompt(
        *,
        node: StoryPlanNode,
        story_bible: StoryBible,
        current_plan: EpisodePlanGenerationItem,
        accepted_plans: list[EpisodePlanGenerationItem],
        predecessor_plan: EpisodePlanGenerationItem | None,
        instruction: str,
        revision_mode: str,
        selection_context: StoryBibleSelectionContext | None,
        knowledge_context: str,
        planning_memory: EpisodePlanningContinuityMemory | None = None,
    ) -> str:
        resolved_instruction = instruction.strip() or (
            "在不改变本集因果职责的前提下，整体重写本集路线图，使其更具体、更适合短剧拍摄。"
        )
        revision_rule = (
            "重写所有可编辑叙事字段，重新组织本集的动作、选择、可见回报和结尾压力；"
            "不得改变本集在剧情段中的位置。"
            if revision_mode == "rewrite"
            else
            "只调整用户要求涉及的叙事字段，保留未涉及的因果事实和上下集交接。"
        )
        previous = accepted_plans[-1] if accepted_plans else predecessor_plan
        previous_checkpoint = previous.model_dump(mode="json") if previous else {
            "episode_number": None,
            "exit_state": node.entry_state,
            "next_episode_obligation": "从剧情段进入状态开始。",
        }
        continuity_memory = StoryPlanningService._compact_episode_continuity_memory(
            accepted_plans,
            predecessor_plan=predecessor_plan,
            current_episode_number=current_plan.episode_number,
            planning_memory=planning_memory,
        )
        market_contract = StoryPlanningService._story_bible_market_contract_text(story_bible)
        if selection_context is None:
            selection_contract = (
                "No text selection was provided. Infer the smallest affected roadmap fields from the instruction."
            )
        else:
            selection_contract = f"""The author selected this exact passage inside the episode roadmap as the primary target.
Source field: {selection_context.source_field}
Selected text:
{selection_context.selected_text}
Text immediately before the selection:
{selection_context.before_text or "(none)"}
Text immediately after the selection:
{selection_context.after_text or "(none)"}
Treat the selection as the precise target. If changing it breaks the preceding checkpoint,
episode payoff, exit state or next-episode obligation, update only those dependent fields too."""
        return f"""{market_contract}

You are revising one episode roadmap item in a serialized short drama.
Return exactly one native JSON object matching the EpisodePlanGenerationItem schema. Do not
return an episode_plans wrapper, screenplay prose, dialogue, Markdown, or explanation.
All human-readable values must follow the market contract above.
{EPISODE_ROADMAP_LENGTH_TARGET_CONTRACT}
{STORY_LINE_EPISODE_DUTY_CONTRACT}
{EPISODE_HUMAN_READABLE_FIELDS_CONTRACT}
{EPISODE_DRAMATIC_DESIGN_CONTRACT}

User instruction:
{resolved_instruction}

Document selection context:
{selection_contract}

Revision mode: {revision_mode}
{revision_rule}

Approved Story Bible premise: {story_bible.core_premise}
Approved characters: {json.dumps(story_bible.character_refs, ensure_ascii=False)}
Approved story lines: {json.dumps([line.story_line_id for line in story_bible.story_lines], ensure_ascii=False)}
Approved segment: {node.title}
Segment synopsis: {node.synopsis}
Segment entry state: {node.entry_state}
Segment conflict: {node.central_conflict}
Segment exit state: {node.exit_state}
Required local resolution: {node.unit_resolution or node.exit_state}
Required handoff pressure: {node.handoff_pressure or node.exit_state}
Ending mode: {current_plan.ending_mode.value}; serial_hook requires a causal cliffhanger,
while season_finale/series_finale must use the approved formal resolution without a
manufactured continuation hook.

Immediately preceding checkpoint:
{json.dumps(previous_checkpoint, ensure_ascii=False, separators=(',', ':'))}

Durable continuity memory from the accepted roadmap prefix:
{json.dumps(continuity_memory, ensure_ascii=False, separators=(',', ':'))}

Current approved roadmap item (identity, references and source assignments are immutable):
{current_plan.model_dump_json(exclude={'scene_execution_plan'})}

Immutable values that must be copied exactly:
- episode_number: {current_plan.episode_number}
- character_refs: {json.dumps(current_plan.character_refs, ensure_ascii=False)}
- story_line_refs: {json.dumps(current_plan.story_line_refs, ensure_ascii=False)}
- setup_refs: {json.dumps(current_plan.setup_refs, ensure_ascii=False)}
- payoff_refs: {json.dumps(current_plan.payoff_refs, ensure_ascii=False)}
- source_turning_points: {json.dumps(current_plan.source_turning_points, ensure_ascii=False)}
- source_unit_story_beats: {json.dumps(current_plan.source_unit_story_beats, ensure_ascii=False)}

{knowledge_context}

Requirements:
1. Keep episode_number exactly {current_plan.episode_number}; target_duration_seconds must be {EPISODE_RUNTIME_MIN_SECONDS}-{EPISODE_RUNTIME_MAX_SECONDS}, planned_scene_count {EPISODE_SCENE_MIN}-{EPISODE_SCENE_MAX}, planned_dialogue_line_count {EPISODE_DIALOGUE_LINE_MIN}-{EPISODE_DIALOGUE_LINE_MAX}, and planned_shot_count {EPISODE_SHOT_UNIT_MIN}-{EPISODE_SHOT_UNIT_MAX}.
1a. If the defining action, choice or reversal changes, update episode_title too.
{EPISODE_TITLE_NAMING_CONTRACT}
1b. If the revision changes where the episode happens or its causal summary, update `locations` and/or `synopsis`; otherwise preserve them exactly.
2. Continue causally from the preceding checkpoint and produce a distinct, story-native dramatic mechanism with an observable exit state. The episode may use a pressure-action-payoff sequence, a relationship turn, a failed attempt with consequences, an information exchange, a pursuit/rescue, a delayed payoff or another approved form; do not force a fixed cycle when the episode's people and circumstances call for a different shape. For serial_hook use a concrete cliffhanger; for season_finale or series_finale use the approved formal resolution and do not invent a continuation hook.
3. Preserve every still-active continuity requirement, unresolved setup, open hook and state
   handoff in the durable memory. Do not fix a local sentence by contradicting an earlier fact.
4. Preserve the approved segment's local resolution and handoff pressure; do not invent a new plot chain or postpone this episode's contribution.
5. Copy every immutable value above exactly. Keep all narrative values concise and production-ready. ending_hook_type must be only a 2-20 character Simplified-Chinese classification label with no explanation.
6. Return a complete `scene_execution_plan` with exactly planned_scene_count scenes. Each
   scene must include scene_number, scene_heading, character_refs, scene_objective,
   opposition, information_shift, choice_or_cost, evidence_requirements,
   forbidden_changes, visible_action, turn_or_reveal, dialogue_objective,
   dialogue_line_target, shot_target and exit_state. Preserve the approved scene count,
   dialogue/shot totals and immutable character references.
7. Keep the combined human-readable roadmap fields within 250-650 Chinese characters. If the
   revision runs long, shorten repeated upper-layer context before returning; preserve the
   episode's distinct causal contribution and handoff.
8. Return only the complete JSON object matching the authoritative schema."""
````

片段 SHA-256：`305b1d09373da59ae24c714ce704c4a8398ed9bf858a8a44e2f75955bdb4b9a1`
