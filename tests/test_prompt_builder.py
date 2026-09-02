import json

from app.modules.script_engine.models import GenerationStrategy, PromptBuildContext, PromptLibraryItem
from app.modules.script_engine.prompt_builder import TemplatePromptBuilder


def build_prompt_item() -> dict:
    return {
        "id": "prompt.story_planning.v1",
        "name": "Story Planning Prompt",
        "prompt_type": "story_planning",
        "target_module": "script_engine",
        "applicable_tags": ["genre.romance", "theme.revenge"],
        "target_platform": "tiktok",
        "target_audience": "women 18-34",
        "version": "v1",
        "prompt_template": "Plan a script for {content_spec_title} using {creative_brief_summary}.",
        "input_variables": ["content_spec_title", "creative_brief_summary"],
        "output_schema": {"type": "object"},
        "evaluation_notes": ["Keep the first hook within 3 seconds."],
    }


def build_strategy() -> dict:
    return {
        "id": "strategy.tiktok.master_script.v1",
        "name": "TikTok Master Script Strategy",
        "target_platform": "tiktok",
        "target_content_type": "ai_comic_drama",
        "applicable_tags": ["genre.romance"],
        "model_provider": "mock",
        "model_name": "mock-script-generator",
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 4000,
        "workflow_steps": [
            {
                "step_order": 1,
                "name": "story_planning",
                "description": "Build the initial story plan.",
                "prompt_id": "prompt.story_planning.v1",
            }
        ],
        "prompt_ids": ["prompt.story_planning.v1"],
        "qc_enabled": True,
        "self_check_enabled": True,
        "human_review_required": False,
        "output_schema": {"type": "object", "properties": {"title": {"type": "string"}}},
        "version": "v1",
        "status": "active",
    }


def test_template_prompt_builder_builds_traceable_prompt() -> None:
    builder = TemplatePromptBuilder(builder_version="v0.test")
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    strategy = GenerationStrategy.model_validate(build_strategy())
    context = PromptBuildContext.model_validate(
        {
            "content_spec_id": "content_spec_001",
            "content_spec_title": "Fake Marriage Revenge Arc",
            "creative_brief_summary": "Build a high-retention revenge romance with a wedding hook.",
            "platform_profile_id": "tiktok_v1",
            "audience_profile_summary": "Women 18-34 who like melodrama.",
            "commercial_goal_summary": "Maximize retention and episode continuation intent.",
            "retrieved_asset_ids": ["asset.story.fake_marriage_001"],
            "generation_strategy_id": strategy.id,
        }
    )

    result = builder.build_master_prompt(
        prompts=[prompt],
        context=context,
        strategy=strategy,
    )

    assert "Fake Marriage Revenge Arc" in result.prompt_text
    assert "[structured_context]" in result.prompt_text
    assert "OutputJsonSchema:" in result.prompt_text
    assert "SceneCausalityContract:" in result.prompt_text
    assert "scene_causality.goal" in result.prompt_text
    assert "scene_causality.conflict" in result.prompt_text
    assert "scene_causality.outcome" in result.prompt_text
    assert "Every later scene must reference an earlier scene number" in result.prompt_text
    forbidden_plot_terms = [
        "wedding",
        "groom",
        "betrayal",
        "livestream",
        "missing relative",
        "missing-relative",
        "missing sister",
    ]
    contract = result.prompt_text.split("SceneCausalityContract:", maxsplit=1)[1]
    assert all(term not in contract.casefold() for term in forbidden_plot_terms)
    assert result.trace.builder_version == "v0.test"
    assert result.trace.prompt_ids == ["prompt.story_planning.v1"]
    assert "ResolvedCreativeContext:" not in result.prompt_text


def test_partner_screenplay_contract_requires_interleaved_body_order() -> None:
    builder = TemplatePromptBuilder(builder_version="v0.test")
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    strategy = GenerationStrategy.model_validate(build_strategy())
    context = PromptBuildContext.model_validate(
        {
            "content_spec_id": "content_spec_001",
            "content_spec_title": "仓库对峙",
            "creative_brief_summary": "用一次逼问揭开账本被调包的事实。",
            "platform_profile_id": "tiktok_v1",
            "audience_profile_summary": "短剧观众",
            "commercial_goal_summary": "推动追看",
            "generation_strategy_id": strategy.id,
            "extra_variables": {"output_language": "zh"},
        }
    )

    result = builder.build_master_prompt(
        prompts=[prompt],
        context=context,
        strategy=strategy,
    )

    assert "partner_screenplay.v1" in result.prompt_text
    assert "body_order" in result.prompt_text
    assert "不能先列完全部动作再集中列全部对白" in result.prompt_text


def test_template_prompt_builder_injects_only_resolved_creative_context() -> None:
    builder = TemplatePromptBuilder(builder_version="v0.test")
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    strategy = GenerationStrategy.model_validate(build_strategy())
    resolved_context = {
        "schema_version": "v1",
        "content_spec_id": "content_spec_001",
        "characters": [
            {
                "character_ref": "character.lena",
                "name": "Lena",
                "role": "protagonist",
                "desire": "Discover the truth",
                "belief": "Technology must be understood before trusted",
                "moral_boundaries": ["Never sacrifice humans for progress"],
                "locked_fields": ["name", "moral_boundaries"],
                "field_sources": {
                    "name": "user_provided",
                    "role": "user_provided",
                    "desire": "user_provided",
                    "belief": "ai_inferred",
                    "moral_boundaries": "user_provided",
                },
            }
        ],
        "excluded_tag_ids": ["relationship.love_triangle"],
        "excluded_patterns": ["love triangle"],
        "resolution_warnings": [],
    }
    context = PromptBuildContext.model_validate(
        {
            "content_spec_id": "content_spec_001",
            "content_spec_title": "AI Mystery",
            "creative_brief_summary": "The system concealed a warning.",
            "platform_profile_id": "tiktok_v1",
            "audience_profile_summary": "Adult mystery viewers",
            "commercial_goal_summary": "Build continuation intent",
            "generation_strategy_id": strategy.id,
            "extra_variables": {
                "resolved_creative_context_json": json.dumps(resolved_context),
            },
        }
    )

    result = builder.build_master_prompt(
        prompts=[prompt],
        context=context,
        strategy=strategy,
    )

    assert "ResolvedCreativeContext:" in result.prompt_text
    assert "CreativeContextUsage:" in result.prompt_text
    assert "Never sacrifice humans for progress" in result.prompt_text
    assert '"belief": "ai_inferred"' in result.prompt_text
    assert "Preserve locked fields" in result.prompt_text


def test_template_prompt_builder_keeps_chinese_json_context_compact() -> None:
    builder = TemplatePromptBuilder(builder_version="v0.test")
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    strategy = GenerationStrategy.model_validate(build_strategy())
    context = PromptBuildContext.model_validate(
        {
            "content_spec_id": "content_spec_001",
            "content_spec_title": "长篇悬疑",
            "creative_brief_summary": "调查母亲死亡真相",
            "platform_profile_id": "cn_mainland_comic_drama_v1",
            "audience_profile_summary": "中国大陆漫剧受众",
            "commercial_goal_summary": "持续追更",
            "generation_strategy_id": strategy.id,
            "extra_variables": {
                "episode_context_json": json.dumps(
                    {
                        "episode_number": 1,
                        "episode_instruction": "从母亲遗物切入调查。",
                    },
                    ensure_ascii=True,
                ),
            },
        }
    )

    result = builder.build_master_prompt(
        prompts=[prompt],
        context=context,
        strategy=strategy,
    )

    assert "从母亲遗物切入调查" in result.prompt_text
    assert "\\u4ece\\u6bcd\\u4eb2" not in result.prompt_text


def test_template_prompt_builder_supports_longform_prompt_over_30000_characters() -> None:
    builder = TemplatePromptBuilder(builder_version="v0.test")
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    strategy = GenerationStrategy.model_validate(build_strategy())
    context = PromptBuildContext.model_validate(
        {
            "content_spec_id": "content_spec_longform",
            "content_spec_title": "长篇故事",
            "creative_brief_summary": "保持连续性",
            "platform_profile_id": "cn_mainland_comic_drama_v1",
            "audience_profile_summary": "中国大陆漫剧受众",
            "commercial_goal_summary": "长篇持续追更",
            "generation_strategy_id": strategy.id,
            "extra_variables": {
                "episode_context_json": json.dumps(
                    {"project_continuity_summary": "剧情状态" * 8_000},
                    ensure_ascii=False,
                ),
            },
        }
    )

    result = builder.build_master_prompt(
        prompts=[prompt],
        context=context,
        strategy=strategy,
    )

    assert len(result.prompt_text) > 30_000


def test_template_prompt_builder_injects_bounded_knowledge_bundle() -> None:
    builder = TemplatePromptBuilder(builder_version="v0.test")
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    strategy_payload = build_strategy()
    strategy_payload["draft_knowledge_bundle_id"] = (
        "knowledge_bundle.draft.dark_romance_tiktok.v1"
    )
    strategy = GenerationStrategy.model_validate(strategy_payload)
    knowledge_payload = {
        "bundle_id": "knowledge_bundle.draft.dark_romance_tiktok.v1",
        "version": "v1",
        "knowledge_items": [
            {
                "knowledge_id": "knowledge.character.choice_reveals_character.v1",
                "version": "v1",
                "category": "character_design",
                "principle": "Reveal character through consequential choices.",
                "application_rules": ["Give the choice a visible consequence."],
                "limitations": ["Do not make every choice irreversible."],
                "anti_patterns": ["Do not state agency without an action."],
            }
        ],
    }
    context = PromptBuildContext.model_validate(
        {
            "content_spec_id": "content_spec_001",
            "content_spec_title": "Bounded Knowledge Draft",
            "creative_brief_summary": "Build conflict through visible choices.",
            "platform_profile_id": "tiktok_v1",
            "audience_profile_summary": "Adult romance viewers",
            "commercial_goal_summary": "Build continuation intent",
            "generation_strategy_id": strategy.id,
            "extra_variables": {
                "knowledge_bundle_json": json.dumps(knowledge_payload),
            },
        }
    )

    result = builder.build_master_prompt(
        prompts=[prompt],
        context=context,
        strategy=strategy,
    )

    assert "CreativeKnowledgeUsage:" in result.prompt_text
    assert "CreativeKnowledgeBundle:" in result.prompt_text
    assert "Reveal character through consequential choices" in result.prompt_text
    assert "Do not make every choice irreversible" in result.prompt_text
    assert "Do not state agency without an action" in result.prompt_text


def test_template_prompt_builder_injects_flexible_script_body_range() -> None:
    builder = TemplatePromptBuilder(builder_version="v0.3-test")
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    strategy = GenerationStrategy.model_validate(build_strategy())
    context = PromptBuildContext.model_validate(
        {
            "content_spec_id": "content_spec_001",
            "content_spec_title": "Long-form body target",
            "creative_brief_summary": "Sustain a causal serialized episode.",
            "platform_profile_id": "mainland_v1",
            "audience_profile_summary": "Mainland serialized comic audience",
            "commercial_goal_summary": "Build a durable long-form story",
            "generation_strategy_id": strategy.id,
            "extra_variables": {
                "target_script_body_characters": "1797",
                "desired_scene_count": "3",
            },
        }
    )

    result = builder.build_master_prompt(
        prompts=[prompt],
        context=context,
        strategy=strategy,
    )

    assert "ScriptBodyLengthContract:" in result.prompt_text
    assert "TargetScriptBodyCharacters: 1797" in result.prompt_text
    assert "reference midpoint" in result.prompt_text
    assert "1258-2516 effective characters" in result.prompt_text
    assert "There is no per-scene character quota" in result.prompt_text
    assert "plot movement" in result.prompt_text
    assert "character_actions and dialogues.text" in result.prompt_text
    assert "Do not add or repeat content to reach the midpoint" in result.prompt_text


def test_template_prompt_builder_requires_mainland_production_script_body() -> None:
    builder = TemplatePromptBuilder(builder_version="v0.3-test")
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    strategy = GenerationStrategy.model_validate(build_strategy())
    context = PromptBuildContext.model_validate(
        {
            "content_spec_id": "content_spec_mainland_001",
            "content_spec_title": "中国大陆长篇漫剧",
            "creative_brief_summary": "以可视化行动推进每一场戏。",
            "platform_profile_id": "cn_mainland_comic_drama_v1",
            "audience_profile_summary": "中国大陆漫剧受众",
            "commercial_goal_summary": "形成可持续的长篇追更动力",
            "generation_strategy_id": strategy.id,
            "extra_variables": {"output_language": "zh"},
        }
    )

    result = builder.build_master_prompt(
        prompts=[prompt],
        context=context,
        strategy=strategy,
    )

    assert "PartnerScreenplayDeliveryContract:" in result.prompt_text
    assert "不写小说、提纲、分集计划或框架" in result.prompt_text
    assert "人物名和人物对白直接使用简体中文" in result.prompt_text
    assert "不得生成英文人物名、英文对白或中英对照" in result.prompt_text
    assert "不得少于75秒、不得超过115秒" in result.prompt_text
    assert "优先落在90至105秒安全区" in result.prompt_text
    assert "中文对白约每秒4.2个汉字" in result.prompt_text
    assert "英文对白约每秒2.7个自然口语词" in result.prompt_text
    assert "每集场景总数必须为1至5个" in result.prompt_text
    assert "一场可以完成本集时不得强行拆场" in result.prompt_text
    assert "scene_execution_plan" in result.prompt_text
    assert "approved_episode_plan.layer_contracts" in result.prompt_text
    assert "冲突-决定-局部回报-压力升级-退出状态因果链" in result.prompt_text
    assert "不得重新设计场景结构" in result.prompt_text
    assert "INT.或EXT." in result.prompt_text
    assert "（O.S.）、（V.O.）" in result.prompt_text
    assert "写完整的竖屏短剧执行稿" in result.prompt_text
    assert "对白采用短剧所需的短句" in result.prompt_text
    assert "整部作品的目标成片总时长不少于100分钟" in result.prompt_text
    assert "通常安排2至3次短循环" in result.prompt_text
    assert "character_actions" in result.prompt_text
    assert "dialogues" in result.prompt_text
    assert "统一添加△" in result.prompt_text
    assert "不写特写、镜头推进等镜头语言" in result.prompt_text
    assert "character_actions合计必须为15至20项" in result.prompt_text
    assert "dialogues合计必须为25至35条" in result.prompt_text
    assert "不得拆句、重复或添加解释性台词凑数" in result.prompt_text
    assert "LedgerCompressionContract:" in result.prompt_text
    assert "normally no more than 80 visible characters" in result.prompt_text
    assert "Compression must never omit a material death" in result.prompt_text
    assert "SerialEpisodeHookContract:" in result.prompt_text
    assert "previous_episode_question" in result.prompt_text
    assert "For every non-final episode" in result.prompt_text
    assert "For the series finale" in result.prompt_text
    assert "每项是一个可独立拍摄" in result.prompt_text


def test_partner_delivery_contract_localizes_only_overseas_dialogue_path() -> None:
    builder = TemplatePromptBuilder(builder_version="v0.3-test")
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    strategy = GenerationStrategy.model_validate(build_strategy())
    context = PromptBuildContext.model_validate(
        {
            "content_spec_id": "content_spec_overseas_001",
            "content_spec_title": "Overseas short drama",
            "creative_brief_summary": "Escalate a visible betrayal.",
            "platform_profile_id": "overseas_tiktok_v1",
            "audience_profile_summary": "US vertical drama viewers",
            "commercial_goal_summary": "Sustain episodic viewing",
            "generation_strategy_id": strategy.id,
            "extra_variables": {
                "output_language": "en",
                "target_duration_seconds": "108",
            },
        }
    )

    result = builder.build_master_prompt(
        prompts=[prompt],
        context=context,
        strategy=strategy,
    )

    assert "PartnerScreenplayDeliveryContract:" in result.prompt_text
    assert "所有可见叙事字段统一使用简体中文" in result.prompt_text
    assert "动作中提到人物时只用对应中文名" in result.prompt_text
    assert "character_name使用稳定英文名" in result.prompt_text
    assert "中文名（ENGLISH NAME）" in result.prompt_text
    assert "dialogues.text使用自然英文" in result.prompt_text
    assert "dialogues.chinese_translation" in result.prompt_text
    assert "OutputLanguage=en仅表示dialogues.text使用英文" in result.prompt_text
    assert "dialogues.chinese_character_name写该说话人的稳定中文名" in result.prompt_text
    assert "在同一次输出中写该句准确、自然的简体中文对照" in result.prompt_text
    assert "characters中的name、role、description、motivation全部只用简体中文" in result.prompt_text
    assert "绝不能据此新建重复人物" in result.prompt_text
    assert "写完整的竖屏短剧执行稿" in result.prompt_text
    assert "对白采用短剧所需的短句" in result.prompt_text
    assert "TargetDurationSeconds: 108" in result.prompt_text
    assert "不得少于75秒、不得超过115秒" in result.prompt_text
