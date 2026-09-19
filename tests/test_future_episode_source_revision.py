"""Future revisions must repair stale ownership without unlocking saved episodes."""
from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from app.modules.script_engine.long_story_models import (
    EpisodeDevelopment, EpisodePlanGenerationItem, EpisodePlanItemModificationRequest,
    PlanningApprovalStatus,
)
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.planning_revision import require_request_epoch
from app.modules.script_engine.story_planning_service import StoryPlanningInputError
from test_story_planning_service import (
    FixedStoryBibleAdapter, build_active_lineage_episode_item,
    build_episode_item_generation_service,
)


def revision_case():
    calls = []
    response = {}

    class Adapter(FixedStoryBibleAdapter):
        def get_model_info(self):
            # Exercise production readiness/compilation with an offline writer.
            return super().get_model_info().model_copy(update={"provider": "openai_compatible"})

        def generate_structured_output(self, prompt, *args, **kwargs):
            calls.append((prompt, kwargs.get("output_schema")))
            return deepcopy(response)

    service, node = build_episode_item_generation_service(Adapter())
    beats = [f"主角完成第{n}项独立核验，公开对应凭证并保留实际结果。" for n in range(1, 9)]
    node.unit_story_beats = beats
    node.turning_points = [beats[1]]
    previous = node.entry_state
    for number, beat in enumerate(beats, 1):
        exit_state = f"第{number}项独立核验已完成，对应凭证进入公开记录。"
        node.episode_developments.append(EpisodeDevelopment(
            episode_number=number, synopsis=beat, entry_state=previous, exit_state=exit_state,
            source_turning_points=[beat] if number == 2 else [], source_unit_story_beats=[beat],
        ))
        previous = exit_state
    node.exit_state = previous
    owned = node.episode_developments[1]
    prefix = EpisodePlanGenerationItem.model_validate(build_active_lineage_episode_item(1)).model_copy(update={
        key: getattr(node.episode_developments[0], key)
        for key in ("entry_state", "exit_state", "source_turning_points", "source_unit_story_beats")
    })
    scenes = []
    for number, lines in [(1, 0), (2, 30)]:
        scenes.append({
            "scene_number": number, "scene_heading": "INT. 档案室 - 夜",
            "character_refs": ["character.mara"],
            "scene_objective": "固定旧凭证的完整页面。" if number == 1 else "当面反驳拒绝公开的理由。",
            "opposition": "凭证已被撕掉一角，保管者拒绝解释。",
            "information_shift": "留存图显示页码缺口。" if number == 1 else "公开材料获准保留完整来源。",
            "choice_or_cost": "主角接受公开自己操作记录的代价。",
            "evidence_requirements": ["现场页面与原始留存图逐项对应。"],
            "forbidden_changes": ["不得把原件交给无关人员。"],
            "visible_action": "主角无声拍下两张凭证，沿页码核对缺失位置。" if number == 1 else "主角指着缺口逼保管者回应，保管者让出完整原始登记供公开核对。",
            "turn_or_reveal": "凭证仍有可核验的独立来源。",
            "dialogue_objective": "本场以无声拍照完成核对。" if number == 1 else "主角追问拒绝公开的理由，以登记逐项回应反方质疑。",
            "dialogue_line_target": lines, "shot_target": 8,
            "exit_state": "页面已拍照留存，原件未离开现场。" if number == 1 else owned.exit_state,
        })
    current = EpisodePlanGenerationItem.model_validate({
        **build_active_lineage_episode_item(2), "planned_scene_count": 2,
        "planned_dialogue_line_count": 30, "scene_execution_plan": scenes,
        "source_turning_points": ["旧转折仍要等待回执"],
        "source_unit_story_beats": ["旧事件尚未公开材料"],
    })
    response.update(current.model_dump(mode="json"))
    response.update({
        "episode_title": "公开缺口", "synopsis": "主角拍下凭证页码缺口，面对阻拦仍公开原始登记，保管者被迫回应缺页责任。",
        "episode_goal": "将独立来源与缺页事实公开核验。",
        "central_conflict": "保管者阻止缺页记录公开，主角坚持留存完整来源。",
        "protagonist_decision": "主角公开完整原始登记而非继续等待私人答复。",
        "reveal": "缺页登记有独立留存图可以核验。",
        "episode_payoff": "公开核验使保管者必须面对缺页来源。",
        "pressure_escalation": "公开缺页记录使责任人面临现场追问。",
        "cliffhanger": "下一份独立凭证也带有同一页码缺口。",
        **{key: getattr(owned, key) for key in ("entry_state", "exit_state", "source_turning_points", "source_unit_story_beats")},
    })
    workspace = {"planningRevisionEpoch": 4, "planningRevision": {"status": "active", "startEpisode": 2},
                 "episodes": [{"episodeNumber": 1, "workingDraftJson": "saved frozen body"}]}
    service._long_story_service.get_workspace_snapshot = lambda _: SimpleNamespace(workspace_payload=workspace)
    service._long_story_service.validate_planning_request_epoch = lambda _project, epoch, episode_number=None: require_request_epoch(
        workspace, epoch, episode_number=episode_number,
    )
    request = EpisodePlanItemModificationRequest(
        story_project_id=node.story_project_id, source_node_id=node.node_id, source_node_version=node.version,
        generation_strategy_id="strategy.test", episode_number=2, accepted_plans=[prefix],
        current_plan=current, planning_revision_epoch=4,
        instruction="按最新批准本叶逐集事件，整体重写本集完整规划；保留90秒、2场、16镜头和30句，各场对白0/30及镜头8/8。",
        revision_mode="rewrite",
    )
    return service, node, request, workspace, response, calls


@pytest.mark.parametrize("mode", ["rewrite", "targeted"])
def test_future_rewrite_rebinds_only_owned_fields_before_generation_and_preserves_budget(mode):
    service, node, request, workspace, _response, calls = revision_case()
    request = request.model_copy(update={"revision_mode": type(request.revision_mode)(mode)})
    before = deepcopy(request.model_dump())
    workspace_before = deepcopy(workspace)
    owned = node.episode_developments[1]
    bound = service._future_revision_episode_input(request, node)
    expected = request.current_plan.model_dump()
    for key in ("entry_state", "exit_state", "source_turning_points", "source_unit_story_beats"):
        expected[key] = getattr(owned, key)
    assert bound.model_dump() == expected
    result = service.modify_episode_plan_item(request)
    assert len(calls) == 1
    prompt, schema = calls[0]
    for key in ("entry_state", "exit_state", "source_turning_points", "source_unit_story_beats"):
        assert getattr(result, key) == getattr(owned, key)
    assert owned.entry_state in prompt and owned.exit_state in prompt
    assert owned.source_unit_story_beats[0] in prompt
    assert "旧转折仍要等待回执" not in prompt
    assert "旧事件尚未公开材料" not in prompt
    # Existing wire transport binds authoritative boundaries outside model prose.
    assert schema is None  # Native JSON carries its authoritative schema in the prompt.
    schema, _ = json.JSONDecoder().raw_decode(prompt.split("AUTHORITATIVE JSON SCHEMA:\n", 1)[1])
    assert "entry_state" not in schema["properties"]
    assert "source_unit_story_beats" not in schema["properties"]
    for key in ("episode_number", "ending_mode", "story_line_refs", "setup_refs", "payoff_refs",
                "target_duration_seconds", "planned_scene_count", "planned_shot_count", "planned_dialogue_line_count"):
        assert getattr(result, key) == getattr(request.current_plan, key)
    assert [scene.dialogue_line_target for scene in result.scene_execution_plan] == [0, 30]
    assert [scene.shot_target for scene in result.scene_execution_plan] == [8, 8]
    assert result.execution_ready is True and result.layer_contracts.meets_contract is True
    assert request.model_dump() == before
    assert workspace == workspace_before
    assert service._long_story_service.saved_nodes == []


@pytest.mark.parametrize("failure", ["targeted", "inactive", "completed", "frozen", "saved", "epoch", "draft_node", "stale_node", "accepted_prefix"])
def test_unauthorized_or_stale_rebinding_fails_before_model(failure):
    service, node, request, workspace, _response, calls = revision_case()
    if failure == "targeted":
        request = request.model_copy(update={"instruction": "只修改本集标题。", "revision_mode": type(request.revision_mode)("targeted")})
    elif failure == "inactive":
        workspace.pop("planningRevision")
    elif failure == "completed":
        workspace["planningRevision"]["status"] = "completed"
    elif failure == "frozen":
        workspace["planningRevision"]["startEpisode"] = 3
    elif failure == "saved":
        workspace["episodes"].append({"episodeNumber": 2, "workingDraftJson": "already saved"})
    elif failure == "epoch":
        request = request.model_copy(update={"planning_revision_epoch": 3})
    elif failure == "draft_node":
        node.status = PlanningApprovalStatus.draft
    elif failure == "stale_node":
        service._long_story_service.latest = service._long_story_service.replacement
    elif failure == "accepted_prefix":
        request = request.model_copy(update={"accepted_plans": [request.accepted_plans[0].model_copy(update={"exit_state": "错误的前集退出状态仍不可跳过。"})]})
    with pytest.raises((StoryPlanningInputError, LongStoryPersistenceConflictError)):
        service.modify_episode_plan_item(request)
    assert calls == []
