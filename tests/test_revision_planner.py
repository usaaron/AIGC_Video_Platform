from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.models import ScriptRevisionPlanRequest, StoryQCReport
from app.modules.script_engine.revision_planner import RubricRevisionPlanner


def build_draft_master_script() -> DraftMasterScript:
    return DraftMasterScript.model_validate(
        {
            "id": "draft.master_script.revision_test",
            "content_spec_id": "content_spec.revision_test",
            "generation_strategy_id": "strategy.tiktok.revision_test.v1",
            "title": "Wedding Trap",
            "language": "en",
            "tone": "intense",
            "hook": "She said yes before recognizing the groom.",
            "synopsis": "A revenge wedding reveal explodes in public.",
            "episode_goal": "End on an unresolved public humiliation threat.",
            "target_duration_seconds": 40,
            "scenes": [
                {
                    "scene_number": 1,
                    "slug": "SCENE 1 - HOOK",
                    "purpose": "Open with the forced wedding setup.",
                    "setting_hint": "Wedding hall",
                    "beat_summary": "Open under pressure and build suspicion.",
                    "emotional_shift": "fear_to_suspense",
                    "cliffhanger": False,
                    "dialogue_prompts": ["Start with a hard contradiction."],
                    "supporting_asset_ids": ["scene.wedding_set"],
                },
                {
                    "scene_number": 2,
                    "slug": "SCENE 2 - REVEAL",
                    "purpose": "Expose the revenge motive.",
                    "setting_hint": "Wedding hall",
                    "beat_summary": "Reveal intent and destabilize the ceremony.",
                    "emotional_shift": "rage_to_suspense",
                    "cliffhanger": True,
                    "dialogue_prompts": ["Escalate with a public threat."],
                    "supporting_asset_ids": ["scene.wedding_set"],
                },
            ],
            "qa_notes": ["Draft only."],
            "llm_metadata": {"provider": "mock"},
        }
    )


def build_story_qc_report() -> StoryQCReport:
    return StoryQCReport.model_validate(
        {
            "overall_score": 0.63,
            "status": "placeholder",
            "checks": [
                {
                    "check_name": "hook_present",
                    "passed": True,
                    "score": 1.0,
                    "note": "Rubric-aligned check for hook presence.",
                },
                {
                    "check_name": "rubric_score",
                    "passed": False,
                    "score": 0.61,
                    "note": "Story quality rubric aggregate score.",
                },
            ],
            "recommended_actions": [
                "Use the story rubric deductions and suggestions to build a revision plan."
            ],
            "rubric_overall_score": 0.61,
            "rubric_categories": [
                {
                    "category_name": "Dialogue Quality",
                    "score": 2.0,
                    "max_score": 5,
                    "deduction_reasons": ["Draft uses prompts instead of final dialogue lines."],
                    "revision_suggestions": ["Replace generic lines with concrete, high-stakes phrasing."],
                },
                {
                    "category_name": "Cliffhanger Strength",
                    "score": 3.0,
                    "max_score": 5,
                    "deduction_reasons": ["Final scene could end on a sharper unresolved reveal."],
                    "revision_suggestions": ["End on a sharper unanswered reveal or power reversal."],
                },
            ],
        }
    )


def test_revision_planner_builds_actions_from_rubric() -> None:
    planner = RubricRevisionPlanner()
    plan = planner.build_plan(
        ScriptRevisionPlanRequest(
            draft_master_script=build_draft_master_script(),
            story_qc_report=build_story_qc_report(),
        )
    )

    assert plan.content_spec_id == "content_spec.revision_test"
    assert plan.overall_priority.value == "high"
    assert plan.must_re_qc is True
    assert len(plan.actions) >= 2
    assert plan.actions[0].target_type.value == "dialogue"
    assert plan.actions[-1].related_scene_numbers == [2]
