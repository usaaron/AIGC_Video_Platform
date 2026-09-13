from copy import deepcopy

import pytest

from app.modules.script_engine.generation_service import ScriptGenerationService


def dialogue(text, *, speaker="Mara", translation=None):
    return {"character_name": speaker, "chinese_character_name": "玛拉" if speaker == "Mara" else "诺亚",
            "intent": "追问真相", "text": text, "chinese_translation": translation}


def rebalance(scene, *, actions=None, dialogues=None):
    return ScriptGenerationService._rebalance_episode_production_counts_locally(
        {"scenes": [scene]},
        target_dialogue_count=len(scene["dialogues"]) if dialogues is None else dialogues,
        target_shot_count=len(scene["character_actions"]) if actions is None else actions,
    )["scenes"][0]


@pytest.mark.parametrize("text", ["ElenaBlocksDoor", "Mara locks the only exit.",
                                  "Dr. Miller opens the file.", "J. Smith locks the door."])
def test_count_shortfall_does_not_split_atomic_text(text):
    scene = {"character_actions": [text], "dialogues": [dialogue(text)],
             "body_order": ["action:0", "dialogue:0"]}
    assert rebalance(scene, actions=2, dialogues=2) == scene


def test_sentence_split_preserves_existing_action_dialogue_order_and_source():
    scene = {"character_actions": ["Mara opens the door. Mara steps back.", "Noah hands over the file."],
             "dialogues": [dialogue("Come inside."), dialogue("Show me the signature.")],
             "body_order": ["dialogue:0", "action:0", "action:1", "dialogue:1"]}
    original = deepcopy(scene)
    repaired = rebalance(scene, actions=3)
    assert scene == original
    assert repaired["character_actions"] == ["Mara opens the door.", "Mara steps back.", "Noah hands over the file."]
    assert repaired["body_order"] == ["dialogue:0", "action:0", "action:1", "action:2", "dialogue:1"]


def test_bilingual_line_is_not_split_with_duplicated_translation():
    scene = {"character_actions": [],
             "dialogues": [dialogue("Don't move! Keep the door shut.", translation="别动！把门关上。")],
             "body_order": ["dialogue:0"]}
    assert rebalance(scene, dialogues=2) == scene


def test_adjacent_bilingual_merge_keeps_both_translations_and_order():
    scene = {"character_actions": ["玛拉压住文件。"], "dialogues": [
        dialogue("You knew.", translation="你早就知道。"),
        dialogue("Why hide it?", translation="为什么瞒着我？"),
        dialogue("Answer me.", speaker="Noah", translation="回答我。"),
    ], "body_order": ["dialogue:0", "dialogue:1", "action:0", "dialogue:2"]}
    repaired = rebalance(scene, dialogues=2)
    assert repaired["dialogues"][0]["text"] == "You knew. Why hide it?"
    assert repaired["dialogues"][0]["chinese_translation"] == "你早就知道。为什么瞒着我？"
    assert repaired["body_order"] == ["dialogue:0", "action:0", "dialogue:1"]


def test_dialogue_merge_does_not_cross_an_intervening_action():
    scene = {"character_actions": ["玛拉撕开封条。"],
             "dialogues": [dialogue("Is it sealed?"), dialogue("It was.")],
             "body_order": ["dialogue:0", "action:0", "dialogue:1"]}
    assert rebalance(scene, dialogues=1) == scene


def test_count_excess_does_not_delete_short_but_meaningful_dialogue():
    scene = {"character_actions": [], "dialogues": [
        dialogue("Stay."), dialogue("No.", speaker="Noah"),
        dialogue("Please."), dialogue("Leave.", speaker="Noah"),
    ], "body_order": ["dialogue:0", "dialogue:1", "dialogue:2", "dialogue:3"]}
    assert rebalance(scene, dialogues=3) == scene


def test_action_merge_does_not_move_actions_across_dialogue():
    scene = {"character_actions": ["Mara hides the file.", "Mara shows the empty drawer."],
             "dialogues": [dialogue("Nothing here.")],
             "body_order": ["action:0", "dialogue:0", "action:1"]}
    assert rebalance(scene, actions=1) == scene


def test_merge_cannot_drop_an_unpaired_translation():
    scene = {"character_actions": [], "dialogues": [
        dialogue("You knew.", translation="你早就知道。"), dialogue("Why hide it?"),
    ], "body_order": ["dialogue:0", "dialogue:1"]}
    assert rebalance(scene, dialogues=1) == scene


def test_repeated_splits_keep_the_entire_performable_sequence():
    scene = {"character_actions": ["Mara opens the file. Mara finds the seal. Mara reads the name.",
                                   "Noah shuts the door. Noah pockets the key."],
             "dialogues": [dialogue("Is it real? Tell me now."), dialogue("Stay here. Don't follow.")],
             "body_order": ["action:0", "dialogue:0", "action:1", "dialogue:1"]}
    repaired = rebalance(scene, actions=5, dialogues=4)

    def sequence(value):
        items = {"action": value["character_actions"], "dialogue": [line["text"] for line in value["dialogues"]]}
        return " ".join(items[kind][int(index)] for kind, index in
                        (reference.split(":") for reference in value["body_order"]))

    assert len(repaired["character_actions"]) == 5
    assert len(repaired["dialogues"]) == 4
    assert len(set(repaired["body_order"])) == 9
    assert sequence(repaired) == sequence(scene)


def test_merge_never_truncates_text_or_intent_at_schema_limits():
    scene = {"character_actions": [], "dialogues": [dialogue("A" * 180), dialogue("B" * 180)],
             "body_order": ["dialogue:0", "dialogue:1"]}
    assert rebalance(scene, dialogues=1) == scene
    scene["dialogues"] = [{**dialogue("Stay."), "intent": "A" * 80},
                          {**dialogue("Tell me."), "intent": "B" * 80}]
    assert rebalance(scene, dialogues=1) == scene
