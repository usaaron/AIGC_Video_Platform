from copy import deepcopy

import pytest

from app.modules.script_engine.overseas_identity import (
    english_language_name_exceptions,
    normalize_new_overseas_payload,
    replace_identity_aliases,
    without_known_english_names,
)
from app.modules.script_engine.mainland_language import mainland_text_violates_language_contract


def test_new_overseas_candidate_uses_declared_names_without_mutating_history() -> None:
    original = {
        "characters": [{"name": "莉娜", "role": "主唱", "description": "莉娜与诺亚一同排练"}],
        "character_state_updates": [{"character_name": "莉娜", "current_goal": "莉娜等诺亚回答"}],
        "scenes": [{"character_refs": ["character.lena", "莉娜"], "character_actions": ["莉娜关门，诺亚放下吉他。"], "dialogues": [{
            "character_name": "Lena (V.O.)", "chinese_character_name": "莉娜",
            "text": "Noah, listen.", "chinese_translation": "诺亚，听一下。", "intent": "看向诺亚",
        }]}],
        "llm_metadata": {"original_quote": "莉娜"},
    }
    snapshot = deepcopy(original)
    candidate = normalize_new_overseas_payload(original, {"莉娜": "Lena", "诺亚": "Noah"})
    assert original == snapshot
    assert candidate["characters"][0]["name"] == "Lena"
    assert candidate["character_state_updates"][0]["character_name"] == "Lena"
    assert candidate["scenes"][0]["character_refs"] == ["character.lena", "Lena"]
    line = candidate["scenes"][0]["dialogues"][0]
    assert line["character_name"] == "Lena (V.O.)"
    assert line["chinese_character_name"] is None
    assert line["chinese_translation"] == "Noah，听一下。"
    assert candidate["scenes"][0]["character_actions"] == ["Lena关门，Noah放下吉他。"]
    assert candidate["llm_metadata"] == original["llm_metadata"]


def test_single_character_alias_does_not_rewrite_words_or_merge_same_role_people() -> None:
    aliases = {"梅": "May", "乔": "Jo"}
    assert replace_identity_aliases("梅", aliases, exact=True) == "May"
    assert replace_identity_aliases("梅（May）", aliases) == "May"
    assert replace_identity_aliases("梅花落在乔木下。", aliases) == "梅花落在乔木下。"
    source = {"characters": [{"name": "Lena", "role": "主角"}, {"name": "June", "role": "主角"}]}
    assert normalize_new_overseas_payload(source, {"莉娜": "Lena"}) == source


def test_chinese_language_gate_exempts_only_known_english_names() -> None:
    text = "Lena看向Noah。"
    assert mainland_text_violates_language_contract(text)
    assert not mainland_text_violates_language_contract(text, allowed_names=("Lena", "Noah"))
    assert mainland_text_violates_language_contract("Lena silently closes the door.", allowed_names=("Lena",))
    assert without_known_english_names("Ann看向Joanne。", ("Ann",)) == "看向Joanne。"


@pytest.mark.parametrize(("text", "names", "invalid"), [
    ("Lane守城，Lane等待Eira。", ("Lane Claude", "Eira"), False),
    ("Lane Claude守城。", ("Lane Claude",), False),
    ("Lane守城。", (), True),  # Mainland: no overseas identity permission.
    ("Lance守城。", ("Lane Claude",), True),
    ("Lanette守城。", ("Lane Claude",), True),
    ("Claude守城。", ("Lane Claude",), True),  # Never infer a surname alias.
    ("Lane Smith守城。", ("Lane Claude",), True),
    ("Lane守城。", ("Lane Claude", "Lane Smith"), True),
    ("Lane quietly opens the city gate.", ("Lane Claude",), True),
    ("Lane will wait. May will leave.", ("Lane Claude", "May Smith", "Will Turner"), True),
    ("Marquis守城。", ("Marquis Claude",), True),
    ("Abyss守城。", ("Abyss Lord",), True),
    ("Alex拿起钥匙。", ("Alexander Stone",), True),  # No invented nickname.
])
def test_language_gate_limits_given_name_shorthand_to_registered_identities(text, names, invalid):
    assert mainland_text_violates_language_contract(text, allowed_names=names) is invalid


def test_language_name_exceptions_do_not_rewrite_names_or_expand_shared_surnames():
    registered = ["Lane Claude", "Marquis Claude", "Abyss Lord", "Anne-Marie O'Neil"]
    assert english_language_name_exceptions(iter(registered)) == (
        *registered, "Lane", "Anne-Marie",
    )
    assert registered == ["Lane Claude", "Marquis Claude", "Abyss Lord", "Anne-Marie O'Neil"]
    # Ordinary alias normalization retains its old exact-name behavior.
    assert without_known_english_names("Lane守城。", registered) == "Lane守城。"


def test_common_english_name_does_not_capitalize_unrelated_dialogue_words() -> None:
    source = {"characters": [{"name": "WILL"}], "scenes": [{"dialogues": [{
        "character_name": "WILL", "chinese_character_name": None,
        "text": "I will wait until May.", "intent": "认真回答", "chinese_translation": "我会等到五月。",
    }]}]}
    candidate = normalize_new_overseas_payload(source, {"威尔": "Will"})
    assert candidate["characters"][0]["name"] == "Will"
    assert candidate["scenes"][0]["dialogues"][0]["character_name"] == "Will"
    assert candidate["scenes"][0]["dialogues"][0]["text"] == "I will wait until May."


def test_explicit_bilingual_aliases_ignore_unknown_roles_and_conflicting_names() -> None:
    from app.modules.script_engine.overseas_identity import explicit_bilingual_aliases
    aliases = explicit_bilingual_aliases([
        "莉娜（Lena）主唱；诺亚（Noah）吉他手；陌生人（Morgan）经纪人。\nMay（梅）：配角。\n风格（Natural）：自然。",
        "诺亚（Neil）是另一份未协调的姓名声明。",
    ], ["莉娜", "诺亚", "梅"])
    assert aliases == {"莉娜": "Lena", "梅": "May"}


def test_explicit_aliases_read_each_declared_source_for_every_registered_identity() -> None:
    from app.modules.script_engine.overseas_identity import explicit_bilingual_aliases
    assert explicit_bilingual_aliases(iter(["莉娜（Lena）；琼（June）"]), ["莉娜", "琼"]) == {"莉娜": "Lena", "琼": "June"}


def test_planning_projection_preserves_model_types_references_and_historical_documents() -> None:
    from enum import Enum
    from pydantic import BaseModel
    from app.modules.script_engine.overseas_identity import planning_identity_projection

    class Status(str, Enum):
        approved = "approved"

    class Person(BaseModel):
        character_ref: str
        name: str

    class Plan(BaseModel):
        node_id: str
        parent_node_id: str
        parent_node_version: int
        version: int
        status: Status
        character_registry: list[Person]
        character_refs: list[str]
        exit_state: str
        imported_source_document: str
        creative_decisions: list[dict]

    source = Plan(
        node_id="node.lena", parent_node_id="node.root", parent_node_version=1,
        version=2, status=Status.approved,
        character_registry=[Person(character_ref="character.lena", name="莉娜"), Person(character_ref="character.june", name="琼")],
        character_refs=["character.lena", "character.june"],
        exit_state="莉娜明天搬家，诺亚仍留在原地；梅花落在乔木下。",
        imported_source_document="作者原文：莉娜（Lena）", creative_decisions=[{"value": "莉娜（Lena）"}],
    )
    snapshot = source.model_dump(mode="json")
    projected = planning_identity_projection(source, {"莉娜": "Lena", "诺亚": "Noah", "琼": "June", "梅": "May", "乔": "Jo"})
    assert type(projected) is Plan and type(projected.character_registry[0]) is Person
    assert projected.status is Status.approved and projected.status.value == "approved"
    assert projected.model_dump(mode="json")["status"] == snapshot["status"]
    assert [item.name for item in projected.character_registry] == ["Lena", "June"]
    assert projected.exit_state == "Lena明天搬家，Noah仍留在原地；梅花落在乔木下。"
    for field in ("node_id", "parent_node_id", "parent_node_version", "version", "character_refs", "creative_decisions", "imported_source_document"):
        assert getattr(projected, field) == getattr(source, field)
    assert source.model_dump(mode="json") == snapshot
    assert planning_identity_projection("Morgan silently leaves.", {"莉娜": "Lena"}) == "Morgan silently leaves."
