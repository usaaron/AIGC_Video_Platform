# 故事总纲生成主提示

编号：`planning.bible_main`。状态：`active_main`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12546](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12546)。符号：`StoryPlanningService._build_prompt`。

generate_story_bible_draft 调用；只稳定整剧方向，不生成逐集正文。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12556 行

````text
- {item.character_ref}: {item.name} ({item.role}){' - ' + item.description if item.description else ''}
````

### 片段 2 · 源码第 12559 行

````text
- 尚未预设角色；请使用稳定的角色引用，例如 character.protagonist。
````

### 片段 3 · 源码第 12565 行

````text
{selected_direction.title}
- 叙事风格：{selected_direction.style_description}
- 内容侧重：{selected_direction.content_description}
````

### 片段 4 · 源码第 12581 行

````text
{StoryPlanningService._market_contract_text(content_spec)}

You are drafting the long-story Story Bible for the selected market path's serialized comic story.
This is a planning document for human review, not an episode script.
Do not write scenes, dialogue, camera directions, or production prompts.
Define only the coherent whole-story direction that a later recursive planning step can split into narrative parts.
Do not assign episode numbers, episode ranges, episode beats, or episode-level hooks in this step.
Do not force every later branch to have the same depth.
All human-readable output values must be written in {market_contract.language_name}.

Outline level and reference style:
Write a concise development master outline, similar to a creator-facing story-development brief:
story positioning, core story promise, established essential characters and relationships, whole-story lines,
the broad conflict/development direction, climax, ending direction, and a short set of creative guardrails.
The JSON fields below are the storage contract for those sections; do not add extra section fields.
Every narrative field should be one compact paragraph or one sentence. List items should normally be one sentence.
Use broad story phases rather than episode summaries. Escalation stages are whole-story milestones, not scenes:
give each stage one goal, one obstacle, one local payoff, and one reason the next pressure becomes harder.
Do not provide step-by-step events, chapter lists, episode beats, scene examples, dialogue, shot actions,
detailed biographies, an encyclopedia of world rules, or a complete chronology. Those details belong to the
recursive story tree and episode roadmap.

{STORY_BIBLE_REFERENCE_FORMAT_CONTRACT}
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

Current working title (input context only; do not treat it as the final title): {project_title}
Target episode count: {payload.target_episode_count}. This is the user's manually entered hard
series boundary. Preserve it exactly; never add, remove, estimate, or replace episodes. Each later episode must run
{EPISODE_RUNTIME_MIN_SECONDS}-{EPISODE_RUNTIME_MAX_SECONDS} seconds, and the complete produced
series must total at least {SERIES_RUNTIME_MIN_MINUTES} minutes.
User creative prompt: {payload.creative_prompt.strip() or '未提供'}
User-selected tag labels: {tag_text}
User-selected creative direction:
{direction_text}
Resolved ContentSpec story goal: {content_spec.story_goal}
Resolved ContentSpec tags: {tag_context}
Characters supplied by the user:
{character_text}

{reference_context}

{knowledge_context}

Author control for this planning turn:
{payload.author_instruction.strip() or '未提供；只整理已有创作输入，未决定的高影响内容保持待定。'}
这条指令用于整理作者已经表达的方向。它不自动授权新增身份、秘密、背叛、死亡、关系结果、主题结论或结局。
只有决策账本中 ai_permission=decide 的项目可以由模型代为决定；suggest_only 只能形成待作者确认的临时建议。

{decision_contract}

Contract requirements:
1. Treat the user-selected creative direction as binding guidance beneath the original prompt and tags. It may refine
   unspecified dimensions but must never override or conflict with any original user input.
2. Organize the story premise, long-form goal, central conflict, development direction, essential relationships,
   and major story lines to the extent supported by author sources. For an unresolved high-impact item, write a
   concise Chinese “待定” structural statement; never silently choose the content merely to make the outline look complete.
   Then name the complete work in project_title using a concise, distinctive 2-12 Chinese-character title grounded
   in confirmed material. If no final title can be grounded yet, preserve the current working title as provisional.
3. Use the supplied character_ref values exactly when referring to supplied characters.
4. If characters were supplied, include all of them. Add a character only when the author sources establish that
   person or ai_permission=decide explicitly allows it. If the schema requires a character before the author has
   decided one, use one stable role placeholder such as character.primary.tbd and label its identity as 待定.
5. Return character_registry with exactly one canonical Chinese name and role for every character_ref. This is the
   authoritative identity ledger for later recursive generation. Never reuse one character's name for another character.
   If a family member's name is unknown, use a stable role label such as "母亲" instead of copying another character's name.
6. Before returning, audit every character arc, relationship, locked fact, and story line for identity consistency.
   A character must not be described as their own mother, father, son, daughter, sibling, spouse, or lover.
7. Keep established character arcs and relationships concise, using one short sentence per narrative field and no
   scene examples. Optional arc and relationship collections may remain empty when the author has not established them.
   Every relationship_type must name the concrete social, family,
   legal, emotional, authority, debt, alliance, or hostility relationship, for example 亲生母女、法定夫妻、前任恋人、
   雇主与雇员、师徒、秘密同盟、债权人与债务人 or 明确敌对. Never output 剧情关联、有关联、认识、情感张力
   or 关系复杂 as a relationship type. Relationships are whole-story constraints, not scene or episode plans.
8. Make story_lines represent the distinct main, subplot, or character-arc responsibilities established by the
   author sources. Do not invent lines to meet a quota. If no concrete line has been established, use one stable
   structural placeholder marked 待定 so later planning can ask the author instead of treating it as story fact. They must describe
   what develops across the whole story and how it is intended to resolve, never an episode list. Every item must
   have a specific title, premise/responsibility, and planned_resolution. Do not use generic placeholders such as
   "故事线 1", "围绕主线冲突推进并形成阶段性变化。" or "在后续剧情中完成与主线方向一致的收束。"
9. When confirmed development content supports it, build 3-5 genuinely different whole-story milestones. Build
   escalation_stages only from confirmed development content or explicit AI-decision permission. Otherwise use
   functional structural milestones such as 建立承诺、升级压力、阶段兑现、最终兑现, with the story-specific person,
   event, secret, relationship outcome and payoff visibly marked 待定. Structure the pressure curve without authoring
   the missing plot on the user's behalf.
10. When the author has established a final opponent or ending, reserve it for the final escalation stage. Earlier
   stages should have distinct functions and local closure without inventing story-specific outcomes.
11. Calibrate the escalation ladder for the target episode count and a minimum 100-minute complete production. Treat each stage as a broad development phase; do not enumerate its internal episode-scale pressure, action, payoff, or scene sequence here. The later recursive story tree and episode roadmap will expand each phase before its local resolution.
12. Keep only source-grounded setup/payoff references at whole-story level. Do not decide which episode contains them;
   the optional list may remain empty.
13. Keep only source-grounded world rules, locked facts and avoid patterns. Optional lists may remain empty. Each
   retained item must be one concise sentence.
14. Keep core_premise, series_goal, central_conflict, and ending_direction to 1-3 concise sentences each. Keep every
   other narrative field to one sentence, normally no more than 120 Chinese characters (preferably shorter); keep each
   escalation-stage field normally under 80 Chinese characters. Detailed beats belong in the recursive story tree and episode roadmap,
   not in this response.
15. Output exactly the schema fields. project_title is the final whole-work title derived from this Story Bible;
   do not repeat other input metadata such as tags, target length,
   target episodes, or tonal guidance as extra top-level fields.

The API may enforce only JSON-object mode, so follow this exact nested contract yourself:
- character_registry item: character_ref, name, role. Use name, never canonical_name.
- character_arc_targets item: character_ref, external_goal, internal_need, starting_state,
  target_state, key_turning_points, protected_traits.
- relationships item: relationship_id, source_character_ref, target_character_ref,
  relationship_type, initial_state, target_direction, locked.
- story_lines item: story_line_id, title, story_line_type (main, subplot, or character_arc),
  premise, planned_resolution, character_refs.
- escalation_stages item: stage_id, title, stage_goal, stage_opposition, stage_payoff,
  escalation_to_next.
- world_rules, character_refs, major_setup_payoff_refs, locked_facts, and avoid_patterns are arrays of strings.
Required top-level fields: {schema_fields}. Do not emit aliases or additional fields.

Return only JSON matching the provided schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_prompt(
        *,
        payload: StoryBibleDraftRequest,
        project_title: str,
        content_spec,
        knowledge_context: str,
    ) -> str:
        tag_text = "、".join(payload.selected_tag_labels) or "未提供系统标签"
        character_text = "\n".join(
            f"- {item.character_ref}: {item.name} ({item.role})"
            f"{(' - ' + item.description) if item.description else ''}"
            for item in payload.characters
        ) or "- 尚未预设角色；请使用稳定的角色引用，例如 character.protagonist。"
        tag_context = "、".join(
            f"{tag.category}:{tag.label}" for tag in content_spec.tags
        ) or "未提供"
        selected_direction = payload.selected_creative_direction
        direction_text = (
            f"{selected_direction.title}\n"
            f"- 叙事风格：{selected_direction.style_description}\n"
            f"- 内容侧重：{selected_direction.content_description}"
            if selected_direction
            else "未选择"
        )
        schema_fields = ", ".join(
            StoryBibleGenerationOutput.model_json_schema().get("properties", {})
        )
        reference_context = StoryPlanningService._reference_material_context(
            payload.reference_materials,
            max_characters=30_000,
        )
        market_contract = content_spec_market_contract(content_spec)
        creative_decisions = _story_bible_decisions_for_request(payload)
        decision_contract = _creative_decision_prompt_contract(creative_decisions)
        return f"""{StoryPlanningService._market_contract_text(content_spec)}

You are drafting the long-story Story Bible for the selected market path's serialized comic story.
This is a planning document for human review, not an episode script.
Do not write scenes, dialogue, camera directions, or production prompts.
Define only the coherent whole-story direction that a later recursive planning step can split into narrative parts.
Do not assign episode numbers, episode ranges, episode beats, or episode-level hooks in this step.
Do not force every later branch to have the same depth.
All human-readable output values must be written in {market_contract.language_name}.

Outline level and reference style:
Write a concise development master outline, similar to a creator-facing story-development brief:
story positioning, core story promise, established essential characters and relationships, whole-story lines,
the broad conflict/development direction, climax, ending direction, and a short set of creative guardrails.
The JSON fields below are the storage contract for those sections; do not add extra section fields.
Every narrative field should be one compact paragraph or one sentence. List items should normally be one sentence.
Use broad story phases rather than episode summaries. Escalation stages are whole-story milestones, not scenes:
give each stage one goal, one obstacle, one local payoff, and one reason the next pressure becomes harder.
Do not provide step-by-step events, chapter lists, episode beats, scene examples, dialogue, shot actions,
detailed biographies, an encyclopedia of world rules, or a complete chronology. Those details belong to the
recursive story tree and episode roadmap.

{STORY_BIBLE_REFERENCE_FORMAT_CONTRACT}
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

Current working title (input context only; do not treat it as the final title): {project_title}
Target episode count: {payload.target_episode_count}. This is the user's manually entered hard
series boundary. Preserve it exactly; never add, remove, estimate, or replace episodes. Each later episode must run
{EPISODE_RUNTIME_MIN_SECONDS}-{EPISODE_RUNTIME_MAX_SECONDS} seconds, and the complete produced
series must total at least {SERIES_RUNTIME_MIN_MINUTES} minutes.
User creative prompt: {payload.creative_prompt.strip() or '未提供'}
User-selected tag labels: {tag_text}
User-selected creative direction:
{direction_text}
Resolved ContentSpec story goal: {content_spec.story_goal}
Resolved ContentSpec tags: {tag_context}
Characters supplied by the user:
{character_text}

{reference_context}

{knowledge_context}

Author control for this planning turn:
{payload.author_instruction.strip() or "未提供；只整理已有创作输入，未决定的高影响内容保持待定。"}
这条指令用于整理作者已经表达的方向。它不自动授权新增身份、秘密、背叛、死亡、关系结果、主题结论或结局。
只有决策账本中 ai_permission=decide 的项目可以由模型代为决定；suggest_only 只能形成待作者确认的临时建议。

{decision_contract}

Contract requirements:
1. Treat the user-selected creative direction as binding guidance beneath the original prompt and tags. It may refine
   unspecified dimensions but must never override or conflict with any original user input.
2. Organize the story premise, long-form goal, central conflict, development direction, essential relationships,
   and major story lines to the extent supported by author sources. For an unresolved high-impact item, write a
   concise Chinese “待定” structural statement; never silently choose the content merely to make the outline look complete.
   Then name the complete work in project_title using a concise, distinctive 2-12 Chinese-character title grounded
   in confirmed material. If no final title can be grounded yet, preserve the current working title as provisional.
3. Use the supplied character_ref values exactly when referring to supplied characters.
4. If characters were supplied, include all of them. Add a character only when the author sources establish that
   person or ai_permission=decide explicitly allows it. If the schema requires a character before the author has
   decided one, use one stable role placeholder such as character.primary.tbd and label its identity as 待定.
5. Return character_registry with exactly one canonical Chinese name and role for every character_ref. This is the
   authoritative identity ledger for later recursive generation. Never reuse one character's name for another character.
   If a family member's name is unknown, use a stable role label such as "母亲" instead of copying another character's name.
6. Before returning, audit every character arc, relationship, locked fact, and story line for identity consistency.
   A character must not be described as their own mother, father, son, daughter, sibling, spouse, or lover.
7. Keep established character arcs and relationships concise, using one short sentence per narrative field and no
   scene examples. Optional arc and relationship collections may remain empty when the author has not established them.
   Every relationship_type must name the concrete social, family,
   legal, emotional, authority, debt, alliance, or hostility relationship, for example 亲生母女、法定夫妻、前任恋人、
   雇主与雇员、师徒、秘密同盟、债权人与债务人 or 明确敌对. Never output 剧情关联、有关联、认识、情感张力
   or 关系复杂 as a relationship type. Relationships are whole-story constraints, not scene or episode plans.
8. Make story_lines represent the distinct main, subplot, or character-arc responsibilities established by the
   author sources. Do not invent lines to meet a quota. If no concrete line has been established, use one stable
   structural placeholder marked 待定 so later planning can ask the author instead of treating it as story fact. They must describe
   what develops across the whole story and how it is intended to resolve, never an episode list. Every item must
   have a specific title, premise/responsibility, and planned_resolution. Do not use generic placeholders such as
   "故事线 1", "围绕主线冲突推进并形成阶段性变化。" or "在后续剧情中完成与主线方向一致的收束。"
9. When confirmed development content supports it, build 3-5 genuinely different whole-story milestones. Build
   escalation_stages only from confirmed development content or explicit AI-decision permission. Otherwise use
   functional structural milestones such as 建立承诺、升级压力、阶段兑现、最终兑现, with the story-specific person,
   event, secret, relationship outcome and payoff visibly marked 待定. Structure the pressure curve without authoring
   the missing plot on the user's behalf.
10. When the author has established a final opponent or ending, reserve it for the final escalation stage. Earlier
   stages should have distinct functions and local closure without inventing story-specific outcomes.
11. Calibrate the escalation ladder for the target episode count and a minimum 100-minute complete production. Treat each stage as a broad development phase; do not enumerate its internal episode-scale pressure, action, payoff, or scene sequence here. The later recursive story tree and episode roadmap will expand each phase before its local resolution.
12. Keep only source-grounded setup/payoff references at whole-story level. Do not decide which episode contains them;
   the optional list may remain empty.
13. Keep only source-grounded world rules, locked facts and avoid patterns. Optional lists may remain empty. Each
   retained item must be one concise sentence.
14. Keep core_premise, series_goal, central_conflict, and ending_direction to 1-3 concise sentences each. Keep every
   other narrative field to one sentence, normally no more than 120 Chinese characters (preferably shorter); keep each
   escalation-stage field normally under 80 Chinese characters. Detailed beats belong in the recursive story tree and episode roadmap,
   not in this response.
15. Output exactly the schema fields. project_title is the final whole-work title derived from this Story Bible;
   do not repeat other input metadata such as tags, target length,
   target episodes, or tonal guidance as extra top-level fields.

The API may enforce only JSON-object mode, so follow this exact nested contract yourself:
- character_registry item: character_ref, name, role. Use name, never canonical_name.
- character_arc_targets item: character_ref, external_goal, internal_need, starting_state,
  target_state, key_turning_points, protected_traits.
- relationships item: relationship_id, source_character_ref, target_character_ref,
  relationship_type, initial_state, target_direction, locked.
- story_lines item: story_line_id, title, story_line_type (main, subplot, or character_arc),
  premise, planned_resolution, character_refs.
- escalation_stages item: stage_id, title, stage_goal, stage_opposition, stage_payoff,
  escalation_to_next.
- world_rules, character_refs, major_setup_payoff_refs, locked_facts, and avoid_patterns are arrays of strings.
Required top-level fields: {schema_fields}. Do not emit aliases or additional fields.

Return only JSON matching the provided schema."""
````

片段 SHA-256：`734b973326048c5f99a7cf77b5db6f7b309139f44df0652af214177035488b9f`
