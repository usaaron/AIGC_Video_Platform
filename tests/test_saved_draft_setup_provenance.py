"""A saved episode's ledger has already advanced when its body is reviewed."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.continuity_qc import _setup_payoff_issues
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.models import EpisodeGenerationContext
from tests.test_master_script_models import build_draft_payload


def review_saved_source(record):
    payload = build_draft_payload()
    payload['setup_payoff_updates'] = [{
        'setup_payoff_ref': 'setup.signal', 'action': 'reinforce', 'status': 'active',
        'progress_summary': 'The witness verifies the earlier signal.',
        'change_cause': 'The investigator presents the earlier record.',
        'evidence_scene_numbers': [1],
    }]
    draft = DraftMasterScript.model_validate(payload)
    context = EpisodeGenerationContext(generation_mode='sequential', episode_number=3,
                                       total_episodes=4, ending_mode=draft.ending_mode)
    # The review request has only serialized public context, never private provenance.
    context = EpisodeGenerationContext.model_validate(context.model_dump())
    workspace = {'setupPayoffs': [record, {
        'ref': 'setup.unrelated', 'setupEpisode': 1, 'lastUpdatedEpisode': 3, 'status': 'active',
    }]}
    original = deepcopy(workspace)
    strategy = object()
    service = object.__new__(ScriptGenerationService)
    service._episode_plan_workspace_loader = lambda _: workspace
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: strategy)
    run = SimpleNamespace(episode_context=context, story_project_id='project.saved',
                          content_spec_id=draft.content_spec_id, generation_strategy_id=draft.generation_strategy_id)
    assert service._validate_source_run(run, draft) is strategy
    assert workspace == original
    assert all(item['source_ref'] != 'setup.unrelated' for item in context._persisted_setup_payoff_records)
    return context, draft


def test_saved_body_review_recovers_exact_earlier_source_advanced_by_current_save():
    context, draft = review_saved_source({
        'ref': 'setup.signal', 'setupEpisode': 1, 'lastUpdatedEpisode': 3, 'status': 'active',
    })
    assert [item['source_ref'] for item in context._persisted_setup_payoff_records] == ['setup.signal']
    assert _setup_payoff_issues(draft, {}, context) == []
    assert '_persisted_setup_payoff_records' not in context.model_dump()


@pytest.mark.parametrize('patch', [
    {'ref': 'setup.different'}, {'setupEpisode': 3}, {'setupEpisode': 4},
    {'setupEpisode': '1'}, {'setupEpisode': 0}, {'lastUpdatedEpisode': 4},
])
def test_saved_body_review_cannot_self_authorize_unknown_or_nonhistorical_source(patch):
    context, draft = review_saved_source({
        'ref': 'setup.signal', 'setupEpisode': 1, 'lastUpdatedEpisode': 3, 'status': 'active', **patch,
    })
    assert context._persisted_setup_payoff_records == []
    assert 'unknown_setup_payoff' in {issue.issue_type.value for issue in _setup_payoff_issues(draft, {}, context)}


def test_earlier_saved_body_review_uses_durable_earlier_history_without_future_status():
    context, draft = review_saved_source({
        'ref': 'setup.signal', 'setupEpisode': 1, 'lastUpdatedEpisode': 4, 'status': 'paid_off',
        'history': [{'episodeNumber': 2, 'action': 'reinforce'}, {'episodeNumber': 4, 'action': 'payoff'}],
    })
    assert context._persisted_setup_payoff_records[0]['source_ref'] == 'setup.signal'
    assert context._persisted_setup_payoff_records[0]['status'] is None
    assert _setup_payoff_issues(draft, {}, context) == []


@pytest.mark.parametrize('history', [[{'episodeNumber': 4}], [{'episodeNumber': 3}],
                                     [{'episodeNumber': '2'}], [{'episodeNumber': 0}]])
def test_future_or_current_only_history_cannot_authorize_an_earlier_edit(history):
    context, draft = review_saved_source({
        'ref': 'setup.signal', 'setupEpisode': 1, 'lastUpdatedEpisode': 4, 'status': 'paid_off',
        'history': history,
    })
    assert context._persisted_setup_payoff_records == []
    assert 'unknown_setup_payoff' in {issue.issue_type.value for issue in _setup_payoff_issues(draft, {}, context)}
