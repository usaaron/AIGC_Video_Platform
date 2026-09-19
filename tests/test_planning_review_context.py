from copy import deepcopy
import json

from app.modules.script_engine.planning_review_context import compact_review_episode, review_event_references
from app.modules.script_engine.planning_review_cache import quality_episode_projection
from app.script_delivery_contract import SHORT_DRAMA_PACING_CONTRACT
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_episode_development_contract import authored_leaf
from tests.test_story_planning_service import build_active_lineage_story_bible, build_active_lineage_story_node
from app.modules.script_engine.long_story_models import StoryPlanExpansionStatus


def restore(record, events, previous):
    result = deepcopy(record)
    for key in ("source_turning_points", "source_unit_story_beats"):
        if key in result:
            result[key] = [events[value - 1] if isinstance(value, int) else value for value in result[key]]
    if result.pop("entry_state_inherits_previous_exit", False):
        result["entry_state"] = previous
    return result


def test_review_compression_roundtrips_every_episode_and_preserves_originals():
    node = authored_leaf()
    previous = node.entry_state
    saved = node.model_dump()
    for item in node.episode_developments:
        record = item.model_dump(mode="json")
        compressed = compact_review_episode(record, node.unit_story_beats, preceding_exit_state=previous)
        assert restore(compressed, node.unit_story_beats, previous) == record
        previous = item.exit_state
    assert node.model_dump() == saved


def test_review_keeps_unknown_claims_contradictory_entries_and_actual_scene_evidence():
    events = ["原件仍由母亲保管。", "主角复制了原件。"]
    record = {"entry_state": "主角已拿走原件。", "source_turning_points": [events[0]],
              "source_unit_story_beats": [events[1], "原件已经销毁。"],
              "scene_execution_plan": [{"visible_action": "主角只拿走一张照片。", "exit_state": "原件已移交。"}]}
    saved = deepcopy(record)
    compressed = compact_review_episode(record, events, preceding_exit_state=events[0])
    assert compressed["entry_state"] == record["entry_state"]
    assert compressed["source_unit_story_beats"] == [2, "原件已经销毁。"]
    assert compressed["scene_execution_plan"] == record["scene_execution_plan"]
    assert restore(compressed, events, events[0]) == saved
    assert record == saved


def test_review_references_preserve_duplicate_and_empty_claims_in_order():
    assert review_event_references(["原件", "其他", "原件"], ["原件", "原件"]) == [1, "其他", 1]
    assert review_event_references([], ["原件"]) == []


def test_quality_prompt_exposes_complete_event_table_and_reconstructable_episode_states():
    node = authored_leaf()
    prompt = StoryPlanningService._build_story_plan_quality_prompt(
        story_bible=build_active_lineage_story_bible(), leaves=[node], sampled_leaves=[node],
    )
    table = json.loads(prompt.split("因果节拍：", 1)[1].split("\n", 1)[0])
    entries = json.loads(prompt.split("逐集事件分配：", 1)[1].split("\n", 1)[0])
    assert table == node.unit_story_beats
    previous = node.entry_state
    for compressed, item in zip(entries, node.episode_developments, strict=True):
        assert restore(compressed, table, previous) == item.model_dump(mode="json")
        previous = item.exit_state
    assert "引用本身不能证明事件已经执行" in prompt


def test_quality_review_sees_unsampled_sibling_allocation_without_mixing_tree_depths():
    parent = build_active_lineage_story_node(
        node_id="node.alloc.root", version=1, start_episode=1, end_episode=130,
        expansion_status=StoryPlanExpansionStatus.expanded,
    ).model_copy(update={"estimated_script_body_characters": 100000})
    siblings = [build_active_lineage_story_node(
        node_id=f"node.alloc.part{index}", version=1, start_episode=start, end_episode=end,
        expansion_status=StoryPlanExpansionStatus.unexpanded,
        parent_node_id=parent.node_id, parent_node_version=parent.version,
    ).model_copy(update={
        "sequence_order": index, "estimated_script_body_characters": budget,
        "decomposition_reason": reason,
    }) for index, (start, end, budget, reason) in enumerate([
        (1, 18, 2140, "本段仅承载前12集，剩余6集留给下一段。"),
        (19, 30, 2140, "完成夺取资源与家族清算的具体行动。"),
        (31, 41, 6539, "完成公开交锋与人物选择。"),
        (42, 130, 89181, "皇城解围后完成联军反攻与感情线结算，仍待细分。"),
    ], 1)]
    descendant = siblings[0].model_copy(update={
        "node_id": "node.alloc.descendant", "parent_node_id": siblings[0].node_id,
        "planned_end_episode": 8, "estimated_script_body_characters": 1000,
    })
    stale_sibling = siblings[-1].model_copy(update={"parent_node_version": 2, "version": 2})
    nodes = [parent, *siblings, descendant, stale_sibling]
    saved = [node.model_dump() for node in nodes]
    prompt = StoryPlanningService._build_story_plan_quality_prompt(
        story_bible=build_active_lineage_story_bible(),
        leaves=[descendant, *siblings[1:]], sampled_leaves=[siblings[1]],
        evaluation_nodes=[siblings[1]], allocation_nodes=nodes,
    )
    evidence = json.loads(prompt.split("数字是规划目标，不是已写正文）：\n", 1)[1].split("\n", 1)[0])
    assert len(evidence) == 1
    assert evidence[0]["parent_episode_range"] == [1, 130]
    assert evidence[0]["parent_body_target"] == 100000
    assert [(row["node_id"], row["node_version"], row["episode_range"], row["body_target"], row["allocation_reason"])
            for row in evidence[0]["siblings"]] == [
        (node.node_id, node.version, [node.planned_start_episode, node.planned_end_episode],
         node.estimated_script_body_characters, node.decomposition_reason) for node in siblings
    ]
    assert "allocation_without_story_support" in prompt
    assert "剧情负荷不同可以合理不均衡" in prompt
    assert "不能要求数字均分、固定比例" in prompt
    assert "不能仅凭节拍数量少于集数判容量不足" in prompt
    assert [node.model_dump() for node in nodes] == saved


def test_quality_review_keeps_absent_parent_budget_unknown():
    node = authored_leaf().model_copy(update={
        "parent_node_id": "node.unprovided", "parent_node_version": 1,
        "estimated_script_body_characters": None,
    })
    prompt = StoryPlanningService._build_story_plan_quality_prompt(
        story_bible=build_active_lineage_story_bible(), leaves=[node], sampled_leaves=[node],
    )
    evidence = json.loads(prompt.split("数字是规划目标，不是已写正文）：\n", 1)[1].split("\n", 1)[0])
    assert evidence[0]["parent_episode_range"] is None
    assert evidence[0]["parent_body_target"] is None
    assert evidence[0]["siblings"][0]["body_target"] is None


def test_quality_prompt_receives_speech_capacity_evidence_and_preserves_legitimate_monologues():
    node = authored_leaf()
    record = {
        "source_node_id": node.node_id, "source_node_version": node.version, "episode_number": 1,
        "planned_dialogue_line_count": 25,
        "synopsis": "调查者独自比对材料，并整理操作记录。",
        "protagonist_decision": "保留原始记录。", "episode_payoff": "观察到一处差异。", "exit_state": "记录已保存。",
        "scene_execution_plan": [{
            "scene_number": 1, "visible_action": "调查者独自核对并登记，手边放着录音设备。",
            "evidence_requirements": ["记录中的差异。"], "exit_state": "记录已保存。",
            "character_refs": ["character.investigator"],
            "dialogue_objective": "全场25行均为操作录音，逐条说明屏幕状态和登记内容。",
            "dialogue_line_target": 25,
        }],
    }
    saved = deepcopy(record)
    evidence = quality_episode_projection(record)
    prompt = StoryPlanningService._build_story_plan_quality_prompt(
        story_bible=build_active_lineage_story_bible(), leaves=[node], sampled_leaves=[node],
        episode_plans=[evidence],
    )

    assert evidence.planned_dialogue_line_count == 25
    assert evidence.scene_execution_plan[0].character_refs == ["character.investigator"]
    assert '"dialogue_line_target":25' in prompt
    assert '"planned_dialogue_line_count":25' in prompt
    assert record["scene_execution_plan"][0]["dialogue_objective"] in prompt
    assert SHORT_DRAMA_PACING_CONTRACT in prompt
    assert "强情绪、短促对白、密集攻防本身不是问题" in prompt
    assert "每集保留25–35句" in prompt
    assert "dialogue_capacity_mismatch" in prompt
    assert "不按说话人数、录音形式或固定台词数量一概否定" in prompt
    assert "旧数据缺少对白字段" in prompt
    assert record == saved


def test_legacy_quality_evidence_does_not_invent_a_dialogue_purpose_or_budget():
    node = authored_leaf()
    evidence = quality_episode_projection({
        "source_node_id": node.node_id, "source_node_version": node.version, "episode_number": 1,
        "scene_execution_plan": [{"scene_number": 1, "visible_action": "保管人展示原件。", "exit_state": "原件仍由保管人持有。"}],
    })

    assert evidence.planned_dialogue_line_count is None
    assert evidence.scene_execution_plan[0].dialogue_objective is None
    assert evidence.scene_execution_plan[0].dialogue_line_target is None
