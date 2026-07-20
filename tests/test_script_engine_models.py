import pytest
from pydantic import ValidationError

from app.modules.script_engine.models import (
    AcceptanceDecision,
    GenerationStrategy,
    PromptLibraryItem,
    PromptRetrievalResult,
    RevisionDecision,
    RevisionPlan,
    RevisionPolicy,
    RevisionStrategy,
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
            "report_version": "story_qc_report.v1",
            "explainability_status": "partial",
            "dimension_evaluations": [
                {
                    "dimension": "hook_quality",
                    "score": 4.2,
                    "summary": "Hook establishes a clear contradiction.",
                    "score_reason": "The hook is specific and front-loads conflict.",
                    "deduction_reasons": [],
                    "scene_refs": [1],
                    "evidence": ["Hook: She married him before she learned his real name."],
                    "revision_signals": [],
                }
            ],
            "evidence_summary": [
                "hook_quality: Hook: She married him before she learned his real name."
            ],
            "knowledge_refs": [
                {
                    "knowledge_id": "hook.core_conflict.fast_setup.v1",
                    "dimension": "hook_quality",
                    "reason": "Hook establishes the core contradiction quickly.",
                    "evidence": "Hook: She married him before she learned his real name.",
                }
            ],
        }
    )
    assert model.rubric_categories[0].category_name == "Dialogue Quality"
    assert model.dimension_evaluations[0].scene_refs == [1]
    assert model.knowledge_refs[0].dimension.value == "hook_quality"


def test_revision_decision_creation_defaults_and_serialization() -> None:
    model = RevisionDecision.model_validate(
        {
            "revision_required": True,
            "decision_reason": "Character agency needs a targeted scene-level revision.",
            "selected_dimensions": ["character_agency"],
            "primary_scene_refs": [2],
            "confidence": 0.86,
        }
    )

    assert model.deferred_dimensions == []
    assert model.protected_dimensions == []
    assert model.model_dump(mode="json") == {
        "revision_required": True,
        "decision_reason": "Character agency needs a targeted scene-level revision.",
        "selected_dimensions": ["character_agency"],
        "deferred_dimensions": [],
        "protected_dimensions": [],
        "primary_scene_refs": [2],
        "confidence": 0.86,
    }


def test_revision_strategy_creation_defaults_and_serialization() -> None:
    model = RevisionStrategy.model_validate(
        {
            "target_dimension": "character_agency",
            "problem_type": "reactive_protagonist",
            "problem_reason": "The protagonist only reacts to the reveal in Scene 2.",
            "revision_goal": "Give the protagonist an active choice with consequences.",
            "revision_method": "Replace the passive response with an irreversible decision.",
            "expected_effect": "Increase character agency without weakening the hook.",
            "confidence": 0.82,
            "scene_refs": [2],
        }
    )

    serialized = model.model_dump(mode="json")
    assert model.priority == 1
    assert model.do_not_touch == []
    assert model.knowledge_refs == []
    assert serialized["target_dimension"] == "character_agency"
    assert serialized["scene_refs"] == [2]


def test_revision_policy_uses_single_round_default() -> None:
    model = RevisionPolicy.model_validate(
        {
            "minimum_improvement_threshold": 0.05,
            "acceptance_threshold": 0.65,
            "regression_limit": 0,
        }
    )

    assert model.max_revision_rounds == 1
    assert model.model_dump() == {
        "policy_version": "revision_acceptance_policy.v1",
        "max_revision_rounds": 1,
        "minimum_improvement_threshold": 0.05,
        "acceptance_threshold": 0.65,
        "regression_limit": 0,
        "dimension_regression_tolerance": 0.0,
    }


def test_acceptance_decision_creation_defaults_and_serialization() -> None:
    model = AcceptanceDecision.model_validate(
        {
            "accepted": True,
            "acceptance_reason": "The targeted dimension improved without protected regressions.",
            "targeted_dimension_improvement": {"character_agency": 0.14},
            "regression_count": 0,
            "protected_dimension_stability": True,
        }
    )

    assert model.stop_reason is None
    assert model.model_dump(mode="json") == {
        "accepted": True,
        "acceptance_reason": "The targeted dimension improved without protected regressions.",
        "targeted_dimension_improvement": {"character_agency": 0.14},
        "regression_count": 0,
        "protected_dimension_stability": True,
        "stop_reason": None,
        "decision_version": "revision_acceptance_decision.v1",
        "policy_version": "revision_acceptance_policy.v1",
        "revision_round": 1,
        "scene_alignment_rate": 0.0,
        "revision_effectiveness": 0.0,
        "regressed_dimensions": [],
    }


def test_revision_plan_old_payload_remains_backward_compatible() -> None:
    model = RevisionPlan.model_validate(
        {
            "draft_master_script_id": "draft.master_script.compatibility",
            "content_spec_id": "content_spec.compatibility",
            "generation_strategy_id": "strategy.tiktok.master_script.v1",
            "story_qc_status": "placeholder",
            "overall_priority": "medium",
            "focus_summary": "Keep the existing revision plan contract unchanged.",
        }
    )

    serialized = model.model_dump(mode="json")
    assert serialized["actions"] == []
    assert serialized["revision_decision"] is None
    assert serialized["revision_strategies"] == []


def test_revision_plan_accepts_decision_and_strategies() -> None:
    model = RevisionPlan.model_validate(
        {
            "draft_master_script_id": "draft.master_script.explainable",
            "content_spec_id": "content_spec.explainable",
            "generation_strategy_id": "strategy.tiktok.master_script.v1",
            "story_qc_status": "placeholder",
            "overall_priority": "high",
            "focus_summary": "Strengthen hook while protecting emotional payoff.",
            "revision_decision": {
                "revision_required": True,
                "decision_reason": "Hook quality is the highest-impact evidence-backed target.",
                "selected_dimensions": ["hook_quality"],
                "deferred_dimensions": ["conflict_escalation"],
                "protected_dimensions": ["emotional_payoff"],
                "primary_scene_refs": [1],
                "confidence": 0.9,
            },
            "revision_strategies": [
                {
                    "target_dimension": "hook_quality",
                    "problem_type": "late_opening_conflict",
                    "problem_reason": "The central contradiction arrives after Scene 1.",
                    "revision_goal": "Establish the contradiction in the opening scene.",
                    "revision_method": "Move the existing reveal into Scene 1 without changing the ending.",
                    "expected_effect": "Increase opening pressure while preserving emotional payoff.",
                    "priority": 1,
                    "confidence": 0.9,
                    "scene_refs": [1],
                    "do_not_touch": ["Preserve emotional_payoff."],
                    "knowledge_refs": [],
                }
            ],
        }
    )

    serialized = model.model_dump(mode="json")
    assert model.revision_decision is not None
    assert model.revision_decision.selected_dimensions[0].value == "hook_quality"
    assert model.revision_strategies[0].scene_refs == [1]
    assert serialized["revision_strategies"][0]["target_dimension"] == "hook_quality"


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
    assert model.acceptance_decision is None
