from app.modules.script_engine.models import (
    RevisionDecision,
    RevisionExecutionTrace,
    RevisionPolicy,
    RevisionStrategy,
    StoryQCReport,
)
from app.modules.script_engine.revision_acceptance import RevisionAcceptanceEvaluator


DIMENSIONS = (
    "hook_quality",
    "character_agency",
    "conflict_escalation",
    "emotional_payoff",
    "cliffhanger_strength",
)


def build_report(scores: dict[str, float]) -> StoryQCReport:
    return StoryQCReport.model_validate(
        {
            "overall_score": 0.8,
            "status": "placeholder",
            "checks": [],
            "recommended_actions": [],
            "report_version": "story_qc_report.v1",
            "explainability_status": "partial",
            "dimension_evaluations": [
                {
                    "dimension": dimension,
                    "score": scores[dimension],
                    "summary": f"Evaluation summary for {dimension}.",
                    "score_reason": f"Evidence-based score reason for {dimension}.",
                    "deduction_reasons": [],
                    "scene_refs": [2] if dimension == "character_agency" else [1],
                    "evidence": [f"Evidence for {dimension}."],
                    "revision_signals": [],
                }
                for dimension in DIMENSIONS
            ],
        }
    )


def build_decision() -> RevisionDecision:
    return RevisionDecision.model_validate(
        {
            "revision_required": True,
            "decision_reason": "Character agency is the selected evidence-backed target.",
            "selected_dimensions": ["character_agency"],
            "protected_dimensions": ["hook_quality"],
            "primary_scene_refs": [2],
            "confidence": 0.9,
        }
    )


def build_strategies() -> list[RevisionStrategy]:
    return [
        RevisionStrategy.model_validate(
            {
                "target_dimension": "character_agency",
                "problem_type": "reactive_protagonist",
                "problem_reason": "The protagonist only reacts in Scene 2.",
                "revision_goal": "Give the protagonist an irreversible choice.",
                "revision_method": "Strengthen the existing decision beat in Scene 2.",
                "expected_effect": "Improve agency without changing the opening hook.",
                "confidence": 0.9,
                "scene_refs": [2],
            }
        )
    ]


def build_trace(
    *,
    applied_actions: list[str] | None = None,
    modified_scene_numbers: list[int] | None = None,
) -> RevisionExecutionTrace:
    return RevisionExecutionTrace.model_validate(
        {
            "executor_version": "rule_based_revision_executor.v1",
            "execution_mode": "controlled",
            "applied_actions": (
                ["revision.draft.character"]
                if applied_actions is None
                else applied_actions
            ),
            "modified_scene_numbers": (
                [2] if modified_scene_numbers is None else modified_scene_numbers
            ),
        }
    )


def build_policy() -> RevisionPolicy:
    return RevisionPolicy(
        minimum_improvement_threshold=0.1,
        acceptance_threshold=0.8,
        regression_limit=0,
        dimension_regression_tolerance=0.01,
    )


def evaluate(
    original: StoryQCReport,
    revised: StoryQCReport,
    *,
    trace: RevisionExecutionTrace | None = None,
):
    return RevisionAcceptanceEvaluator().evaluate(
        original_report=original,
        revised_report=revised,
        revision_decision=build_decision(),
        revision_strategies=build_strategies(),
        execution_trace=trace or build_trace(),
        policy=build_policy(),
    )


def base_scores() -> dict[str, float]:
    return {dimension: 4.0 for dimension in DIMENSIONS}


def test_accepts_target_improvement_with_stable_protection_and_aligned_scene() -> None:
    original_scores = base_scores()
    original_scores["character_agency"] = 3.0
    revised_scores = base_scores()

    decision = evaluate(build_report(original_scores), build_report(revised_scores))

    assert decision.accepted is True
    assert decision.targeted_dimension_improvement == {"character_agency": 0.2}
    assert decision.protected_dimension_stability is True
    assert decision.scene_alignment_rate == 1.0
    assert decision.revision_effectiveness == 1.0
    assert decision.regressed_dimensions == []
    assert decision.stop_reason is None


def test_rejects_when_no_revision_action_was_applied() -> None:
    original_scores = base_scores()
    original_scores["character_agency"] = 3.0

    decision = evaluate(
        build_report(original_scores),
        build_report(base_scores()),
        trace=build_trace(applied_actions=[], modified_scene_numbers=[]),
    )

    assert decision.accepted is False
    assert decision.stop_reason == "no_revision_actions_applied"


def test_rejects_when_target_dimension_is_unchanged() -> None:
    scores = base_scores()
    scores["character_agency"] = 3.0

    decision = evaluate(build_report(scores), build_report(scores))

    assert decision.accepted is False
    assert decision.targeted_dimension_improvement == {"character_agency": 0.0}
    assert decision.stop_reason == "target_improvement_below_threshold"


def test_rejects_and_records_protected_dimension_regression() -> None:
    original_scores = base_scores()
    original_scores["character_agency"] = 3.0
    revised_scores = base_scores()
    revised_scores["hook_quality"] = 3.0

    decision = evaluate(build_report(original_scores), build_report(revised_scores))

    assert decision.accepted is False
    assert decision.protected_dimension_stability is False
    assert decision.regression_count == 1
    assert [item.value for item in decision.regressed_dimensions] == ["hook_quality"]
    assert decision.stop_reason == "protected_dimension_regression"


def test_rejects_protected_regression_inside_ordinary_noise_tolerance() -> None:
    original_scores = base_scores()
    original_scores["character_agency"] = 3.0
    revised_scores = base_scores()
    revised_scores["hook_quality"] = 3.9

    decision = evaluate(build_report(original_scores), build_report(revised_scores))

    assert decision.accepted is False
    assert decision.protected_dimension_stability is False
    assert [item.value for item in decision.regressed_dimensions] == ["hook_quality"]
    assert decision.revision_effectiveness == 0.8
    assert decision.stop_reason == "protected_dimension_regression"


def test_keeps_ordinary_non_target_regression_tolerance() -> None:
    original_scores = base_scores()
    original_scores["character_agency"] = 3.0
    revised_scores = base_scores()
    revised_scores["emotional_payoff"] = 3.99

    decision = evaluate(build_report(original_scores), build_report(revised_scores))

    assert decision.accepted is True
    assert decision.regressed_dimensions == []
    assert decision.revision_effectiveness == 1.0


def test_rejects_when_qc_explainability_is_insufficient() -> None:
    report_without_dimensions = StoryQCReport.model_validate(
        {
            "overall_score": 0.8,
            "status": "placeholder",
            "checks": [],
            "recommended_actions": [],
        }
    )

    decision = evaluate(report_without_dimensions, report_without_dimensions)

    assert decision.accepted is False
    assert decision.targeted_dimension_improvement == {}
    assert decision.stop_reason == "insufficient_qc_explainability"
