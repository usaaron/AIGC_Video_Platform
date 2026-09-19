from copy import deepcopy
import json
from pathlib import Path

import pytest

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.continuity_qc import (
    BlockingContinuityConflictError, _setup_payoff_issues, evaluate_episode_continuity,
)
from app.modules.script_engine.models import (
    EpisodeGenerationContext, ScriptDraftReviewRequest, ScriptGenerationDraftRequest,
)
from app.modules.script_engine.setup_payoff_provenance import stable_setup_payoff_id
from tests.test_script_generation_service import seed_dependencies


@pytest.fixture
def actual_candidate():
    data = json.loads((Path(__file__).parent / "fixtures/domestic-episode-one-unknown-setup.json").read_text())
    return DraftMasterScript.model_validate(data["draft"]), EpisodeGenerationContext.model_validate(data["context"])


def test_actual_domestic_candidate_blocks_unknown_knowledge_id_but_keeps_missing_refs_advisory(actual_candidate):
    draft, context = actual_candidate
    before = draft.model_dump()
    assert sum(len(scene.dialogues) for scene in draft.scenes) == 25
    assert len(context.approved_episode_plan.setup_refs) == 2
    report = evaluate_episode_continuity(draft, context)
    assert report.status.value == "blocked"
    assert report.blocking_issue_count == 1
    assert report.warning_count == 2
    issue = next(item for item in report.issues if item.severity.value == "blocking")
    assert issue.issue_type.value == "unknown_setup_payoff"
    assert issue.entity_key == "knowledge.story.causal_sequence.v1"
    assert {item.issue_type.value for item in report.issues if item.severity.value == "warning"} == {"missing_planned_setup"}
    assert draft.model_dump() == before


def test_real_review_service_rejects_actual_candidate_without_model_or_body_mutation(actual_candidate):
    draft, context = actual_candidate
    service, content_spec_id = seed_dependencies()
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="zh", desired_scene_count=1,
    ))
    draft = draft.model_copy(update={
        "content_spec_id": content_spec_id, "generation_strategy_id": source.generation_strategy_id,
    })
    source = source.model_copy(update={"draft_master_script": draft, "episode_context": context})
    before = draft.model_dump()
    with pytest.raises(BlockingContinuityConflictError) as caught:
        service.review_draft(ScriptDraftReviewRequest(source_generation_run=source, draft_master_script=draft))
    assert caught.value.report.blocking_issue_count == 1
    assert draft.model_dump() == before


@pytest.mark.parametrize("form", ["exact_source", "stable_id", "stable_id_in_source"])
def test_approved_prose_and_proven_legacy_hashes_are_accepted_without_changing_ledger(actual_candidate, form):
    draft, context = actual_candidate
    updates = []
    for reference in context.approved_episode_plan.setup_refs:
        identity = stable_setup_payoff_id(reference)
        updates.append(draft.setup_payoff_updates[0].model_copy(update={
            "setup_payoff_ref": identity,
            "source_ref": reference if form == "exact_source" else identity if form == "stable_id_in_source" else None,
        }))
    draft = draft.model_copy(update={"setup_payoff_updates": updates})
    before = draft.model_dump()
    assert _setup_payoff_issues(draft, {}, context) == []
    assert draft.model_dump() == before


@pytest.mark.parametrize("source_ref", [None, "旧账本完整中文来源。", "setup.old_approved"])
def test_existing_ledger_id_or_source_is_legal_even_when_not_repeated_in_current_plan(actual_candidate, source_ref):
    draft, context = actual_candidate
    draft.setup_payoff_updates[0] = draft.setup_payoff_updates[0].model_copy(update={
        "setup_payoff_ref": "setup.old_approved", "source_ref": source_ref,
    })
    ledger = {"open_setup_payoffs": [{
        "setup_payoff_id": "setup.old_approved", "source_ref": "旧账本完整中文来源。", "setup_episode": 1,
    }]}
    issues = _setup_payoff_issues(draft, ledger, context)
    assert len(issues) == 2
    assert all(item.issue_type.value == "missing_planned_setup" and item.severity.value == "warning" for item in issues)


def test_explicit_unknown_source_cannot_hide_behind_a_valid_technical_id(actual_candidate):
    draft, context = actual_candidate
    draft.setup_payoff_updates[0] = draft.setup_payoff_updates[0].model_copy(update={
        "setup_payoff_ref": stable_setup_payoff_id(context.approved_episode_plan.setup_refs[0]),
        "source_ref": "knowledge.story.causal_sequence.v1",
    })
    assert any(item.severity.value == "blocking" for item in _setup_payoff_issues(draft, {}, context))


def test_unapproved_context_cannot_whitelist_an_unknown_ref_using_its_convenience_list(actual_candidate):
    draft, context = actual_candidate
    context.planned_setup_refs.append("knowledge.story.causal_sequence.v1")
    assert any(item.severity.value == "blocking" for item in _setup_payoff_issues(draft, {}, context))


def test_no_approved_plan_retains_legacy_warning_and_missing_only_is_not_a_hard_failure(actual_candidate):
    draft, context = actual_candidate
    legacy = context.model_copy(update={"approved_episode_plan": None})
    assert all(item.severity.value == "warning" for item in _setup_payoff_issues(draft, {}, legacy))
    draft = draft.model_copy(update={"setup_payoff_updates": []})
    issues = _setup_payoff_issues(draft, {}, context)
    assert len(issues) == 2
    assert all(item.severity.value == "warning" for item in issues)


def test_ambiguous_legacy_id_is_not_guessed(actual_candidate):
    draft, context = actual_candidate
    draft.setup_payoff_updates[0] = draft.setup_payoff_updates[0].model_copy(update={
        "setup_payoff_ref": "setup.ambiguous", "source_ref": None,
    })
    ledger = {"setup_payoffs": [
        {"setup_payoff_id": "setup.ambiguous", "source_ref": reference}
        for reference in ("完整旧引用甲。", "完整旧引用乙。")
    ]}
    assert any(item.severity.value == "blocking" for item in _setup_payoff_issues(draft, ledger, context))


def test_compressed_checkpoint_keeps_saved_setup_identity_after_server_hydration(actual_candidate):
    from app.modules.script_engine.generation_service import ScriptGenerationService
    draft, context = actual_candidate
    context.episode_number = 54
    context.total_episodes = 72
    context.approved_story_node = None
    context.planned_setup_refs = []
    context.planned_payoff_refs = []
    context.approved_episode_plan = context.approved_episode_plan.model_copy(update={"episode_number": 54, "setup_refs": [], "payoff_refs": []})
    reference = "sl_main_responsibility"
    draft = draft.model_copy(update={"setup_payoff_updates": [draft.setup_payoff_updates[0].model_copy(update={
        "setup_payoff_ref": reference, "source_ref": None,
    })]})
    # Actual failure shape: the compact checkpoint retains only the last hook,
    # while the persisted project has an older setup with a story-line-like ID.
    checkpoint = {"open_setup_payoffs": [{"setup_payoff_id": "hook.episode_0053", "setup_episode": 53}]}
    assert any(x.issue_type.value == "unknown_setup_payoff" for x in _setup_payoff_issues(draft, checkpoint, context))
    workspace = {"setupPayoffs": [{"ref": reference, "setupEpisode": 7, "lastUpdatedEpisode": 53, "status": "open"}]}
    original = deepcopy(workspace)
    ScriptGenerationService._validate_setup_payoff_sources(context, workspace)
    assert _setup_payoff_issues(draft, checkpoint, context) == []
    assert workspace == original
    assert "_persisted_setup_payoff_records" not in context.model_dump()
    # A serialized recovery context must be revalidated, not self-authorize.
    recovered = EpisodeGenerationContext.model_validate(context.model_dump())
    assert not recovered._persisted_setup_payoff_records
    ScriptGenerationService._validate_setup_payoff_sources(recovered, workspace)
    assert _setup_payoff_issues(draft, checkpoint, recovered) == []
    # An invented source label still blocks even if the technical ID is real.
    forged = draft.model_copy(update={"setup_payoff_updates": [draft.setup_payoff_updates[0].model_copy(
        update={"source_ref": "episode_53_scene_3_street_pressure"})]})
    assert any(x.issue_type.value == "unknown_setup_payoff" for x in _setup_payoff_issues(forged, checkpoint, context))


@pytest.mark.parametrize("first,last", [(54,54), (55,55), (7,54), (True,53), (7,None)])
def test_persisted_setup_hydration_does_not_admit_current_future_or_invalid_history(actual_candidate, first, last):
    from app.modules.script_engine.generation_service import ScriptGenerationService
    _, context = actual_candidate
    context.episode_number = 54
    ScriptGenerationService._validate_setup_payoff_sources(context, {"setupPayoffs": [
        {"ref": "setup.unproven", "setupEpisode": first, "lastUpdatedEpisode": last},
    ]})
    assert context._persisted_setup_payoff_records == []


def test_writer_receives_same_durable_identity_table_as_continuity_gate(actual_candidate):
    from app.modules.script_engine.generation_service import ScriptGenerationService
    _, context = actual_candidate
    context.episode_number = 2
    context.total_episodes = 3
    context.approved_story_node = None
    context.approved_episode_plan = context.approved_episode_plan.model_copy(update={"episode_number": 2})
    service, content_spec_id = seed_dependencies()
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="zh", desired_scene_count=1,
    ))
    # Exercise the normal writer boundary with an authoritative workspace loader.
    service._episode_plan_workspace_loader = lambda _: {"setupPayoffs": [
        {"ref": "setup.existing", "setupEpisode": 1, "lastUpdatedEpisode": 1, "status": "open"},
    ]}
    service._episode_plan_history_loader = None
    result = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, generation_strategy_id=source.generation_strategy_id,
        story_project_id="project.identity-regression", output_language="zh", desired_scene_count=1,
        episode_context=context,
    ))
    packet = json.loads(result.prompt_build_result.rendered_variables["episode_context_json"])
    assert packet["persisted_setup_payoff_identities"] == context._persisted_setup_payoff_records
    assert packet["persisted_setup_payoff_identities"][0]["source_ref"] == "setup.existing"
