import json
import shutil
from pathlib import Path

import pytest

from app.modules.script_engine.revision_acceptance_calibration import (
    CalibrationFixtureError,
    CalibrationStatus,
    RevisionAcceptanceCalibrationEvaluator,
)


FIXTURE_ROOT = Path("tests/fixtures/revision_acceptance_calibration")


def test_all_twelve_fixed_fixtures_validate() -> None:
    samples = RevisionAcceptanceCalibrationEvaluator().load_samples()

    assert len(samples) == 12
    assert len({sample.sample_id for sample in samples}) == 12
    assert sum(sample.case_type == "clear_accepted" for sample in samples) == 3
    assert sum(sample.case_type == "clear_rejected" for sample in samples) == 5
    assert sum(sample.case_type == "ambiguous" for sample in samples) == 4
    assert {
        dimension.value
        for sample in samples
        for dimension in sample.revision_decision.selected_dimensions
    } == {
        "hook_quality",
        "character_agency",
        "conflict_escalation",
        "emotional_payoff",
        "cliffhanger_strength",
    }


def test_calibration_aggregates_expected_metrics_and_conflicts() -> None:
    report = RevisionAcceptanceCalibrationEvaluator().run_from_fixtures()

    assert report.total_samples == 12
    assert report.agreement_count == 9
    assert report.agreement_rate == 0.75
    assert report.false_acceptance_count == 1
    assert report.false_acceptance_rate == 0.143
    assert report.false_rejection_count == 2
    assert report.false_rejection_rate == 0.4
    assert report.successful_revision_rate == 0.417
    assert report.average_targeted_improvement == 0.12
    assert report.regression_rate == 0.167
    assert report.protected_dimension_stability_rate == 0.833
    assert report.average_scene_alignment_rate == 0.833
    assert report.average_revision_effectiveness == 0.753
    assert report.acceptance_true_human_false == 1
    assert report.acceptance_false_human_true == 2
    assert report.improved_true_acceptance_false >= 1
    assert report.improved_false_acceptance_true >= 1
    assert report.status == CalibrationStatus.review_required
    assert report.go_no_go_checks == {
        "reproducibility": True,
        "clear_negative_safety": True,
        "agreement_target": False,
        "disagreement_explainability": True,
    }
    assert report.known_blind_spots == [
        "character_voice_consistency_not_available_in_runtime_qc",
        "dialogue_naturalness_not_available_in_runtime_qc",
    ]


def test_per_sample_results_expose_required_evidence() -> None:
    report = RevisionAcceptanceCalibrationEvaluator().run_from_fixtures()

    assert all(result.acceptance_reason for result in report.sample_results)
    assert all(result.reviewer_reason for result in report.sample_results)
    assert all(result.machine_baseline_match for result in report.sample_results)
    assert any(
        "acceptance_true_human_false" in result.conflict_type
        for result in report.sample_results
    )
    assert any(
        "acceptance_false_human_true" in result.conflict_type
        for result in report.sample_results
    )
    dialogue_case = next(
        result
        for result in report.sample_results
        if result.sample_id == "calibration.ambiguous.dialogue_degrades"
    )
    hook_case = next(
        result
        for result in report.sample_results
        if result.sample_id == "calibration.ambiguous.hook_soft_regression"
    )
    assert dialogue_case.machine_accepted is True
    assert dialogue_case.known_blind_spots
    assert hook_case.machine_accepted is False
    assert hook_case.stop_reason == "protected_dimension_regression"


def test_repeated_runs_are_identical_and_do_not_mutate_policy() -> None:
    evaluator = RevisionAcceptanceCalibrationEvaluator()
    samples = evaluator.load_samples()
    policies_before = [sample.revision_policy.model_dump() for sample in samples]

    first = evaluator.run(samples).model_dump(mode="json")
    second = evaluator.run(samples).model_dump(mode="json")

    assert first == second
    assert [sample.revision_policy.model_dump() for sample in samples] == policies_before


def test_missing_fixture_is_rejected(tmp_path: Path) -> None:
    copied_root = tmp_path / "fixtures"
    shutil.copytree(FIXTURE_ROOT, copied_root)
    next(copied_root.glob("*.json")).unlink()

    with pytest.raises(CalibrationFixtureError, match="exactly 12"):
        RevisionAcceptanceCalibrationEvaluator(
            fixture_root=copied_root
        ).load_samples()


def test_malformed_fixture_is_rejected(tmp_path: Path) -> None:
    copied_root = tmp_path / "fixtures"
    shutil.copytree(FIXTURE_ROOT, copied_root)
    fixture_path = next(copied_root.glob("*.json"))
    payload = json.loads(fixture_path.read_text())
    del payload["human_ground_truth"]["reviewer_reason"]
    fixture_path.write_text(json.dumps(payload))

    with pytest.raises(CalibrationFixtureError, match="Invalid calibration fixture"):
        RevisionAcceptanceCalibrationEvaluator(
            fixture_root=copied_root
        ).load_samples()
