from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from evaluation.models import ComponentEvaluation
from evaluation.story_rubric import StoryRubricEvaluator


class ScriptEvaluator:
    def __init__(self) -> None:
        self._rubric_evaluator = StoryRubricEvaluator()

    def evaluate(self, script: Mapping[str, Any], *, stage: str) -> ComponentEvaluation:
        rubric_result = self._rubric_evaluator.evaluate(script, stage=stage)
        return ComponentEvaluation(
            component_name=f"{stage}_script_evaluation",
            score=rubric_result.overall_score,
            passed=rubric_result.passed,
            details=[
                f"{category.category_name}: {category.score}/{category.max_score}"
                for category in rubric_result.categories
            ],
            artifacts={"rubric": rubric_result.model_dump()},
        )
