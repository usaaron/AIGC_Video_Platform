from copy import deepcopy
from threading import Lock
from types import MethodType

import pytest
from pydantic import ValidationError
from sqlmodel import SQLModel, select

from app.database import create_database_runtime
from app.modules.agent_runtime.persistence import AgentRunRecordTable, AgentStepRecordTable
from app.modules.agent_runtime.service import AgentRunService
from app.modules.agent_runtime.runtime import AgentSession
from app.modules.agent_runtime.story_quality import StoryQualityAgent
from app.modules.script_engine.long_story_models import StoryPlanQualityEvaluation
from app.modules.script_engine.planning_review_progress import quality_review_checkpoints
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_planning_review_resume import review_fixture


@pytest.mark.parametrize("problem", ["issue_only", "repair_only", "both", "clean"])
def test_model_reported_problem_cannot_be_saved_as_pass_and_trace_survives_success(tmp_path, problem):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'review.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    service, request, state = review_fixture()
    service._generate_planning_output = MethodType(StoryPlanningService._generate_planning_output, service)
    service._adapter_for_artifact = lambda _: object()
    calls = []
    lock = Lock()

    def generated(*args, **kwargs):
        keys = kwargs["output_schema"]["properties"]["evaluations"]["required"]
        with lock:
            calls.append(keys)
        return {
            "overall_summary": "逐个目标检查完成。",
            "evaluations": {
                key: {"status": "pass", "summary": "当前分场承载已核对。",
                      "issue_codes": ["silent_dialogue_contradiction"]
                      if key == "review_7" and problem in {"issue_only", "both"} else [],
                      "repair_instruction": "统一全场静默要求与十五句对白目标。"
                      if key == "review_7" and problem in {"repair_only", "both"} else None,
                      "execution_requirements": []}
                for key in keys
            },
            "_meta": {
                "provider": "openai_compatible", "model_name": "fallback-model",
                "model_failover_used": True,
                "primary_model_provider": "openai_compatible", "primary_model_name": "primary-model",
                "fallback_model_provider": "openai_compatible", "fallback_model_name": "fallback-model",
                "model_failover_reason": "private-provider-error",
                "gateway": "private-gateway", "api_key": "secret-token",
                "prompt": "private-prompt", "reasoning_content": "private-reasoning",
            },
        }

    service._generate_structured_planning_response = generated
    agent = StoryQualityAgent(planning_service=service, run_service=AgentRunService(runtime))
    result = agent.run(request)
    expected = "pass" if problem == "clean" else "needs_revision"
    assert result.audit.status == expected
    assert len(calls) == 3  # No extra repair or semantic round for contradictory PASS.
    if problem != "clean":
        assert len(result.audit.findings) == 1
        finding = result.audit.findings[0]
        assert finding.node_id.endswith("part_6")
        assert finding.issue_codes and finding.repair_instruction
        if problem in {"issue_only", "both"}:
            assert finding.issue_codes == ["silent_dialogue_contradiction"]
        if problem in {"repair_only", "both"}:
            assert finding.repair_instruction == "统一全场静默要求与十五句对白目标。"
    else:
        assert result.audit.findings == []

    with runtime.session() as db:
        row = db.get(AgentRunRecordTable, result.run.run_id)
        step = db.exec(select(AgentStepRecordTable).where(
            AgentStepRecordTable.run_id == result.run.run_id)).one()
        stored = row.result_payload
        assert step.checkpoint_payload == stored
        assert step.checkpoint_type == "story_plan_quality_audit.v1"
        assert stored["audit"]["status"] == expected
        metadata = stored["review_metadata"]
        assert len(metadata["groups"]) == len(metadata["group_metadata"]) == 3
        evaluations = [item for group in metadata["groups"].values() for item in group["evaluations"]]
        assert len(evaluations) == 7
        assert next(item for item in evaluations if item["node_id"].endswith("part_6"))["status"] == expected
        target_keys = []
        for group in metadata["group_metadata"].values():
            route = group["model_route"]
            assert route["model_name"] == route["fallback_model_name"] == "fallback-model"
            assert route["primary_model_name"] == "primary-model"
            assert route["model_failover_used"] is True
            assert all(status == "pass" for status in group["reported_statuses"].values())
            target_keys.extend(group["target_refs"])
        assert sorted(target_keys) == [f"review_{i}" for i in range(1, 8)]
        serialized = str(stored)
        for secret in ["private-provider-error", "private-gateway", "secret-token", "private-prompt", "private-reasoning"]:
            assert secret not in serialized
    assert "review_metadata" not in result.run.model_dump()
    assert "model_route" not in result.audit.model_dump()
    repeated = agent.run(request)
    assert repeated.run.run_id == result.run.run_id
    assert repeated.audit.status == expected
    assert len(calls) == 3


@pytest.mark.parametrize("missing", ["issue_codes", "repair_instruction"])
def test_needs_revision_still_requires_existing_issue_and_repair_contract(missing):
    value = {"node_id": "node.review.part", "node_version": 1, "status": "needs_revision",
             "summary": "分场对白与动作存在冲突。", "issue_codes": ["conflict"],
             "repair_instruction": "统一获批同场表达。"}
    value.pop(missing)
    with pytest.raises(ValidationError, match="requires issue codes and a repair instruction"):
        StoryPlanQualityEvaluation.model_validate(value)


def test_all_recovered_groups_keep_their_trace_without_new_model_calls():
    service, request, state = review_fixture()
    state.fail = False
    saved = []
    with quality_review_checkpoints(None, lambda value: saved.append(deepcopy(value))):
        first = service.audit_story_plan_quality(request)
    recovered = saved[-1]
    assert len(recovered["groups"]) == len(recovered["group_metadata"]) == 3
    state.calls.clear()
    saved.clear()
    with quality_review_checkpoints(recovered, lambda value: saved.append(deepcopy(value))):
        second = service.audit_story_plan_quality(request)
    assert state.calls == []
    assert second.status == first.status
    assert saved[-1] == recovered


@pytest.mark.parametrize("legacy", [False, True])
def test_successful_checkpoint_restores_new_trace_and_legacy_bare_audit(tmp_path, monkeypatch, legacy):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'restore.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    service, request, state = review_fixture()
    state.fail = False
    agent = StoryQualityAgent(planning_service=service, run_service=AgentRunService(runtime))
    complete = AgentSession.complete

    def fail_after_checkpoint(session, **kwargs):
        session.fail(RuntimeError("interrupted after successful tool checkpoint"))
        raise RuntimeError("interrupted after successful tool checkpoint")

    monkeypatch.setattr(AgentSession, "complete", fail_after_checkpoint)
    with pytest.raises(RuntimeError, match="after successful tool checkpoint"):
        agent.run(request)
    with runtime.session() as db:
        step = db.exec(select(AgentStepRecordTable)).one()
        original = deepcopy(step.checkpoint_payload)
        if legacy:
            step.checkpoint_payload = original["audit"]
            db.add(step)
            db.commit()
    monkeypatch.setattr(AgentSession, "complete", complete)
    state.calls.clear()
    resumed = agent.run(request)
    assert state.calls == []
    assert resumed.audit.model_dump(mode="json") == original["audit"]
    assert resumed.run.attempt_count == 2
    with runtime.session() as db:
        stored = db.get(AgentRunRecordTable, resumed.run.run_id).result_payload
        assert stored["audit"] == original["audit"]
        assert stored["review_metadata"] == ({} if legacy else original["review_metadata"])
