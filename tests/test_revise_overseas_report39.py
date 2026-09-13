from copy import deepcopy
import json

import pytest

from scripts.revise_overseas_report39 import (
    apply_report39_corrections,
    revise_report39_sample,
    verify_report39_handoff,
)


def _draft():
    return {
        "unreviewed_evidence": {"accident_time": "unknown", "first_payment": "18:00"},
        "scenes": [{
            "character_actions": ["Original action"] * count,
            "body_order": [*(f"action:{index}" for index in range(count)),
                           *(f"dialogue:{index}" for index in range(10))],
            "dialogues": [{"intent": "Original intent", "text": "Original dialogue",
                           "chinese_translation": "原对白"} for _ in range(10)],
            "dialogue_prompts": ["Original dialogue"] * 6,
        } for count in (5, 5, 6)],
        "character_state_updates": [{
            "location": "Original location", "knowledge_changes": ["Original knowledge"] * 4,
            "knowledge_states": [{"knowledge_key": str(index), "statement": "Original fact", "status": "known"}
                                 for index in range(5)],
            "lasting_marks": ["Original mark"], "active_constraints": ["Original constraint"],
            "change_cause": "Original cause", "change_summary": "Original summary",
        } for _ in range(3)],
        "continuity_state_updates": [{"entity_name": "Original entity", "current_state": "Original state",
                                      "change_cause": "Original cause"} for _ in range(4)],
        "relationship_state_updates": [{"change_cause": "Original cause"}],
        "setup_payoff_updates": [{"setup_payoff_ref": "hook_payoff_target_episode_4"}],
        "next_episode_question": "Investigate the dispatch logs and Eve's sister's signature.",
    }


def test_report39_corrections_are_reversible_and_keep_evidence_and_body_membership():
    original = _draft()
    unchanged = deepcopy(original)
    revised, changes = apply_report39_corrections(original)
    assert original == unchanged
    assert revised["unreviewed_evidence"] == original["unreviewed_evidence"]
    assert revised["next_episode_question"] == original["next_episode_question"]
    assert {item["finding"] for item in changes} == {"N01", "N02", "N03", "N04", "N05", "N06"}
    for before, after in zip(original["scenes"], revised["scenes"]):
        assert len(before["character_actions"]) == len(after["character_actions"])
        assert len(before["dialogues"]) == len(after["dialogues"])
        assert sorted(before["body_order"]) == sorted(after["body_order"])
    assert revised["scenes"][1]["body_order"].index("action:1") < revised["scenes"][1]["body_order"].index("dialogue:0")
    ending = revised["scenes"][2]
    assert ending["body_order"].index("action:2") < ending["body_order"].index("dialogue:2")
    assert ending["body_order"].index("action:5") < ending["body_order"].index("dialogue:9")
    assert ending["dialogue_prompts"][5] == ending["dialogues"][5]["text"]
    for change in reversed(changes):
        parent = revised
        for key in change["path"][:-1]:
            parent = parent[key]
        assert parent[change["path"][-1]] == change["after"]
        parent[change["path"][-1]] = change["before"]
    assert revised == original


def test_report39_rejects_unreviewed_source_before_writing(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "probe.db").write_bytes(b"Not the reviewed database")
    output = tmp_path / "output"
    with pytest.raises(ValueError, match="exact report39"):
        revise_report39_sample(source, output)
    assert not output.exists()


def test_report39_rejects_nested_output_before_writing(tmp_path):
    source = tmp_path / "source"
    with pytest.raises(ValueError, match="outside the immutable source"):
        revise_report39_sample(source, source / "revised")
    assert not source.exists()


def _handoff_fixture():
    draft, _ = apply_report39_corrections(_draft())
    knowledge = [{"knowledgeKey": row["knowledge_key"], "statement": row["statement"], "status": row["status"]}
                 for row in draft["character_state_updates"][1]["knowledge_states"]]
    workspace = {"characters": [{"id": "adam_cole", "dynamicState": {
        "knowledgeStates": knowledge, "currentKnowledge": ["Only saw a safety signal"], "lastingMarks": [],
        "activeConstraints": draft["character_state_updates"][1]["active_constraints"],
    }}, {"id": "nora_reed", "dynamicState": {"knowledgeStates": [{
        "knowledgeKey": "full_work_order_content", "status": "known",
        "statement": draft["character_state_updates"][2]["knowledge_states"][-1]["statement"],
    }]}}], "setupPayoffs": []}
    checkpoint = {"through_episode_number": 3, "version": "provisional", "character_states": [{
        "character_ref": "character.adam_cole", "knowledge_states": draft["character_state_updates"][1]["knowledge_states"],
    }]}
    handoff = {"generation_ready": False, "episode_context": {
        "approved_episode_plan": None, "provisional_continuity_checkpoint": json.dumps(checkpoint, ensure_ascii=False),
        "memory_recall": {"through_episode_number": 3, "capsules": [{
            "capsule_id": "memory.character.adam_cole",
            "summary": draft["character_state_updates"][1]["active_constraints"][-1],
        }]},
    }}
    return handoff, workspace, draft


@pytest.mark.parametrize("broken_layer", [None, "workspace", "checkpoint", "recall", "lasting_marks", "setup", "plan", "nora"])
def test_report39_handoff_rejects_wrong_knowledge_and_field_semantics(broken_layer):
    handoff, workspace, draft = _handoff_fixture()
    if broken_layer == "workspace":
        workspace["characters"][0]["dynamicState"]["knowledgeStates"].append({"knowledgeKey": "meeting_result", "status": "known"})
    elif broken_layer == "checkpoint":
        checkpoint = json.loads(handoff["episode_context"]["provisional_continuity_checkpoint"])
        checkpoint["character_states"][0]["knowledge_states"].append({"knowledge_key": "meeting_result", "status": "known"})
        handoff["episode_context"]["provisional_continuity_checkpoint"] = json.dumps(checkpoint)
    elif broken_layer == "recall":
        handoff["episode_context"]["memory_recall"]["capsules"] = [{"summary": "听见伊芙获悉调度室记录位置"}]
    elif broken_layer == "lasting_marks":
        workspace["characters"][0]["dynamicState"]["lastingMarks"] = ["Lost publication freedom"]
    elif broken_layer == "setup":
        workspace["setupPayoffs"] = [{"id": "hook_payoff_target_episode_4"}]
    elif broken_layer == "plan":
        handoff["generation_ready"] = True
    elif broken_layer == "nora":
        workspace["characters"][1]["dynamicState"]["knowledgeStates"][0]["statement"] = "完整工单影像内容尚未由诺拉查看。"
    if broken_layer:
        with pytest.raises(AssertionError):
            verify_report39_handoff(handoff, workspace, draft)
    else:
        assert verify_report39_handoff(handoff, workspace, draft)["passed"]
