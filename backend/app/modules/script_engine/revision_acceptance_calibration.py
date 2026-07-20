from __future__ import annotations

import json
from collections.abc import Iterable
from enum import Enum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.modules.script_engine.models import (
    RevisionDecision,
    RevisionExecutionTrace,
    RevisionPolicy,
    RevisionStrategy,
    StoryQCDimension,
    StoryQCReport,
)
from app.modules.script_engine.revision_acceptance import RevisionAcceptanceEvaluator


FIXTURE_COUNT = 12
DEFAULT_FIXTURE_ROOT = Path("tests/fixtures/revision_acceptance_calibration")


class CalibrationFixtureError(ValueError):
    """Raised when the fixed calibration set is missing or invalid."""


class CalibrationCaseType(str, Enum):
    clear_accepted = "clear_accepted"
    clear_rejected = "clear_rejected"
    ambiguous = "ambiguous"


class DialogueNaturalnessChange(str, Enum):
    improved = "improved"
    unchanged = "unchanged"
    degraded = "degraded"


class HumanPreference(str, Enum):
    original = "original"
    revised = "revised"
    neutral = "neutral"


class CalibrationStatus(str, Enum):
    ready_for_generation_quality_experiments = (
        "ready_for_generation_quality_experiments"
    )
    review_required = "review_required"
    insufficient_evidence = "insufficient_evidence"


class FrozenStoryQCReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall_score: float = Field(ge=0.0, le=1.0)
    dimension_scores: dict[StoryQCDimension, float]
    evidence: dict[StoryQCDimension, str]

    @model_validator(mode="after")
    def require_all_dimensions(self) -> "FrozenStoryQCReport":
        expected = set(StoryQCDimension)
        if set(self.dimension_scores) != expected or set(self.evidence) != expected:
            raise ValueError("Frozen QC reports must include all Story QC dimensions.")
        if any(score < 0.0 or score > 5.0 for score in self.dimension_scores.values()):
            raise ValueError("Frozen dimension scores must be between 0 and 5.")
        return self

    def to_runtime_report(self) -> StoryQCReport:
        return StoryQCReport.model_validate(
            {
                "overall_score": self.overall_score,
                "status": "placeholder",
                "report_version": "story_qc_report.v1",
                "explainability_status": "calibration_fixture",
                "dimension_evaluations": [
                    {
                        "dimension": dimension,
                        "score": self.dimension_scores[dimension],
                        "summary": f"Frozen calibration evaluation for {dimension.value}.",
                        "score_reason": self.evidence[dimension],
                        "scene_refs": [],
                        "evidence": [self.evidence[dimension]],
                    }
                    for dimension in StoryQCDimension
                ],
            }
        )


class RevisionCalibrationEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intended_revision: str = Field(min_length=10, max_length=500)
    actual_change: str = Field(min_length=10, max_length=500)
    human_judgment: str = Field(min_length=10, max_length=500)
    expected_acceptance_behavior: str = Field(min_length=10, max_length=500)
    original_excerpt: str | None = Field(default=None, min_length=3, max_length=500)
    revised_excerpt: str | None = Field(default=None, min_length=3, max_length=500)


class RevisionHumanGroundTruth(BaseModel):
    model_config = ConfigDict(extra="forbid")

    human_accept_revision: bool
    target_issue_fixed: bool
    major_regression_detected: bool
    protected_dimensions_preserved: bool
    scene_scope_aligned: bool
    character_consistency_preserved: bool
    dialogue_naturalness_change: DialogueNaturalnessChange
    overall_human_preference: HumanPreference
    reviewer_reason: str = Field(min_length=10, max_length=500)
    reviewer_confidence: float = Field(ge=0.0, le=1.0)


class RevisionAcceptanceCalibrationSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(pattern=r"^revision_acceptance_calibration\.v1$")
    sample_id: str = Field(
        min_length=3,
        max_length=120,
        pattern=r"^[a-z0-9_.-]+$",
    )
    case_type: CalibrationCaseType
    description: str = Field(min_length=10, max_length=500)
    original_story_qc_report: FrozenStoryQCReport
    revised_story_qc_report: FrozenStoryQCReport
    revision_decision: RevisionDecision
    revision_strategies: list[RevisionStrategy] = Field(min_length=1, max_length=2)
    revision_execution_trace: RevisionExecutionTrace
    revision_policy: RevisionPolicy
    legacy_improved: bool
    expected_machine_accepted: bool
    human_ground_truth: RevisionHumanGroundTruth
    evidence: RevisionCalibrationEvidence


class RevisionAcceptanceCalibrationSampleResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sample_id: str
    case_type: CalibrationCaseType
    human_accept_revision: bool
    machine_accepted: bool
    expected_machine_accepted: bool
    machine_baseline_match: bool
    agreement: bool
    legacy_improved: bool
    acceptance_reason: str
    stop_reason: str | None
    targeted_dimension_improvement: dict[StoryQCDimension, float]
    regression_count: int
    regressed_dimensions: list[StoryQCDimension]
    protected_dimension_stability: bool
    scene_alignment_rate: float
    revision_effectiveness: float
    conflict_type: str
    reviewer_reason: str
    known_blind_spots: list[str] = Field(default_factory=list)


class RevisionAcceptanceCalibrationReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = "revision_acceptance_calibration_report.v1"
    status: CalibrationStatus
    total_samples: int
    agreement_count: int
    agreement_rate: float
    false_acceptance_count: int
    false_acceptance_rate: float
    false_rejection_count: int
    false_rejection_rate: float
    successful_revision_rate: float
    average_targeted_improvement: float
    regression_rate: float
    protected_dimension_stability_rate: float
    average_scene_alignment_rate: float
    average_revision_effectiveness: float
    improved_true_acceptance_false: int
    improved_false_acceptance_true: int
    acceptance_true_human_false: int
    acceptance_false_human_true: int
    go_no_go_checks: dict[str, bool]
    go_no_go_reasons: list[str]
    known_blind_spots: list[str]
    sample_results: list[RevisionAcceptanceCalibrationSampleResult]


class RevisionAcceptanceCalibrationEvaluator:
    """Compare the fixed synthetic calibration set with shadow acceptance."""

    def __init__(
        self,
        *,
        fixture_root: Path | str = DEFAULT_FIXTURE_ROOT,
        acceptance_evaluator: RevisionAcceptanceEvaluator | None = None,
    ) -> None:
        self._fixture_root = Path(fixture_root)
        self._acceptance_evaluator = (
            acceptance_evaluator or RevisionAcceptanceEvaluator()
        )

    def load_samples(self) -> list[RevisionAcceptanceCalibrationSample]:
        fixture_paths = sorted(self._fixture_root.glob("*.json"))
        if len(fixture_paths) != FIXTURE_COUNT:
            raise CalibrationFixtureError(
                f"Expected exactly {FIXTURE_COUNT} calibration fixtures, "
                f"found {len(fixture_paths)}."
            )

        samples: list[RevisionAcceptanceCalibrationSample] = []
        for fixture_path in fixture_paths:
            try:
                payload = json.loads(fixture_path.read_text(encoding="utf-8"))
                samples.append(
                    RevisionAcceptanceCalibrationSample.model_validate(payload)
                )
            except (OSError, json.JSONDecodeError, ValidationError) as exc:
                raise CalibrationFixtureError(
                    f"Invalid calibration fixture '{fixture_path}': {exc}"
                ) from exc

        sample_ids = [sample.sample_id for sample in samples]
        if len(set(sample_ids)) != len(sample_ids):
            raise CalibrationFixtureError("Calibration sample IDs must be unique.")
        return samples

    def run_from_fixtures(self) -> RevisionAcceptanceCalibrationReport:
        return self.run(self.load_samples())

    def run(
        self,
        samples: list[RevisionAcceptanceCalibrationSample],
    ) -> RevisionAcceptanceCalibrationReport:
        if len(samples) != FIXTURE_COUNT:
            raise CalibrationFixtureError(
                f"Calibration requires exactly {FIXTURE_COUNT} samples."
            )

        results = [self._evaluate_sample(sample) for sample in samples]
        total = len(results)
        agreement_count = sum(result.agreement for result in results)
        false_acceptance_count = sum(
            result.machine_accepted and not result.human_accept_revision
            for result in results
        )
        false_rejection_count = sum(
            not result.machine_accepted and result.human_accept_revision
            for result in results
        )
        human_acceptance_count = sum(
            result.human_accept_revision for result in results
        )
        human_rejection_count = total - human_acceptance_count
        clear_negative_safe = not any(
            result.case_type == CalibrationCaseType.clear_rejected
            and result.machine_accepted
            for result in results
        )
        explainable_disagreements = all(
            result.agreement
            or (
                result.conflict_type != "none"
                and bool(result.reviewer_reason)
                and bool(result.stop_reason or result.machine_accepted)
            )
            for result in results
        )
        reproducible = all(result.machine_baseline_match for result in results)
        agreement_target_met = self._rate(agreement_count, total) >= 0.8
        go_no_go_checks = {
            "reproducibility": reproducible,
            "clear_negative_safety": clear_negative_safe,
            "agreement_target": agreement_target_met,
            "disagreement_explainability": explainable_disagreements,
        }
        go_no_go_reasons = [
            reason
            for check, reason in (
                (reproducible, "Machine decisions changed from the fixed baseline."),
                (
                    clear_negative_safe,
                    "At least one clear-negative sample was falsely accepted.",
                ),
                (
                    agreement_target_met,
                    "Human-machine agreement is below the 0.80 target.",
                ),
                (
                    explainable_disagreements,
                    "At least one disagreement lacks an identifiable explanation.",
                ),
            )
            if not check
        ]

        status = CalibrationStatus.ready_for_generation_quality_experiments
        if not reproducible or not explainable_disagreements:
            status = CalibrationStatus.insufficient_evidence
        elif not clear_negative_safe or not agreement_target_met:
            status = CalibrationStatus.review_required

        targeted_improvements = [
            self._average(result.targeted_dimension_improvement.values())
            for result in results
        ]
        return RevisionAcceptanceCalibrationReport(
            status=status,
            total_samples=total,
            agreement_count=agreement_count,
            agreement_rate=self._rate(agreement_count, total),
            false_acceptance_count=false_acceptance_count,
            false_acceptance_rate=self._rate(
                false_acceptance_count,
                human_rejection_count,
            ),
            false_rejection_count=false_rejection_count,
            false_rejection_rate=self._rate(
                false_rejection_count,
                human_acceptance_count,
            ),
            successful_revision_rate=self._rate(
                human_acceptance_count,
                total,
            ),
            average_targeted_improvement=self._average(targeted_improvements),
            regression_rate=self._rate(
                sum(result.regression_count > 0 for result in results),
                total,
            ),
            protected_dimension_stability_rate=self._rate(
                sum(result.protected_dimension_stability for result in results),
                total,
            ),
            average_scene_alignment_rate=self._average(
                result.scene_alignment_rate for result in results
            ),
            average_revision_effectiveness=self._average(
                result.revision_effectiveness for result in results
            ),
            improved_true_acceptance_false=sum(
                result.legacy_improved and not result.machine_accepted
                for result in results
            ),
            improved_false_acceptance_true=sum(
                not result.legacy_improved and result.machine_accepted
                for result in results
            ),
            acceptance_true_human_false=false_acceptance_count,
            acceptance_false_human_true=false_rejection_count,
            go_no_go_checks=go_no_go_checks,
            go_no_go_reasons=go_no_go_reasons,
            known_blind_spots=sorted(
                {
                    blind_spot
                    for result in results
                    for blind_spot in result.known_blind_spots
                }
            ),
            sample_results=results,
        )

    def _evaluate_sample(
        self,
        sample: RevisionAcceptanceCalibrationSample,
    ) -> RevisionAcceptanceCalibrationSampleResult:
        policy_before = sample.revision_policy.model_dump(mode="json")
        decision = self._acceptance_evaluator.evaluate(
            original_report=sample.original_story_qc_report.to_runtime_report(),
            revised_report=sample.revised_story_qc_report.to_runtime_report(),
            revision_decision=sample.revision_decision,
            revision_strategies=sample.revision_strategies,
            execution_trace=sample.revision_execution_trace,
            policy=sample.revision_policy,
        )
        if sample.revision_policy.model_dump(mode="json") != policy_before:
            raise RuntimeError("Calibration must not mutate RevisionPolicy.")

        human_accepted = sample.human_ground_truth.human_accept_revision
        return RevisionAcceptanceCalibrationSampleResult(
            sample_id=sample.sample_id,
            case_type=sample.case_type,
            human_accept_revision=human_accepted,
            machine_accepted=decision.accepted,
            expected_machine_accepted=sample.expected_machine_accepted,
            machine_baseline_match=(
                decision.accepted == sample.expected_machine_accepted
            ),
            agreement=decision.accepted == human_accepted,
            legacy_improved=sample.legacy_improved,
            acceptance_reason=decision.acceptance_reason,
            stop_reason=decision.stop_reason,
            targeted_dimension_improvement=decision.targeted_dimension_improvement,
            regression_count=decision.regression_count,
            regressed_dimensions=decision.regressed_dimensions,
            protected_dimension_stability=decision.protected_dimension_stability,
            scene_alignment_rate=decision.scene_alignment_rate,
            revision_effectiveness=decision.revision_effectiveness,
            conflict_type=self._conflict_type(
                machine_accepted=decision.accepted,
                human_accepted=human_accepted,
                legacy_improved=sample.legacy_improved,
            ),
            reviewer_reason=sample.human_ground_truth.reviewer_reason,
            known_blind_spots=self._known_blind_spots(
                sample=sample,
                machine_accepted=decision.accepted,
            ),
        )

    def _known_blind_spots(
        self,
        *,
        sample: RevisionAcceptanceCalibrationSample,
        machine_accepted: bool,
    ) -> list[str]:
        ground_truth = sample.human_ground_truth
        if not machine_accepted or ground_truth.human_accept_revision:
            return []

        blind_spots: list[str] = []
        if ground_truth.dialogue_naturalness_change == DialogueNaturalnessChange.degraded:
            blind_spots.append("dialogue_naturalness_not_available_in_runtime_qc")
        if not ground_truth.character_consistency_preserved:
            blind_spots.append("character_voice_consistency_not_available_in_runtime_qc")
        return blind_spots

    def _conflict_type(
        self,
        *,
        machine_accepted: bool,
        human_accepted: bool,
        legacy_improved: bool,
    ) -> str:
        conflicts: list[str] = []
        if machine_accepted and not human_accepted:
            conflicts.append("acceptance_true_human_false")
        if not machine_accepted and human_accepted:
            conflicts.append("acceptance_false_human_true")
        if legacy_improved and not machine_accepted:
            conflicts.append("improved_true_acceptance_false")
        if not legacy_improved and machine_accepted:
            conflicts.append("improved_false_acceptance_true")
        return "+".join(conflicts) if conflicts else "none"

    def _rate(self, count: int, total: int) -> float:
        return round(count / total, 3) if total else 0.0

    def _average(self, values: Iterable[float]) -> float:
        normalized = list(values)
        return round(sum(normalized) / len(normalized), 3) if normalized else 0.0


def main() -> None:
    report = RevisionAcceptanceCalibrationEvaluator().run_from_fixtures()
    print(report.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
