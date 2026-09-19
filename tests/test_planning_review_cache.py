from copy import deepcopy
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.modules.script_engine.long_story_models import PlanningApprovalStatus, StoryPlanQualityAudit, StoryPlanQualityAuditRequest
from app.modules.script_engine.planning_review_cache import CURRENT_REVIEW_CONTRACT_VERSION, quality_node_signature, review_after_approval, quality_episode_projection
from app.modules.script_engine.planning_source_inheritance import (
    planning_source_context, planning_source_fingerprint, planning_source_signature,
)
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_episode_development_contract import authored_leaf
from tests.test_story_planning_service import build_active_lineage_story_bible, build_strategy


def approval_case():
    old = authored_leaf().model_copy(update={"status": PlanningApprovalStatus.draft, "approved_at": None})
    new = old.model_copy(update={"status": PlanningApprovalStatus.approved, "version": 2, "approved_at": datetime.now(timezone.utc)})
    source = planning_source_context(build_active_lineage_story_bible())
    audit = StoryPlanQualityAudit(
        story_project_id=old.story_project_id, story_bible_id=old.story_bible_id, story_bible_version=old.story_bible_version,
        node_refs=[{"node_id": old.node_id, "node_version": 1}],
        node_signature=quality_node_signature({(old.node_id, 1)}), status="pass", summary="因果推进与本段结算一致。",
        audited_node_count=1, semantic_sample_count=1,
        reviewed_source_fingerprint=planning_source_fingerprint(source),
        reviewed_source_signature=planning_source_signature(source),
    ).model_dump(mode="json") | {"review_contract_version": CURRENT_REVIEW_CONTRACT_VERSION, "reviewed_episode_plans": "[]"}
    return old, new, audit


@pytest.mark.parametrize("verdict", ["pass", "needs_revision"])
def test_approval_reuses_the_actual_verdict_and_review_time_without_modifying_sources(verdict):
    old, new, audit = approval_case()
    if verdict == "needs_revision":
        audit.update(status=verdict, findings=[{
            "node_id": old.node_id, "node_version": 1, "title": old.title,
            "start_episode": 1, "end_episode": 8, "summary": "结果缺少成立依据。",
            "issue_codes": ["causal_gap"], "repair_instruction": "补齐产生结果的行动。",
        }])
    before = deepcopy(audit)
    result = review_after_approval(audit, [old], [new], source_fingerprint=audit["reviewed_source_fingerprint"])
    assert result is not None and result.status.value == verdict
    assert result.node_refs[0].node_version == 2
    assert result.node_signature == quality_node_signature({(old.node_id, 2)})
    assert result.model_dump(mode="json")["created_at"] == audit["created_at"]
    assert result.summary == audit["summary"]
    if result.findings:
        assert result.findings[0].node_version == 2
        assert result.findings[0].summary == audit["findings"][0]["summary"]
    assert audit == before


@pytest.mark.parametrize("change", ["synopsis", "exit_state", "episode_developments", "story_bible_version", "parent_node_version", "draft", "skipped_version", "same_version", "old_contract", "episode_review", "signature", "missing_node"])
def test_review_never_carries_over_changed_content_context_or_unproven_versions(change):
    old, new, audit = approval_case()
    previous = [old]
    if change in {"synopsis", "exit_state"}:
        new = new.model_copy(update={change: "人物放弃先前行动，原结算没有发生。"})
    elif change == "episode_developments":
        entries = list(new.episode_developments)
        entries[0] = entries[0].model_copy(update={"synopsis": "人物拒绝原计划并销毁现存材料，证据已经无法保全。"})
        new = new.model_copy(update={change: entries})
    elif change in {"story_bible_version", "parent_node_version"}:
        new = new.model_copy(update={change: 9})
    elif change == "draft": new = new.model_copy(update={"status": PlanningApprovalStatus.draft})
    elif change == "skipped_version": new = new.model_copy(update={"version": 3})
    elif change == "same_version": new = old
    elif change == "old_contract": audit["review_contract_version"] = 8
    elif change == "episode_review": audit["reviewed_episode_plans"] = '[{"episode_number":1}]'
    elif change == "signature": audit["node_signature"] = "0" * 64
    else: previous = []
    assert review_after_approval(audit, previous, [new], source_fingerprint=audit["reviewed_source_fingerprint"]) is None


@pytest.mark.parametrize("review_version", [8, 9, 10, 11, 12, 13])
@pytest.mark.parametrize("new_episodes,stored_episodes", [(False, False), (True, False), (False, True)])
def test_actual_audit_entry_skips_only_approval_changes_and_reviews_new_episode_content(new_episodes, stored_episodes, review_version):
    old, new, audit = approval_case()
    audit["review_contract_version"] = review_version
    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(
        get_project=lambda _: SimpleNamespace(active_story_bible_id=new.story_bible_id, active_story_bible_version=new.story_bible_version, planned_episode_count=8),
        get_story_bible=lambda *args, **kwargs: build_active_lineage_story_bible(),
        list_story_plan_nodes=lambda *args, **kwargs: [new],
        get_workspace_snapshot=lambda _: SimpleNamespace(workspace_payload={"storyTreeQualityAudit": audit, "episodeRoadmaps": [{"episode_number": 1}] if stored_episodes else []}),
        get_story_plan_node=lambda *args, **kwargs: old,
    )
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: build_strategy())
    calls = []
    def model_call(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("fresh content must be reviewed")
    service._generate_planning_output = model_call
    episodes = [{
        "source_node_id": new.node_id, "source_node_version": new.version, "episode_number": 1,
        "synopsis": "人物公开新的材料，导致证人处境发生变化。", "protagonist_decision": "先公开再保护证人。",
        "episode_payoff": "材料进入公开质证。", "exit_state": "证人身份面临暴露。",
    }] if new_episodes else []
    request = StoryPlanQualityAuditRequest(
        story_project_id=new.story_project_id, story_bible_id=new.story_bible_id, story_bible_version=new.story_bible_version,
        generation_strategy_id="strategy.review", node_refs=[{"node_id": new.node_id, "node_version": 2}],
        agent_request_id="agent-request.approval-review", episode_plans=episodes,
    )
    if new_episodes or stored_episodes or review_version != CURRENT_REVIEW_CONTRACT_VERSION:
        with pytest.raises(RuntimeError, match="fresh content"):
            service.audit_story_plan_quality(request)
        assert len(calls) == 1
    else:
        result = service.audit_story_plan_quality(request)
        assert result.status.value == "pass" and result.node_refs[0].node_version == 2
        assert calls == []


@pytest.mark.parametrize("change", [None, "synopsis", "action", "evidence", "source", "added", "omitted", "stored_mismatch", "dialogue_objective", "dialogue_target", "dialogue_total", "scene_characters", "continuity_requirements", "dramatic_units", "forbidden_changes"])
def test_actual_audit_reuses_unchanged_reviewed_scenes_only_after_approval(change):
    old, new, audit = approval_case()
    row = {
        "source_node_id": old.node_id, "source_node_version": old.version, "episode_number": 1,
        "story_bible_version": old.story_bible_version,
        "planned_dialogue_line_count": 25,
        "synopsis": "主角取得原件，管理员当场签收并入柜。",
        "protagonist_decision": "提交原件。", "episode_payoff": "原件封存完成。", "exit_state": "原件已在柜中。",
        "source_unit_story_beats": [old.unit_story_beats[0]],
        "scene_execution_plan": [{"scene_number": 1, "visible_action": "管理员接过原件，签收后放入柜内。",
                                  "evidence_requirements": ["签收联和柜内原件。"], "exit_state": "原件已在柜中。",
                                  "character_refs": ["character.mara", "character.clerk"],
                                  "dialogue_objective": "双方就拒收理由交涉，并当场确认封存责任。", "dialogue_line_target": 25}],
    }
    audit["reviewed_episode_plans"] = json.dumps([quality_episode_projection(row).model_dump(mode="json")])
    current = deepcopy(row) | {"source_node_version": new.version, "approval_status": "approved"}
    if change == "synopsis": current["synopsis"] = "主角仍持有原件。"
    elif change == "action": current["scene_execution_plan"][0]["visible_action"] = "管理员只是口头答应接收，主角带走原件。"
    elif change == "evidence": current["scene_execution_plan"][0]["evidence_requirements"] = ["柜门尚未打开。"]
    elif change == "source": current["source_unit_story_beats"] = []
    elif change == "dialogue_objective": current["scene_execution_plan"][0]["dialogue_objective"] = "独自把所有操作逐条录音报账。"
    elif change == "dialogue_target": current["scene_execution_plan"][0]["dialogue_line_target"] = 30
    elif change == "dialogue_total": current["planned_dialogue_line_count"] = 30
    elif change == "scene_characters": current["scene_execution_plan"][0]["character_refs"] = ["character.mara"]
    elif change == "continuity_requirements": current["continuity_requirements"] = ["旧内部审查仍然有效。"]
    elif change == "dramatic_units": current["dramatic_units"] = [{
        "trigger": "原件已送到接收窗口。", "choice": "两人始终保持沉默。",
        "visible_consequence": "两人没有说话便完成交接。", "change_type": "责任", "evidence_hint": "全场两人都没有开口。",
    }]
    elif change == "forbidden_changes": current["scene_execution_plan"][0]["forbidden_changes"] = ["不得让原件离开主角手中。"]
    rows = [current]
    if change == "added": rows.append(deepcopy(current) | {"episode_number": 2})
    if change == "omitted": rows = []
    stored = deepcopy(rows)
    if change == "stored_mismatch": stored[0]["scene_execution_plan"][0]["visible_action"] = "管理员拒绝收件。"
    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(
        get_project=lambda _: SimpleNamespace(active_story_bible_id=new.story_bible_id, active_story_bible_version=new.story_bible_version, planned_episode_count=8),
        get_story_bible=lambda *args, **kwargs: build_active_lineage_story_bible(),
        list_story_plan_nodes=lambda *args, **kwargs: [new],
        get_workspace_snapshot=lambda _: SimpleNamespace(workspace_payload={"storyTreeQualityAudit": audit, "episodeRoadmaps": stored}),
        get_story_plan_node=lambda *args, **kwargs: old,
    )
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: build_strategy())
    calls = []
    def model_call(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("fresh content must be reviewed")
    service._generate_planning_output = model_call
    request = StoryPlanQualityAuditRequest(
        story_project_id=new.story_project_id, story_bible_id=new.story_bible_id, story_bible_version=new.story_bible_version,
        generation_strategy_id="strategy.review", node_refs=[{"node_id": new.node_id, "node_version": new.version}],
        agent_request_id="agent-request.same-scenes", episode_plans=[quality_episode_projection(item) for item in rows],
    )
    if change is not None:
        with pytest.raises(RuntimeError, match="fresh content"):
            service.audit_story_plan_quality(request)
        assert len(calls) == 1
    else:
        result = service.audit_story_plan_quality(request)
        assert result.status.value == "pass" and calls == []
        assert result.model_dump(mode="json")["created_at"] == audit["created_at"]
