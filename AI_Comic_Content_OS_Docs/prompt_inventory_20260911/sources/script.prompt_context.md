# 正文输入资料与动态合同装配

编号：`script.prompt_context`。状态：`默认主链`。

来源：[backend/app/modules/script_engine/generation_service.py:2439](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:2439)。符号：`ScriptGenerationService._build_prompt_context`。

输入装配而非独立模型请求；保留其动态边界文字与上下文选择。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 长文本阅读视图

按源码位置列出长字符串；静态文本按字符串值显示，花括号内动态表达式仅供识别，未执行。条件分支分别列出，不代表一次调用全部生效。短标签、拼装顺序和完整条件见后面的源码原文。

### 片段 1 · 源码第 2485 行

````text
Return one JSON object with these top-level fields in this order when possible: title, logline, synopsis, hook, target_audience, target_platform, language, tone, episode_goal, target_duration_seconds, ending_mode, characters, scenes, character_state_updates, relationship_state_updates, continuity_state_updates, story_line_updates, setup_payoff_updates, continuation_hook, next_episode_question. The API response_format supplies the exact field types and enum constraints. Keep technical enum values in the schema's English form, numeric fields as whole integers, and array fields as arrays even when visible narrative text is Chinese.
````

### 片段 2 · 源码第 2565 行

````text
ending_mode=series_finale；完成主要因果与情绪收束；最后场景可以没有cliffhanger，next_episode_question可以为null。
````

### 片段 3 · 源码第 2570 行

````text
ending_mode=season_finale；完成本季主要结算，可保留下一季入口；不得用无关突发事件制造尾钩。
````

### 片段 4 · 源码第 2574 行

````text
ending_mode=serial_hook；非最终集必须由本集因果产生下一集承接义务。
````

### 片段 5 · 源码第 2590 行

````text
完成批准的本集正式收束和可见后果；不要为了满足通用钩子要求制造无关悬念。
````

### 片段 6 · 源码第 2595 行

````text
The protagonist must make a visible choice, refusal, or public move.
````

### 片段 7 · 源码第 2598 行

````text
Write for {content_spec.audience_goal.summary} in {output_language} with clear, export-ready language.
````

### 片段 8 · 源码第 2625 行

````text
resolved_creative_context_json
````

### 片段 9 · 源码第 2661 行

````text
source_draft_master_script_json
````

### 片段 10 · 源码第 2668 行

````text
document_selection_context_json
````

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    def _build_prompt_context(
        self,
        *,
        content_spec,
        platform_profile,
        generation_strategy: GenerationStrategy,
        retrieval_result: RetrievalPlanResult,
        desired_scene_count: int,
        target_script_body_characters: int | None = None,
        output_language: str,
        target_episode_duration_seconds: int | None = None,
        resolved_creative_context: ResolvedCreativeContext | None,
        knowledge_bundle: KnowledgeBundle | None,
        knowledge_items: list[StaticKnowledgeItem],
        episode_context: EpisodeGenerationContext | None = None,
        source_draft_master_script: DraftMasterScript | None = None,
        modification_instruction: str | None = None,
        selection_context: StoryBibleSelectionContext | None = None,
    ) -> PromptBuildContext:
        retrieved_assets = [
            {
                "request_id": resolved.request_id,
                "asset_type": resolved.asset_type,
                "candidates": [
                    {
                        "asset_id": candidate.asset_id,
                        "asset_type": candidate.asset_type,
                        "score": candidate.score,
                        "title": candidate.title,
                        "matched_required_tag_ids": candidate.matched_required_tag_ids,
                        "matched_optional_tag_ids": candidate.matched_optional_tag_ids,
                    }
                    for candidate in resolved.candidates
                ],
            }
            for resolved in retrieval_result.resolved_requests
        ]
        retrieved_asset_ids = [
            candidate.asset_id
            for resolved in retrieval_result.resolved_requests
            for candidate in resolved.candidates[:1]
        ]
        # The provider receives the full schema through response_format/json_schema.
        # Repeating that large schema in the prompt slows every episode and increases
        # the chance that the model copies schema noise into the screenplay.
        output_schema = (
            "Return one JSON object with these top-level fields in this order when possible: "
            "title, logline, synopsis, hook, target_audience, target_platform, language, tone, "
            "episode_goal, target_duration_seconds, ending_mode, characters, scenes, character_state_updates, "
            "relationship_state_updates, continuity_state_updates, story_line_updates, "
            "setup_payoff_updates, continuation_hook, next_episode_question. "
            "The API response_format supplies the exact field types and enum constraints. "
            "Keep technical enum values in the schema's English form, numeric fields as "
            "whole integers, and array fields as arrays even when visible narrative text "
            "is Chinese."
        )
        # Episode prompts already carry the episode route, bible, and continuity
        # checkpoint. Keep invariant configuration compact so every episode does
        # not pay to re-read timestamps, model knobs, prompt ids, and duplicated
        # platform rule objects.
        is_episode_generation = episode_context is not None
        if is_episode_generation:
            content_spec_payload = {
                "id": content_spec.id,
                "title": content_spec.title,
                "audience_goal": content_spec.audience_goal.model_dump(mode="json"),
                "commercial_goal": content_spec.commercial_goal.model_dump(mode="json"),
                "platform_goal": content_spec.platform_goal.model_dump(mode="json"),
                "story_goal": content_spec.story_goal,
                "quality_level": content_spec.quality_level,
                "budget_level": content_spec.budget_level,
                "tags": [
                    {
                        "ontology_node_id": tag.ontology_node_id,
                        "label": tag.label,
                        "category": tag.category,
                    }
                    for tag in content_spec.tags
                ],
                "metadata": content_spec.metadata,
            }
            platform_profile_payload = {
                "id": platform_profile.id,
                "platform_name": platform_profile.platform_name,
                "version": platform_profile.version,
                "content_mode": platform_profile.content_mode,
                "primary_regions": platform_profile.primary_regions,
                "supported_aspect_ratios": platform_profile.supported_aspect_ratios,
            }
            generation_strategy_payload = {
                "id": generation_strategy.id,
                "name": generation_strategy.name,
                "target_platform": generation_strategy.target_platform,
                "target_content_type": generation_strategy.target_content_type,
                "applicable_tags": generation_strategy.applicable_tags,
                "version": generation_strategy.version,
            }
        else:
            content_spec_payload = content_spec.model_dump(mode="json")
            platform_profile_payload = platform_profile.model_dump(mode="json")
            generation_strategy_payload = generation_strategy.model_dump(mode="json")

        extra_variables = {
            "content_spec_json": json.dumps(
                content_spec_payload,
                ensure_ascii=True,
            ),
            "creative_brief_json": json.dumps(
                content_spec.creative_brief.model_dump(mode="json"),
                ensure_ascii=True,
            ),
            "platform_profile_json": json.dumps(
                platform_profile_payload,
                ensure_ascii=True,
            ),
            "market_profile_contract": content_spec_market_contract(content_spec).prompt_contract,
            "retrieved_assets_json": json.dumps(
                retrieved_assets,
                ensure_ascii=True,
            ),
            "generation_strategy_json": json.dumps(
                generation_strategy_payload,
                ensure_ascii=True,
            ),
            "output_language": output_language,
            "ending_mode_contract": (
                "ending_mode=series_finale；完成主要因果与情绪收束；"
                "最后场景可以没有cliffhanger，next_episode_question可以为null。"
                if episode_context is not None
                and episode_context.ending_mode.value == "series_finale"
                else (
                    "ending_mode=season_finale；完成本季主要结算，可保留下一季入口；"
                    "不得用无关突发事件制造尾钩。"
                    if episode_context is not None
                    and episode_context.ending_mode.value == "season_finale"
                    else "ending_mode=serial_hook；非最终集必须由本集因果产生下一集承接义务。"
                )
            ),
            "desired_scene_count": str(desired_scene_count),
            "target_duration_seconds": str(
                self._delivery_target_duration_seconds(
                    requested=target_episode_duration_seconds,
                    fallback=content_spec.platform_goal.target_duration_seconds,
                )
            ),
            "hook_requirement": content_spec.creative_brief.hook,
            "cliffhanger_requirement": (
                content_spec.story_goal
                if episode_context is None
                or ending_mode_requires_hook(episode_context.ending_mode)
                else (
                    "完成批准的本集正式收束和可见后果；不要为了满足通用钩子要求"
                    "制造无关悬念。"
                )
            ),
            "character_agency_requirement": (
                "The protagonist must make a visible choice, refusal, or public move."
            ),
            "cultural_fit_requirement": (
                f"Write for {content_spec.audience_goal.summary} in {output_language} "
                "with clear, export-ready language."
            ),
            "platform_constraints": json.dumps(
                {
                    "platform_name": platform_profile.platform_name,
                    "best_practices": [
                        rule.summary for rule in platform_profile.best_practices
                    ],
                    "recommendation_rules": [
                        rule.summary
                        for rule in platform_profile.recommendation_rules
                    ],
                    "ai_policies": [rule.summary for rule in platform_profile.ai_policies],
                    "community_guidelines": [
                        rule.summary for rule in platform_profile.community_guidelines
                    ],
                },
                ensure_ascii=True,
            ),
            "output_json_schema": output_schema,
        }
        if target_script_body_characters is not None:
            extra_variables["target_script_body_characters"] = str(
                target_script_body_characters
            )
        if resolved_creative_context is not None:
            extra_variables["resolved_creative_context_json"] = json.dumps(
                resolved_creative_context.model_dump(mode="json"),
                ensure_ascii=True,
            )
        if knowledge_bundle is not None:
            extra_variables["knowledge_bundle_json"] = json.dumps(
                {
                    "bundle_id": knowledge_bundle.bundle_id,
                    "version": knowledge_bundle.version,
                    "knowledge_items": [
                        {
                            "knowledge_id": item.knowledge_id,
                            "version": item.version,
                            "category": item.category,
                            "principle": item.principle,
                            "application_rules": item.application_rules,
                            "limitations": item.limitations,
                            "anti_patterns": item.anti_patterns,
                        }
                        for item in knowledge_items
                    ],
                },
                ensure_ascii=True,
            )
        if episode_context is not None:
            episode_context_payload = self._episode_execution_context_payload(
                episode_context,
                model_context_tokens=(
                    self._llm_adapter.get_model_info().max_context_tokens
                ),
            )
            extra_variables["episode_context_json"] = json.dumps(
                episode_context_payload,
                ensure_ascii=True,
            )
        if source_draft_master_script is not None:
            extra_variables["source_draft_master_script_json"] = json.dumps(
                source_draft_master_script.model_dump(mode="json"),
                ensure_ascii=True,
            )
        if modification_instruction is not None:
            extra_variables["user_modification_instruction"] = modification_instruction
        if selection_context is not None:
            extra_variables["document_selection_context_json"] = json.dumps(
                selection_context.model_dump(mode="json"),
                ensure_ascii=True,
            )
        return PromptBuildContext(
            content_spec_id=content_spec.id,
            content_spec_title=content_spec.title,
            creative_brief_summary=content_spec.creative_brief.hook,
            platform_profile_id=content_spec.platform_goal.platform_profile_id,
            audience_profile_summary=content_spec.audience_goal.summary,
            commercial_goal_summary=content_spec.commercial_goal.summary,
            retrieved_asset_ids=retrieved_asset_ids,
            generation_strategy_id=generation_strategy.id,
            extra_variables=extra_variables,
        )
````

片段 SHA-256：`e94ceea606e9936f75fd5673ec9cdc20dea847f3385968cfe00a7e43168a3c77`
