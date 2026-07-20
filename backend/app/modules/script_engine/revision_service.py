from __future__ import annotations

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.revision_acceptance import RevisionAcceptanceEvaluator
from app.modules.script_engine.revision_executor import (
    RevisionExecutor,
    RuleBasedRevisionExecutor,
)
from app.modules.script_engine.models import (
    RevisionPolicy,
    RevisionPlan,
    ScriptRevisionRequest,
    ScriptRevisionRun,
)
from app.modules.script_engine.repository import GenerationStrategyRepository
from app.modules.script_engine.story_qc import PlaceholderStoryQC, StoryQC
from app.runtime_policies import REVISION_ACCEPTANCE_SHADOW_POLICY


class MissingRevisionGenerationStrategyError(ValueError):
    """Raised when a revision references a missing generation strategy."""


class InvalidRevisionPlanError(ValueError):
    """Raised when a revision plan does not match the provided draft."""


class ScriptRevisionService:
    def __init__(
        self,
        *,
        generation_strategy_repository: GenerationStrategyRepository,
        story_qc: StoryQC | None = None,
        revision_executor: RevisionExecutor | None = None,
        acceptance_evaluator: RevisionAcceptanceEvaluator | None = None,
        revision_policy: RevisionPolicy | None = None,
    ) -> None:
        self._generation_strategy_repository = generation_strategy_repository
        self._story_qc = story_qc or PlaceholderStoryQC()
        self._revision_executor = revision_executor or RuleBasedRevisionExecutor()
        self._acceptance_evaluator = (
            acceptance_evaluator or RevisionAcceptanceEvaluator()
        )
        self._revision_policy = revision_policy or REVISION_ACCEPTANCE_SHADOW_POLICY

    def revise(self, payload: ScriptRevisionRequest) -> ScriptRevisionRun:
        draft = payload.draft_master_script
        plan = payload.revision_plan
        self._validate_alignment(draft, plan)

        strategy = self._generation_strategy_repository.get(plan.generation_strategy_id)
        if strategy is None:
            raise MissingRevisionGenerationStrategyError(
                f"GenerationStrategy '{plan.generation_strategy_id}' was not found."
            )

        original_story_qc_report = self._story_qc.evaluate(
            draft.model_dump(),
            strategy=strategy,
        )
        execution_result = self._revision_executor.execute(
            draft=draft,
            plan=plan,
            strategies=plan.revision_strategies,
        )
        revised_draft = execution_result.revised_draft_master_script
        revised_story_qc_report = self._story_qc.evaluate(
            revised_draft.model_dump(),
            strategy=strategy,
        )
        acceptance_decision = None
        if plan.revision_decision is not None and plan.revision_strategies:
            acceptance_decision = self._acceptance_evaluator.evaluate(
                original_report=original_story_qc_report,
                revised_report=revised_story_qc_report,
                revision_decision=plan.revision_decision,
                revision_strategies=plan.revision_strategies,
                execution_trace=execution_result.execution_trace,
                policy=self._revision_policy,
                revision_round=1,
            )
        improved = revised_story_qc_report.overall_score >= original_story_qc_report.overall_score

        improvement_summary = [
            f"Story QC score changed from {original_story_qc_report.overall_score:.3f} to {revised_story_qc_report.overall_score:.3f}.",
            "Re-run Final MasterScript mapping only after the revised draft is accepted.",
        ]
        if improved:
            improvement_summary.insert(
                0,
                "Placeholder revision pass improved or preserved the draft Story QC score.",
            )
        else:
            improvement_summary.insert(
                0,
                "Placeholder revision pass did not improve the Story QC score yet.",
            )

        return ScriptRevisionRun(
            original_draft_master_script=draft,
            revision_plan=plan,
            revised_draft_master_script=revised_draft,
            original_story_qc_report=original_story_qc_report,
            revised_story_qc_report=revised_story_qc_report,
            applied_action_ids=execution_result.execution_trace.applied_actions,
            execution_trace=execution_result.execution_trace,
            acceptance_decision=acceptance_decision,
            improvement_summary=improvement_summary,
            improved=improved,
        )

    def _validate_alignment(
        self,
        draft: DraftMasterScript,
        plan: RevisionPlan,
    ) -> None:
        if draft.id != plan.draft_master_script_id:
            raise InvalidRevisionPlanError(
                "RevisionPlan draft_master_script_id does not match the provided DraftMasterScript."
            )
        if draft.content_spec_id != plan.content_spec_id:
            raise InvalidRevisionPlanError(
                "RevisionPlan content_spec_id does not match the provided DraftMasterScript."
            )
        if draft.generation_strategy_id != plan.generation_strategy_id:
            raise InvalidRevisionPlanError(
                "RevisionPlan generation_strategy_id does not match the provided DraftMasterScript."
            )
