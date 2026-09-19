"""Current-memory safety for amended screenplays; all storage is in-memory SQLite."""
from copy import deepcopy
import hashlib
import json

import pytest

from app.modules.script_engine.long_story_models import (
    ContinuityLedgerRollbackRequest, EpisodeArtifact, EpisodeArtifactCreate,
)
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.produced_plan_amendment import body_hash
from tests.test_produced_plan_amendment import (
    source_workspace, save, amended_candidate, resolution_candidate, closed_amendment,
)


def seed_historical_artifacts(service, workspace):
    """Simulate bodies and canonical artifacts saved before the planning reopen."""
    def operation(repository):
        project = repository.get_project(workspace['id'])
        result = []
        for episode in workspace['episodes']:
            payload = json.loads(episode['workingDraftJson'])
            encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
            artifact = EpisodeArtifact(
                artifact_id=f"artifact.history.{episode['episodeNumber']}", story_project_id=workspace['id'],
                episode_number=episode['episodeNumber'], artifact_kind='final', memory_layer='canonical',
                content_schema_version='draft_master_script.v1', content_payload=payload,
                artifact_version=1, payload_checksum=hashlib.sha256(encoded).hexdigest(), payload_size_bytes=len(encoded),
            )
            repository.save_episode_artifact(artifact)
            service._save_artifact_narrative_events(repository, artifact)
            service._save_artifact_continuity_checkpoint(repository, project, artifact, newly_persisted=True)
            result.append(artifact)
        return result
    return service._run(operation)


def accepted_artifact(workspace, number, *, artifact_id=None):
    return EpisodeArtifactCreate(
        artifact_id=artifact_id or f'artifact.accepted.{number}', story_project_id=workspace['id'],
        episode_number=number, artifact_kind='draft', memory_layer='canonical',
        planning_revision_epoch=workspace['planningRevisionEpoch'],
        content_schema_version='draft_master_script.v1',
        content_payload=json.loads(workspace['episodes'][number-1]['workingDraftJson']),
    )


def selected_numbers(service, project_id):
    return service._run(lambda repo: [item.episode_number for item in service._latest_canonical_episode_artifacts(repo, project_id)])


def test_pending_sources_never_return_old_checkpoint_or_replay_it(source_workspace):
    service, _, active, _ = source_workspace
    old_artifacts = seed_historical_artifacts(service, active)
    old = service.get_latest_continuity_ledger(active['id'])
    assert old.through_episode_number == 3
    amended = save(service, amended_candidate(active), 3)
    assert service.get_latest_continuity_ledger(active['id']) is None
    assert selected_numbers(service, active['id']) == []
    assert service.rebuild_continuity_ledger(active['id']) is None
    # Historical artifacts/checkpoints remain available; the current-memory endpoint hides them.
    assert len(service.list_episode_artifacts(active['id'])) == 3
    assert service.get_episode_artifact(active['id'], old_artifacts[0].artifact_id) == old_artifacts[0]
    history = service._run(lambda repo: repo.get_continuity_ledger_version(active['id'], old.version))
    assert history == old
    audit = service.audit_continuity_ledger(active['id'])
    assert audit.status.value == 'incomplete'
    assert any('Missing canonical artifacts' in reason for reason in audit.conflicts)
    with pytest.raises(LongStoryPersistenceConflictError, match='Rollback'):
        service.rollback_continuity_ledger(active['id'], ContinuityLedgerRollbackRequest(target_version=1))
    assert amended['producedPlanAmendments'][0]['originalEpisodes'] == active['episodes'][:2]


def test_accepted_draft_artifact_beats_old_final_and_rebuilds_valid_prefix(source_workspace):
    service, _, active, _ = source_workspace
    old_artifacts = seed_historical_artifacts(service, active)
    closed = closed_amendment(service, active)
    first = save(service, resolution_candidate(closed, 1), 5)
    assert service.get_latest_continuity_ledger(active['id']) is None
    accepted = service.save_episode_artifact(accepted_artifact(first, 1))
    assert selected_numbers(service, active['id']) == [1]
    ledger = service.get_latest_continuity_ledger(active['id'])
    assert ledger.through_episode_number == 1
    assert ledger.source_artifact_id == accepted.artifact_id
    assert service.audit_continuity_ledger(active['id']).status.value == 'consistent'
    # The original final has higher stage rank but is not current after adoption.
    selected = service._run(lambda repo: service._latest_canonical_episode_artifacts(repo, active['id']))
    assert [item.artifact_id for item in selected] == [accepted.artifact_id]
    assert service.get_episode_artifact(active['id'], old_artifacts[0].artifact_id).artifact_kind.value == 'final'
    stale = accepted_artifact(first, 1, artifact_id='artifact.stale.at.current.epoch').model_copy(update={
        'content_payload':old_artifacts[0].content_payload,
    })
    with pytest.raises(LongStoryPersistenceConflictError, match='accepted screenplay'):
        service.save_episode_artifact(stale)
    with pytest.raises(LongStoryPersistenceConflictError):
        service.save_episode_artifact(accepted_artifact(first, 2))


def test_unchanged_downstream_acceptance_replays_changed_predecessors(source_workspace):
    service, _, active, _ = source_workspace
    seed_historical_artifacts(service, active)
    closed = closed_amendment(service, active)
    first = save(service, resolution_candidate(closed, 1), 5)
    first_artifact = service.save_episode_artifact(accepted_artifact(first, 1))
    second = save(service, resolution_candidate(first, 2), 6)
    second_artifact = service.save_episode_artifact(accepted_artifact(second, 2))
    third = save(service, resolution_candidate(second, 3, revised=False), 7)
    # Third's old canonical body is unchanged, but the ledger must include the new prefix.
    service.save_episode_artifact(accepted_artifact(third, 3))
    ledger = service.get_latest_continuity_ledger(active['id'])
    assert ledger.through_episode_number == 3
    assert service.audit_continuity_ledger(active['id']).status.value == 'consistent'
    selected = service._run(lambda repo: service._latest_canonical_episode_artifacts(repo, active['id']))
    assert [item.artifact_id for item in selected[:2]] == [first_artifact.artifact_id, second_artifact.artifact_id]
    assert all(body_hash(third['episodes'][n-1]) == receipt['acceptedBodyHash']
               for n, receipt in enumerate(third['producedPlanAmendmentResolutions'], start=1))


def test_current_read_rejects_legacy_checkpoint_with_stale_predecessor_state(source_workspace):
    service, _, active, _ = source_workspace
    seed_historical_artifacts(service, active)
    closed = closed_amendment(service, active)
    first = save(service, resolution_candidate(closed, 1), 5)
    service.save_episode_artifact(accepted_artifact(first, 1))
    second = save(service, resolution_candidate(first, 2), 6)
    service.save_episode_artifact(accepted_artifact(second, 2))
    ledger = service.get_latest_continuity_ledger(active['id'])
    # Simulate an old implementation carrying an unrelated predecessor warning/state
    # into a checkpoint whose final artifact is otherwise the correct new artifact.
    stale = ledger.model_copy(update={'version':ledger.version+1,'warnings':['Superseded source residue.']})
    service._run(lambda repo: repo.save_continuity_ledger(stale))
    assert service.get_latest_continuity_ledger(active['id']) is None
    assert service.audit_continuity_ledger(active['id']).status.value == 'drifted'
    rebuilt = service.rebuild_continuity_ledger(active['id'])
    assert rebuilt is not None and not rebuilt.warnings
    assert service.get_latest_continuity_ledger(active['id']) == rebuilt


def test_legacy_late_edit_invalidates_entire_dependent_canonical_prefix(source_workspace):
    service, _, active, _ = source_workspace
    seed_historical_artifacts(service, active)
    current = closed_amendment(service, active)
    for number in (1, 2, 3):
        current = save(service, resolution_candidate(current, number, revised=number < 3), number + 4)
        service.save_episode_artifact(accepted_artifact(current, number))
    assert service.get_latest_continuity_ledger(active['id']).through_episode_number == 3

    # Older persistence code/imported workspaces might already contain such a late
    # edit. The current-memory view must reject stale receipts independently of PUT.
    def inject_historical_inconsistent_snapshot(repository):
        snapshot = repository.get_workspace_snapshot(active['id'])
        changed = deepcopy(snapshot.workspace_payload)
        draft = json.loads(changed['episodes'][0]['workingDraftJson'])
        draft['synopsis'] = 'A later edit changes the original causal basis.'
        changed['episodes'][0]['workingDraftJson'] = json.dumps(draft)
        repository.save_workspace_snapshot(snapshot.model_copy(update={
            'revision':snapshot.revision+1, 'workspace_payload':changed,
        }))
    service._run(inject_historical_inconsistent_snapshot)
    assert selected_numbers(service, active['id']) == []
    assert service.get_latest_continuity_ledger(active['id']) is None
    assert service.rebuild_continuity_ledger(active['id']) is None
    assert service.audit_continuity_ledger(active['id']).status.value == 'incomplete'


@pytest.mark.parametrize('change',['body','plan'])
def test_completed_review_cannot_silently_change_and_leave_dependent_receipts_valid(source_workspace, change):
    service, _, active, _ = source_workspace
    current = closed_amendment(service, active)
    for number in (1, 2, 3):
        current = save(service, resolution_candidate(current, number, revised=number < 3), number + 4)
    candidate = deepcopy(current)
    if change == 'body':
        draft = json.loads(candidate['episodes'][0]['workingDraftJson'])
        draft['synopsis'] = 'A changed predecessor invalidates the downstream causal review.'
        candidate['episodes'][0]['workingDraftJson'] = json.dumps(draft)
    else:
        candidate['episodeRoadmaps'][0]['synopsis'] = '普通保存不能改变已复核正文的执行来源。'
    with pytest.raises(LongStoryPersistenceConflictError, match='explicit amendment'):
        save(service, candidate, 8)
    assert service.get_workspace_snapshot(active['id']).workspace_payload == current
