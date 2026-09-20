from copy import deepcopy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.script_engine.long_story_models import CharacterActingProfile, StoryBibleGenerationOutput
from app.modules.script_engine.mainland_language import (
    mainland_text_violates_language_contract,
    permanent_voice_prompt_violates_language_contract,
    story_bible_chinese_issues,
)
from app.modules.script_engine.story_bible_contracts import story_bible_non_chinese_fields


VALID_SAMPLES = [
    "拒绝｜EN: I can't promise you that.｜中译: 我不能向你保证。",
    "撒谎｜EN: I thought you'd already left.｜中译: 我以为你已经走了。",
    "示弱｜EN: Could you stay a minute?｜中译: 你能再留一会儿吗？",
]
VOICE_PATH = "character_registry.0.acting_profile.permanentVoicePrompt"


def story_bible(profile):
    return StoryBibleGenerationOutput.model_validate({
        "core_premise": "一名记者追查旧案并重新理解姐姐当年的选择。",
        "series_goal": "姐妹取得完整证据并帮助无辜者重新获得自由。",
        "theme": "信任与真相", "central_conflict": "姐姐拒绝公开过去，记者必须逐步验证线索。",
        "ending_direction": "姐妹公开证据并各自选择自由的新生活。",
        "character_refs": ["character.lena"],
        "character_registry": [{"character_ref": "character.lena", "name": "Lena", "role": "记者", "acting_profile": profile}],
        "story_lines": [{"story_line_id": "storyline.truth", "title": "旧案的真相", "story_line_type": "main",
                         "premise": "姐妹核对封存多年的案件证据。", "planned_resolution": "案件得以澄清，无辜者恢复自由。",
                         "character_refs": ["character.lena"]}],
    })


@pytest.mark.parametrize("samples", [VALID_SAMPLES[:2], VALID_SAMPLES])
def test_overseas_voice_samples_accept_two_or_three_marked_examples(samples):
    value = "表达克制，拒绝时先停顿再明确边界；样本仅示范说话方式，不是剧情事实。\n" + "\n".join(samples)
    assert not permanent_voice_prompt_violates_language_contract(value, allow_english_samples=True)
    output = story_bible({"permanentVoicePrompt": value, "voice": "低声说话，以短句表达边界。"})
    original = deepcopy(output.model_dump())
    assert story_bible_non_chinese_fields(output, market_profile="overseas_tiktok") == []
    assert output.model_dump() == original


@pytest.mark.parametrize("situation", ["拒绝", "撒谎", "示弱", "亲近者", "对手"])
def test_all_declared_voice_sample_situations_are_supported(situation):
    value = f"{situation}｜EN: Give me a minute.｜中译: 给我一点时间。"
    assert not permanent_voice_prompt_violates_language_contract(value, allow_english_samples=True)


@pytest.mark.parametrize("spacing", ["", " ", "\t", "  \t"])
def test_voice_sample_colon_spacing_is_optional(spacing):
    value = f"拒绝｜EN:{spacing}Not tonight.｜中译:{spacing}今晚不行。"
    assert not permanent_voice_prompt_violates_language_contract(value, allow_english_samples=True)
    assert story_bible_non_chinese_fields(
        story_bible({"permanentVoicePrompt": value}), market_profile="overseas_tiktok",
    ) == []


@pytest.mark.parametrize("value", [
    "I can't promise you that.",
    "表达克制，不主动解释原因。\nI can't promise you that.",
    "拒绝｜English: I can't promise you that.｜中译: 我不能保证。",
    "拒绝｜en: I can't promise you that.｜中译: 我不能保证。",
    "拒绝｜EN：I can't promise you that.｜中译: 我不能保证。",
    "拒绝|EN: I can't promise you that.|中译: 我不能保证。",
    "拒绝｜EN: I can't promise you that.｜CN: 我不能保证。",
    "愤怒｜EN: I can't promise you that.｜中译: 我不能保证。",
    "拒绝｜EN: I can't promise you that.｜中译: I cannot promise that.",
    "拒绝｜EN: No.｜中译: NO",
    "拒绝｜EN: I can't答应。｜中译: 我不能保证。",
    "拒绝｜EN: 我不能保证。｜中译: 我不能保证。",
    "拒绝｜EN: ...123!｜中译: 我不能保证。",
    "拒绝｜EN: I can't promise you that.｜中译: ",
    "拒绝｜EN: I can't promise you that.\n｜中译: 我不能保证。",
    "\n".join([*VALID_SAMPLES, "对手｜EN: Try asking nicely.｜中译: 试着好好说话。"]),
])
def test_overseas_voice_sample_contract_rejects_malformed_or_non_bilingual_lines(value):
    assert permanent_voice_prompt_violates_language_contract(value, allow_english_samples=True)
    assert VOICE_PATH in story_bible_non_chinese_fields(
        story_bible({"permanentVoicePrompt": value}), market_profile="overseas_tiktok",
    )


def test_chinese_description_and_translation_keep_registered_name_exceptions():
    value = "Lena看向Noah，先停顿再回答。\n亲近者｜EN: Noah, stay.｜中译: Noah，留下。"
    assert not permanent_voice_prompt_violates_language_contract(
        value, allowed_names=iter(("Lena", "Noah")), allow_english_samples=True,
    )
    assert permanent_voice_prompt_violates_language_contract(value, allow_english_samples=True)
    assert permanent_voice_prompt_violates_language_contract(
        value + "\nLena speaks quietly and avoids questions.", allowed_names=("Lena", "Noah"),
        allow_english_samples=True,
    )


def test_sample_english_is_validated_before_identity_name_removal():
    # A terse name-only utterance still contains English before the name
    # exception is applied to Chinese descriptions and translations.
    value = "拒绝｜EN: Lena?｜中译: Lena，你认真的吗？"
    assert story_bible_non_chinese_fields(
        story_bible({"permanentVoicePrompt": value}), market_profile="overseas_tiktok",
    ) == []


def test_mainland_and_default_checks_do_not_enable_english_examples():
    value = "\n".join(VALID_SAMPLES)
    assert permanent_voice_prompt_violates_language_contract(value)
    output = story_bible({"permanentVoicePrompt": value})
    assert VOICE_PATH in story_bible_chinese_issues(output, allowed_names=("Lena",))
    assert VOICE_PATH in story_bible_non_chinese_fields(output, market_profile="cn_mainland")
    assert VOICE_PATH not in story_bible_chinese_issues(output, allowed_names=("Lena",), allow_voice_samples=True)


@pytest.mark.parametrize("field", [
    "bodyLanguage", "voice", "movement", "gazeAndAttention", "habitualActions", "pressureResponse", "relationshipBehavior",
])
def test_overseas_voice_exception_cannot_escape_permanent_voice_prompt(field):
    output = story_bible({"permanentVoicePrompt": VALID_SAMPLES[0], field: VALID_SAMPLES[1]})
    assert story_bible_non_chinese_fields(output, market_profile="overseas_tiktok") == [
        f"character_registry.0.acting_profile.{field}",
    ]


@pytest.mark.parametrize("value", [None, "", "表达克制，先停顿再明确边界。", "保留DNA等必要缩写。"])
def test_existing_chinese_voice_descriptions_keep_their_language_contract(value):
    expected = mainland_text_violates_language_contract(value)
    assert permanent_voice_prompt_violates_language_contract(value) is expected
    assert permanent_voice_prompt_violates_language_contract(value, allow_english_samples=True) is expected


def test_voice_samples_keep_existing_six_hundred_character_model_limit():
    with pytest.raises(ValidationError):
        CharacterActingProfile(permanentVoicePrompt="中" * 601)


@pytest.mark.parametrize("case", json.loads(
    (Path(__file__).parent / "fixtures/overseas_voice_samples.json").read_text(encoding="utf-8")
), ids=lambda case: case["label"])
def test_frontend_backend_share_voice_sample_contract(case):
    assert (not permanent_voice_prompt_violates_language_contract(
        case["value"], allowed_names=case.get("allowedNames", []), allow_english_samples=True,
    )) is case["valid"]


@pytest.mark.parametrize("field", ["core_premise", "central_conflict", "ending_direction"])
def test_allowed_voice_quotation_does_not_exempt_english_planning_narrative(field):
    output = story_bible({"permanentVoicePrompt": VALID_SAMPLES[0]})
    output = output.model_copy(update={field: "The two sisters discover proof and decide to expose it."})
    assert story_bible_non_chinese_fields(output, market_profile="overseas_tiktok") == [field]
