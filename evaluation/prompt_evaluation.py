from __future__ import annotations

from app.modules.script_engine.models import PromptBuildResult
from evaluation.models import ComponentEvaluation


class PromptEvaluator:
    def evaluate(self, prompt_build_result: PromptBuildResult) -> ComponentEvaluation:
        prompt_text = prompt_build_result.prompt_text
        rendered_variables = prompt_build_result.rendered_variables
        score_parts = [
            1.0 if len(prompt_text) >= 20 else 0.0,
            1.0 if bool(rendered_variables) else 0.4,
            1.0 if bool(prompt_build_result.trace.prompt_ids) else 0.0,
            1.0 if "{content_spec_title}" not in prompt_text else 0.0,
        ]
        score = round(sum(score_parts) / len(score_parts), 3)
        return ComponentEvaluation(
            component_name="prompt_evaluation",
            score=score,
            passed=score >= 0.75,
            details=[
                f"Rendered variable count: {len(rendered_variables)}.",
                f"Prompt ids resolved: {len(prompt_build_result.trace.prompt_ids)}.",
            ],
            artifacts={"builder_version": prompt_build_result.trace.builder_version},
        )
