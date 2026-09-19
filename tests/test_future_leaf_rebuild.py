"""Future rebuilds keep saved work and use durable, source-bound chunk receipts."""
from copy import deepcopy
from types import SimpleNamespace

import pytest
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.agent_runtime.episode_roadmap import EpisodeRoadmapAgent
from app.modules.agent_runtime.repository import AgentRunPersistenceConflictError
from app.modules.agent_runtime.service import AgentRunService
from app.modules.script_engine.future_leaf_rebuild import plan_projection, prepare_future_leaf_rebuild, verify_rebuild_budget
from app.modules.script_engine.long_story_models import EpisodeDevelopment, EpisodePlanGenerationItem, EpisodePlanItemDraftRequest, PlanningApprovalStatus
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.long_story_service import LongStoryService
from test_agent_runtime import _roadmap_item
from test_long_story_api import build_project, build_story_bible, build_story_plan_node, NOW
from test_planning_revision import opened_payload, save


@pytest.fixture
def rebuild_case():
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = LongStoryService(runtime)
    project = build_project().model_copy(update={"planned_episode_count": 16})
    service.save_project(project)
    service.save_story_bible(build_story_bible().model_copy(update={"status": PlanningApprovalStatus.approved, "approved_at": NOW}))
    root = build_story_plan_node(node_id="node.root", planned_start_episode=1, planned_end_episode=16,
        expansion_status="expanded").model_copy(update={"status": PlanningApprovalStatus.approved, "approved_at": NOW})
    service.save_story_plan_node(root)
    node = build_story_plan_node(node_id="node.future", planned_start_episode=1, planned_end_episode=8,
        expansion_status="episode_ready").model_copy(update={"status": PlanningApprovalStatus.approved, "approved_at": NOW,
        "parent_node_id": root.node_id, "parent_node_version": 1, "depth": 1,
        "unit_story_beats": ["找到确切的证据。", "对手试图否认证据。", "证人明确核实事实。", "主角公开证据获胜。"],
        "unit_resolution": "本段事件已经形成确定结局。", "handoff_pressure": "主角须核验下一段证据的来源。",
        "episode_developments": [EpisodeDevelopment(episode_number=n,
            synopsis=f"第{n}集出示独立凭证，迫使对手承担当前责任。",
            entry_state=f"第{n}集入场前的确定状态。", exit_state=f"第{n}集离场后的确定状态。",
            source_turning_points=[], source_unit_story_beats=[]) for n in range(1, 9)]})
    service.save_story_plan_node(node)
    second_node = node.model_copy(update={"node_id": "node.next", "sequence_order": 2,
        "planned_start_episode": 9, "planned_end_episode": 16, "predecessor_node_id": node.node_id,
        "predecessor_node_version": 1, "episode_developments": [event.model_copy(update={"episode_number": event.episode_number + 8}) for event in node.episode_developments]})
    service.save_story_plan_node(second_node)
    template = _roadmap_item(with_scene_plan=True).model_dump(mode="json")
    scene = template["scene_execution_plan"][0]
    scene["character_refs"] = ["character.mara"]
    template.update(character_refs=["character.mara"], story_line_refs=["storyline.hidden_ledger"],
        planned_scene_count=2, planned_shot_count=16, planned_dialogue_line_count=30,
        scene_execution_plan=[{**scene, "scene_number": 1, "dialogue_line_target": 0, "shot_target": 8},
                              {**scene, "scene_number": 2, "dialogue_line_target": 30, "shot_target": 8}])
    rows = []
    for event in [*node.episode_developments, *second_node.episode_developments]:
        owner = node if event.episode_number <= 8 else second_node
        row = EpisodePlanGenerationItem.model_validate({**template, **event.model_dump(mode="json")}).model_dump(mode="json")
        rows.append({**row, "status": "approved", "source_node_id": owner.node_id,
                     "source_node_version": 1, "story_bible_version": 1})
    source = {"id": project.project_id, "storyBibleVersion": 1,
        "episodes": [{"episodeNumber": 1, "workingDraftJson": "saved original screenplay"}],
        "planningSession": {"phase": "script", "status": "approved"},
        "episodeRoadmaps": rows, "storyTreeQualityAudit": {"status": "needs_revision"}}
    save(service, source, 1)
    active = save(service, opened_payload(source), 2).workspace_payload
    for row in active["episodeRoadmaps"][1:]:
        row["source_revision_review"] = {"previous_version": 0, "current_version": 1}
    active = save(service, active, 3).workspace_payload

    class Writer:
        def __init__(self):
            self._long_story_service = service
            self.calls = 0
            self.after_generate = None
        def _episode_plan_source_node(self, request):
            return service.get_story_plan_node(project.project_id, request.source_node_id, version=request.source_node_version)
        def generate_episode_plan_chunk(self, request):
            self.calls += 1
            current = service.get_workspace_snapshot(project.project_id).workspace_payload
            item = plan_projection(current["episodeRoadmaps"][request.episode_number - 1])
            item["synopsis"] = f"第{request.episode_number}集依最新批准事件重建的全新执行安排。"
            if self.after_generate:
                self.after_generate()
            return [EpisodePlanGenerationItem.model_validate(item)]
    writer = Writer()
    agent = EpisodeRoadmapAgent(planning_service=writer, run_service=AgentRunService(runtime))
    def request(number=2, **changes):
        current = service.get_workspace_snapshot(project.project_id).workspace_payload
        owner = node if number <= 8 else second_node
        return EpisodePlanItemDraftRequest(story_project_id=project.project_id, source_node_id=owner.node_id,
            source_node_version=1, generation_strategy_id="strategy.rebuild", planning_revision_epoch=1,
            episode_number=number, future_rebuild=True, agent_request_id=f"rebuild.episode.{number}",
            accepted_plans=[plan_projection(row) for row in current["episodeRoadmaps"][owner.planned_start_episode - 1:number - 1]],
            predecessor_plan=plan_projection(current["episodeRoadmaps"][7]) if number > 8 else None,
            **changes)
    case = SimpleNamespace(service=service, runtime=runtime, source=source, node=node, writer=writer, agent=agent, request=request)
    yield case
    runtime.engine.dispose()


def adopt(case, result):
    saved = case.service.get_workspace_snapshot(case.source["id"])
    candidate = deepcopy(saved.workspace_payload)
    index = result.items[0].episode_number - 1
    old = candidate["episodeRoadmaps"][index]
    candidate["episodeRoadmaps"][index] = {**old, **result.items[0].model_dump(mode="json"),
        "source_revision_review": {**old["source_revision_review"], "rebuilt": result.rebuild_receipt.model_dump(mode="json")}}
    return save(case.service, candidate, saved.revision + 1)


def test_rebuild_runs_once_replays_after_ack_and_advances_with_saved_prefix(rebuild_case):
    c = rebuild_case
    request = c.request()
    result = c.agent.run_chunk(request)
    assert c.writer.calls == 1 and result.run.model_tool_call_count == 1
    assert result.rebuild_receipt.budget.scenes[0].dialogue_line_target == 0
    before_ack = c.service.get_workspace_snapshot(c.source["id"]).workspace_payload
    with pytest.raises(LongStoryPersistenceConflictError, match="preceding rebuilt"):
        c.agent.run_chunk(c.request(3))
    assert c.writer.calls == 1
    adopted = adopt(c, result).workspace_payload
    assert adopted["episodes"] == c.source["episodes"]
    assert adopted["episodeRoadmaps"][0] == c.source["episodeRoadmaps"][0]
    assert adopted["planningRevision"] == before_ack["planningRevision"]
    assert adopted["episodeRoadmaps"][1]["status"] == "draft"
    assert adopted["episodeRoadmaps"][1]["scene_execution_plan"][0]["dialogue_line_target"] == 0
    replay = c.agent.run_chunk(request)
    assert replay.run.run_id == result.run.run_id and replay.rebuild_receipt == result.rebuild_receipt
    assert c.writer.calls == 1
    next_result = c.agent.run_chunk(c.request(3))
    assert next_result.items[0].episode_number == 3 and c.writer.calls == 2
    adopt(c, next_result)


@pytest.mark.parametrize("reason", ["approved", "epoch", "no_marker", "no_revision", "body", "draft_source", "prefix", "ending_mode", "budget", "prefix_budget"])
def test_cache_replay_rechecks_current_eligibility_without_another_model(rebuild_case, reason):
    c = rebuild_case
    request = c.request()
    c.agent.run_chunk(request)
    current = c.service.get_workspace_snapshot(c.source["id"])
    workspace = deepcopy(current.workspace_payload)
    row = workspace["episodeRoadmaps"][1]
    if reason == "approved":
        row["status"] = "approved"
        row.pop("source_revision_review")
        save(c.service, workspace, current.revision + 1)
    elif reason == "no_marker":
        row.pop("source_revision_review")
        save(c.service, workspace, current.revision + 1)
    elif reason in {"ending_mode", "budget"}:
        if reason == "ending_mode": row["ending_mode"] = "season_finale"
        else: row["target_duration_seconds"] += 1
        save(c.service, workspace, current.revision + 1)
    elif reason == "epoch": request = request.model_copy(update={"planning_revision_epoch": 0})
    elif reason == "prefix": request.accepted_plans[0].synopsis = "unsaved fabricated predecessor"
    elif reason == "prefix_budget": request.accepted_plans[0].target_duration_seconds += 1
    else:
        # Exercise the same repository qualification against impossible/stale read
        # snapshots without weakening normal workspace mutation guards to set them up.
        if reason == "no_revision": workspace.pop("planningRevision")
        if reason == "body": workspace["episodes"].append({"episodeNumber": 2, "workingDraftJson": "saved"})
        node = c.node.model_copy(update={"status": PlanningApprovalStatus.draft}) if reason == "draft_source" else c.node
        from app.modules.script_engine.future_leaf_rebuild import context_from_repository
        with pytest.raises(LongStoryPersistenceConflictError):
            c.service._run(lambda repo: context_from_repository(repo, repo.get_project(c.source["id"]), workspace, request, node))
        assert c.writer.calls == 1
        return
    with pytest.raises((LongStoryPersistenceConflictError, AgentRunPersistenceConflictError)):
        c.agent.run_chunk(request)
    assert c.writer.calls == 1


@pytest.mark.parametrize("tamper", ["text", "receipt", "budget", "zero", "source", "run"])
def test_workspace_rejects_unearned_or_changed_rebuild_receipt_atomically(rebuild_case, tamper):
    c = rebuild_case
    result = c.agent.run_chunk(c.request())
    current = c.service.get_workspace_snapshot(c.source["id"])
    workspace = deepcopy(current.workspace_payload)
    row = workspace["episodeRoadmaps"][1]
    row.update(result.items[0].model_dump(mode="json"))
    row["source_revision_review"]["rebuilt"] = result.rebuild_receipt.model_dump(mode="json")
    if tamper == "text": row["synopsis"] += "changed after generation"
    elif tamper == "receipt": row["source_revision_review"]["rebuilt"]["evidence_signature"] = "a" * 64
    elif tamper == "budget": row["target_duration_seconds"] += 1
    elif tamper == "zero":
        row["scene_execution_plan"][0]["dialogue_line_target"] = 1
        row["scene_execution_plan"][1]["dialogue_line_target"] = 29
    elif tamper == "source": row["exit_state"] = "invented outcome"
    elif tamper == "run": row["source_revision_review"]["rebuilt"]["agent_run_id"] = "nonexistent.run"
    with pytest.raises(LongStoryPersistenceConflictError): save(c.service, workspace, current.revision + 1)
    assert c.service.get_workspace_snapshot(c.source["id"]).workspace_payload == current.workspace_payload


def test_late_result_is_not_receipted_when_budget_changed_during_generation(rebuild_case):
    c = rebuild_case
    def change():
        current = c.service.get_workspace_snapshot(c.source["id"])
        workspace = deepcopy(current.workspace_payload)
        workspace["episodeRoadmaps"][1]["target_duration_seconds"] += 1
        save(c.service, workspace, current.revision + 1)
    c.writer.after_generate = change
    with pytest.raises(LongStoryPersistenceConflictError, match="source changed"):
        c.agent.run_chunk(c.request())
    assert c.writer.calls == 1


def test_manual_edit_clears_receipt_and_old_prefix_cannot_advance(rebuild_case):
    c = rebuild_case
    adopt(c, c.agent.run_chunk(c.request()))
    adopt(c, c.agent.run_chunk(c.request(3)))
    current = c.service.get_workspace_snapshot(c.source["id"])
    workspace = deepcopy(current.workspace_payload)
    workspace["episodeRoadmaps"][1]["synopsis"] += "作者手动改动了本集前序。"
    workspace["episodeRoadmaps"][1]["source_revision_review"].pop("rebuilt")
    # Old later receipt is retained here to model an outdated client. It cannot
    # authorize the next generation even though this unrelated row was unchanged.
    save(c.service, workspace, current.revision + 1)
    with pytest.raises(LongStoryPersistenceConflictError, match="preceding rebuilt"):
        c.agent.run_chunk(c.request(4))
    assert c.writer.calls == 2


def test_next_leaf_waits_for_approved_current_predecessor_even_on_cache_replay(rebuild_case):
    c = rebuild_case
    with pytest.raises(LongStoryPersistenceConflictError, match="preceding leaf ending"):
        c.agent.run_chunk(c.request(9))
    assert c.writer.calls == 0
    current = c.service.get_workspace_snapshot(c.source["id"])
    workspace = deepcopy(current.workspace_payload)
    for row in workspace["episodeRoadmaps"][1:8]:
        row["status"] = "approved"
        row.pop("source_revision_review")
    save(c.service, workspace, current.revision + 1)
    result = c.agent.run_chunk(c.request(9))
    assert result.items[0].episode_number == 9 and c.writer.calls == 1
    adopt(c, result)
    current = c.service.get_workspace_snapshot(c.source["id"])
    workspace = deepcopy(current.workspace_payload)
    workspace["episodeRoadmaps"][7]["status"] = "draft"
    save(c.service, workspace, current.revision + 1)
    with pytest.raises(LongStoryPersistenceConflictError, match="preceding leaf ending"):
        c.agent.run_chunk(c.request(9))
    assert c.writer.calls == 1


@pytest.mark.parametrize("frozen_saved", [True, False])
def test_legacy_predecessor_without_event_is_allowed_only_when_frozen_and_saved(rebuild_case, frozen_saved):
    """An old saved ep53 needs no event migration; a future ep64 still does."""
    c = rebuild_case
    workspace = deepcopy(c.service.get_workspace_snapshot(c.source["id"]).workspace_payload)
    workspace["planningRevision"]["startEpisode"] = 9
    row = workspace["episodeRoadmaps"][7]
    row["status"] = "approved"
    row.pop("source_revision_review")
    if frozen_saved:
        workspace["episodes"].append({"episodeNumber": 8, "workingDraftJson": "legacy saved body"})
    request = c.request(9)
    source = c.service.get_story_plan_node(c.source["id"], "node.next")
    from app.modules.script_engine.future_leaf_rebuild import context_from_repository
    def operation(repository):
        class LegacyRepository:
            def __getattr__(self, name):
                return getattr(repository, name)
            def get_story_plan_node(self, node_id, version=None):
                current = repository.get_story_plan_node(node_id, version=version)
                return current.model_copy(update={"episode_developments": []}) if node_id == c.node.node_id else current
        return context_from_repository(LegacyRepository(), repository.get_project(c.source["id"]), workspace, request, source)
    if frozen_saved:
        result = c.service._run(operation)
        assert result["predecessor_plan"] == plan_projection(row)
    else:
        with pytest.raises(LongStoryPersistenceConflictError, match="approved source event"):
            c.service._run(operation)
    assert c.writer.calls == 0
