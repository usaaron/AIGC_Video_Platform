"""Review the approved execution contract completely, without rewriting evidence."""
from copy import deepcopy
import json

import pytest
from pydantic import ValidationError

from app.modules.script_engine.long_story_models import StoryPlanQualityAuditRequest, StoryPlanQualityEpisode
from app.modules.script_engine.planning_review_cache import quality_episode_projection
from app.modules.script_engine.planning_review_context import (
    SAME_EPISODE_EXECUTION_REVIEW_CONTRACT, compact_review_episode,
)
from app.modules.script_engine.story_planning_service import StoryPlanningService
from app.script_delivery_contract import SHORT_DRAMA_PACING_CONTRACT
from tests.test_episode_development_contract import authored_leaf
from tests.test_story_planning_service import build_active_lineage_story_bible
from tests.test_planning_review_context import restore


def execution_record():
    node = authored_leaf()
    return {
        "source_node_id": node.node_id, "source_node_version": node.version, "episode_number": 7,
        "planned_dialogue_line_count": 30,
        "synopsis": "旧内部审查已经终止，当事人在现场听到这一结果。",
        "protagonist_decision": "保留独立专项复核。", "episode_payoff": "旧内部审查正式终止。",
        "exit_state": "旧内部审查终止，独立专项复核继续。",
        "source_turning_points": [node.unit_story_beats[0]],
        "source_unit_story_beats": [node.unit_story_beats[0], "前文没有发生的结果仍须保留原文供核对。"],
        "continuity_requirements": ["旧内部审查仍然持续。", "在场当事人不知道本次公开通知。", "旧内部审查仍然持续。"],
        "dramatic_units": [{
            "trigger": "两人已经收到通知。", "choice": "两人始终保持沉默。", "visible_consequence": "两人在沉默中接受代价。",
            "change_type": "关系", "evidence_hint": "两人都没有开口。",
        }],
        "scene_execution_plan": [{
            "scene_number": 2, "visible_action": "两人在现场用简短对话确认代价。", "exit_state": "两人决定继续联系。",
            "character_refs": ["character.lead", "character.partner"],
            "evidence_requirements": ["当事人当场听到旧审查终止。"],
            "dialogue_objective": "两人用对话各自提出继续联系的边界。", "dialogue_line_target": 15,
            "forbidden_changes": ["不得让两人开口。", "独立专项复核不得擅自取消。"],
        }],
    }


def test_complete_review_evidence_survives_request_validation_and_lossless_reference_compaction():
    original = execution_record()
    snapshot = deepcopy(original)
    evidence = quality_episode_projection(original)
    serialized = evidence.model_dump(mode="json")
    node = authored_leaf()
    request = StoryPlanQualityAuditRequest(
        story_project_id=node.story_project_id, story_bible_id=node.story_bible_id,
        story_bible_version=node.story_bible_version, generation_strategy_id="strategy.review",
        node_refs=[{"node_id": node.node_id, "node_version": node.version}],
        episode_plans=[serialized], agent_request_id="agent-request.complete-evidence",
    )
    roundtrip = request.model_dump(mode="json")["episode_plans"][0]
    assert roundtrip["continuity_requirements"] == snapshot["continuity_requirements"]
    assert roundtrip["dramatic_units"] == snapshot["dramatic_units"]
    assert roundtrip["scene_execution_plan"][0]["forbidden_changes"] == snapshot["scene_execution_plan"][0]["forbidden_changes"]
    assert "forbidden_changes" not in roundtrip  # This is a scene contract, not a new episode-level field.
    compressed = compact_review_episode(roundtrip, node.unit_story_beats)
    assert compressed["source_turning_points"] == [1]
    assert restore(compressed, node.unit_story_beats, None) == roundtrip
    assert original == snapshot


def test_review_prompt_keeps_cross_layer_silence_knowledge_and_ended_state_conflicts_visible():
    first = execution_record()
    second = deepcopy(first)
    second.update(episode_number=8, synopsis="下一集收到另一项独立通知。", continuity_requirements=["此新通知只在下一集发生。"])
    second["dramatic_units"] = []
    second["scene_execution_plan"][0]["forbidden_changes"] = ["不得把本集新通知提前到上一集。"]
    records = [first, second]
    snapshots = deepcopy(records)
    node = authored_leaf()
    prompt = StoryPlanningService._build_story_plan_quality_prompt(
        story_bible=build_active_lineage_story_bible(), leaves=[node], sampled_leaves=[node],
        episode_plans=[quality_episode_projection(record) for record in records],
    )
    marker = "分集未覆盖完整节点时，只评价已有内容，不把尚未生成的结尾判为漏结算。\n"
    actual = json.loads(prompt.split(marker, 1)[1].split("\n", 1)[0])
    assert [row["episode_number"] for row in actual] == [7, 8]
    for row, original in zip(actual, snapshots, strict=True):
        assert row["continuity_requirements"] == original["continuity_requirements"]
        assert row["dramatic_units"] == original["dramatic_units"]
        assert row["scene_execution_plan"][0]["forbidden_changes"] == original["scene_execution_plan"][0]["forbidden_changes"]
    assert actual[0]["dramatic_units"][0]["evidence_hint"] == "两人都没有开口。"
    assert actual[0]["scene_execution_plan"][0]["dialogue_line_target"] == 15
    assert SAME_EPISODE_EXECUTION_REVIEW_CONTRACT in prompt
    assert SHORT_DRAMA_PACING_CONTRACT in prompt
    assert "逐集检查所有已提供分集，再逐场核对" in prompt
    assert "不能用多数分集成立" in prompt
    assert "片刻停顿、局部沉默" in prompt
    assert "不让复制的旧约束复活已终止状态" in prompt
    assert "强情绪与密集交锋完全合法，每集25–35句继续保持" in prompt
    assert records == snapshots


def test_legacy_review_evidence_keeps_missing_constraints_empty_without_inventing_or_promoting_facts():
    original = execution_record()
    for field in ("continuity_requirements", "dramatic_units"):
        original.pop(field)
    original["scene_execution_plan"][0].pop("forbidden_changes")
    evidence = quality_episode_projection(original)
    assert evidence.continuity_requirements == []
    assert evidence.dramatic_units == []
    assert evidence.scene_execution_plan[0].forbidden_changes == []


def test_review_schema_reuses_the_full_dramatic_unit_contract_and_rejects_incomplete_units():
    schema = StoryPlanQualityAuditRequest.model_json_schema()
    unit = schema["$defs"]["EpisodeDramaticUnit"]
    assert set(unit["properties"]) == {"trigger", "choice", "visible_consequence", "change_type", "evidence_hint"}
    assert schema["$defs"]["StoryPlanQualityEpisode"]["properties"]["dramatic_units"]["items"] == {"$ref": "#/$defs/EpisodeDramaticUnit"}
    malformed = execution_record()
    del malformed["dramatic_units"][0]["choice"]
    with pytest.raises(ValidationError, match="dramatic_units.0.choice"):
        quality_episode_projection(malformed)
    with pytest.raises(ValidationError, match="forbidden_changes"):
        StoryPlanQualityEpisode.model_validate({**quality_episode_projection(execution_record()).model_dump(), "forbidden_changes": ["错误的集级字段"]})
