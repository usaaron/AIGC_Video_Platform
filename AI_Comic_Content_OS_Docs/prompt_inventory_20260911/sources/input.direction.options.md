# 保留的创作方向候选提示词

编号：`input.direction.options`。状态：`legacy`。

来源：[backend/app/modules/script_engine/story_planning_service.py:12417](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:12417)。符号：`StoryPlanningService._build_creative_direction_prompt`。

后端 API 和客户端函数仍存在；当前前端组件未发现调用。仅变化用户未指定维度，不能当作当前 Grill 主流程。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 12440 行

````text
{StoryPlanningService._market_contract_text(content_spec)}

You are proposing concise creative directions for the selected market path's serialized comic story.
Generate exactly {payload.option_count} genuinely different choices for the user to select before Story Bible generation.

Hard constraints, in priority order:
1. The user's creative prompt and selected tags are authoritative. Never negate, replace, weaken, or reinterpret them.
2. Vary only dimensions the user has not fixed, such as narrative emphasis, dramatic texture, pacing feel, relationship focus, or suspense method.
3. Do not introduce a genre, audience, era, ending type, or emotional tone that conflicts with any selected tag.
4. Keep every option concise and concrete. Do not write a synopsis, episode outline, scene, dialogue, or marketing copy.
5. All human-readable values must be written in {market_contract.language_name}.

Current working title (input context only; replace it when it is generic or provisional): {project_title}
User creative prompt: {payload.creative_prompt.strip() or '未提供'}
User-selected tag labels: {tag_text}
Resolved ContentSpec story goal: {content_spec.story_goal}
Resolved ContentSpec tags: {resolved_tags}
Known characters: {character_text}

{reference_context}

Each direction needs:
- title: a short selectable name;
- style_description: one short sentence describing storytelling style and texture;
- content_description: one short sentence describing the main content emphasis without changing user facts.
- dramatic_goal: the immediate dramatic objective this direction prioritizes;
- character_changes: 1-3 concrete character-state changes the direction is likely to create;
- reveals_or_withholds: 1-3 important truths it would reveal early or deliberately hold back;
- story_line_effects: 1-3 effects on the main line, subplots, or relationship arcs;
- tradeoffs: 1-3 creative costs or risks the author accepts by choosing it;
- next_pressure: the concrete pressure that should confront the story after this choice.

These consequence fields are a decision preview, not a fixed outline. Keep them conditional and
specific enough for the author to compare options. Do not invent facts that conflict with the prompt,
tags, or known characters; use an empty list or empty string when a field truly has no safe consequence.

Authoritative JSON contract: attached by the runtime through strict response format or a compact
native-container shape, according to the selected model transport.
Required top-level fields: {schema_fields}.

Return only JSON matching the schema.
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_creative_direction_prompt(
        *,
        payload: CreativeDirectionDraftRequest,
        project_title: str,
        content_spec,
    ) -> str:
        tag_text = "、".join(payload.selected_tag_labels) or "未提供标签"
        character_text = "、".join(
            f"{item.name}（{item.role}）" for item in payload.characters
        ) or "未预设角色"
        resolved_tags = "、".join(
            f"{tag.category}:{tag.label}" for tag in content_spec.tags
        ) or "未提供"
        schema_fields = ", ".join(
            CreativeDirectionGenerationOutput.model_json_schema()
            .get("properties", {})
        )
        reference_context = StoryPlanningService._reference_material_context(
            payload.reference_materials,
            max_characters=8_000,
        )
        market_contract = content_spec_market_contract(content_spec)
        return f"""{StoryPlanningService._market_contract_text(content_spec)}

You are proposing concise creative directions for the selected market path's serialized comic story.
Generate exactly {payload.option_count} genuinely different choices for the user to select before Story Bible generation.

Hard constraints, in priority order:
1. The user's creative prompt and selected tags are authoritative. Never negate, replace, weaken, or reinterpret them.
2. Vary only dimensions the user has not fixed, such as narrative emphasis, dramatic texture, pacing feel, relationship focus, or suspense method.
3. Do not introduce a genre, audience, era, ending type, or emotional tone that conflicts with any selected tag.
4. Keep every option concise and concrete. Do not write a synopsis, episode outline, scene, dialogue, or marketing copy.
5. All human-readable values must be written in {market_contract.language_name}.

Current working title (input context only; replace it when it is generic or provisional): {project_title}
User creative prompt: {payload.creative_prompt.strip() or '未提供'}
User-selected tag labels: {tag_text}
Resolved ContentSpec story goal: {content_spec.story_goal}
Resolved ContentSpec tags: {resolved_tags}
Known characters: {character_text}

{reference_context}

Each direction needs:
- title: a short selectable name;
- style_description: one short sentence describing storytelling style and texture;
- content_description: one short sentence describing the main content emphasis without changing user facts.
- dramatic_goal: the immediate dramatic objective this direction prioritizes;
- character_changes: 1-3 concrete character-state changes the direction is likely to create;
- reveals_or_withholds: 1-3 important truths it would reveal early or deliberately hold back;
- story_line_effects: 1-3 effects on the main line, subplots, or relationship arcs;
- tradeoffs: 1-3 creative costs or risks the author accepts by choosing it;
- next_pressure: the concrete pressure that should confront the story after this choice.

These consequence fields are a decision preview, not a fixed outline. Keep them conditional and
specific enough for the author to compare options. Do not invent facts that conflict with the prompt,
tags, or known characters; use an empty list or empty string when a field truly has no safe consequence.

Authoritative JSON contract: attached by the runtime through strict response format or a compact
native-container shape, according to the selected model transport.
Required top-level fields: {schema_fields}.

Return only JSON matching the schema."""
````

片段 SHA-256：`a56d1d93328c44ffde999dbd98f0f2d8c8690855d59e4c172e31e4dcb7d3e6ee`
