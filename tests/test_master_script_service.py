import pytest

from app.modules.master_script.models import MasterScriptFinalizeRequest
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.master_script.repository import MasterScriptRepository
from app.modules.master_script.service import (
    DirectMasterScriptCreationDeprecatedError,
    FinalizationThresholdNotMetError,
    MasterScriptService,
)
from app.modules.script_engine.models import ScriptGenerationDraftRequest, ScriptRevisionRequest
from app.modules.script_engine.revision_service import ScriptRevisionService
from tests.test_script_generation_service import seed_dependencies


def build_finalize_request(
    *,
    output_language: str = "en",
    speaker_name_cycle: list[str] | None = None,
    minimum_re_qc_score_override: float | None = None,
) -> tuple[MasterScriptFinalizeRequest, MasterScriptService]:
    generation_service, content_spec_id = seed_dependencies()
    draft_run = generation_service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language=output_language,
            desired_scene_count=3,
        )
    )
    revision_service = ScriptRevisionService(
        generation_strategy_repository=generation_service._generation_strategy_repository,  # noqa: SLF001
    )
    revision_run = revision_service.revise(
        ScriptRevisionRequest(
            draft_master_script=draft_run.draft_master_script,
            revision_plan=draft_run.revision_plan,
        )
    )
    request = MasterScriptFinalizeRequest(
        script_generation_draft_run=draft_run,
        script_revision_run=revision_run,
        dialogue_line_count_per_scene=2,
        speaker_name_cycle=speaker_name_cycle or ["Heroine", "Counterpart"],
        minimum_re_qc_score_override=minimum_re_qc_score_override,
    )
    service = MasterScriptService(
        repository=MasterScriptRepository(),
        content_spec_repository=generation_service._content_spec_repository,  # noqa: SLF001
    )
    return request, service


def test_master_script_service_creates_final_script_from_controlled_chain() -> None:
    request, service = build_finalize_request()

    result = service.create_from_draft(request)

    assert result.source_draft_id == (
        request.script_revision_run.revised_draft_master_script.id
    )
    assert result.master_script.content_spec_id == request.script_generation_draft_run.content_spec_id
    assert result.master_script.scenes[-1].cliffhanger is True
    assert result.master_script.scenes[1].scene_causality.caused_by_scene_number == 1
    assert len(result.master_script.scenes[0].dialogues) == 2
    assert result.master_script.lineage.generation_strategy_version == "v1"
    assert result.master_script.lineage.selected_prompt_versions == ["v1"]
    assert result.master_script.lineage.re_qc_score >= 0.65
    assert result.master_script.lineage.speaker_name_cycle == ["Heroine", "Counterpart"]
    assert result.master_script.version == "final_master_script.v1"
    assert "End with a public reveal" not in result.master_script.scenes[-1].beat_summary
    assert "Make the cause of the next escalation explicit" not in result.master_script.scenes[-1].beat_summary
    assert "Let the lead make an irreversible choice" not in result.master_script.scenes[-1].purpose


def test_master_script_service_rejects_direct_creation() -> None:
    request, service = build_finalize_request()

    with pytest.raises(
        DirectMasterScriptCreationDeprecatedError,
        match="Direct FinalMasterScript creation is deprecated",
    ):
        service.create(request)


def test_master_script_service_restores_content_spec_from_generation_snapshot() -> None:
    request, _ = build_finalize_request()
    restored_repository = ContentSpecRepository()
    service = MasterScriptService(
        repository=MasterScriptRepository(),
        content_spec_repository=restored_repository,
    )

    result = service.create_from_draft(request)

    content_spec_id = request.script_generation_draft_run.content_spec_id
    assert result.master_script.content_spec_id == content_spec_id
    assert restored_repository.get(content_spec_id) is not None


def test_master_script_service_allows_explicit_no_revision_decision() -> None:
    request, service = build_finalize_request()
    draft_run = request.script_generation_draft_run.model_copy(deep=True)
    revision_run = request.script_revision_run.model_copy(deep=True)
    no_revision_decision = revision_run.revision_plan.revision_decision.model_copy(
        update={
            "revision_required": False,
            "selected_dimensions": [],
            "deferred_dimensions": [],
        }
    )
    no_revision_plan = revision_run.revision_plan.model_copy(
        update={
            "revision_decision": no_revision_decision,
            "revision_strategies": [],
            "actions": [],
        }
    )
    draft_run.revision_plan = no_revision_plan
    revision_run.revision_plan = no_revision_plan
    request = request.model_copy(
        update={
            "script_generation_draft_run": draft_run,
            "script_revision_run": revision_run,
        }
    )

    result = service.create_from_draft(request)

    assert result.master_script.id


def test_master_script_service_rejects_finalize_below_re_qc_threshold() -> None:
    request, service = build_finalize_request(minimum_re_qc_score_override=0.99)

    with pytest.raises(FinalizationThresholdNotMetError, match="below the minimum"):
        service.create_from_draft(request)
