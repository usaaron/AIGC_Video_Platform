from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.modules.script_engine.long_story_models import (
    StoryPlanExecutionRequirement, StoryPlanExecutionHandoff, StoryPlanQualityAuditRequest,
    StoryPlanQualityEvaluation, StoryPlanQualityModelOutput, EpisodePlanGenerationItem,
    EpisodePlanItemModificationRequest, EpisodePlanItemPreparationRequest,
)
from app.modules.script_engine.planning_execution_requirements import validate_execution_requirements
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.planning_review_cache import review_after_approval, quality_episode_projection
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_episode_development_contract import authored_leaf
from tests.test_planning_review_cache import approval_case
from tests.test_story_planning_service import (
    build_active_lineage_story_bible, build_strategy, build_episode_item_generation_service,
    build_active_lineage_episode_item, episode_item_request,
)


def requirement(episode=1, index=1):
    return StoryPlanExecutionRequirement(episode_number=episode, source_event_index=index,
        instruction=f"在第{episode}集对应事件内先取回已有原件，再完成核验并保留取件后的去向。")


def audit_case():
    node = authored_leaf()
    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(
        get_project=lambda _: SimpleNamespace(active_story_bible_id=node.story_bible_id,
            active_story_bible_version=node.story_bible_version, planned_episode_count=8),
        get_story_bible=lambda *a, **k: build_active_lineage_story_bible(),
        list_story_plan_nodes=lambda *a, **k: [node],
    )
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: build_strategy())
    request = StoryPlanQualityAuditRequest(story_project_id=node.story_project_id,
        story_bible_id=node.story_bible_id, story_bible_version=node.story_bible_version,
        generation_strategy_id="strategy.test", agent_request_id="request.execution",
        node_refs=[{"node_id": node.node_id, "node_version": node.version}])
    return service, node, request


@pytest.mark.parametrize("change", ["episode", "event", "duplicate", "realized"])
def test_execution_notes_cannot_move_events_or_defer_existing_scene_gaps(change):
    node = authored_leaf()
    notes = [requirement(2 if change == "episode" else 1, 12 if change == "event" else 1)]
    if change == "duplicate": notes *= 2
    with pytest.raises(StoryPlanningInputError):
        validate_execution_requirements(notes, node, realized_episodes={1} if change == "realized" else set())


@pytest.mark.parametrize("realized,failed", [(False, False), (False, True), (True, False), (True, True)])
def test_future_obligation_survives_until_actual_review_without_changing_verdict(realized, failed):
    service, node, request = audit_case()
    note = StoryPlanExecutionHandoff(**requirement().model_dump(), node_id=node.node_id, node_version=node.version)
    request.execution_requirements = [note]
    if realized:
        request.episode_plans = [quality_episode_projection({
            "source_node_id": node.node_id, "source_node_version": node.version, "episode_number": 1,
            "synopsis": "取件完成后现场核验。", "exit_state": "原件交回原保管人。"})]
    calls = []
    def model(**kwargs):
        calls.append(kwargs)
        assert note.instruction in kwargs["prompt"]
        return StoryPlanQualityModelOutput(overall_summary="已按实际场景审查。", evaluations=[
            StoryPlanQualityEvaluation(node_id=node.node_id, node_version=node.version,
                status="needs_revision" if failed else "pass", summary="存在禁止取件的有效限制。" if failed else "执行条件成立。",
                issue_codes=["missing_condition"] if failed else [],
                repair_instruction="先解决有效禁令，不能把材料写成已取得。" if failed else None)])
    service._generate_planning_output = model
    result = service.audit_story_plan_quality(request)
    assert len(calls) == 1
    assert result.status.value == ("needs_revision" if failed else "pass")
    assert bool(result.findings) == failed
    assert result.execution_requirements == ([] if realized else [note])


def test_new_model_requirement_is_bound_to_current_event_and_rejects_realized_deferral():
    service, node, request = audit_case()
    service._generate_planning_output = lambda **kwargs: StoryPlanQualityModelOutput(
        overall_summary="后续取件可在已分配事件内落实。", evaluations=[StoryPlanQualityEvaluation(
            node_id=node.node_id, node_version=node.version, status="pass", summary="上层因果成立。",
            execution_requirements=[requirement()])])
    result = service.audit_story_plan_quality(request)
    assert result.status.value == "pass"
    assert result.execution_requirements[0].node_id == node.node_id
    request.episode_plans = [quality_episode_projection({
        "source_node_id": node.node_id, "source_node_version": node.version, "episode_number": 1})]
    with pytest.raises(StoryPlanningInputError, match="cannot be deferred"):
        service.audit_story_plan_quality(request)


def test_same_event_model_notes_merge_losslessly_in_the_original_review_call():
    service, node, request = audit_case()
    second = requirement().model_copy(update={"instruction": "核验后由原保管人收回，不将现场查看写成所有权转移。"})
    calls = []
    def model(**kwargs):
        calls.append(kwargs)
        return StoryPlanQualityModelOutput(overall_summary="上层因果成立，后续按事件落实细节。", evaluations=[
            StoryPlanQualityEvaluation(node_id=node.node_id, node_version=node.version,
                status="pass", summary="后续执行事项可在既有边界内完成。",
                execution_requirements=[requirement(), second, requirement()])])
    service._generate_planning_output = model
    result = service.audit_story_plan_quality(request)
    assert len(calls) == 1
    assert result.status.value == "pass"
    assert len(result.execution_requirements) == 1
    assert result.execution_requirements[0].instruction == requirement().instruction + "\n" + second.instruction
    assert result.execution_requirements[0].node_id == node.node_id


@pytest.mark.parametrize("change", ["node", "version", "duplicate"])
def test_stale_or_duplicate_handoffs_fail_before_model_call(change):
    service, node, request = audit_case()
    note = StoryPlanExecutionHandoff(**requirement().model_dump(),
        node_id="node.other" if change == "node" else node.node_id, node_version=2 if change == "version" else 1)
    service._generate_planning_output = lambda **kwargs: pytest.fail("invalid input must stop before model")
    if change == "duplicate":
        with pytest.raises(ValidationError, match="unique"):
            StoryPlanQualityAuditRequest.model_validate(request.model_dump() | {"execution_requirements": [note, note]})
    else:
        request.execution_requirements = [note]
        with pytest.raises(StoryPlanningInputError, match="active reviewed node"):
            service.audit_story_plan_quality(request)


def test_approval_only_rebase_preserves_pending_requirements_and_evidence_time():
    old, new, audit = approval_case()
    audit["execution_requirements"] = [dict(requirement().model_dump(), node_id=old.node_id, node_version=old.version)]
    result = review_after_approval(audit, [old], [new], source_fingerprint=audit["reviewed_source_fingerprint"])
    assert result.execution_requirements[0].node_version == new.version
    assert result.execution_requirements[0].instruction == requirement().instruction
    assert result.model_dump(mode="json")["created_at"] == audit["created_at"]
    assert audit["execution_requirements"][0]["node_version"] == old.version


class FirstModelCall(BaseException):
    pass


@pytest.mark.parametrize("operation", ["chunk", "item", "modify", "prepare"])
def test_first_generation_and_scene_preparation_receive_current_execution_obligations(operation):
    service, _ = build_episode_item_generation_service(object())
    node = authored_leaf()
    service._long_story_service.source = service._long_story_service.latest = node
    service._episode_plan_chunk_size = 1
    current = EpisodePlanGenerationItem.model_validate({**build_active_lineage_episode_item(), **node.episode_developments[0].model_dump()})
    request = episode_item_request(node).model_copy(update={"execution_requirements": [requirement(), requirement(8, 4)]})
    calls = []
    def capture(prompt):
        calls.append(prompt)
        assert requirement().instruction in prompt
        assert requirement(8, 4).instruction not in prompt
        raise FirstModelCall()
    service._generate_segmented_episode_roadmap = lambda **kw: capture(kw["prompt"])
    service._generate_structured_planning_response = lambda adapter, prompt, **kw: capture(prompt)
    if operation == "modify":
        request = EpisodePlanItemModificationRequest(**request.model_dump(), current_plan=current, instruction="完整落实材料的来源和使用顺序。")
    elif operation == "prepare":
        request = EpisodePlanItemPreparationRequest(**request.model_dump(), current_plan=current)
        def completion(item, **kwargs):
            assert kwargs["execution_requirements"] == request.execution_requirements
            calls.append("preparation")
            raise FirstModelCall()
        service._complete_episode_scene_execution_plan = completion
    with pytest.raises(FirstModelCall):
        getattr(service, {"chunk":"generate_episode_plan_chunk", "item":"generate_episode_plan_item",
            "modify":"modify_episode_plan_item", "prepare":"prepare_episode_plan_item"}[operation])(request)
    assert len(calls) == 1
