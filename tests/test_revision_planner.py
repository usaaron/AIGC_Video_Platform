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
                    "turning_point": "The bride stops the ceremony before anyone can answer for her.",
                    "character_actions": ["The bride takes control of the microphone."],
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
                    "turning_point": "The bride exposes the payment before the groom can stop her.",
                    "character_actions": ["The bride reveals the evidence to the guests."],
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


def build_explainable_story_qc_report() -> StoryQCReport:
    return StoryQCReport.model_validate(
        {
            "overall_score": 0.61,
            "status": "placeholder",
            "rubric_overall_score": 0.59,
            "report_version": "story_qc_report.v1",
            "explainability_status": "partial",
            "dimension_evaluations": [
                {
                    "dimension": "hook_quality",
                    "score": 2.5,
                    "summary": "The opening lacks an immediate contradiction.",
                    "score_reason": "Scene 1 establishes context before conflict.",
                    "deduction_reasons": ["Opening conflict arrives too late."],
                    "scene_refs": [1],
                    "evidence": ["Scene 1 begins with ceremony setup."],
                    "revision_signals": ["strengthen_opening_conflict"],
                },
                {
                    "dimension": "character_agency",
                    "score": 2.0,
                    "summary": "The protagonist reacts instead of choosing.",
                    "score_reason": "The reveal changes the scene without a lead decision.",
                    "deduction_reasons": ["The protagonist remains reactive in Scene 2."],
                    "scene_refs": [2],
                    "evidence": ["Scene 2 reveal is initiated by the antagonist."],
                    "revision_signals": ["show_protagonist_choice"],
                },
                {
                    "dimension": "cliffhanger_strength",
                    "score": 2.2,
                    "summary": "The ending reveals information without enough pressure.",
                    "score_reason": "The final reveal resolves more than it withholds.",
                    "deduction_reasons": ["The ending lacks a consequential question."],
                    "scene_refs": [2],
                    "evidence": ["Scene 2 ends after the identity reveal."],
                    "revision_signals": ["strengthen_unresolved_question"],
                },
                {
                    "dimension": "conflict_escalation",
                    "score": 3.0,
                    "summary": "Conflict rises, but the second scene does not increase risk.",
                    "score_reason": "Both scenes sustain similar public pressure.",
                    "deduction_reasons": ["Scene 2 repeats rather than escalates the threat."],
                    "scene_refs": [1, 2],
                    "evidence": ["Both scenes remain at the wedding altar."],
                    "revision_signals": ["increase_scene_to_scene_stakes"],
                },
                {
                    "dimension": "emotional_payoff",
                    "score": 4.5,
                    "summary": "The emotional turn lands clearly.",
                    "score_reason": "Fear turns into public defiance by Scene 2.",
                    "deduction_reasons": [],
                    "scene_refs": [1, 2],
                    "evidence": ["The protagonist moves from fear to defiance."],
                    "revision_signals": [],
                },
            ],
            "knowledge_refs": [
                {
                    "knowledge_id": "hook.core_conflict.fast_setup.v1",
                    "dimension": "hook_quality",
                    "reason": "The opening should establish the core contradiction quickly.",
                    "evidence": "Scene 1 begins with ceremony setup before conflict.",
                }
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


def test_revision_planner_selects_high_priority_evidence_backed_dimensions() -> None:
    planner = RubricRevisionPlanner()
    report = build_explainable_story_qc_report()

    decision = planner.build_decision(report)

    assert decision.revision_required is True
    assert [dimension.value for dimension in decision.selected_dimensions] == [
        "hook_quality",
        "character_agency",
    ]
    assert len(decision.selected_dimensions) <= 2
    assert [dimension.value for dimension in decision.deferred_dimensions] == [
        "cliffhanger_strength",
        "conflict_escalation",
    ]


def test_revision_planner_preserves_scene_refs_and_protected_dimensions() -> None:
    planner = RubricRevisionPlanner()
    report = build_explainable_story_qc_report()
    decision = planner.build_decision(report)

    strategies = planner.build_strategies(report, decision)

    assert decision.primary_scene_refs == [1, 2]
    assert [dimension.value for dimension in decision.protected_dimensions] == [
        "emotional_payoff"
    ]
    assert strategies[0].scene_refs == [1]
    assert strategies[1].scene_refs == [2]
    assert strategies[0].problem_reason == "Opening conflict arrives too late."
    assert "Preserve emotional_payoff" in strategies[0].do_not_touch[0]


def test_revision_planner_builds_bounded_plan_from_strategies() -> None:
    planner = RubricRevisionPlanner()
    report = build_explainable_story_qc_report()
    decision = planner.build_decision(report)
    strategies = planner.build_strategies(report, decision)
    plan = planner.build_plan(
        ScriptRevisionPlanRequest(
            draft_master_script=build_draft_master_script(),
            story_qc_report=report,
        )
    )

    assert plan.revision_decision == decision
    assert plan.revision_strategies == strategies
    assert len(plan.actions) == 2
    assert [action.target_type.value for action in plan.actions] == [
        "hook",
        "character",
    ]
    assert plan.actions[0].related_scene_numbers == [1]
    assert plan.actions[1].related_scene_numbers == [2]
    assert "immediate contradiction" in plan.actions[0].instructions[0]
    assert plan.revision_decision.selected_dimensions == decision.selected_dimensions
    assert plan.revision_decision.protected_dimensions == decision.protected_dimensions
    assert plan.revision_decision.primary_scene_refs == [1, 2]
    assert plan.revision_strategies[0].scene_refs == [1]
    assert plan.revision_strategies[0].knowledge_refs[0].knowledge_id == (
        "hook.core_conflict.fast_setup.v1"
    )
    assert any(note.startswith("RevisionDecision:") for note in plan.notes)


def test_revision_planner_keeps_legacy_report_contract_compatible() -> None:
    planner = RubricRevisionPlanner()
    report = build_story_qc_report()
    decision = planner.build_decision(report)

    plan = planner.build_plan(
        ScriptRevisionPlanRequest(
            draft_master_script=build_draft_master_script(),
            story_qc_report=report,
        )
    )

    assert decision.revision_required is True
    assert decision.selected_dimensions == []
    assert [action.target_type.value for action in plan.actions] == [
        "dialogue",
        "cliffhanger",
    ]
    assert plan.revision_decision == decision
    assert plan.revision_strategies == []
    assert plan.model_dump(mode="json")["must_re_qc"] is True
