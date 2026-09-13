# 保留的已确认交互框架合成总纲提示词

编号：`input.interactive.synthesis`。状态：`legacy`。

来源：[backend/app/modules/script_engine/story_planning_service.py:5320](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/story_planning_service.py:5320)。符号：`StoryPlanningService.complete_interactive_story_bible`。

完整方法内含 synthesis_prompt。当前 Grill 完成后走普通 generateStoryBibleDraft，不走此旧合成接口。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 5326 行

````text
Interactive Story Bible ContentSpec must match the project.
````

### 片段 2 · 源码第 5330 行

````text
GenerationStrategy '{payload.generation_strategy_id}' was not found.
````

### 片段 3 · 源码第 5334 行

````text
ContentSpec '{payload.content_spec_id}' was not found.
````

### 片段 4 · 源码第 5353 行

````text
You are compiling the final Story Bible from an author-approved interactive framework.
This is the first complete outline artifact, not an episode script. Preserve every confirmed decision
in the framework and every author note. You may only fill structural gaps needed to make the Story Bible
internally consistent. Do not replace the author's choices with a new premise, genre, ending, or cast.
All human-readable values must be written in {market_contract.language_name}.

{STORY_BIBLE_REFERENCE_FORMAT_CONTRACT}
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

Original creative prompt: {payload.creative_prompt.strip() or '未提供'}
Selected hard tags: {'、'.join(payload.selected_tag_labels) or '未提供'}
ContentSpec goal: {content_spec.story_goal}
{self._market_contract_text(content_spec)}
Knowledge context:
{self._knowledge_context(strategy=story_bible_strategy, content_spec=content_spec, preferred_categories=['short_drama_structure', 'story_structure_and_serialization', 'character_design', 'conflict_and_emotion'], max_items=8)}
Reference materials:
{StoryPlanningService._reference_material_context(payload.reference_materials, max_characters=12000)}
Approved interactive framework:
{json.dumps(raw, ensure_ascii=False, indent=2)[:60000]}
Author supplements by question:
{json.dumps(author_notes, ensure_ascii=False, indent=2)[:12000]}

Return a complete StoryBibleGenerationOutput. Keep the approved fields semantically unchanged and
ensure all character, relationship, story-line, and escalation references are coherent.
Do not assign episode numbers or return episode plans; this artifact is the whole-story Story Bible.
Keep it at development-outline level: compact premise, goal, conflict, ending, essential characters,
relationships, whole-story lines, broad escalation milestones, and concise guardrails. Do not expand
approved choices into scenes, episode beats, dialogue, detailed biographies, or a complete chronology;
those details belong to the recursive story tree and episode roadmap.
All human-readable output values must be written in Simplified Chinese.
````

### 片段 5 · 源码第 5398 行

````text
Interactive Story Bible synthesis and approved framework both failed; using deterministic fallback synthesis first_error=%s fallback_error=%s
````

### 片段 6 · 源码第 5416 行

````text
Interactive Story Bible dependency-safe merge still failed; retaining generated candidate errors=%s
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def complete_interactive_story_bible(
        self,
        payload: StoryBibleInteractiveCompleteRequest,
    ) -> StoryBible:
        project = self._long_story_service.get_project(payload.story_project_id)
        if project.content_spec_id != payload.content_spec_id:
            raise StoryPlanningInputError("Interactive Story Bible ContentSpec must match the project.")
        strategy = self._generation_strategy_repository.get(payload.generation_strategy_id)
        if strategy is None:
            raise StoryPlanningInputError(
                f"GenerationStrategy '{payload.generation_strategy_id}' was not found."
            )
        content_spec = self._content_spec_repository.get(payload.content_spec_id)
        if content_spec is None:
            raise StoryPlanningInputError(f"ContentSpec '{payload.content_spec_id}' was not found.")
        # The final interactive synthesis returns the same complete contract as
        # the regular Story Bible path. Do not reuse the smaller per-question
        # token budget, or a valid response can be cut before the last fields.
        story_bible_strategy = strategy.model_copy(
            update={
                "max_tokens": max(strategy.max_tokens, STORY_BIBLE_MIN_OUTPUT_TOKENS),
            }
        )
        # The interactive editor persists its review framework independently
        # from the final Story Bible schema. Normalize older saved sessions
        # before the synthesis result is merged back into the contract.
        raw = normalize_interactive_story_bible_sections(dict(payload.sections))
        author_notes = raw.pop("__author_notes", {})
        normalized_approved = story_bible_payload_for_validation(
            raw,
            supplied_characters=[],
        )
        market_contract = content_spec_market_contract(content_spec)
        synthesis_prompt = f"""You are compiling the final Story Bible from an author-approved interactive framework.
This is the first complete outline artifact, not an episode script. Preserve every confirmed decision
in the framework and every author note. You may only fill structural gaps needed to make the Story Bible
internally consistent. Do not replace the author's choices with a new premise, genre, ending, or cast.
All human-readable values must be written in {market_contract.language_name}.

{STORY_BIBLE_REFERENCE_FORMAT_CONTRACT}
{STORY_LINE_BALANCE_CONTRACT}
{STORY_BIBLE_LENGTH_TARGET_CONTRACT}

Original creative prompt: {payload.creative_prompt.strip() or '未提供'}
Selected hard tags: {'、'.join(payload.selected_tag_labels) or '未提供'}
ContentSpec goal: {content_spec.story_goal}
{self._market_contract_text(content_spec)}
Knowledge context:
{self._knowledge_context(strategy=story_bible_strategy, content_spec=content_spec, preferred_categories=["short_drama_structure", "story_structure_and_serialization", "character_design", "conflict_and_emotion"], max_items=8)}
Reference materials:
{StoryPlanningService._reference_material_context(payload.reference_materials, max_characters=12_000)}
Approved interactive framework:
{json.dumps(raw, ensure_ascii=False, indent=2)[:60_000]}
Author supplements by question:
{json.dumps(author_notes, ensure_ascii=False, indent=2)[:12_000]}

Return a complete StoryBibleGenerationOutput. Keep the approved fields semantically unchanged and
ensure all character, relationship, story-line, and escalation references are coherent.
Do not assign episode numbers or return episode plans; this artifact is the whole-story Story Bible.
Keep it at development-outline level: compact premise, goal, conflict, ending, essential characters,
relationships, whole-story lines, broad escalation milestones, and concise guardrails. Do not expand
approved choices into scenes, episode beats, dialogue, detailed biographies, or a complete chronology;
those details belong to the recursive story tree and episode roadmap.
All human-readable output values must be written in Simplified Chinese."""
        try:
            generated = self._generate_story_bible_model_output(
                synthesis_prompt,
                strategy=story_bible_strategy,
                output_schema=StoryBibleGenerationOutput.model_json_schema(),
                stage="interactive_synthesis",
            )
            normalized = story_bible_payload_for_validation(generated, supplied_characters=[])
            output = StoryBibleGenerationOutput.model_validate(normalized)
        except (ValidationError, LLMStructuredOutputError) as first_error:
            try:
                output = StoryBibleGenerationOutput.model_validate(normalized_approved)
            except ValidationError as fallback_error:
                logger.warning(
                    "Interactive Story Bible synthesis and approved framework both "
                    "failed; using deterministic fallback synthesis first_error=%s "
                    "fallback_error=%s",
                    str(first_error)[:500],
                    self._validation_error_summary(fallback_error),
                )
                output = deterministic_interactive_story_bible_fallback(
                    normalized_approved,
                    project_title=project.title,
                )
        generated_output = output
        try:
            output = merge_interactive_story_bible_framework(output, normalized_approved)
        except ValidationError as merge_error:
            # The generated candidate is already schema-valid. This final
            # guard prevents a malformed historical checkpoint from turning a
            # successful model response into a user-visible 422.
            logger.warning(
                "Interactive Story Bible dependency-safe merge still failed; "
                "retaining generated candidate errors=%s",
                self._validation_error_summary(merge_error),
            )
            output = generated_output
        if not output.project_title:
            output = output.model_copy(update={"project_title": project.title})
        output = self._ensure_short_drama_escalation_ladder(output)
        return self._save_generated_story_bible(
            StoryBible(
                story_bible_id=self._story_bible_id(payload.story_project_id),
                story_project_id=payload.story_project_id,
                content_spec_id=payload.content_spec_id,
                market_profile=content_spec_market_profile(content_spec),
                version=1,
                project_title=output.project_title,
                core_premise=output.core_premise,
                series_goal=output.series_goal,
                theme=output.theme,
                central_conflict=output.central_conflict,
                ending_direction=output.ending_direction,
                world_rules=output.world_rules,
                character_refs=output.character_refs,
                character_registry=output.character_registry,
                character_arc_targets=output.character_arc_targets,
                relationships=output.relationships,
                story_lines=output.story_lines,
                escalation_stages=output.escalation_stages,
                major_setup_payoff_refs=output.major_setup_payoff_refs,
                locked_facts=output.locked_facts,
                avoid_patterns=output.avoid_patterns,
                imported_source_document=(
                    _source_document_from_parts(
                        payload.creative_prompt,
                        payload.reference_materials,
                    )
                    if payload.preserve_source_document
                    else None
                ),
            )
        )
````

片段 SHA-256：`b9ff512eeca0c9f0a4528852bd4cce2d5c21712abde4345158ca8ad63c2f9db9`
