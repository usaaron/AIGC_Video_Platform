from copy import deepcopy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.draft_scalar_normalization import normalize_draft_scalar_contracts
from app.modules.script_engine.continuity_ledger import _project_setup_payoffs
from app.modules.script_engine.continuity_qc import _setup_payoff_issues
from app.modules.script_engine.generation_service import ScriptGenerationService, EpisodeExecutionNotReadyError
from app.modules.script_engine.models import EpisodeGenerationContext
from app.modules.script_engine.narrative_events import build_narrative_event_set
from app.modules.script_engine.setup_payoff_provenance import (
    same_episode_setup_payoff_sources, stable_setup_payoff_id, validate_same_episode_setup_payoff_sources,
)
from tests.test_master_script_models import build_draft_payload
from tests.test_narrative_events import build_artifact


def actual_case():
    fixture = json.loads((Path(__file__).parent / 'fixtures/overseas-episode-three-memory.json').read_text())
    workspace = fixture['project']
    context = EpisodeGenerationContext.model_validate(fixture['context'])
    sources = same_episode_setup_payoff_sources(workspace, 3, workspace['storyBibleVersion'])
    context.memory_recall = context.memory_recall.model_copy(update={'same_episode_setup_payoffs': sources})
    return workspace, context


def test_actual_holdout_episode_three_resolves_only_approved_current_setup_timing():
    workspace, context = actual_case()
    assert len(context.memory_recall.same_episode_setup_payoffs) == 3
    original = deepcopy(workspace)
    ScriptGenerationService._validate_setup_payoff_sources(context, workspace)
    assert context._verified_same_episode_setup_payoff_refs == set(context.planned_payoff_refs)
    assert workspace == original
    assert context.memory_recall.capsules == []  # No invented earlier evidence.
    assert '_verified_same_episode_setup_payoff_refs' not in context.model_dump()
    reloaded = EpisodeGenerationContext.model_validate(context.model_dump())
    assert not reloaded._verified_same_episode_setup_payoff_refs


@pytest.mark.parametrize('change', [
    'no_workspace', 'missing_prefix', 'draft_prefix', 'newer_draft_lineage', 'source_version',
    'modified_current_body', 'earlier_plan_setup', 'earlier_plan_payoff', 'actual_ledger',
    'actual_body_without_ledger', 'active_revision', 'wrong_bible',
])
def test_claim_requires_durable_current_approved_lineage_and_no_earlier_source(change):
    workspace, context = actual_case()
    reference = context.planned_payoff_refs[0]
    if change == 'no_workspace': workspace = None
    elif change == 'missing_prefix': workspace['episodeRoadmaps'].pop(0)
    elif change == 'draft_prefix': workspace['episodeRoadmaps'][0]['status'] = 'draft'
    elif change == 'newer_draft_lineage':
        row = deepcopy(workspace['episodeRoadmaps'][-1]); row['source_node_version'] += 1; row['status'] = 'draft'
        workspace['episodeRoadmaps'].append(row)
    elif change == 'source_version': workspace['episodeRoadmaps'][-1]['source_node_version'] += 1
    elif change == 'modified_current_body': workspace['episodeRoadmaps'][-1]['scene_execution_plan'][0]['visible_action'] += '合法但尚未更新请求的新动作。'
    elif change == 'earlier_plan_setup': workspace['episodeRoadmaps'][0]['setup_refs'].append(reference)
    elif change == 'earlier_plan_payoff': workspace['episodeRoadmaps'][0]['payoff_refs'].append(reference)
    elif change == 'actual_ledger': workspace['setupPayoffs'].append({'ref': reference, 'setupEpisode': 1, 'lastUpdatedEpisode': 3, 'history': []})
    elif change == 'actual_body_without_ledger': workspace['episodes'][0]['generationRun']['draft_master_script']['setup_payoff_updates'].append({'setup_payoff_ref': reference})
    elif change == 'active_revision': workspace['planningRevision'] = {'status': 'active'}
    elif change == 'wrong_bible': workspace['storyBibleVersion'] += 1
    with pytest.raises(EpisodeExecutionNotReadyError, match='批准来源'):
        ScriptGenerationService._validate_setup_payoff_sources(context, workspace)
    assert not context._verified_same_episode_setup_payoff_refs


def test_no_provenance_keeps_legacy_missing_history_and_untrusted_boolean_cannot_grant_exception():
    workspace, context = actual_case()
    context.memory_recall = context.memory_recall.model_copy(update={'same_episode_setup_payoffs': []})
    validate_same_episode_setup_payoff_sources(context, workspace)
    assert context.memory_recall.status.value == 'insufficient'
    assert context.memory_recall.missing_requirements == context.planned_payoff_refs
    claim = same_episode_setup_payoff_sources(workspace, 3, 2)[0].model_dump()
    claim['approved'] = True
    with pytest.raises(ValidationError):
        type(context.memory_recall).model_validate({**context.memory_recall.model_dump(), 'same_episode_setup_payoffs': [claim]})


def test_legacy_split_group_in_earlier_plan_cannot_disguise_a_new_atomic_setup():
    workspace, _ = actual_case()
    reference = '先留下的证据；本次解开原因，关系产生变化。'
    workspace['episodeRoadmaps'][0]['setup_refs'] = ['先留下的证据', '本次解开原因', '关系产生变化。']
    workspace['episodeRoadmaps'][-1]['setup_refs'] = [reference]
    workspace['episodeRoadmaps'][-1]['payoff_refs'] = [reference]
    assert same_episode_setup_payoff_sources(workspace, 3, 2) == []


def payoff_draft(references, scenes=None):
    payload = build_draft_payload()
    payload['setup_payoff_updates'] = [{
        'setup_payoff_ref': reference, 'action': 'payoff', 'status': 'paid_off',
        'progress_summary': 'Noah先面对过去的缺席，再当面承认原因。',
        'change_cause': 'Sam当面追问后Noah作出回答。', 'evidence_scene_numbers': scenes if scenes is not None else [1],
    } for reference in references]
    normalize_draft_scalar_contracts(payload)
    return DraftMasterScript.model_validate(payload)


def test_same_episode_qc_uses_verified_source_and_real_scene_evidence_only():
    workspace, context = actual_case()
    draft = payoff_draft(context.planned_payoff_refs)
    # Merely carrying a serialized client claim grants nothing.
    assert {issue.issue_type.value for issue in _setup_payoff_issues(draft, {}, context)} == {
        'missing_planned_setup', 'setup_payoff_plan_deviation',
    }
    validate_same_episode_setup_payoff_sources(context, workspace)
    assert _setup_payoff_issues(draft, {}, context) == []
    invalid = draft.model_copy(deep=True)
    invalid.setup_payoff_updates[0].evidence_scene_numbers = [99]
    assert _setup_payoff_issues(invalid, {}, context)


def test_chinese_reference_survives_canonical_events_and_same_episode_ledger_with_stable_id():
    reference = '诺亚两年前缺席的真正原因是临场怯场；他不再用旧借口掩盖，成为关系修复的关键。'
    update = payoff_draft([reference]).setup_payoff_updates[0].model_dump(mode='json')
    artifact = build_artifact().model_copy(update={'episode_number': 3, 'content_payload': {'setup_payoff_updates': [update]}})
    _, events = build_narrative_event_set(artifact)
    event = next(event for event in events if event.event_type.value == 'setup_payoff_updated')
    assert event.entity_refs == [stable_setup_payoff_id(reference)]
    assert event.state_mutation['setup_payoff_ref'] == stable_setup_payoff_id(reference)
    assert event.state_mutation['source_ref'] == reference
    records = _project_setup_payoffs([], [event.state_mutation], 3)
    record = records[0]
    assert record.source_ref == reference
    assert record.setup_payoff_id == stable_setup_payoff_id(reference)
    assert record.setup_episode == record.payoff_episode == 3
    assert _project_setup_payoffs(records, [event.state_mutation], 3) == records
    # Technical IDs keep their existing identity.
    assert stable_setup_payoff_id('setup.original') == 'setup.original'
    workspace, context = actual_case()
    context = context.model_copy(update={'planned_setup_refs': [], 'planned_payoff_refs': [reference]})
    assert _setup_payoff_issues(payoff_draft([reference]), {'setup_payoffs': [record.model_dump()]}, context) == []


def test_generation_entry_revalidates_claim_before_any_writer_call():
    from app.modules.script_engine.models import ScriptGenerationDraftRequest
    from tests.test_script_generation_service import seed_dependencies
    service, content_spec_id = seed_dependencies()
    workspace, context = actual_case()
    workspace['episodeRoadmaps'][0]['status'] = 'draft'
    service._episode_plan_workspace_loader = lambda project_id: workspace
    request = ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, story_project_id='7f8f6737-8ecf-47f3-86e6-3804b9edebef',
        generation_strategy_id='strategy.tiktok.service_generation.v1', output_language='en',
        episode_context=context,
    )
    with pytest.raises(EpisodeExecutionNotReadyError, match='批准来源'):
        service.generate_draft(request)
    assert not context._verified_same_episode_setup_payoff_refs


def test_prose_reference_normalization_is_atomic_stable_and_idempotent():
    reference = 'Noah两年前缺席的真正原因是临场怯场；他不再用旧借口掩盖。'
    draft = payoff_draft([reference])
    update = draft.setup_payoff_updates[0]
    assert update.source_ref == reference
    assert update.setup_payoff_ref == stable_setup_payoff_id(reference)
    payload = draft.model_dump(mode='json')
    original = deepcopy(payload['setup_payoff_updates'])
    normalize_draft_scalar_contracts(payload)
    assert payload['setup_payoff_updates'] == original
    technical = payoff_draft(['setup.old_signal']).setup_payoff_updates[0]
    assert technical.setup_payoff_ref == 'setup.old_signal'
    assert technical.source_ref is None
    invalid = update.model_dump(); invalid['setup_payoff_ref'] = reference
    with pytest.raises(ValidationError):
        type(update).model_validate(invalid)  # The technical-ID contract remains strict.


def test_artifact_to_checkpoint_retains_original_reference_and_same_episode_dates():
    from app.modules.script_engine.continuity_ledger import project_episode_artifact_to_ledger
    from tests.test_long_story_repository import build_story_bible
    reference = '本集首次提出的完整问题；同集经过选择后给出答案。'
    update = payoff_draft([reference]).setup_payoff_updates[0].model_dump(mode='json')
    artifact = build_artifact().model_copy(update={
        'episode_number': 3, 'content_payload': {'setup_payoff_updates': [update]},
    })
    ledger = project_episode_artifact_to_ledger(artifact=artifact, story_bible=build_story_bible(), previous=None)
    record = ledger.setup_payoffs[0]
    assert record.setup_payoff_id == stable_setup_payoff_id(reference)
    assert record.source_ref == reference
    assert record.setup_episode == record.payoff_episode == 3
