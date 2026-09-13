# 独立剧情节点生成提示

编号：`planning.node_draft`。状态：`active_auxiliary_endpoint`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12325](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12325)。符号：`StoryPlanningService._build_story_plan_node_prompt`。

generate_story_plan_node_draft 调用；不是当前前端顶层分支生成主路径。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12335 行

````text
{item.character_ref}={item.name}（{item.role}）
````

### 片段 2 · 源码第 12339 行

````text
- {line.story_line_id}: {line.title}；{line.premise}；收束：{line.planned_resolution}
````

### 片段 3 · 源码第 12344 行

````text
- {item.stage_id}《{item.title}》：目标={item.stage_goal}；阶段对手/门槛={item.stage_opposition}；回报={item.stage_payoff}；升级={item.escalation_to_next}
````

### 片段 4 · 源码第 12351 行

````text
父节点：{payload.parent_node_id} v{payload.parent_node_version}
````

### 片段 5 · 源码第 12353 行

````text
当前生成覆盖整部故事的根节点；其子分支再按内容需要递归拆分。
````

### 片段 6 · 源码第 12357 行

````text
{market_contract}

You are planning one recursively expandable narrative segment for a serialized comic.
This is a planning artifact, not an episode script. Do not write full scenes, dialogue, camera directions, or production prompts.
The hierarchy is intentionally level-free: choose a meaningful segment boundary from the story, and do not force every branch to have the same depth.
All human-readable output values must follow the market contract above.
{STORY_TREE_LENGTH_TARGET_CONTRACT}
{STORY_LINE_PLANNING_CONTRACT}

Project: {project_title}
Target total episodes: {payload.target_episode_count}
{parent_text}

Approved Story Bible:
Core premise: {story_bible.core_premise}
Series goal: {story_bible.series_goal}
Theme: {story_bible.theme}
Central conflict: {story_bible.central_conflict}
Ending direction: {story_bible.ending_direction}
World rules: {'；'.join(story_bible.world_rules) or '未指定'}
Character refs: {character_refs}
Canonical character registry: {character_registry}
Story lines:
{story_line_text}
Short-drama escalation ladder:
{escalation_text}
Major setup/payoff refs: {'；'.join(story_bible.major_setup_payoff_refs) or '未指定'}
Locked facts: {'；'.join(story_bible.locked_facts) or '未指定'}
Avoid patterns: {'；'.join(story_bible.avoid_patterns) or '未指定'}

{knowledge_context}

Author control for this planning turn:
{author_instruction}
Treat this as a high-priority creative preference. Apply it when it is compatible with the approved
Story Bible, episode boundaries, character references, causal continuity, and mainland-language contract.
If it conflicts with a hard constraint, preserve the hard constraint and satisfy the remaining intent.

Contract requirements:
1. Define why this segment exists, its entry state, central conflict, turning points, emotional direction, and exit state.
2. Keep all character_refs and story_line_refs inside the approved Story Bible references.
3. Preserve setup/payoff references; do not resolve the whole story inside this node.
4. Estimate a bounded episode range only when supported by the story; do not pad the range to reach a target number.
5. The exit state must create a concrete causal basis for the next segment.
6. This segment must belong to a concrete short-drama escalation stage. It must confront a reachable stage opponent or barrier, repeatedly earn visible local payoffs, and then expose a stronger next pressure. Do not use the whole segment only to prepare for the final opponent.
7. Keep the combined narrative fields within the applicable node target range above. If the draft runs long,
compress repeated context before returning; use later tree levels for new causal detail rather than expanding this node.

Return only JSON matching the provided schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_story_plan_node_prompt(
        *,
        project_title: str,
        story_bible: StoryBible,
        payload: StoryPlanNodeDraftRequest,
        knowledge_context: str,
    ) -> str:
        character_refs = "、".join(story_bible.character_refs) or "未指定"
        character_registry = "；".join(
            f"{item.character_ref}={item.name}（{item.role}）"
            for item in story_bible.character_registry
        ) or "未建立；只能使用已批准的角色引用，不得自行复用其他角色姓名"
        story_line_text = "\n".join(
            f"- {line.story_line_id}: {line.title}；{line.premise}；收束：{line.planned_resolution}"
            for line in story_bible.story_lines
        ) or "- 未指定"
        escalation_text = "\n".join(
            (
                f"- {item.stage_id}《{item.title}》：目标={item.stage_goal}；"
                f"阶段对手/门槛={item.stage_opposition}；回报={item.stage_payoff}；"
                f"升级={item.escalation_to_next}"
            )
            for item in getattr(story_bible, "escalation_stages", [])
        ) or "- 未指定"
        parent_text = (
            f"父节点：{payload.parent_node_id} v{payload.parent_node_version}"
            if payload.parent_node_id
            else "当前生成覆盖整部故事的根节点；其子分支再按内容需要递归拆分。"
        )
        author_instruction = payload.author_instruction.strip() or "未提供；请根据已批准边界自主提出最稳妥的剧情推进。"
        market_contract = StoryPlanningService._story_bible_market_contract_text(story_bible)
        return f"""{market_contract}

You are planning one recursively expandable narrative segment for a serialized comic.
This is a planning artifact, not an episode script. Do not write full scenes, dialogue, camera directions, or production prompts.
The hierarchy is intentionally level-free: choose a meaningful segment boundary from the story, and do not force every branch to have the same depth.
All human-readable output values must follow the market contract above.
{STORY_TREE_LENGTH_TARGET_CONTRACT}
{STORY_LINE_PLANNING_CONTRACT}

Project: {project_title}
Target total episodes: {payload.target_episode_count}
{parent_text}

Approved Story Bible:
Core premise: {story_bible.core_premise}
Series goal: {story_bible.series_goal}
Theme: {story_bible.theme}
Central conflict: {story_bible.central_conflict}
Ending direction: {story_bible.ending_direction}
World rules: {'；'.join(story_bible.world_rules) or '未指定'}
Character refs: {character_refs}
Canonical character registry: {character_registry}
Story lines:
{story_line_text}
Short-drama escalation ladder:
{escalation_text}
Major setup/payoff refs: {'；'.join(story_bible.major_setup_payoff_refs) or '未指定'}
Locked facts: {'；'.join(story_bible.locked_facts) or '未指定'}
Avoid patterns: {'；'.join(story_bible.avoid_patterns) or '未指定'}

{knowledge_context}

Author control for this planning turn:
{author_instruction}
Treat this as a high-priority creative preference. Apply it when it is compatible with the approved
Story Bible, episode boundaries, character references, causal continuity, and mainland-language contract.
If it conflicts with a hard constraint, preserve the hard constraint and satisfy the remaining intent.

Contract requirements:
1. Define why this segment exists, its entry state, central conflict, turning points, emotional direction, and exit state.
2. Keep all character_refs and story_line_refs inside the approved Story Bible references.
3. Preserve setup/payoff references; do not resolve the whole story inside this node.
4. Estimate a bounded episode range only when supported by the story; do not pad the range to reach a target number.
5. The exit state must create a concrete causal basis for the next segment.
6. This segment must belong to a concrete short-drama escalation stage. It must confront a reachable stage opponent or barrier, repeatedly earn visible local payoffs, and then expose a stronger next pressure. Do not use the whole segment only to prepare for the final opponent.
7. Keep the combined narrative fields within the applicable node target range above. If the draft runs long,
compress repeated context before returning; use later tree levels for new causal detail rather than expanding this node.

Return only JSON matching the provided schema."""
````

片段 SHA-256：`659e3faa2f5729cee522f179053bc1bb3b0c2a465085efbd044d6dace8f9c51f`
