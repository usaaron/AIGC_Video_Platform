from contextvars import ContextVar
import json
from threading import Barrier, Lock
from types import SimpleNamespace

import pytest

from app.modules.script_engine.long_story_models import (
    StoryPlanExpansionStatus, StoryPlanQualityAuditRequest, StoryPlanQualityEvaluation,
    StoryPlanQualityModelOutput,
)
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_story_planning_service import (
    build_active_lineage_story_bible, build_active_lineage_story_node, build_strategy,
)


@pytest.mark.parametrize("outcome", ["pass", "finding", "unavailable", "wrong_group", "duplicate"])
def test_bounded_review_preserves_context_and_requires_every_group(outcome):
    root = build_active_lineage_story_node(node_id="node.review.root", version=1, start_episode=1,
        end_episode=56, expansion_status=StoryPlanExpansionStatus.expanded)
    leaves = [build_active_lineage_story_node(node_id=f"node.review.part_{i}", version=1,
        start_episode=i * 8 + 1, end_episode=(i + 1) * 8,
        expansion_status=StoryPlanExpansionStatus.episode_ready,
        parent_node_id=root.node_id, parent_node_version=1).model_copy(update={
            "sequence_order": i + 1, "unit_story_beats": [f"区段{i}的完整关键事件，不得从其他组上下文删去。"],
        }) for i in range(7)]
    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(
        get_project=lambda _: SimpleNamespace(active_story_bible_id=root.story_bible_id,
            active_story_bible_version=root.story_bible_version, planned_episode_count=56),
        get_story_bible=lambda *a, **k: build_active_lineage_story_bible(),
        list_story_plan_nodes=lambda *a, **k: [root, *leaves],
    )
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: build_strategy())
    service._story_plan_quality_hard_issues = lambda _: {}
    marker = ContextVar("review_test_context", default=None)
    token = marker.set("current-market-and-request")
    barrier, lock, called = Barrier(3, timeout=5), Lock(), []

    def generate(**kwargs):
        assert marker.get() == "current-market-and-request"
        keys = kwargs["output_schema"]["properties"]["evaluations"]["required"]
        assert 1 <= len(keys) <= 3
        for node in leaves:
            assert node.unit_story_beats[0] in kwargs["prompt"]
        allocation = json.loads(kwargs["prompt"].split("数字是规划目标，不是已写正文）：\n", 1)[1].split("\n", 1)[0])
        assert len(allocation) == 1
        assert allocation[0]["parent_episode_range"] == [1, 56]
        assert allocation[0]["parent_body_target"] == root.estimated_script_body_characters
        assert [row["node_id"] for row in allocation[0]["siblings"]] == [node.node_id for node in leaves]
        assert "其他组也必须看到：管理员仅承诺接收，没有取得原件。" in kwargs["prompt"]
        assert kwargs["strategy"].max_tokens == min(build_strategy().max_tokens, 5_000)
        with lock:
            called.append(keys)
        barrier.wait()  # Ensures independent groups are really concurrent.
        targets = [leaves[int(key.removeprefix("review_")) - 1] for key in keys]
        if "review_4" in keys and outcome == "unavailable":
            raise RuntimeError("provider unavailable")
        if "review_4" in keys and outcome == "wrong_group":
            targets[0] = leaves[0]
        if "review_4" in keys and outcome == "duplicate":
            targets[-1] = targets[0]
        return StoryPlanQualityModelOutput(overall_summary="本组检查完成。", evaluations=[
            StoryPlanQualityEvaluation(node_id=node.node_id, node_version=node.version,
                status="needs_revision" if outcome == "finding" and node is leaves[-1] else "pass",
                summary="关键条件缺失。" if outcome == "finding" and node is leaves[-1] else "本组因果成立。",
                issue_codes=["missing_condition"] if outcome == "finding" and node is leaves[-1] else [],
                repair_instruction="先安排实际交接再使用材料。" if outcome == "finding" and node is leaves[-1] else None,
            ) for node in targets])

    service._generate_planning_output = generate
    request = StoryPlanQualityAuditRequest(story_project_id=root.story_project_id,
        agent_request_id="agent-request.bounded-review-test",
        story_bible_id=root.story_bible_id, story_bible_version=root.story_bible_version,
        generation_strategy_id="strategy.review", node_refs=[{"node_id": n.node_id, "node_version": 1} for n in leaves],
        episode_plans=[{"source_node_id": leaves[0].node_id, "source_node_version": 1,
            "episode_number": 1, "synopsis": "只预约了明日保管。", "protagonist_decision": "先预约再保管。",
            "episode_payoff": "预约已受理。", "exit_state": "原件仍未移交。",
            "scene_execution_plan": [{"scene_number": 1,
                "visible_action": "其他组也必须看到：管理员仅承诺接收，没有取得原件。",
                "exit_state": "原件仍由主角持有。"}]}])
    try:
        if outcome in {"unavailable", "wrong_group", "duplicate"}:
            with pytest.raises(RuntimeError if outcome == "unavailable" else StoryPlanningInputError):
                service.audit_story_plan_quality(request)
        else:
            audit = service.audit_story_plan_quality(request)
            assert audit.status == ("needs_revision" if outcome == "finding" else "pass")
            assert audit.semantic_sample_count == audit.audited_node_count == 7
            assert [f.node_id for f in audit.findings] == ([leaves[-1].node_id] if outcome == "finding" else [])
        assert sorted(key for keys in called for key in keys) == [f"review_{i}" for i in range(1, 8)]
        assert len(called) == 3
    finally:
        marker.reset(token)
