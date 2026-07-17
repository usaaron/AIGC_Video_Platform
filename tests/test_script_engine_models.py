import pytest
from pydantic import ValidationError

from app.modules.script_engine.models import (
    GenerationStrategy,
    PromptLibraryItem,
    PromptRetrievalResult,
    RevisionPlan,
    ScriptRevisionRun,
    StoryQCReport,
)


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


def test_prompt_library_item_accepts_valid_payload() -> None:
    model = PromptLibraryItem.model_validate(build_prompt_item())
    assert model.prompt_type.value == "story_planning"


def test_prompt_library_item_rejects_duplicate_applicable_tags() -> None:
    payload = build_prompt_item()
    payload["applicable_tags"] = ["genre.romance", "genre.romance"]

    with pytest.raises(ValidationError, match="List values must be unique"):
        PromptLibraryItem.model_validate(payload)


def test_generation_strategy_accepts_valid_payload() -> None:
    model = GenerationStrategy.model_validate(build_strategy())
    assert model.workflow_steps[0].prompt_id == "prompt.story_planning.v1"


def test_generation_strategy_rejects_unknown_workflow_prompt_reference() -> None:
    payload = build_strategy()
    payload["workflow_steps"][0]["prompt_id"] = "prompt.missing"

    with pytest.raises(
        ValidationError,
        match="Workflow step prompt_id values must exist in prompt_ids",
    ):
        GenerationStrategy.model_validate(payload)


def test_prompt_retrieval_result_accepts_valid_payload() -> None:
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    model = PromptRetrievalResult.model_validate(
        {
            "generation_strategy_id": "strategy.tiktok.master_script.v1",
            "strategy_name": "TikTok Master Script Strategy",
            "prompt_ids": ["prompt.story_planning.v1"],
            "prompts": [prompt.model_dump()],
            "retrieval_mode": "exact_ids",
            "notes": ["Resolve prompt assets by exact ids."],
        }
    )
    assert model.prompts[0].id == "prompt.story_planning.v1"


def test_prompt_retrieval_result_rejects_duplicate_prompt_ids() -> None:
    prompt = PromptLibraryItem.model_validate(build_prompt_item())

    with pytest.raises(ValidationError, match="List values must be unique"):
        PromptRetrievalResult.model_validate(
            {
                "generation_strategy_id": "strategy.tiktok.master_script.v1",
                "strategy_name": "TikTok Master Script Strategy",
                "prompt_ids": ["prompt.story_planning.v1", "prompt.story_planning.v1"],
                "prompts": [prompt.model_dump()],
                "retrieval_mode": "exact_ids",
                "notes": ["Resolve prompt assets by exact ids."],
            }
        )


def test_story_qc_report_accepts_rubric_categories() -> None:
    model = StoryQCReport.model_validate(
        {
            "overall_score": 0.72,
            "status": "placeholder",
            "checks": [
                {
                    "check_name": "hook_present",
                    "passed": True,
                    "score": 1.0,
                    "note": "Hook exists.",
                }
            ],
            "recommended_actions": ["Build a revision plan from rubric deductions."],
            "rubric_overall_score": 0.68,
            "rubric_categories": [
                {
                    "category_name": "Dialogue Quality",
                    "score": 2.0,
                    "max_score": 5,
                    "deduction_reasons": ["Draft uses prompts instead of final dialogue lines."],
                    "revision_suggestions": ["Replace generic lines with concrete, high-stakes phrasing."],
                }
            ],
        }
    )
    assert model.rubric_categories[0].category_name == "Dialogue Quality"


def test_revision_plan_accepts_valid_payload() -> None:
    model = RevisionPlan.model_validate(
        {
            "draft_master_script_id": "draft.master_script.demo",
            "content_spec_id": "content_spec.demo",
            "generation_strategy_id": "strategy.tiktok.master_script.v1",
            "story_qc_status": "placeholder",
            "overall_priority": "high",
            "focus_summary": "Strengthen hook; Strengthen dialogue quality",
            "actions": [
                {
                    "action_id": "revision.draft.master_script.demo.hook",
                    "target_type": "hook",
                    "priority": "high",
                    "title": "Strengthen hook",
                    "rationale": "Hook is too short or non-specific.",
                    "based_on_checks": ["hook_present"],
                    "related_scene_numbers": [1],
                    "instructions": [
                        "Strengthen the opening reveal or contradiction.",
                        "Fix issue: Hook is too short or non-specific.",
                    ],
                    "expected_impact": "Improves first-second stopping power and replay intent.",
                }
            ],
            "must_re_qc": True,
            "notes": ["Re-run Story QC after revisions."],
        }
    )
    assert model.actions[0].target_type.value == "hook"


def test_script_revision_run_accepts_valid_payload() -> None:
    model = ScriptRevisionRun.model_validate(
        {
            "original_draft_master_script": {
                "id": "draft.master_script.demo",
                "content_spec_id": "content_spec.demo",
                "generation_strategy_id": "strategy.tiktok.master_script.v1",
                "title": "Draft Title",
                "language": "en",
                "tone": "intense",
                "hook": "She recognized the groom too late.",
                "synopsis": "A public marriage trap starts collapsing.",
                "episode_goal": "End on a social cliffhanger.",
                "target_duration_seconds": 40,
                "scenes": [
                    {
                        "scene_number": 1,
                        "slug": "SCENE 1 - HOOK",
                        "purpose": "Open the trap.",
                        "setting_hint": "Wedding hall",
                        "beat_summary": "Start with pressure.",
                        "emotional_shift": "fear_to_revenge",
                        "cliffhanger": False,
                        "dialogue_prompts": ["Open with contradiction."],
                        "supporting_asset_ids": ["scene.wedding_set"],
                    },
                    {
                        "scene_number": 2,
                        "slug": "SCENE 2 - CLIFFHANGER",
                        "purpose": "Expose the secret.",
                        "setting_hint": "Wedding hall",
                        "beat_summary": "Flip the power.",
                        "emotional_shift": "shock_to_suspense",
                        "cliffhanger": True,
                        "dialogue_prompts": ["End with an unanswered question."],
                        "supporting_asset_ids": ["scene.wedding_set"],
                    },
                ],
                "qa_notes": ["Draft only."],
                "llm_metadata": {"provider": "mock"},
            },
            "revision_plan": {
                "draft_master_script_id": "draft.master_script.demo",
                "content_spec_id": "content_spec.demo",
                "generation_strategy_id": "strategy.tiktok.master_script.v1",
                "story_qc_status": "placeholder",
                "overall_priority": "high",
                "focus_summary": "Strengthen hook",
                "actions": [
                    {
                        "action_id": "revision.draft.master_script.demo.hook",
                        "target_type": "hook",
                        "priority": "high",
                        "title": "Strengthen hook",
                        "rationale": "Hook is too short or non-specific.",
                        "based_on_checks": ["hook_present"],
                        "related_scene_numbers": [1],
                        "instructions": ["Strengthen the opening reveal or contradiction."],
                        "expected_impact": "Improves first-second stopping power and replay intent.",
                    }
                ],
                "must_re_qc": True,
                "notes": ["Re-run Story QC after revisions."],
            },
            "revised_draft_master_script": {
                "id": "draft.master_script.demo",
                "content_spec_id": "content_spec.demo",
                "generation_strategy_id": "strategy.tiktok.master_script.v1",
                "title": "Draft Title",
                "language": "en",
                "tone": "intense",
                "hook": "She recognized the groom too late. Then the groom said the name she buried years ago.",
                "synopsis": "A public marriage trap starts collapsing.",
                "episode_goal": "End on a social cliffhanger.",
                "target_duration_seconds": 40,
                "scenes": [
                    {
                        "scene_number": 1,
                        "slug": "SCENE 1 - HOOK",
                        "purpose": "Open the trap.",
                        "setting_hint": "Wedding hall",
                        "beat_summary": "Start with pressure.",
                        "emotional_shift": "fear_to_revenge",
                        "cliffhanger": False,
                        "dialogue_prompts": ["Open with contradiction."],
                        "supporting_asset_ids": ["scene.wedding_set"],
                    },
                    {
                        "scene_number": 2,
                        "slug": "SCENE 2 - CLIFFHANGER",
                        "purpose": "Expose the secret.",
                        "setting_hint": "Wedding hall",
                        "beat_summary": "Flip the power.",
                        "emotional_shift": "shock_to_suspense",
                        "cliffhanger": True,
                        "dialogue_prompts": ["End with an unanswered question."],
                        "supporting_asset_ids": ["scene.wedding_set"],
                    },
                ],
                "qa_notes": ["Draft only."],
                "llm_metadata": {"provider": "mock", "revision_signals": {"hook_polish_complete": True}},
            },
            "original_story_qc_report": {
                "overall_score": 0.70,
                "status": "placeholder",
                "checks": [
                    {"check_name": "hook_present", "passed": True, "score": 1.0, "note": "Hook exists."}
                ],
                "recommended_actions": ["Build a revision plan."],
            },
            "revised_story_qc_report": {
                "overall_score": 0.76,
                "status": "placeholder",
                "checks": [
                    {"check_name": "hook_present", "passed": True, "score": 1.0, "note": "Hook exists."}
                ],
                "recommended_actions": ["Re-run QC before finalization."],
            },
            "applied_action_ids": ["revision.draft.master_script.demo.hook"],
            "improvement_summary": [
                "Placeholder revision pass improved or preserved the draft Story QC score.",
                "Story QC score changed from 0.700 to 0.760.",
            ],
            "improved": True,
        }
    )
    assert model.improved is True
