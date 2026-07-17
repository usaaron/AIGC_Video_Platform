from __future__ import annotations

from app.modules.script_engine.models import StoryQCReport
from evaluation.models import ComponentEvaluation


class StoryQCEvaluator:
    def evaluate(self, report: StoryQCReport) -> ComponentEvaluation:
        check_density = min(len(report.checks) / 5.0, 1.0)
        action_quality = 1.0 if report.recommended_actions else 0.4
        status_quality = 1.0 if report.status.value in {"placeholder", "pass_with_notes"} else 0.3
        score = round((report.overall_score + check_density + action_quality + status_quality) / 4, 3)
        return ComponentEvaluation(
            component_name="story_qc_evaluation",
            score=score,
            passed=score >= 0.65,
            details=[
                f"Story QC status: {report.status.value}.",
                f"Story QC checks: {len(report.checks)}.",
            ],
            artifacts={"raw_report": report.model_dump()},
        )
