from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from app.modules.script_engine.future_revision_review import future_revision_context, scope_matches_workspace
from app.modules.script_engine.long_story_models import StoryPlanQualityAuditRequest, StoryPlanQualityModelOutput
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.planning_review_cache import CURRENT_REVIEW_CONTRACT_VERSION, quality_episode_projection
from app.modules.script_engine.story_planning_service import StoryPlanningService, StoryPlanningInputError
from tests.test_planning_revision import complete_revision_workspace, reviewed_completion, record_quality_audit, save
from tests.test_story_planning_service import build_strategy


@pytest.mark.parametrize("problem", ["historical", "boundary", "future"])
def test_existing_audit_call_retains_history_and_checks_actual_boundary(complete_revision_workspace, problem):
    long, _, _, active, node = complete_revision_workspace
    service = object.__new__(StoryPlanningService)
    service._long_story_service = long
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: build_strategy())
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        scoped_problem = problem in {"boundary", "future"}
        return StoryPlanQualityModelOutput.model_validate({
            "overall_summary": "历史问题保留，另核对未来执行。",
            "evaluations": [{"node_id": node.node_id, "node_version": node.version,
                "status": "needs_revision", "summary": "第1集存在历史重复，不能说全剧已通过。",
                "issue_codes": ["historical_repetition"], "repair_instruction": "历史问题保留记录。"}],
            "future_revision_evaluation": {"status": "needs_revision" if scoped_problem else "pass",
                "summary": "保存的原件持有状态支持后续开场。" if not scoped_problem else "后续错误使用了已交出的原件。",
                "issue_codes": ["saved_boundary_conflict"] if scoped_problem else [],
                "repair_instruction": "后续须承接真实原件保管人。" if scoped_problem else None},
        })

    service._generate_planning_output = generate
    request = StoryPlanQualityAuditRequest(
        story_project_id=active["id"], story_bible_id=node.story_bible_id, story_bible_version=1,
        planning_revision_epoch=1, generation_strategy_id="strategy.test",
        node_refs=[{"node_id": node.node_id, "node_version": node.version}],
        episode_plans=[quality_episode_projection(row) for row in active["episodeRoadmaps"]],
        agent_request_id="agent-request.future.review",
    )
    result = service.audit_story_plan_quality(request)
    assert len(calls) == 1
    assert result.status == "needs_revision"
    assert result.findings[0].issue_codes == ["historical_repetition"]
    # This fixture's sole leaf straddles the frozen boundary: its unspecific
    # historical finding cannot safely be treated as prefix-only.
    assert result.future_revision_review.status == "needs_revision"
    assert "主角收好原件" in calls[0]["prompt"]
    assert "过去未兑现的义务" in calls[0]["prompt"]
    assert "future_revision_evaluation" in calls[0]["output_schema"]["required"]
    candidate = reviewed_completion(active)
    candidate["storyTreeQualityAudit"].update(result.model_dump(mode="json"))
    record_quality_audit(long, candidate)
    if problem != "historical":
        assert any(f.start_episode == 2 for f in result.findings)
    with pytest.raises(LongStoryPersistenceConflictError):
        save(long, candidate, 3)



@pytest.mark.parametrize("tamper", ["missing_scope", "old_epoch", "old_revision", "wrong_range", "changed_body", "changed_plan", "edited_verdict", "forged_result"])
def test_completion_rejects_stale_or_client_forged_scope(complete_revision_workspace, tamper):
    service, _, _, active, _ = complete_revision_workspace
    candidate = reviewed_completion(active)
    if tamper != "forged_result":
        record_quality_audit(service, candidate)
    audit = candidate["storyTreeQualityAudit"]
    scope = audit["future_revision_review"]
    if tamper == "missing_scope": audit.pop("future_revision_review")
    elif tamper == "old_epoch": scope["planning_revision_epoch"] = 0
    elif tamper == "old_revision": scope["revision_id"] = "planning-revision.old"
    elif tamper == "wrong_range": scope["start_episode"] = 3
    elif tamper == "changed_body": candidate["episodes"][0]["workingDraftJson"] = json.dumps({"synopsis": "伪造已保存事实。"})
    elif tamper == "changed_plan": candidate["episodeRoadmaps"][1]["synopsis"] += "未经审校的新事实。"
    elif tamper == "edited_verdict": audit["summary"] = "客户端擅自修改服务器结论。"
    with pytest.raises(LongStoryPersistenceConflictError):
        save(service, candidate, 3)
    assert service.get_workspace_snapshot(active["id"]).workspace_payload == active


def test_evidence_digest_covers_whole_saved_body_without_prompting_whole_body(complete_revision_workspace):
    _, _, _, active, _ = complete_revision_workspace
    source = deepcopy(active)
    draft = json.loads(source["episodes"][0]["workingDraftJson"])
    draft["scenes"].insert(0, {"scene_number": 1, "character_actions": ["开头完整原文不可忽略。"]})
    source["episodes"][0]["workingDraftJson"] = json.dumps(draft)
    context = future_revision_context(source)
    assert "开头完整原文" not in json.dumps(context["saved_boundary_episode"], ensure_ascii=False)
    assert context["evidence_signature"] != future_revision_context(active)["evidence_signature"]
    assert scope_matches_workspace(context, source)
    assert not scope_matches_workspace(context, active)


def test_completed_revision_reaudit_keeps_actual_boundary_with_fresh_source_fingerprint(complete_revision_workspace):
    _, _, _, active, node = complete_revision_workspace
    source = deepcopy(active)
    source['planningRevision']['status'] = 'completed'
    source['planningRevisionEpoch'] = 2
    source['episodeRoadmaps'][-1]['synopsis'] += '本次只纠正现场人物引用。'
    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(
        get_workspace_snapshot=lambda _: SimpleNamespace(workspace_payload=source))
    request = StoryPlanQualityAuditRequest(
        story_project_id=source['id'], story_bible_id=node.story_bible_id, story_bible_version=1,
        planning_revision_epoch=2, generation_strategy_id='strategy.test',
        agent_request_id='agent-request.completed.reaudit',
        node_refs=[{'node_id': node.node_id, 'node_version': node.version}],
        episode_plans=[quality_episode_projection(row) for row in source['episodeRoadmaps']],
    )
    context = service._future_quality_context(request)
    assert context['revision_id'] == active['planningRevision']['revisionId']
    assert context['planning_revision_epoch'] == 2
    assert '主角收好原件' in json.dumps(context['saved_boundary_episode'], ensure_ascii=False)
    assert context['evidence_signature'] != future_revision_context(active)['evidence_signature']
    assert scope_matches_workspace(context, source)
    request.episode_plans[-1].synopsis += '未经保存的改动。'
    with pytest.raises(StoryPlanningInputError, match='exact complete saved roadmap'):
        service._future_quality_context(request)


def test_reaudit_sees_saved_clarification_without_revoking_scope_as_bodies_progress(complete_revision_workspace):
    _, _, _, active, _ = complete_revision_workspace
    source = deepcopy(active)
    source['planningRevision']['status'] = 'completed'
    source['episodes'].append({'episodeNumber': 2, 'status': 'saved', 'workingDraftJson': json.dumps({
        'scenes': [{'scene_number': 1, 'character_actions': ['从既有照片打印带署名日志页，未取得原件。'],
                    'dialogues': [{'character_name': '主角', 'text': '只作照片核对件。'}],
                    'body_order': ['action:0', 'dialogue:0']}],
        'llm_metadata': {'private_trace': 'Do not multiply this trace into the review prompt.'},
    })})
    current = future_revision_context(source, completing=True)
    actual = current['recent_saved_execution'][-1]
    assert actual['episode_number'] == 2
    assert actual['scenes'][0]['ordered_body'][0]['action'] == '从既有照片打印带署名日志页，未取得原件。'
    assert 'private_trace' not in json.dumps(current)
    source['episodes'][-1]['hasLocalDraftEdits'] = True
    pending = future_revision_context(source, completing=True)
    assert not any(row['episode_number'] == 2 for row in pending['recent_saved_execution'])
    assert current['recent_saved_execution'] != pending['recent_saved_execution']
    assert current['evidence_signature'] == pending['evidence_signature']
    assert scope_matches_workspace(current, source)


def test_contradictory_boundary_pass_preserves_issue():
    result = StoryPlanQualityModelOutput.model_validate({"overall_summary": "整体仍需核对。",
        "evaluations": [{"node_id": "node.one", "node_version": 1, "status": "pass", "summary": "本节点通过。"}],
        "future_revision_evaluation": {"status": "pass", "summary": "存在真实边界冲突。", "issue_codes": ["boundary_conflict"]}})
    assert result.future_revision_evaluation.status == "needs_revision"


def test_reaudit_retains_material_acquisition_before_recent_window(complete_revision_workspace):
    _, _, _, active, _ = complete_revision_workspace
    source = deepcopy(active)
    for number in range(2, 15):
        action = '原件保管人当场允许主角拍摄整页，主角将照片留在手机。' if number == 2 else '主角继续核对。'
        source['episodes'].append({'episodeNumber': number, 'status': 'saved', 'workingDraftJson': json.dumps({
            'scenes': [{'scene_number': 1, 'character_actions': [action],
                        'dialogues': [{'character_name': '保管人', 'text': '原件留在这里。'}],
                        'body_order': ['dialogue:0', 'action:0']}],
            'llm_metadata': {'trace': 'NEVER_COPY_MODEL_TRACE'},
        })})
    current = future_revision_context(source)
    early = next(row for row in current['historical_saved_execution'] if row['episode_number'] == 2)
    assert early['scenes'][0]['ordered_body'] == [
        ['保管人', '原件留在这里。'], '原件保管人当场允许主角拍摄整页，主角将照片留在手机。']
    assert len(current['recent_saved_execution']) == 10
    assert 'NEVER_COPY_MODEL_TRACE' not in json.dumps(current)
    source['episodes'][1]['hasLocalDraftEdits'] = True
    pending = future_revision_context(source)
    assert not any(row['episode_number'] == 2 for row in pending['historical_saved_execution'])
    assert current['historical_saved_execution'] != pending['historical_saved_execution']
    assert current['evidence_signature'] == pending['evidence_signature']


def test_completed_server_review_retains_prefix_failure_without_claiming_full_pass(complete_revision_workspace):
    service, _, _, active, node = complete_revision_workspace
    candidate = reviewed_completion(active)
    audit = candidate["storyTreeQualityAudit"]
    audit.update(status="needs_revision", findings=[{"node_id": node.node_id, "node_version": node.version,
        "title": "冻结历史问题", "start_episode": 1, "end_episode": 1,
        "summary": "历史重复仍保留，不影响后续真实承接。", "issue_codes": ["historical_repetition"],
        "repair_instruction": "历史问题保留，不冒称整剧通过。"}])
    record_quality_audit(service, candidate)
    completed = save(service, candidate, 3).workspace_payload
    assert completed["storyTreeQualityAudit"]["status"] == "needs_revision"
    assert completed["storyTreeQualityAudit"]["findings"] == audit["findings"]
    assert completed["episodes"] == active["episodes"]
    from app.modules.script_engine.story_quality_gate import current_story_quality_rejection
    assert current_story_quality_rejection(1, completed) is not None
    assert current_story_quality_rejection(2, completed) is None


def test_cross_boundary_finding_blocks_even_when_scope_claims_pass(complete_revision_workspace):
    service, _, _, active, node = complete_revision_workspace
    candidate = reviewed_completion(active)
    candidate["storyTreeQualityAudit"].update(status="needs_revision", findings=[{
        "node_id": node.node_id, "node_version": node.version, "title": "跨界问题",
        "start_episode": 1, "end_episode": 8, "summary": "该问题范围跨越冻结边界。",
        "issue_codes": ["cross_boundary"], "repair_instruction": "核对跨界因果后重新审校。"}])
    record_quality_audit(service, candidate)
    with pytest.raises(LongStoryPersistenceConflictError, match="future-range findings"):
        save(service, candidate, 3)


def test_real_service_distinguishes_wholly_frozen_leaf_from_reviewed_future_leaf():
    from tests.test_story_planning_service import build_active_lineage_story_node, build_active_lineage_story_bible
    bible = build_active_lineage_story_bible()
    root = build_active_lineage_story_node(node_id="node.root", version=1, start_episode=1,
                                         end_episode=16, expansion_status="expanded")
    first = build_active_lineage_story_node(node_id="node.history", version=1, start_episode=1,
        end_episode=8, expansion_status="episode_ready", parent_node_id=root.node_id, parent_node_version=1)
    second = build_active_lineage_story_node(node_id="node.future", version=1, start_episode=9,
        end_episode=16, expansion_status="episode_ready", parent_node_id=root.node_id, parent_node_version=1).model_copy(update={
            "entry_state": first.exit_state, "central_conflict": "主角当面质问证据保管人并确认来源。",
            "exit_state": "证人承认曾经调换文件并交出原件。", "unit_resolution": "新的证据交接已经发生。"})
    plans = [{"episode_number": n, "source_node_id": first.node_id if n <= 8 else second.node_id,
              "source_node_version": 1, "synopsis": f"第{n}集发生独立行动与后果。"} for n in range(1, 17)]
    workspace = {"planningRevisionEpoch": 1, "storyBibleVersion": 1, "episodeRoadmaps": plans,
        "planningRevision": {"status": "active", "revisionId": "revision.future", "startEpisode": 9},
        "episodes": [{"episodeNumber": 8, "workingDraftJson": json.dumps({
            "synopsis": "主角持有原件。", "scenes": [{"character_actions": ["主角收好原件。"]}]})}]}
    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(
        get_project=lambda _: SimpleNamespace(active_story_bible_id=bible.story_bible_id, active_story_bible_version=1, planned_episode_count=16),
        get_story_bible=lambda *a, **k: bible,
        list_story_plan_nodes=lambda *a, **k: [root, first, second],
        get_workspace_snapshot=lambda _: SimpleNamespace(workspace_payload=workspace))
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: build_strategy())
    calls = []
    def generate(**kwargs):
        calls.append(kwargs)
        return StoryPlanQualityModelOutput.model_validate({"overall_summary": "历史保留，未来可继续。",
            "evaluations": [
                {"node_id": first.node_id, "node_version": 1, "status": "needs_revision", "summary": "前段仍有历史重复。",
                 "issue_codes": ["historical_repetition"], "repair_instruction": "如实保留历史问题。"},
                {"node_id": second.node_id, "node_version": 1, "status": "pass", "summary": "后段有实际交接并承接已存正文。"}],
            "future_revision_evaluation": {"status": "pass", "summary": "原件持有与下一场交接连贯，前文没有阻断后段的未兑义务。"}})
    service._generate_planning_output = generate
    result = service.audit_story_plan_quality(StoryPlanQualityAuditRequest(
        story_project_id=root.story_project_id, story_bible_id=bible.story_bible_id, story_bible_version=1,
        planning_revision_epoch=1, generation_strategy_id="strategy.test", agent_request_id="request.future.real",
        node_refs=[{"node_id": n.node_id, "node_version": 1} for n in (first, second)],
        episode_plans=[quality_episode_projection(row) for row in plans]))
    assert len(calls) == 1
    assert result.status == "needs_revision"
    assert result.future_revision_review.status == "pass"
    assert [(f.start_episode, f.end_episode) for f in result.findings] == [(1, 8)]
