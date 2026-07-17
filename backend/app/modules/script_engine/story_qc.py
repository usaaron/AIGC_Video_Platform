from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Mapping

from evaluation.story_rubric import StoryRubricEvaluator
from app.modules.script_engine.models import (
    GenerationStrategy,
    StoryQCCheck,
    StoryQCRubricCategory,
    StoryQCReport,
    StoryQCStatus,
)


class StoryQC(ABC):
    @abstractmethod
    def evaluate(
        self,
        draft_script: Mapping[str, Any],
        *,
        strategy: GenerationStrategy,
    ) -> StoryQCReport:
        raise NotImplementedError


class PlaceholderStoryQC(StoryQC):
    def __init__(self) -> None:
        self._rubric_evaluator = StoryRubricEvaluator()

    def evaluate(
        self,
        draft_script: Mapping[str, Any],
        *,
        strategy: GenerationStrategy,
    ) -> StoryQCReport:
        rubric_result = self._rubric_evaluator.evaluate(draft_script, stage="draft")
        checks = [
            StoryQCCheck(
                check_name="hook_present",
                passed=bool(draft_script.get("hook")),
                score=1.0 if draft_script.get("hook") else 0.3,
                note="Rubric-aligned check for hook presence.",
            ),
            StoryQCCheck(
                check_name="scenes_present",
                passed=bool(draft_script.get("scenes")),
                score=1.0 if draft_script.get("scenes") else 0.2,
                note="Rubric-aligned check for scene structure presence.",
            ),
            StoryQCCheck(
                check_name="strategy_qc_enabled",
                passed=strategy.qc_enabled,
                score=0.8 if strategy.qc_enabled else 0.4,
                note="Rubric-aligned check for strategy QC configuration.",
            ),
            StoryQCCheck(
                check_name="rubric_score",
                passed=rubric_result.passed,
                score=rubric_result.overall_score,
                note="Story quality rubric aggregate score.",
            ),
        ]
        overall_score = round(sum(check.score for check in checks) / len(checks), 3)
        return StoryQCReport(
            overall_score=overall_score,
            status=StoryQCStatus.placeholder,
            checks=checks,
            recommended_actions=[
                "Use the story rubric deductions and suggestions to build a revision plan."
            ],
            rubric_overall_score=rubric_result.overall_score,
            rubric_categories=[
                StoryQCRubricCategory(
                    category_name=category.category_name,
                    score=category.score,
                    max_score=category.max_score,
                    deduction_reasons=category.deduction_reasons,
                    revision_suggestions=category.revision_suggestions,
                )
                for category in rubric_result.categories
            ],
        )
