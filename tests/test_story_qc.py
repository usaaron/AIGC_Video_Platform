from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.story_qc import PlaceholderStoryQC


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


def test_placeholder_story_qc_returns_report() -> None:
    qc = PlaceholderStoryQC()
    strategy = GenerationStrategy.model_validate(build_strategy())
    report = qc.evaluate(
        {
            "hook": "She married him before she learned his real name.",
            "scenes": [{"scene_number": 1}],
        },
        strategy=strategy,
    )

    assert report.status.value == "placeholder"
    assert report.overall_score > 0.0
    assert len(report.checks) == 4
    assert report.rubric_overall_score is not None
    assert len(report.rubric_categories) >= 1
