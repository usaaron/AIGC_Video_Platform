from app.modules.script_engine.models import (
    ScriptGenerationDraftRequest,
    ScriptRevisionRequest,
)
from app.modules.script_engine.revision_service import ScriptRevisionService
from tests.test_script_generation_service import seed_dependencies


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
    assert result.revised_draft_master_script.id == draft_run.draft_master_script.id
    assert result.revised_draft_master_script.hook != draft_run.draft_master_script.hook
    assert result.revised_story_qc_report.overall_score >= result.original_story_qc_report.overall_score
    assert result.improved is True


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
