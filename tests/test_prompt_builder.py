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
