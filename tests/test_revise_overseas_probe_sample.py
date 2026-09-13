from copy import deepcopy
import json
import sys

import pytest

from scripts.revise_overseas_probe_sample import (
    CORRECTION_SETS,
    SOURCE_DRAFT_SHA256,
    apply_corrections,
    main,
    verify_next_episode_state,
)


def _report36_draft():
    return {
        "untouched_metadata": {"provisional": True},
        "scenes": [{"slug": "Unchanged opening"}, {
            "character_actions": ["First", "Second", "Third", "Fourth", "亚当滑到页脚的次日08:00，又返回事故当日20:00。"],
            "body_order": [
                "action:0", "dialogue:0", "dialogue:1", "action:1", "dialogue:2", "dialogue:3",
                "action:2", "dialogue:4", "dialogue:5", "action:3", "dialogue:6", "dialogue:7",
                "action:4", "dialogue:8", "dialogue:9",
            ],
            "dialogues": [{"intent": "返回原字段", "text": "Original dialogue", "chinese_translation": "原对白"}
                          for _ in range(10)],
        }, {"slug": "Unchanged ending"}],
        "character_state_updates": [{
            "character_name": name,
            "knowledge_states": [
                {"knowledge_key": "mine.payment_statement.time_gap", "statement": "付款18:00早于通报所载事故20:00。", "status": "disproved"},
                {"knowledge_key": "actual_accident", "statement": "实际事故时间仍未知。", "status": "known"},
            ],
        } for name in ("伊芙", "亚当")],
    }


def _next_request(revised):
    characters = [{"character_ref": ref, "knowledge_states": revised["character_state_updates"][index]["knowledge_states"]}
                  for index, ref in enumerate(("character.eve_hart", "character.adam_cole"))]
    capsules = [{"capsule_id": f"memory.{row['character_ref']}",
                 "summary": f"角色{row['character_ref']}；known:{row['knowledge_states'][0]['statement']}"}
                for row in characters]
    return {"episode_context": {
        "provisional_continuity_checkpoint": json.dumps({"through_episode_number": 1, "character_states": characters}),
        "memory_recall": {"capsules": capsules},
    }}


def test_report36_edits_are_reversible_and_preserve_unreviewed_content():
    source = _report36_draft()
    untouched = deepcopy(source)
    revised, changes = apply_corrections(source, "report36")
    assert source == untouched
    assert len(changes) == 6
    assert revised["scenes"][0] == source["scenes"][0]
    assert revised["scenes"][2] == source["scenes"][2]
    scene = revised["scenes"][1]
    assert len(scene["character_actions"]) == len(source["scenes"][1]["character_actions"])
    assert len(scene["dialogues"]) == len(source["scenes"][1]["dialogues"])
    assert sorted(scene["body_order"]) == sorted(source["scenes"][1]["body_order"])
    assert scene["body_order"].index("action:4") < scene["body_order"].index("dialogue:7")
    assert scene["dialogues"][8]["intent"] == "滑回事故当日20:00字段"
    assert all(row["knowledge_states"][0]["status"] == "known" for row in revised["character_state_updates"])
    for change in reversed(changes):
        parent = revised
        for part in change["path"][:-1]:
            parent = parent[part]
        assert parent[change["path"][-1]] == change["after"]
        parent[change["path"][-1]] = change["before"]
    assert revised == source


@pytest.mark.parametrize("correction_set", [None, "report36", "report38"])
def test_revision_rejects_unreviewed_source_before_creating_output(tmp_path, monkeypatch, correction_set):
    source = tmp_path / "source"
    (source / "episode_001").mkdir(parents=True)
    (source / "episode_001/draft.json").write_text("{}")
    output = tmp_path / "output"
    argv = ["revision", "--source", str(source), "--output-dir", str(output)]
    if correction_set:
        argv.extend(["--correction-set", correction_set])
    monkeypatch.setattr(sys, "argv", argv)
    with pytest.raises(ValueError, match=f"exact {correction_set or 'report34'} sample"):
        main()
    assert not output.exists()
    assert CORRECTION_SETS["report34"]["source_draft_sha256"] == SOURCE_DRAFT_SHA256


@pytest.mark.parametrize("broken_layer", [None, "checkpoint", "recall", "prompt"])
def test_report36_requires_corrected_state_in_checkpoint_recall_and_prompt(broken_layer):
    revised, _ = apply_corrections(_report36_draft(), "report36")
    payload = _next_request(revised)
    context = payload["episode_context"]
    prompt = json.dumps(context["memory_recall"], ensure_ascii=False)
    if broken_layer == "checkpoint":
        context["provisional_continuity_checkpoint"] = context["provisional_continuity_checkpoint"].replace('"known"', '"disproved"', 1)
    elif broken_layer == "recall":
        context["memory_recall"]["capsules"][0]["summary"] = context["memory_recall"]["capsules"][0]["summary"].replace("known:", "disproved:")
    elif broken_layer == "prompt":
        prompt = prompt.replace("known:", "disproved:")
    if broken_layer:
        with pytest.raises(AssertionError):
            verify_next_episode_state(payload, revised, prompt, "report36")
    else:
        verify_next_episode_state(payload, revised, prompt, "report36")


@pytest.mark.parametrize("episode_number", [1, 2])
def test_report38_changes_preserve_knowledge_and_playable_order(episode_number):
    scene = {
        "character_actions": [f"Original action {index}" for index in range(6)],
        "dialogues": [{"text": "Original", "chinese_translation": "原文", "intent": "核对"} for _ in range(10)],
        "dialogue_prompts": ["Original" for _ in range(6)],
        "body_order": ["action:0", "action:1", "action:2", "dialogue:5", "action:3", "dialogue:6", "action:4", "action:5"],
    }
    source = {"scenes": [deepcopy(scene) for _ in range(3)],
              "character_state_updates": [{"knowledge_states": [{"status": "known", "statement": "Original knowledge"}]}],
              "continuity_state_updates": [{"current_state": "Original source evidence"}]}
    untouched = deepcopy(source)
    revised, changes = apply_corrections(source, "report38", episode_number)
    assert source == untouched
    assert revised["character_state_updates"] == source["character_state_updates"]
    assert revised["continuity_state_updates"] == source["continuity_state_updates"]
    for before, after in zip(source["scenes"], revised["scenes"]):
        assert before["body_order"] == after["body_order"]
        assert len(before["character_actions"]) == len(after["character_actions"])
        assert len(before["dialogues"]) == len(after["dialogues"])
    changed_scene = revised["scenes"][1 if episode_number == 1 else 2]
    if episode_number == 1:
        assert "再滑回事故记载20:00" in changed_scene["character_actions"][2]
        assert "滑到页脚" in changed_scene["dialogues"][6]["intent"]
        assert "切换相机拍下亚当屏幕" in changed_scene["character_actions"][4]
        assert "这两个时间都很重要" in changed_scene["dialogues"][2]["chinese_translation"]
    else:
        assert "走到停车区另一端" in changed_scene["character_actions"][5]
        assert "展示给亚当" in changed_scene["character_actions"][5]
        assert "他看清后点头" in changed_scene["character_actions"][5]
        assert changed_scene["dialogues"][5]["text"] == changed_scene["dialogue_prompts"][5]
        assert "who I am" in changed_scene["dialogues"][5]["text"]
        assert "a work order with her signature" in changed_scene["dialogues"][5]["text"]
        assert "No attachments." in changed_scene["dialogues"][5]["text"]
    for change in reversed(changes):
        parent = revised
        for part in change["path"][:-1]:
            parent = parent[part]
        parent[change["path"][-1]] = change["before"]
    assert revised == source


def test_report38_rejects_output_inside_source_before_writing(tmp_path):
    from scripts.revise_overseas_report38 import revise_report38_sample

    source = tmp_path / "source"
    output = source / "revised"
    with pytest.raises(ValueError, match="outside the immutable source"):
        revise_report38_sample(source, output)
    assert not source.exists()


def test_report38_rejects_mismatched_run_before_writing(tmp_path, monkeypatch):
    import hashlib
    from scripts.revise_overseas_report38 import revise_report38_sample

    source = tmp_path / "source"
    episode = source / "episode_001"
    episode.mkdir(parents=True)
    draft_path = episode / "draft.json"
    draft_path.write_text('{"title": "Exact reviewed draft"}')
    (episode / "run.json").write_text('{"data": {"draft_master_script": {"title": "Different run"}}}')
    monkeypatch.setitem(CORRECTION_SETS["report38"]["episodes"][1], "source_draft_sha256",
                        hashlib.sha256(draft_path.read_bytes()).hexdigest())
    output = tmp_path / "revised"
    with pytest.raises(ValueError, match="run and draft disagree"):
        revise_report38_sample(source, output)
    assert not output.exists()


@pytest.mark.parametrize("broken_layer", [None, "checkpoint", "workspace", "recall", "prompt", "evidence"])
def test_report38_third_episode_checks_focused_checkpoint_and_full_adam_state(broken_layer):
    from scripts.revise_overseas_report38 import verify_report38_handoff

    condition = {"knowledge_key": "nora_condition", "statement": "诺拉拒绝科尔家族成员靠近会面。", "status": "known"}
    adam = {"knowledge_states": [condition], "emotional_state": "对诺拉的警告保持警惕。",
            "change_cause": "诺拉明确排斥科尔家族。"}
    draft = {"character_state_updates": [{"knowledge_states": [condition]}, adam],
             "scenes": [{}, {}, {"body_order": ["action:5"], "character_actions": ["Original"] * 5 + [
                 "伊芙将整条警告展示给亚当；他看清后点头。"]}]}
    checkpoint = {"through_episode_number": 2, "version": "provisional", "character_states": [
        {"character_ref": "character.eve_hart", "knowledge_states": [deepcopy(condition)]}]}
    workspace = {"characters": [{"id": "adam_cole", "dynamicState": {"knowledgeStates": [
        {"knowledgeKey": "nora_condition", "statement": condition["statement"], "status": "known"}]}}]}
    recall = {"status": "sufficient", "missing_requirements": [], "capsules": [
        {"capsule_id": "memory.character.adam_cole", "summary": adam["emotional_state"] + adam["change_cause"]}]}
    prompt = json.dumps(recall, ensure_ascii=False)
    if broken_layer == "checkpoint":
        checkpoint["character_states"][0]["knowledge_states"][0]["status"] = "suspected"
    elif broken_layer == "workspace":
        workspace["characters"][0]["dynamicState"]["knowledgeStates"][0]["status"] = "suspected"
    elif broken_layer == "recall":
        recall["capsules"][0]["summary"] = "Unrelated facts"
        prompt = json.dumps(recall)
    elif broken_layer == "prompt":
        prompt = "Omitted recall"
    elif broken_layer == "evidence":
        draft["scenes"][2]["character_actions"][5] = "警告只留在伊芙手机上。"
    payload = {"episode_context": {"provisional_continuity_checkpoint": json.dumps(checkpoint), "memory_recall": recall}}
    if broken_layer:
        with pytest.raises(AssertionError):
            verify_report38_handoff(payload, draft, 2, prompt, workspace)
    else:
        verify_report38_handoff(payload, draft, 2, prompt, workspace)
