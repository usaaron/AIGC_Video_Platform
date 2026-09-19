from copy import deepcopy
import json
from datetime import datetime, timezone

import pytest
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.agent_runtime.models import AgentRunPolicy
from app.modules.agent_runtime.service import AgentRunService
from app.modules.agent_runtime.repository import AgentRunPersistenceConflictError
from app.modules.script_engine.long_story_models import StoryProjectWorkspaceSave, GenerationBatchStatus, GenerationJobStatus, PlanningApprovalStatus, EpisodeDevelopment
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError, LongStoryRepository
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.planning_revision import validate_workspace_transition
from app.modules.script_engine.planning_review_cache import CURRENT_REVIEW_CONTRACT_VERSION, quality_episode_projection, quality_node_signature
from tests.test_long_story_api import build_project, build_generation_task, build_story_bible, build_story_plan_node, NOW


@pytest.fixture
def revision_workspace():
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = LongStoryService(runtime)
    service.save_project(build_project())
    payload = {
        "id": build_project().project_id, "storyBibleVersion": 1,
        "episodes": [{"id": "episode.saved", "episodeNumber": 1, "workingDraftJson": "original body"}],
        "generationBatches": [],
        "planningSession": {"phase": "script", "status": "approved"},
        "episodeRoadmaps": [{"episode_number": n, "story_bible_version": 1, "status": "approved",
                             "source_node_id": "node.future", "source_node_version": 1,
                             "synopsis": f"第{n}集原稿"} for n in range(1, 5)],
        "storyTreeQualityAudit": {"status": "needs_revision", "summary": "保留原审阅。"},
    }
    service.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id=payload["id"], client_instance_id="client.revision", revision=1, workspace_payload=payload,
    ))
    yield service, runtime, payload
    runtime.engine.dispose()


def opened_payload(source, *, start=2):
    result = deepcopy(source)
    result["planningRevisionEpoch"] = 1
    result["planningRevision"] = {
        "revisionId": "planning-revision.first", "status": "active",
        "startEpisode": start,
        "sourceWorkspaceRevision": 1, "startedAt": datetime.now(timezone.utc).isoformat(),
        "originalRoadmaps": deepcopy([row for row in source["episodeRoadmaps"] if row["episode_number"] >= start]),
        "originalAudit": deepcopy(source["storyTreeQualityAudit"]),
        "originalPlanningSession": deepcopy(source["planningSession"]),
        "invalidatedJobIds": [],
    }
    result["planningRevisionHistory"] = []
    result.pop("storyTreeQualityAudit", None)
    for item in result["episodeRoadmaps"]:
        if item["episode_number"] >= start:
            item["status"] = "draft"
    return result


def save(service, payload, revision=2):
    return service.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id=payload["id"], client_instance_id="client.revision", revision=revision, workspace_payload=payload,
    ))


def test_future_revision_preserves_existing_bodies_prefix_and_original_history(revision_workspace):
    service, _, source = revision_workspace
    saved = save(service, opened_payload(source)).workspace_payload
    assert saved["episodes"] == source["episodes"]
    assert saved["episodeRoadmaps"][0] == source["episodeRoadmaps"][0]
    assert [item["status"] for item in saved["episodeRoadmaps"]] == ["approved", "draft", "draft", "draft"]
    assert saved["planningRevision"]["originalRoadmaps"] == source["episodeRoadmaps"][1:]
    assert saved["planningRevision"]["originalAudit"] == source["storyTreeQualityAudit"]
    assert saved["planningSession"] == source["planningSession"]
    assert "epoch" not in saved["planningRevision"]
    assert "frozenThroughEpisode" not in saved["planningRevision"]


@pytest.mark.parametrize("change", ["body_boundary", "stale_source", "missing_original", "deleted_tail", "changed_prefix", "new_body", "original_tampered"])
def test_future_revision_open_rejects_unsafe_transition_atomically(revision_workspace, change):
    service, _, source = revision_workspace
    candidate = opened_payload(source)
    if change == "body_boundary": candidate["planningRevision"]["startEpisode"] = 1
    elif change == "stale_source": candidate["planningRevision"]["sourceWorkspaceRevision"] = 0
    elif change == "missing_original": candidate["planningRevision"].pop("originalRoadmaps")
    elif change == "deleted_tail": candidate["episodeRoadmaps"].pop()
    elif change == "changed_prefix": candidate["episodeRoadmaps"][0]["synopsis"] = "改写前文"
    elif change == "new_body": candidate["episodes"].append({"episodeNumber": 2})
    else: candidate["planningRevision"]["originalRoadmaps"][1]["synopsis"] = "伪造原稿"
    with pytest.raises(LongStoryPersistenceConflictError): save(service, candidate)
    assert service.get_workspace_snapshot(source["id"]).workspace_payload == source


@pytest.mark.parametrize("change", ["remove_active", "reset_epoch", "history", "snapshot", "prefix", "body", "delete_tail", "settings", "continuity", "session", "close_unreviewed"])
def test_active_future_revision_cannot_be_bypassed_by_workspace_save(revision_workspace, change):
    service, _, source = revision_workspace
    active = save(service, opened_payload(source)).workspace_payload
    candidate = deepcopy(active)
    if change == "remove_active": candidate.pop("planningRevision")
    elif change == "reset_epoch": candidate["planningRevisionEpoch"] = 0
    elif change == "history": candidate["planningRevisionHistory"] = [{"status": "completed"}]
    elif change == "snapshot": candidate["planningRevision"]["originalAudit"] = None
    elif change == "prefix": candidate["episodeRoadmaps"][0]["synopsis"] = "改写既有前文"
    elif change == "body": candidate["episodes"][0]["workingDraftJson"] = "正文改写"
    elif change == "delete_tail": candidate["episodeRoadmaps"].pop()
    elif change == "settings": candidate["generationSettings"] = {"episodeCount": 72}
    elif change == "continuity": candidate["confirmedContinuityCheckpoint"] = {"forged": True}
    elif change == "session": candidate["planningSession"]["phase"] = "episode_roadmap"
    else:
        candidate["planningRevision"]["status"] = "completed"
        candidate["planningRevision"]["completedAt"] = datetime.now(timezone.utc).isoformat()
        candidate["planningSession"] = {"phase": "script", "status": "approved"}
    with pytest.raises(LongStoryPersistenceConflictError): save(service, candidate, 3)
    assert service.get_workspace_snapshot(source["id"]).workspace_payload == active


def test_future_revision_rejects_running_job_and_running_agent(revision_workspace):
    service, runtime, source = revision_workspace
    service.save_generation_task(source["id"], build_generation_task())
    with pytest.raises(LongStoryPersistenceConflictError, match="running|运行|进行中"):
        save(service, opened_payload(source))
    task = build_generation_task()
    task.batch.status = GenerationBatchStatus.paused
    task.batch.revision = 2
    task.checkpoint.status = GenerationJobStatus.paused
    task.checkpoint.revision = 2
    service.save_generation_task(source["id"], task)
    agent = AgentRunService(runtime)
    agent.start_session(agent_name="episode_script", subject_ref="episode.2", request_key="request.running",
                        input_fingerprint="1" * 64, project_id=source["id"], episode_number=2,
                        policy=AgentRunPolicy(max_steps=1, max_model_tool_calls=1, allowed_tools={"draft"}))
    with pytest.raises(LongStoryPersistenceConflictError, match="running|运行|进行中"):
        save(service, opened_payload(source))


def test_active_revision_blocks_body_agents_and_old_jobs_but_allows_current_future_roadmaps(revision_workspace):
    service, runtime, source = revision_workspace
    task = build_generation_task()
    task.batch.status = GenerationBatchStatus.paused
    task.checkpoint.status = GenerationJobStatus.paused
    service.save_generation_task(source["id"], task)
    save(service, opened_payload(source))
    assert service.get_recoverable_generation_task(source["id"]) is None
    with pytest.raises(LongStoryPersistenceConflictError):
        service.save_generation_task(source["id"], task)
    agent = AgentRunService(runtime)
    args = dict(subject_ref="episode.2", request_key="request.current", input_fingerprint="1" * 64,
                project_id=source["id"], episode_number=2,
                policy=AgentRunPolicy(max_steps=1, max_model_tool_calls=1, allowed_tools={"draft"}))
    with pytest.raises(AgentRunPersistenceConflictError):
        agent.start_session(agent_name="episode_script", planning_revision_epoch=1, **args)
    with pytest.raises(AgentRunPersistenceConflictError):
        agent.start_session(agent_name="episode_roadmap", planning_revision_epoch=0, **args)
    assert agent.start_session(agent_name="episode_roadmap", planning_revision_epoch=1, **args).session is not None


def test_completed_body_cache_is_not_replayed_across_planning_epochs(revision_workspace):
    service, runtime, source = revision_workspace
    agent = AgentRunService(runtime)
    args = dict(agent_name="episode_script", subject_ref="episode.2", request_key="request.cached",
                input_fingerprint="1" * 64, project_id=source["id"], episode_number=2,
                policy=AgentRunPolicy(max_steps=1, max_model_tool_calls=1, allowed_tools={"draft"}))
    started = agent.start_session(**args)
    started.session.complete(result_type="episode_script_run.v1", result_payload={"draft_run": {"old": True}})
    save(service, opened_payload(source))
    with pytest.raises(AgentRunPersistenceConflictError): agent.start_session(**args)
    with pytest.raises(AgentRunPersistenceConflictError): agent.start_session(planning_revision_epoch=1, **args)


@pytest.fixture
def complete_revision_workspace():
    """A real persisted 8-episode tree, with the browser's actual revision shape."""
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = LongStoryService(runtime)
    project = build_project().model_copy(update={"planned_episode_count": 8})
    service.save_project(project)
    bible = build_story_bible().model_copy(update={"status": PlanningApprovalStatus.approved, "approved_at": NOW})
    service.save_story_bible(bible)
    node = build_story_plan_node(node_id="node.future", planned_start_episode=1, planned_end_episode=8,
                                 expansion_status="episode_ready").model_copy(update={
        "status": PlanningApprovalStatus.approved, "approved_at": NOW,
        "unit_story_beats": ["找到确切的证据。", "对手试图否认证据。", "证人明确核实事实。", "主角公开证据获胜。"],
        "unit_resolution": "本段事件已经形成确定结局。",
        "episode_developments": [EpisodeDevelopment(episode_number=n,
            synopsis=f"第{n}集角色带着新证据进入谈判并获得独立结果，推动下一集。",
            entry_state=f"第{n}集入场前的确定状态。", exit_state=f"第{n}集出口时的确定状态。",
            source_turning_points=[], source_unit_story_beats=[]) for n in range(1, 9)],
    })
    service.save_story_plan_node(node)
    source = {"id": project.project_id, "storyBibleVersion": 1,
              "generationSettings": {"episodeCount": 8}, "episodes": [{"episodeNumber": 1, "workingDraftJson": json.dumps({"synopsis": "原稿已保存，证据仍由主角持有。", "scenes": [{"scene_number": 1, "character_actions": ["主角收好原件。"]}]})}],
              "planningSession": {"phase": "script", "status": "approved"}, "episodeRoadmaps": [],
              "storyTreeQualityAudit": {"status": "needs_revision"}}
    for event in node.episode_developments:
        source["episodeRoadmaps"].append({
            **event.model_dump(mode="json"), "status": "approved", "source_node_id": node.node_id,
            "source_node_version": 1, "story_bible_version": 1, "protagonist_decision": "角色选择提出证据。",
            "episode_payoff": "对手承认一项事实。", "scene_execution_plan": [],
        })
    save(service, source, 1)
    active = save(service, opened_payload(source)).workspace_payload
    yield service, runtime, source, active, node
    runtime.engine.dispose()


def reviewed_completion(active, service=None):
    candidate = deepcopy(active)
    candidate["planningRevision"].update(status="completed", completedAt=datetime.now(timezone.utc).isoformat())
    for row in candidate["episodeRoadmaps"]:
        row["status"] = "approved"
    refs = {(row["source_node_id"], row["source_node_version"]) for row in candidate["episodeRoadmaps"]}
    candidate["storyTreeQualityAudit"] = {
        "story_project_id": active["id"], "story_bible_id": build_story_bible().story_bible_id,
        "story_bible_version": 1, "status": "pass", "findings": [], "summary": "本次范围与真实边界审校通过。",
        "review_contract_version": CURRENT_REVIEW_CONTRACT_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "node_refs": [{"node_id": node, "node_version": version} for node, version in refs],
        "node_signature": quality_node_signature(refs), "audited_node_count": len(refs), "semantic_sample_count": len(refs),
        "reviewed_episode_plans": json.dumps([quality_episode_projection(row).model_dump(mode="json") for row in candidate["episodeRoadmaps"]]),
    }
    from app.modules.script_engine.future_revision_review import future_revision_context, SCOPE_IDENTITY_FIELDS
    context = future_revision_context(candidate, completing=True)
    candidate["storyTreeQualityAudit"]["future_revision_review"] = {
        **{key: context[key] for key in SCOPE_IDENTITY_FIELDS}, "status": "pass", "boundary_status": "pass",
        "summary": "未来规划承接已保存的原件持有与状态，当前范围没有阻断。",
    }
    if service is not None:
        record_quality_audit(service, candidate)
    return candidate


def record_quality_audit(service, candidate):
    from app.modules.agent_runtime.models import AgentRunRecord, AgentRunStatus
    from app.modules.agent_runtime.repository import AgentRunRepository
    from app.modules.script_engine.long_story_models import StoryPlanQualityAudit
    audit = candidate["storyTreeQualityAudit"]
    raw = StoryPlanQualityAudit.model_validate({key: value for key, value in audit.items()
                                               if key in StoryPlanQualityAudit.model_fields}).model_dump(mode="json")
    record = AgentRunRecord(agent_name="story_quality", subject_ref="quality.future",
        project_id=candidate["id"], planning_revision_epoch=candidate["planningRevisionEpoch"],
        policy=AgentRunPolicy(max_steps=1, max_model_tool_calls=1, allowed_tools={"audit_story_tree"}))
    with service._database_runtime.session() as session:
        repo = AgentRunRepository(session)
        repo.start_or_resume(record)
        repo.save_record(record.model_copy(update={"status": AgentRunStatus.completed,
            "completed_at": datetime.now(timezone.utc), "result_type": "story_plan_quality_audit.v1"}),
            result_payload={"audit": raw})


def test_revision_completes_only_with_fresh_exact_full_audit_and_preserves_history(complete_revision_workspace):
    service, _, source, active, _ = complete_revision_workspace
    completed = save(service, reviewed_completion(active, service), 3).workspace_payload
    assert completed["planningRevisionEpoch"] == 1
    assert completed["planningRevisionHistory"] == []
    assert completed["planningSession"] == source["planningSession"]
    # Closing does not freeze unrelated normal authoring operations forever.
    next_body = deepcopy(completed)
    next_body["episodes"].append({"episodeNumber": 2, "workingDraftJson": "new body"})
    save(service, next_body, 4)
    reopened = opened_payload(next_body, start=3)
    reopened["planningRevisionEpoch"] = 2
    reopened["planningRevision"].update(revisionId="planning-revision.second", sourceWorkspaceRevision=4)
    reopened["planningRevisionHistory"] = [deepcopy(completed["planningRevision"])]
    result = save(service, reopened, 5).workspace_payload
    assert len(result["planningRevisionHistory"]) == 1
    assert result["planningRevisionHistory"][0]["originalRoadmaps"] == source["episodeRoadmaps"][1:]


@pytest.mark.parametrize("change", ["old_audit", "old_contract", "draft", "partial", "changed_evidence", "wrong_source", "changed_event", "pending_source", "removed_history"])
def test_revision_completion_rejects_stale_or_incomplete_evidence_atomically(complete_revision_workspace, change):
    service, _, _, active, _ = complete_revision_workspace
    candidate = reviewed_completion(active)
    if change == "old_audit": candidate["storyTreeQualityAudit"]["created_at"] = "2000-01-01T00:00:00Z"
    elif change == "old_contract": candidate["storyTreeQualityAudit"]["review_contract_version"] = CURRENT_REVIEW_CONTRACT_VERSION - 1
    elif change == "draft": candidate["episodeRoadmaps"][2]["status"] = "draft"
    elif change == "partial": candidate["storyTreeQualityAudit"]["semantic_sample_count"] = 0
    elif change == "changed_evidence": candidate["episodeRoadmaps"][2]["synopsis"] += "未经审阅的新因果。"
    elif change == "wrong_source":
        for row in candidate["episodeRoadmaps"]: row["source_node_version"] = 2
    elif change == "changed_event": candidate["episodeRoadmaps"][2]["entry_state"] = "与上层不同的新入场条件。"
    elif change == "pending_source": candidate["episodeRoadmaps"][2]["source_revision_review"] = {"previous_version": 1, "current_version": 2}
    else: candidate["planningRevisionHistory"] = [{"status": "completed"}]
    with pytest.raises(LongStoryPersistenceConflictError): save(service, candidate, 3)
    assert service.get_workspace_snapshot(active["id"]).workspace_payload == active


def test_active_revision_cannot_approve_roadmap_after_silently_clearing_changed_source_marker(complete_revision_workspace):
    service, _, _, active, _ = complete_revision_workspace
    candidate = deepcopy(active)
    candidate["episodeRoadmaps"][1].update(status="approved", entry_state="未经上层批准的新开场状态。")
    with pytest.raises(LongStoryPersistenceConflictError, match="source episode"):
        save(service, candidate, 3)


def test_old_completed_agent_cache_stays_invalid_after_revision_is_completed(complete_revision_workspace):
    service, runtime, _, active, _ = complete_revision_workspace
    # Seed a legacy completed run independently: it predates the revision.
    from app.modules.agent_runtime.models import AgentRunRecord, AgentRunStatus
    from app.modules.agent_runtime.repository import AgentRunRepository
    record = AgentRunRecord(agent_name="episode_script", subject_ref="episode.2", request_key="request.old.completed",
                            input_fingerprint="1" * 64, project_id=active["id"], episode_number=2,
                            policy=AgentRunPolicy(max_steps=1, max_model_tool_calls=1, allowed_tools={"draft"}))
    with runtime.session() as session:
        repo = AgentRunRepository(session)
        repo.start_or_resume(record)
        repo.save_record(record.model_copy(update={"status": AgentRunStatus.completed, "completed_at": datetime.now(timezone.utc),
                                                  "result_type": "episode_script_run.v1"}), result_payload={"draft_run": {"old": True}})
    save(service, reviewed_completion(active, service), 3)
    with pytest.raises(AgentRunPersistenceConflictError, match="epoch"):
        AgentRunService(runtime).start_session(agent_name=record.agent_name, subject_ref=record.subject_ref,
            request_key=record.request_key, input_fingerprint=record.input_fingerprint, project_id=record.project_id,
            episode_number=record.episode_number, policy=record.policy, planning_revision_epoch=1)
    started = AgentRunService(runtime).start_session(agent_name=record.agent_name, subject_ref=record.subject_ref,
        request_key="request.current.completed", input_fingerprint=record.input_fingerprint, project_id=record.project_id,
        episode_number=record.episode_number, policy=record.policy, planning_revision_epoch=1)
    assert started.session is not None


@pytest.mark.parametrize("field,value", [("planned_start_episode", 3), ("planned_end_episode", 20),
    ("parent_node_id", "node.new.parent"), ("parent_node_version", 2), ("predecessor_node_id", "node.new.previous"),
    ("predecessor_node_version", 2), ("sequence_order", 2), ("story_bible_version", 2)])
def test_future_node_revision_keeps_original_tree_identity_and_range(revision_workspace, field, value):
    service, runtime, source = revision_workspace
    save(service, opened_payload(source))
    node = build_story_plan_node(node_id="node.future", planned_start_episode=2, planned_end_episode=9)
    # Fixture seed represents an existing future node; production mutation below
    # must fail before any unrelated Bible/approval checks or writes.
    with runtime.session() as session:
        repo = LongStoryRepository(session)
        repo.save_story_bible(build_story_bible())
        repo.save_story_plan_node(node)
    with pytest.raises(LongStoryPersistenceConflictError, match="identity"):
        service.save_story_plan_node(node.model_copy(update={"version": 2, field: value}), planning_revision_epoch=1)


def test_future_parent_revision_cannot_invalidate_existing_descendants(revision_workspace):
    service, runtime, source = revision_workspace
    save(service, opened_payload(source))
    parent = build_story_plan_node(node_id="node.future", planned_start_episode=2, planned_end_episode=19)
    child = build_story_plan_node(node_id="node.future.child", parent_node_id=parent.node_id,
                                  planned_start_episode=2, planned_end_episode=9)
    with runtime.session() as session:
        repo = LongStoryRepository(session)
        repo.save_story_bible(build_story_bible())
        repo.save_story_plan_node(parent)
        repo.save_story_plan_node(child)
    with pytest.raises(LongStoryPersistenceConflictError, match="descendants"):
        service.save_story_plan_node(parent.model_copy(update={"version": 2}), planning_revision_epoch=1)
    with pytest.raises(LongStoryPersistenceConflictError, match="identities"):
        service.save_story_plan_node(parent.model_copy(update={"node_id": "node.new.identity"}), planning_revision_epoch=1)
    with pytest.raises(LongStoryPersistenceConflictError, match="identities"):
        service.save_story_plan_node(parent.model_copy(update={"version": 2, "status": PlanningApprovalStatus.superseded}), planning_revision_epoch=1)


def test_planning_route_returns_conflict_for_old_epoch_before_any_model_request(revision_workspace):
    from fastapi import HTTPException
    from app.api.routes.story_projects import generate_episode_plan_batch
    from app.modules.script_engine.long_story_models import EpisodePlanBatchDraftRequest
    from app.modules.script_engine.story_planning_service import StoryPlanningService
    service, _, source = revision_workspace
    save(service, opened_payload(source))
    planner = object.__new__(StoryPlanningService)
    planner._long_story_service = service
    request = EpisodePlanBatchDraftRequest(story_project_id=source["id"], source_node_id="node.future",
        source_node_version=1, generation_strategy_id="strategy.test", planning_revision_epoch=0)
    with pytest.raises(HTTPException) as caught:
        generate_episode_plan_batch(source["id"], "node.future", request, service=planner)
    assert caught.value.status_code == 409
    assert "epoch" in caught.value.detail


def test_revision_node_guard_freezes_spanning_leaf_and_body_gate_cannot_omit_approved_context(complete_revision_workspace):
    service, _, _, active, node = complete_revision_workspace
    with pytest.raises(LongStoryPersistenceConflictError, match="boundary"):
        service.save_story_plan_node(node.model_copy(update={"version": 2}), planning_revision_epoch=1)
    from app.modules.script_engine.generation_service import ScriptGenerationService
    from app.modules.script_engine.generation_service import EpisodeExecutionNotReadyError
    from app.modules.script_engine.models import ScriptGenerationDraftRequest
    generator = object.__new__(ScriptGenerationService)
    generator._episode_plan_history_loader = None
    generator._episode_plan_workspace_loader = lambda _: active
    request = ScriptGenerationDraftRequest(content_spec_id="content_spec.api_demo", story_project_id=active["id"],
        generation_strategy_id="strategy.test", output_language="zh-CN", planning_revision_epoch=1)
    with pytest.raises(EpisodeExecutionNotReadyError, match="active"):
        generator.validate_episode_plan_progression(request)
    request.planning_revision_epoch = 0
    with pytest.raises(EpisodeExecutionNotReadyError, match="epoch"):
        generator.validate_episode_plan_progression(request)


def test_revision_transition_and_agent_start_are_serialized_under_the_same_project_lock(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'revision-race.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    service = LongStoryService(runtime)
    project = build_project()
    service.save_project(project)
    source = {"id": project.project_id, "episodes": [{"episodeNumber": 1}],
              "planningSession": {"phase": "script", "status": "approved"},
              "episodeRoadmaps": [{"episode_number": 2, "status": "approved"}],
              "storyTreeQualityAudit": {"status": "needs_revision"}}
    save(service, source, 1)
    barrier = Barrier(2)
    def start_revision():
        barrier.wait()
        try:
            save(service, opened_payload(source))
            return "revision"
        except LongStoryPersistenceConflictError:
            return "rejected"
    def start_agent():
        barrier.wait()
        try:
            AgentRunService(runtime).start_session(agent_name="episode_script", subject_ref="episode.2",
                request_key="request.racing", input_fingerprint="1" * 64, project_id=project.project_id,
                episode_number=2, policy=AgentRunPolicy(max_steps=1, max_model_tool_calls=1, allowed_tools={"draft"}))
            return "agent"
        except AgentRunPersistenceConflictError:
            return "rejected"
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda function: function(), [start_revision, start_agent]))
        assert results.count("rejected") == 1
        assert ("revision" in results) != ("agent" in results)
    finally:
        runtime.engine.dispose()
