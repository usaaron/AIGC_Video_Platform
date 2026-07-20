from __future__ import annotations

from collections.abc import Iterable

from app.modules.script_engine.models import (
    AcceptanceDecision,
    RevisionDecision,
    RevisionExecutionTrace,
    RevisionPolicy,
    RevisionStrategy,
    StoryQCDimension,
    StoryQCReport,
)


class RevisionAcceptanceEvaluator:
    """Compare one bounded revision with its original QC evidence."""

    decision_version = "revision_acceptance_decision.v1"
    _DIMENSION_SCORE_MAX = 5.0

    def evaluate(
        self,
        *,
        original_report: StoryQCReport,
        revised_report: StoryQCReport,
        revision_decision: RevisionDecision,
        revision_strategies: list[RevisionStrategy],
        execution_trace: RevisionExecutionTrace,
        policy: RevisionPolicy,
        revision_round: int = 1,
    ) -> AcceptanceDecision:
        original_scores = self._dimension_scores(original_report)
        revised_scores = self._dimension_scores(revised_report)
        selected_dimensions = revision_decision.selected_dimensions
        required_dimensions = set(original_scores) | set(revised_scores)
        missing_dimensions = required_dimensions - (
            set(original_scores) & set(revised_scores)
        )
        selected_missing = (
            set(selected_dimensions) - set(original_scores)
        ) | (
            set(selected_dimensions) - set(revised_scores)
        )
        explainability_available = bool(
            original_scores
            and revised_scores
            and selected_dimensions
            and not missing_dimensions
            and not selected_missing
        )

        improvements = (
            self._targeted_improvements(
                original_scores,
                revised_scores,
                selected_dimensions,
            )
            if explainability_available
            else {}
        )
        regressed_dimensions = (
            self._regressed_non_target_dimensions(
                original_scores,
                revised_scores,
                set(selected_dimensions),
                policy.dimension_regression_tolerance,
            )
            if explainability_available
            else []
        )
        protected_stable = explainability_available and not (
            set(regressed_dimensions) & set(revision_decision.protected_dimensions)
        )
        scene_alignment_rate = self._scene_alignment_rate(
            revision_strategies,
            selected_dimensions,
            execution_trace,
        )
        average_target_improvement = self._average(improvements.values())
        target_component = self._target_component(
            average_target_improvement,
            policy.minimum_improvement_threshold,
        )
        regression_safety = float(
            protected_stable and len(regressed_dimensions) <= policy.regression_limit
        )
        revision_effectiveness = round(
            (0.6 * target_component)
            + (0.2 * scene_alignment_rate)
            + (0.2 * regression_safety),
            3,
        )

        stop_reason = self._stop_reason(
            revision_round=revision_round,
            policy=policy,
            revision_decision=revision_decision,
            revision_strategies=revision_strategies,
            execution_trace=execution_trace,
            explainability_available=explainability_available,
            improvements=improvements,
            average_target_improvement=average_target_improvement,
            protected_stable=protected_stable,
            regression_count=len(regressed_dimensions),
            scene_alignment_rate=scene_alignment_rate,
            revision_effectiveness=revision_effectiveness,
        )
        accepted = stop_reason is None

        return AcceptanceDecision(
            accepted=accepted,
            acceptance_reason=self._acceptance_reason(
                accepted=accepted,
                average_target_improvement=average_target_improvement,
                regression_count=len(regressed_dimensions),
                scene_alignment_rate=scene_alignment_rate,
                revision_effectiveness=revision_effectiveness,
                stop_reason=stop_reason,
            ),
            targeted_dimension_improvement=improvements,
            regression_count=len(regressed_dimensions),
            protected_dimension_stability=protected_stable,
            stop_reason=stop_reason,
            decision_version=self.decision_version,
            policy_version=policy.policy_version,
            revision_round=revision_round,
            scene_alignment_rate=scene_alignment_rate,
            revision_effectiveness=revision_effectiveness,
            regressed_dimensions=regressed_dimensions,
        )

    def _dimension_scores(
        self,
        report: StoryQCReport,
    ) -> dict[StoryQCDimension, float]:
        return {
            evaluation.dimension: evaluation.score
            for evaluation in report.dimension_evaluations
        }

    def _targeted_improvements(
        self,
        original_scores: dict[StoryQCDimension, float],
        revised_scores: dict[StoryQCDimension, float],
        selected_dimensions: list[StoryQCDimension],
    ) -> dict[StoryQCDimension, float]:
        return {
            dimension: round(
                (revised_scores[dimension] - original_scores[dimension])
                / self._DIMENSION_SCORE_MAX,
                3,
            )
            for dimension in selected_dimensions
        }

    def _regressed_non_target_dimensions(
        self,
        original_scores: dict[StoryQCDimension, float],
        revised_scores: dict[StoryQCDimension, float],
        selected_dimensions: set[StoryQCDimension],
        tolerance: float,
    ) -> list[StoryQCDimension]:
        return [
            dimension
            for dimension in original_scores
            if dimension not in selected_dimensions
            and (
                (revised_scores[dimension] - original_scores[dimension])
                / self._DIMENSION_SCORE_MAX
            )
            < -tolerance
        ]

    def _scene_alignment_rate(
        self,
        strategies: list[RevisionStrategy],
        selected_dimensions: list[StoryQCDimension],
        execution_trace: RevisionExecutionTrace,
    ) -> float:
        selected = set(selected_dimensions)
        planned_scenes = {
            scene_ref
            for strategy in strategies
            if strategy.target_dimension in selected
            for scene_ref in strategy.scene_refs
        }
        modified_scenes = set(execution_trace.modified_scene_numbers)
        if not planned_scenes:
            return 1.0 if execution_trace.applied_actions else 0.0
        return round(
            len(planned_scenes & modified_scenes)
            / len(planned_scenes | modified_scenes),
            3,
        )

    def _target_component(
        self,
        average_improvement: float,
        minimum_threshold: float,
    ) -> float:
        if average_improvement <= 0:
            return 0.0
        if minimum_threshold == 0:
            return 1.0
        return round(min(average_improvement / minimum_threshold, 1.0), 3)

    def _stop_reason(
        self,
        *,
        revision_round: int,
        policy: RevisionPolicy,
        revision_decision: RevisionDecision,
        revision_strategies: list[RevisionStrategy],
        execution_trace: RevisionExecutionTrace,
        explainability_available: bool,
        improvements: dict[StoryQCDimension, float],
        average_target_improvement: float,
        protected_stable: bool,
        regression_count: int,
        scene_alignment_rate: float,
        revision_effectiveness: float,
    ) -> str | None:
        if revision_round > policy.max_revision_rounds:
            return "maximum_revision_rounds_exceeded"
        if not revision_decision.revision_required:
            return "revision_not_required"
        if not execution_trace.applied_actions:
            return "no_revision_actions_applied"
        if not revision_strategies:
            return "missing_revision_strategy"
        if not explainability_available:
            return "insufficient_qc_explainability"
        if any(
            value < -policy.dimension_regression_tolerance
            for value in improvements.values()
        ):
            return "target_dimension_regression"
        if average_target_improvement <= 0 or (
            average_target_improvement < policy.minimum_improvement_threshold
        ):
            return "target_improvement_below_threshold"
        if not protected_stable:
            return "protected_dimension_regression"
        if regression_count > policy.regression_limit:
            return "regression_limit_exceeded"
        if scene_alignment_rate <= 0:
            return "scene_scope_not_aligned"
        if revision_effectiveness < policy.acceptance_threshold:
            return "revision_effectiveness_below_threshold"
        return None

    def _acceptance_reason(
        self,
        *,
        accepted: bool,
        average_target_improvement: float,
        regression_count: int,
        scene_alignment_rate: float,
        revision_effectiveness: float,
        stop_reason: str | None,
    ) -> str:
        if not accepted:
            return (
                f"Revision rejected because {stop_reason}; effectiveness was "
                f"{revision_effectiveness:.3f}."
            )
        return (
            "Revision accepted: average targeted improvement was "
            f"{average_target_improvement:.3f}, scene alignment was "
            f"{scene_alignment_rate:.3f}, and regression count was "
            f"{regression_count}."
        )

    def _average(self, values: Iterable[float]) -> float:
        normalized = list(values)
        if not normalized:
            return 0.0
        return round(sum(normalized) / len(normalized), 3)
