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
