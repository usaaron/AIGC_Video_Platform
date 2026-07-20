from typing import Any, Mapping

from app.modules.script_engine.models import (
    GenerationStrategy,
    ScriptGenerationDraftRequest,
    ScriptRevisionRequest,
    StoryQCReport,
)
from app.modules.script_engine.revision_service import ScriptRevisionService
from app.modules.script_engine.story_qc import StoryQC
from tests.test_script_generation_service import seed_dependencies


class FixedStoryQC(StoryQC):
    def __init__(self, report: StoryQCReport) -> None:
        self._report = report

    def evaluate(
        self,
        draft_script: Mapping[str, Any],
        *,
        strategy: GenerationStrategy,
    ) -> StoryQCReport:
        del draft_script, strategy
        return self._report.model_copy(deep=True)


def test_script_revision_service_revises_draft_and_re_qcs() -> None:
    generation_service, content_spec_id = seed_dependencies()
    draft_run = generation_service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )
    revision_service = ScriptRevisionService(
        generation_strategy_repository=generation_service._generation_strategy_repository,  # noqa: SLF001
    )

    result = revision_service.revise(
        ScriptRevisionRequest(
            draft_master_script=draft_run.draft_master_script,
            revision_plan=draft_run.revision_plan,
        )
    )

    assert result.applied_action_ids
    assert result.execution_trace is not None
    assert result.execution_trace.execution_mode.value == "controlled"
    assert result.acceptance_decision is not None
    assert result.acceptance_decision.decision_version == (
        "revision_acceptance_decision.v1"
    )
    assert result.acceptance_decision.policy_version == (
        "revision_acceptance_shadow_policy.v1"
    )
    assert result.revised_draft_master_script.id == draft_run.draft_master_script.id
    assert result.revised_draft_master_script.hook != draft_run.draft_master_script.hook
    assert result.revised_story_qc_report.overall_score >= result.original_story_qc_report.overall_score
    assert result.improved is True


def test_script_revision_service_records_rejected_shadow_acceptance() -> None:
    generation_service, content_spec_id = seed_dependencies()
    draft_run = generation_service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )
    revision_service = ScriptRevisionService(
        generation_strategy_repository=generation_service._generation_strategy_repository,  # noqa: SLF001
        story_qc=FixedStoryQC(draft_run.story_qc_report),
    )

    result = revision_service.revise(
        ScriptRevisionRequest(
            draft_master_script=draft_run.draft_master_script,
            revision_plan=draft_run.revision_plan,
        )
    )

    assert result.improved is True
    assert result.acceptance_decision is not None
    assert result.acceptance_decision.accepted is False
    assert result.acceptance_decision.stop_reason == (
        "target_improvement_below_threshold"
    )
    assert result.acceptance_decision.targeted_dimension_improvement
    assert all(
        improvement == 0.0
        for improvement in result.acceptance_decision.targeted_dimension_improvement.values()
    )


def test_script_revision_service_does_not_leak_revision_instructions_into_scene_text() -> None:
    generation_service, content_spec_id = seed_dependencies()
    draft_run = generation_service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )
    revision_service = ScriptRevisionService(
        generation_strategy_repository=generation_service._generation_strategy_repository,  # noqa: SLF001
    )

    result = revision_service.revise(
        ScriptRevisionRequest(
            draft_master_script=draft_run.draft_master_script,
            revision_plan=draft_run.revision_plan,
        )
    )

    final_scene = result.revised_draft_master_script.scenes[-1]
    assert "End with a public reveal" not in final_scene.beat_summary
    assert "Make the cause of the next escalation explicit" not in final_scene.beat_summary
    assert "Let the lead make an irreversible choice" not in final_scene.purpose


def test_script_revision_service_keeps_legacy_revision_plan_working() -> None:
    generation_service, content_spec_id = seed_dependencies()
    draft_run = generation_service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )
    legacy_plan = draft_run.revision_plan.model_copy(
        update={"revision_decision": None, "revision_strategies": []}
    )
    revision_service = ScriptRevisionService(
        generation_strategy_repository=generation_service._generation_strategy_repository,  # noqa: SLF001
    )

    result = revision_service.revise(
        ScriptRevisionRequest(
            draft_master_script=draft_run.draft_master_script,
            revision_plan=legacy_plan,
        )
    )

    assert result.execution_trace is not None
    assert result.execution_trace.execution_mode.value == "legacy_fallback"
    assert result.acceptance_decision is None
    assert result.execution_trace.skipped_actions == []
    assert result.applied_action_ids == [
        action.action_id for action in legacy_plan.actions
    ]
