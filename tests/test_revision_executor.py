from app.modules.script_engine.models import RevisionPlan
from app.modules.script_engine.revision_executor import RuleBasedRevisionExecutor
from tests.test_revision_planner import build_draft_master_script


def build_controlled_revision_plan() -> RevisionPlan:
    return RevisionPlan.model_validate(
        {
            "draft_master_script_id": "draft.master_script.revision_test",
            "content_spec_id": "content_spec.revision_test",
            "generation_strategy_id": "strategy.tiktok.revision_test.v1",
            "story_qc_status": "placeholder",
            "overall_priority": "high",
            "focus_summary": "Strengthen character agency in Scene 2.",
            "revision_decision": {
                "revision_required": True,
                "decision_reason": "Character agency is the selected evidence-backed target.",
                "selected_dimensions": ["character_agency"],
                "deferred_dimensions": [],
                "protected_dimensions": ["hook_quality"],
                "primary_scene_refs": [2],
                "confidence": 0.9,
            },
            "revision_strategies": [
                {
                    "target_dimension": "character_agency",
                    "problem_type": "reactive_protagonist",
                    "problem_reason": "The protagonist only reacts in Scene 2.",
                    "revision_goal": "Give the protagonist an irreversible choice.",
                    "revision_method": "Strengthen the existing decision beat in Scene 2.",
                    "expected_effect": "Improve agency without changing the opening hook.",
                    "priority": 1,
                    "confidence": 0.9,
                    "scene_refs": [2],
                    "do_not_touch": ["Preserve the opening hook."],
                    "knowledge_refs": [
                        {
                            "knowledge_id": "character.agency.active_choice.v1",
                            "dimension": "character_agency",
                            "reason": "Agency requires a consequential protagonist choice.",
                            "evidence": "Scene 2 contains only a reactive beat.",
                        }
                    ],
                }
            ],
            "actions": [
                {
                    "action_id": "revision.draft.revision_test.character",
                    "target_type": "character",
                    "priority": "high",
                    "title": "Strengthen character agency",
                    "rationale": "The protagonist only reacts in Scene 2.",
                    "based_on_checks": ["dimension.character_agency"],
                    "related_scene_numbers": [1, 2],
                    "instructions": ["Give the protagonist an irreversible choice."],
                    "expected_impact": "Improves protagonist agency in the selected scene.",
                },
                {
                    "action_id": "revision.draft.revision_test.hook",
                    "target_type": "hook",
                    "priority": "medium",
                    "title": "Strengthen hook",
                    "rationale": "An old action requests an opening change.",
                    "based_on_checks": ["rubric.hook"],
                    "related_scene_numbers": [1],
                    "instructions": ["Add another opening reveal."],
                    "expected_impact": "Would modify the protected opening hook.",
                },
            ],
        }
    )


def test_rule_based_executor_applies_strategy_with_scene_scope_and_trace() -> None:
    draft = build_draft_master_script()
    plan = build_controlled_revision_plan()

    result = RuleBasedRevisionExecutor().execute(
        draft=draft,
        plan=plan,
        strategies=plan.revision_strategies,
    )

    revised = result.revised_draft_master_script
    trace = result.execution_trace
    assert revised.scenes[0].purpose == draft.scenes[0].purpose
    assert revised.scenes[1].purpose != draft.scenes[1].purpose
    assert revised.hook == draft.hook
    assert trace.executor_version == "rule_based_revision_executor.v1"
    assert trace.execution_mode.value == "controlled"
    assert trace.modified_scene_numbers == [2]
    assert trace.applied_actions == ["revision.draft.revision_test.character"]
    assert trace.strategy_contexts[0].revision_goal == (
        "Give the protagonist an irreversible choice."
    )
    assert trace.strategy_contexts[0].knowledge_ref_ids == [
        "character.agency.active_choice.v1"
    ]


def test_rule_based_executor_blocks_protected_action_and_records_skip() -> None:
    draft = build_draft_master_script()
    plan = build_controlled_revision_plan()

    trace = RuleBasedRevisionExecutor().execute(
        draft=draft,
        plan=plan,
        strategies=plan.revision_strategies,
    ).execution_trace

    assert len(trace.skipped_actions) == 1
    assert trace.skipped_actions[0].action_id == "revision.draft.revision_test.hook"
    assert trace.skipped_actions[0].reason == "protected_dimension"
    protected_check = next(
        check
        for check in trace.protected_scope_checks
        if check.scope_ref == "protected_dimension:hook_quality"
    )
    assert protected_check.status.value == "blocked"
    assert any(
        check.status.value == "recorded_only"
        for check in trace.protected_scope_checks
    )


def test_rule_based_executor_uses_legacy_fallback_without_new_contract() -> None:
    draft = build_draft_master_script()
    controlled_plan = build_controlled_revision_plan()
    legacy_plan = controlled_plan.model_copy(
        update={"revision_decision": None, "revision_strategies": []}
    )

    result = RuleBasedRevisionExecutor().execute(
        draft=draft,
        plan=legacy_plan,
        strategies=[],
    )

    assert result.execution_trace.execution_mode.value == "legacy_fallback"
    assert result.execution_trace.skipped_actions == []
    assert result.execution_trace.applied_actions == [
        "revision.draft.revision_test.character",
        "revision.draft.revision_test.hook",
    ]
    assert result.revised_draft_master_script.scenes[0].purpose != draft.scenes[0].purpose
    assert result.revised_draft_master_script.scenes[1].purpose != draft.scenes[1].purpose
    assert result.revised_draft_master_script.hook != draft.hook
