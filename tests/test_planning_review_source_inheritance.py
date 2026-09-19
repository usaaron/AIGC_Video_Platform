from copy import deepcopy
import json
from types import SimpleNamespace

import pytest
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.agent_runtime.service import AgentRunService
from app.modules.agent_runtime.story_quality import StoryQualityAgent
from app.modules.script_engine.planning_review_context import (
    CONFIRMED_EVENT_REVIEW_CONTRACT, build_confirmed_event_review_context,
)
from app.modules.script_engine.planning_review_cache import quality_episode_projection
from app.modules.script_engine.planning_review_progress import quality_review_checkpoints
from app.modules.script_engine.planning_source_inheritance import (
    planning_source_context, planning_source_fingerprint, planning_source_signature,
)
from app.modules.script_engine.story_planning_service import StoryPlanningService
from app.modules.script_engine.story_quality_gate import current_story_quality_rejection
from app.modules.script_engine.long_story_models import StoryPlanQualityAuditRequest
from tests.test_planning_review_cache import approval_case
from tests.test_planning_review_resume import review_fixture
from tests.test_story_planning_service import build_active_lineage_story_bible, build_strategy


ORDERED_STORY = (
    "Lane在首次守堡时放弃安全区救下Eira。荒野中Lane救下伪装牧师的Eileen，她加入团队。"
    "Lane收留Lina并合作研发。Viola被处死、Cole出走后，Lina的戒指解封，器灵揭示起源并返还魔力。"
    "Lane反攻失地后赴皇城；离城返程遇分身偷袭重伤，敌军随后围城。"
    "Lane不顾伤势驰援、救出Eileen，最后统领联军反攻。三女主含蓄表达爱慕，Cole心怀愧疚。"
)


def with_confirmed_source(service, state):
    state.bible = state.bible.model_copy(update={"story_project_id": state.nodes[0].story_project_id})
    workspace = {
        "id": state.bible.story_project_id, "storyBibleVersion": state.bible.version,
        "storySynopsis": {"version": 4, "status": "confirmed", "text": ORDERED_STORY},
    }
    service._long_story_service.get_workspace_snapshot = lambda _: SimpleNamespace(workspace_payload=workspace)
    return workspace


def evidence_section(prompt, tag):
    return json.loads(prompt.split(f"<{tag}>\n", 1)[1].split(f"\n</{tag}>", 1)[0])


def test_review_sees_full_ordered_source_and_unsampled_sibling_events_without_mutation():
    service, _, state = review_fixture()
    workspace = with_confirmed_source(service, state)
    state.nodes[-1] = state.nodes[-1].model_copy(update={
        "unit_story_beats": ["Lane救出Eileen，随后又被分身偷袭，再次围城。"],
        "handoff_pressure": "前段已经完成救援，后段却仍要求首次救援。" * 20,
    })
    state.bible = state.bible.model_copy(update={"imported_source_document": "原文历史称谓：侯爵无力制衡妻子与继子。"})
    source = planning_source_context(state.bible, workspace)
    before = deepcopy((source, [node.model_dump(mode="json") for node in state.nodes]))
    prompt = StoryPlanningService._build_story_plan_quality_prompt(
        story_bible=state.bible, leaves=state.nodes[1:], sampled_leaves=[state.nodes[1]],
        evaluation_nodes=[state.nodes[1]], allocation_nodes=state.nodes, source_context=source,
    )
    supplied_source = evidence_section(prompt, "planning_source_evidence")
    assert supplied_source["confirmed_synopsis"]["text"] == ORDERED_STORY
    assert supplied_source["imported_source_document"] == state.bible.imported_source_document
    supplied_nodes = evidence_section(prompt, "complete_planning_event_evidence")
    assert len(supplied_nodes) == len(state.nodes)
    final = next(node for node in supplied_nodes if node["node_id"] == state.nodes[-1].node_id)
    assert final["unit_story_beats"] == state.nodes[-1].unit_story_beats
    assert final["handoff_pressure"] == state.nodes[-1].handoff_pressure
    assert final["parent_node_id"] == state.nodes[0].node_id
    assert final["parent_node_version"] == state.nodes[0].version
    assert CONFIRMED_EVENT_REVIEW_CONTRACT in prompt
    assert (source, [node.model_dump(mode="json") for node in state.nodes]) == before


def test_legacy_review_keeps_missing_confirmed_source_unknown_and_does_not_promote_old_text():
    _, _, state = review_fixture()
    bible = state.bible.model_copy(update={"imported_source_document": "原文旧关系，仅供辅助核对。"})
    prompt = build_confirmed_event_review_context(bible, None, state.nodes)
    source = evidence_section(prompt, "planning_source_evidence")
    assert source["confirmed_synopsis"] is None
    assert source["imported_source_document"] == bible.imported_source_document
    assert "不得声称已核对不存在的来源" in prompt
    assert "较新已确认总纲修订只覆盖其明确改动的事实" in prompt
    assert "原文旧矛盾不得覆盖该修改" in prompt


def test_repair_contract_checks_actors_order_unique_events_and_real_repair_scope():
    contract = CONFIRMED_EVENT_REVIEW_CONTRACT
    for instruction in (
        "谁实施、作用于谁", "全剧结局", "累计状态", "首次执行时间",
        "人物首次入场", "能力或装备来源", "confirmed_event_missing",
        "confirmed_event_order_conflict", "confirmed_event_actor_conflict",
        "confirmed_event_duplicate", "confirmed_event_timing_conflict",
        "先在共同父级最小协调", "错误边界不可当作必须保留的事实",
        "不能一面要求原进入/退出不变", "不能新增第二次袭击", "不得把已定主角救援替给同伴",
        "内心愧疚", "保留其程度", "不能替作者批准",
    ):
        assert instruction in contract


def test_each_review_group_receives_confirmed_source_and_same_source_checkpoint(tmp_path):
    service, request, state = review_fixture()
    workspace = with_confirmed_source(service, state)
    state.fail = False
    generated = service._generate_planning_output
    seen_sources = []

    def observe(**kwargs):
        seen_sources.append(evidence_section(kwargs["prompt"], "planning_source_evidence"))
        assert ORDERED_STORY in kwargs["prompt"]
        assert len(evidence_section(kwargs["prompt"], "complete_planning_event_evidence")) == len(state.nodes)
        return generated(**kwargs)

    service._generate_planning_output = observe
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'source-review.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    agent = StoryQualityAgent(planning_service=service, run_service=AgentRunService(runtime))
    first = agent.run(request)
    source = planning_source_context(state.bible, workspace)
    assert first.audit.reviewed_source_fingerprint == planning_source_fingerprint(source)
    assert first.audit.reviewed_source_signature == planning_source_signature(source)
    assert len(seen_sources) == 3
    assert all(value == seen_sources[0] for value in seen_sources)
    seen_sources.clear()
    assert agent.run(request).run.run_id == first.run.run_id
    assert seen_sources == []
    workspace["storySynopsis"] = {**workspace["storySynopsis"], "version": 5, "text": ORDERED_STORY + "能力归还先于皇城之战。"}
    latest = agent.run(request)
    assert latest.run.run_id != first.run.run_id
    assert len(seen_sources) == 3
    assert all(value["confirmed_synopsis"]["version"] == 5 for value in seen_sources)
    assert first.audit.status == latest.audit.status == "needs_revision"
    assert first.audit.reviewed_source_fingerprint != latest.audit.reviewed_source_fingerprint
    assert first.audit.reviewed_source_signature != latest.audit.reviewed_source_signature


def test_changed_confirmed_source_invalidates_partial_review_groups_without_erasing_findings():
    service, request, state = review_fixture()
    workspace = with_confirmed_source(service, state)
    checkpoints = []
    with quality_review_checkpoints(None, lambda value: checkpoints.append(deepcopy(value))):
        with pytest.raises(RuntimeError, match="disconnected"):
            service.audit_story_plan_quality(request)
    recovered = deepcopy(checkpoints[-1])
    assert len(recovered["groups"]) == 2
    workspace["storySynopsis"]["text"] = ORDERED_STORY + "该次救援只能发生一次。"
    state.fail = False
    state.calls.clear()
    with quality_review_checkpoints(recovered, lambda value: None):
        result = service.audit_story_plan_quality(request)
    assert len(state.calls) == 3
    assert result.status == "needs_revision"
    assert result.findings[0].node_id.endswith("part_6")
    assert recovered == checkpoints[-1]


@pytest.mark.parametrize("contract", [12, 13])
def test_current_and_previous_contract_failures_preserve_full_evidence_until_revision(contract):
    row = {"episode_number": 1, "story_bible_version": 3, "source_node_id": "node.source.review",
           "source_node_version": 2, "synopsis": "救援之后才受伤。",
           "continuity_requirements": ["先受伤再救援。"], "dramatic_units": [],
           "scene_execution_plan": [{"scene_number": 1, "visible_action": "Lane完成救援。",
                                     "exit_state": "尚未受伤。", "forbidden_changes": ["不得改由Lina救援。"]}]}
    workspace = {"storyBibleVersion": 3, "episodeRoadmaps": [row], "storyTreeQualityAudit": {
        "review_contract_version": contract, "story_bible_version": 3, "status": "needs_revision",
        "node_refs": [{"node_id": row["source_node_id"], "node_version": 2}],
        "reviewed_episode_plans": json.dumps([quality_episode_projection(row).model_dump(mode="json")]),
        "findings": [{"node_id": row["source_node_id"], "node_version": 2, "title": "救援时序",
                      "summary": "救援与受伤先后倒置。"}],
    }}
    loaded = json.loads(json.dumps(workspace))
    assert "先后倒置" in current_story_quality_rejection(1, loaded)
    loaded["episodeRoadmaps"][0]["scene_execution_plan"][0]["visible_action"] = "Lane带伤完成救援。"
    assert current_story_quality_rejection(1, loaded) is None
    assert "先后倒置" in current_story_quality_rejection(1, workspace)


@pytest.mark.parametrize("change", [
    None, "text", "version", "status", "pending", "outdated", "project", "bible_version",
    "imported_source", "missing_fingerprint",
])
def test_approval_only_reuse_requires_the_source_that_was_actually_reviewed(change):
    old, approved, audit = approval_case()
    bible = build_active_lineage_story_bible()
    bible.story_project_id = approved.story_project_id
    bible.imported_source_document = "历史原文：Lane救出Eileen。"
    workspace = {
        "id": approved.story_project_id, "storyBibleVersion": bible.version,
        "storySynopsis": {"version": 4, "status": "confirmed", "text": ORDERED_STORY},
        "episodeRoadmaps": [], "storyTreeQualityAudit": audit,
    }
    source = planning_source_context(bible, workspace)
    audit.update(reviewed_source_fingerprint=planning_source_fingerprint(source),
                 reviewed_source_signature=planning_source_signature(source))
    original_audit = deepcopy(audit)
    if change == "text": workspace["storySynopsis"]["text"] += "救援只发生一次。"
    elif change == "version": workspace["storySynopsis"]["version"] = 5
    elif change == "status": workspace["storySynopsis"]["status"] = "draft"
    elif change == "pending": workspace["storySynopsis"]["pendingChanges"] = True
    elif change == "outdated": workspace["storyBibleSynopsisOutdated"] = True
    elif change == "project": workspace["id"] = "project.unrelated"
    elif change == "bible_version": workspace["storyBibleVersion"] += 1
    elif change == "imported_source": bible.imported_source_document += "修正了行动者。"
    elif change == "missing_fingerprint": audit.pop("reviewed_source_fingerprint")
    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(
        get_project=lambda _: SimpleNamespace(active_story_bible_id=approved.story_bible_id,
            active_story_bible_version=approved.story_bible_version, planned_episode_count=8),
        get_story_bible=lambda *a, **k: bible,
        list_story_plan_nodes=lambda *a, **k: [approved],
        get_story_plan_node=lambda *a, **k: old,
        get_workspace_snapshot=lambda _: SimpleNamespace(workspace_payload=workspace),
    )
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: build_strategy())
    calls = []

    def review(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("changed source requires fresh review")

    service._generate_planning_output = review
    request = StoryPlanQualityAuditRequest(
        story_project_id=approved.story_project_id, story_bible_id=approved.story_bible_id,
        story_bible_version=approved.story_bible_version, generation_strategy_id="strategy.review",
        agent_request_id="agent-request.review.source-approval",
        node_refs=[{"node_id": approved.node_id, "node_version": approved.version}],
    )
    if change is None:
        result = service.audit_story_plan_quality(request)
        assert result.status.value == "pass" and calls == []
        assert result.node_refs[0].node_version == approved.version
        assert result.model_dump(mode="json")["created_at"] == original_audit["created_at"]
        assert result.reviewed_source_fingerprint == original_audit["reviewed_source_fingerprint"]
        assert result.reviewed_source_signature == original_audit["reviewed_source_signature"]
    else:
        with pytest.raises(RuntimeError, match="changed source"):
            service.audit_story_plan_quality(request)
        assert len(calls) == 1
        assert evidence_section(calls[0]["prompt"], "planning_source_evidence") == planning_source_context(bible, workspace)
    # A rejected cache entry is left intact, never silently converted or deleted.
    assert workspace["storyTreeQualityAudit"] == audit
    assert audit["status"] == original_audit["status"]
