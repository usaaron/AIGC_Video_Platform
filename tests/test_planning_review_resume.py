from copy import deepcopy
from threading import Lock
from types import SimpleNamespace

import pytest
from sqlmodel import SQLModel, select

from app.database import create_database_runtime
from app.script_delivery_contract import SHORT_DRAMA_PACING_CONTRACT
from app.modules.agent_runtime.models import AgentRunStatus
from app.modules.agent_runtime.persistence import AgentRunRecordTable
from app.modules.agent_runtime.service import AgentRunService
from app.modules.agent_runtime.story_quality import StoryQualityAgent
from app.modules.script_engine.long_story_models import (
    StoryBible, StoryPlanExpansionStatus, StoryPlanQualityAuditRequest,
    StoryPlanQualityEvaluation, StoryPlanQualityModelOutput,
)
from app.modules.script_engine.planning_review_progress import (
    REVIEW_GROUP_CHECKPOINT_TYPE, quality_review_checkpoints,
)
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_story_planning_service import (
    build_active_lineage_story_bible, build_active_lineage_story_node, build_strategy,
)


def review_fixture():
    root = build_active_lineage_story_node(node_id="node.review.root", version=1, start_episode=1,
        end_episode=56, expansion_status=StoryPlanExpansionStatus.expanded)
    leaves = [build_active_lineage_story_node(node_id=f"node.review.part_{i}", version=1,
        start_episode=i * 8 + 1, end_episode=(i + 1) * 8,
        expansion_status=StoryPlanExpansionStatus.episode_ready,
        parent_node_id=root.node_id, parent_node_version=1).model_copy(update={"sequence_order": i + 1})
        for i in range(7)]
    state = SimpleNamespace(nodes=[root, *leaves], bible=StoryBible.model_construct(
        **vars(build_active_lineage_story_bible())), strategy=build_strategy(), fail=True, calls=[])
    lock = Lock()
    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(
        get_project=lambda _: SimpleNamespace(active_story_bible_id=root.story_bible_id,
            active_story_bible_version=1, planned_episode_count=56),
        get_story_bible=lambda *a, **k: state.bible,
        list_story_plan_nodes=lambda *a, **k: state.nodes,
    )
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: state.strategy)
    service._story_plan_quality_hard_issues = lambda _: {}

    def generate(**kwargs):
        keys = kwargs["output_schema"]["properties"]["evaluations"]["required"]
        with lock:
            state.calls.append(keys)
        if state.fail and "review_4" in keys:
            raise RuntimeError("one group disconnected")
        return StoryPlanQualityModelOutput(overall_summary="已审校本组。", evaluations=[
            StoryPlanQualityEvaluation(node_id=leaves[int(key[7:])-1].node_id, node_version=1,
                status="needs_revision" if key == "review_7" else "pass",
                summary="原件尚未交接。" if key == "review_7" else "本组通过。",
                issue_codes=["missing_transfer"] if key == "review_7" else [],
                repair_instruction="先交接原件再使用。" if key == "review_7" else None)
            for key in keys])
    service._generate_planning_output = generate
    request = StoryPlanQualityAuditRequest(story_project_id=root.story_project_id,
        story_bible_id=root.story_bible_id, story_bible_version=1,
        generation_strategy_id=state.strategy.id, agent_request_id="request.review.resume",
        node_refs=[{"node_id": n.node_id, "node_version": 1} for n in leaves],
        episode_plans=[{"source_node_id": leaves[0].node_id, "source_node_version": 1,
            "episode_number": 1, "synopsis": "原件仍由主角持有。", "protagonist_decision": "预约交接。",
            "episode_payoff": "取得预约。", "exit_state": "尚未实际交接。",
            "scene_execution_plan": [{"scene_number": 1, "visible_action": "主角预约明天办理。",
                                      "exit_state": "原件未离手。"}]}])
    return service, request, state


def test_failed_review_resumes_validated_groups_after_runtime_restart(tmp_path):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'review.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    service, request, state = review_fixture()
    before = AgentRunService(runtime, instance_id="before")
    with pytest.raises(RuntimeError, match="disconnected"):
        StoryQualityAgent(planning_service=service, run_service=before).run(request)
    with runtime.session() as db:
        row = db.exec(select(AgentRunRecordTable).where(
            AgentRunRecordTable.agent_name == "story_quality")).one()
        run_id, status = row.run_id, row.status
    assert status == AgentRunStatus.failed.value
    saved = before.load_tool_recovery_checkpoint(run_id, "audit_story_tree", REVIEW_GROUP_CHECKPOINT_TYPE)
    assert len(saved["groups"]) == 2
    state.fail = False
    state.calls.clear()
    after = AgentRunService(runtime, instance_id="after")
    result = StoryQualityAgent(planning_service=service, run_service=after).run(request)
    assert state.calls == [["review_4", "review_5", "review_6"]]
    assert result.audit.status == "needs_revision"  # A retained failure cannot become PASS.
    assert result.audit.audited_node_count == result.audit.semantic_sample_count == 7
    assert result.audit.findings[0].node_id.endswith("part_6")
    assert result.run.run_id == run_id and result.run.attempt_count == 2


@pytest.mark.parametrize("change", ["prompt", "bible", "node", "strategy"])
def test_completed_review_cache_tracks_actual_execution_context(tmp_path, change):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'completed-review.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    service, request, state = review_fixture()
    state.fail = False
    agent = StoryQualityAgent(planning_service=service, run_service=AgentRunService(runtime))
    first = agent.run(request)
    state.calls.clear()
    repeated = agent.run(request)
    assert repeated.run.run_id == first.run.run_id
    assert state.calls == []
    if change == "prompt":
        original = service._build_story_plan_quality_prompt
        service._build_story_plan_quality_prompt = lambda **kw: original(**kw) + "新增批准状态解释。"
    elif change == "bible":
        state.bible = state.bible.model_copy(update={"ending_direction": "原件移交后揭示完整真相。"})
    elif change == "node":
        state.nodes[1] = state.nodes[1].model_copy(update={"synopsis": "本次核验新增了明确交接。"})
    else:
        state.strategy = state.strategy.model_copy(update={"temperature": 0.13})
    fresh = agent.run(request)
    assert fresh.run.run_id != first.run.run_id
    assert len(state.calls) == 3
    assert fresh.audit.status == "needs_revision"


@pytest.mark.parametrize("prior_verdict", ["pass", "needs_revision"])
def test_short_drama_contract_invalidates_completed_cache_and_preserves_prior_verdict(tmp_path, prior_verdict):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'short-drama-review.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    service, request, state = review_fixture()
    state.fail = False
    current_prompt = service._build_story_plan_quality_prompt
    current_generate = service._generate_planning_output

    def without_short_drama_contract(**kwargs):
        prompt = current_prompt(**kwargs)
        assert SHORT_DRAMA_PACING_CONTRACT in prompt
        return prompt.replace(SHORT_DRAMA_PACING_CONTRACT, "")

    def previous_verdict(**kwargs):
        result = current_generate(**kwargs)
        if prior_verdict == "pass":
            return result.model_copy(update={"evaluations": [StoryPlanQualityEvaluation.model_validate({
                **evaluation.model_dump(mode="json"),
                "status": "pass", "issue_codes": [], "repair_instruction": None,
            }) for evaluation in result.evaluations]})
        return result

    service._build_story_plan_quality_prompt = without_short_drama_contract
    service._generate_planning_output = previous_verdict
    agent = StoryQualityAgent(planning_service=service, run_service=AgentRunService(runtime))
    previous = agent.run(request)
    assert previous.audit.status == prior_verdict
    state.calls.clear()
    assert agent.run(request).run.run_id == previous.run.run_id
    assert state.calls == []

    service._build_story_plan_quality_prompt = current_prompt
    service._generate_planning_output = current_generate
    current = agent.run(request)  # Same request ID and episode evidence, new actual policy.
    assert current.run.run_id != previous.run.run_id
    assert len(state.calls) == 3
    assert current.audit.status == "needs_revision"
    state.calls.clear()
    assert agent.run(request).run.run_id == current.run.run_id
    assert state.calls == []
    with runtime.session() as db:
        saved = {row.run_id: row.result_payload["audit"] for row in db.exec(
            select(AgentRunRecordTable).where(AgentRunRecordTable.agent_name == "story_quality")
        ).all()}
    assert len(saved) == 2
    assert saved[previous.run.run_id] == previous.audit.model_dump(mode="json")
    assert saved[current.run.run_id] == current.audit.model_dump(mode="json")


@pytest.mark.parametrize("change", ["node", "parent", "bible", "strategy", "scene", "prompt", "corrupt"])
def test_review_checkpoint_invalidates_on_any_evidence_or_contract_change(change):
    service, request, state = review_fixture()
    saved = []
    with quality_review_checkpoints(None, lambda value: saved.append(deepcopy(value))):
        with pytest.raises(RuntimeError):
            service.audit_story_plan_quality(request)
    recovered = saved[-1]
    assert len(recovered["groups"]) == 2
    if change in {"node", "parent"}:
        index = 1 if change == "node" else 0
        state.nodes[index] = state.nodes[index].model_copy(update={"synopsis": "关键控制权已改变。"})
    elif change == "bible":
        state.bible = state.bible.model_copy(update={"core_premise": "作者改变了世界前提。"})
    elif change == "strategy":
        state.strategy = state.strategy.model_copy(update={"temperature": 0.13})
    elif change == "scene":
        request.episode_plans[0].scene_execution_plan[0].visible_action = "实际交接原件。"
    elif change == "prompt":
        original = service._build_story_plan_quality_prompt
        service._build_story_plan_quality_prompt = lambda **kw: original(**kw) + "新增审校职责。"
    else:
        for output in recovered["groups"].values():
            output["evaluations"][0]["node_id"] = "node.wrong.owner"
    state.fail = False
    state.calls.clear()
    with quality_review_checkpoints(recovered, lambda value: None):
        result = service.audit_story_plan_quality(request)
    assert len(state.calls) == 3
    assert result.status == "needs_revision"
