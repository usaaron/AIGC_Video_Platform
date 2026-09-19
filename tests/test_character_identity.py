import pytest
from pydantic import ValidationError

from app.modules.content_spec.models import CharacterContext
from app.modules.master_script.models import (
    CharacterProfile,
    CharacterStateUpdate,
    DialogueLine,
    RelationshipStateUpdate,
)
from app.modules.script_engine.long_story_models import (
    StoryBibleCharacterInput,
    StoryBibleCharacterRegistryEntry,
)


@pytest.mark.parametrize("name", ["梅", "乔", "Jo", "诺拉", "Nora Ellis"])
def test_character_identity_survives_input_planning_screenplay_and_memory(name):
    context = CharacterContext(character_ref="character.cafe", name=name, role="店员")
    planning_input = StoryBibleCharacterInput.model_validate(
        context.model_dump(include={"character_ref", "name", "role"})
    )
    registry = StoryBibleCharacterRegistryEntry.model_validate(
        planning_input.model_dump(include={"character_ref", "name", "role"})
    )
    profile = CharacterProfile(
        name=registry.name, role="店员", description="咖啡馆的资深店员，待人直率。",
        motivation="想让今天的订单准时完成。",
    )
    dialogue = DialogueLine(character_name=profile.name, intent="催促开工", text="先把咖啡端过去。")
    state = CharacterStateUpdate(
        character_name=dialogue.character_name, current_goal="完成预订订单", emotional_state="开始着急",
        change_summary="转而主动催促同事。", change_cause="同事争执影响了出餐。", evidence_scene_numbers=[1],
    )
    relationship = RelationshipStateUpdate(
        source_character_name=state.character_name, target_character_name="老板",
        relationship_type="同事关系", source_to_target="希望对方尽快开工。", target_to_source="接受对方的催促。",
        current_state="双方开始协调出餐。", change_summary="建立临时分工。",
        change_cause="订单需要协作完成。", evidence_scene_numbers=[1],
    )
    assert [context.name, planning_input.name, registry.name, profile.name, dialogue.character_name,
            state.character_name, relationship.source_character_name] == [name] * 7


@pytest.mark.parametrize("name", ["", " ", "\t\n", "\u3000", "长" * 81])
def test_empty_or_overlong_character_identity_is_still_rejected(name):
    with pytest.raises(ValidationError):
        StoryBibleCharacterRegistryEntry(character_ref="character.cafe", name=name)
    with pytest.raises(ValidationError):
        DialogueLine(character_name=name, intent="催促开工", text="先把咖啡端过去。")


def test_whitespace_does_not_create_a_second_character_identity():
    character = StoryBibleCharacterInput(character_ref="character.cafe", name="  梅  ")
    assert character.name == "梅"
    with pytest.raises(ValidationError, match="two different characters"):
        RelationshipStateUpdate(
            source_character_name="梅", target_character_name=" 梅 ", relationship_type="同事关系",
            source_to_target="希望对方尽快开工。", target_to_source="接受对方的催促。",
            current_state="双方开始协调出餐。", change_summary="建立临时分工。",
            change_cause="订单需要协作完成。", evidence_scene_numbers=[1],
        )
