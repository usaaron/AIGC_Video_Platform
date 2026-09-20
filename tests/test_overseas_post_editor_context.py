from __future__ import annotations

from copy import deepcopy
import json

import pytest

from app.modules.content_spec.overseas_story_profile import (
    normalize_overseas_story_profile,
    overseas_story_profile_contract,
)
from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from app.modules.script_engine.script_post_editor import ScriptPostEditor
from test_script_post_editor import (
    DialoguePairRepairAdapter,
    HeadingPatchAdapter,
    StickyOverseasFieldRepairAdapter,
    _draft,
    _heading_only_draft,
    _strategy,
)


def profile(country="英国", region="伦敦"):
    return {
        "schema_version": "overseas_story_profile.v1",
        "country": country,
        "region": region,
        "social_context": "家族经营的剧院面临继承与经营权冲突。",
        "story_engine": "人物在经营权与互信之间持续作出有代价的选择。",
    }


def voice_draft():
    payload = _draft().model_dump(mode="json")
    for character in payload["characters"]:
        character["acting_profile"] = {
            "voice": f"{character['name']}声音克制，回答前有短暂停顿。",
            "permanentVoicePrompt": "拒绝｜EN: Not tonight.｜中译: 今晚不行。",
            "pressureResponse": "不会向编辑模型暴露的其他表演字段",
        }
    payload["characters"].append({
        **payload["characters"][0], "name": "Absent",
        "acting_profile": {"voice": "不会暴露的未出场人物声音"},
    })
    payload["scenes"][0]["dialogues"][0]["character_name"] = "Damian (V.O.)"
    payload["scenes"][1]["dialogues"][0]["character_name"] = "Elena"
    return DraftMasterScript.model_validate(payload)


def editor_prompt(source, *, overseas=True, story_profile=None, **kwargs):
    scene_count, dialogue_count, shot_count = ScriptPostEditor._production_counts(source)
    return ScriptPostEditor._build_prompt(
        draft=source,
        current_duration=estimate_screenplay_duration(source),
        target_duration=90,
        source_scene_count=scene_count,
        source_dialogue_count=dialogue_count,
        source_shot_count=shot_count,
        overseas_release=overseas,
        canonical_character_names={},
        correction_issues=[],
        previous_patch=None,
        editable_scene_numbers=[1],
        overseas_story_profile=story_profile,
        **kwargs,
    )


def editable_context(prompt):
    return json.loads(prompt.split("不要恢复第一轮措辞：\n", 1)[1])


def repair_voice_reference(prompt):
    context = prompt.split("只读声音参考：\n", 1)[1].split("\n\n待修字段：", 1)[0]
    return json.loads(context)["character_voice_reference"]


@pytest.mark.parametrize("story_profile", [profile(), profile("美国", "纽约"), profile("", "")])
def test_editor_uses_explicit_setting_without_an_american_default_or_planning_authority(story_profile):
    prompt = editor_prompt(_draft(), story_profile=story_profile)
    assert overseas_story_profile_contract(story_profile, planning=False) in prompt
    assert json.dumps(story_profile, ensure_ascii=False, separators=(",", ":")) in prompt
    assert "未指定背景时保留已有用法，不默认美国" in prompt
    assert "American English" not in prompt
    assert "美式英语" not in prompt
    assert "符合美国短剧" not in prompt
    assert "【持续冲突与阶段兑现" not in prompt
    assert "只优化语言表达，不得改变剧情内容" in prompt


@pytest.mark.parametrize("story_profile", [None, {}, {"country": "英国"}, {**profile(), "schema_version": "v2"}])
def test_absent_or_invalid_profile_preserves_legacy_editor_language(story_profile):
    source = _draft()
    prompt = editor_prompt(source, story_profile=story_profile)
    assert prompt == editor_prompt(source)
    assert "符合美国短剧的口语、节奏、打断、反击和潜台词习惯。" in prompt
    assert "不默认美国" not in prompt
    assert "【作者设定的海外背景】" not in prompt
    assert "character_voice_reference" not in prompt


@pytest.mark.parametrize("story_profile", [None, profile("", "")])
@pytest.mark.parametrize("acting_profile", [None, {}, {"voice": " \t", "permanentVoicePrompt": "", "pressureResponse": "握紧扶手"}])
def test_missing_or_blank_voice_fields_do_not_add_empty_editor_or_repair_context(story_profile, acting_profile):
    source = _draft()
    for character in source.characters:
        character.acting_profile = acting_profile
    prompt = editor_prompt(source, story_profile=story_profile)
    assert "character_voice_reference" not in prompt
    assert "只读声音参考" not in prompt
    adapter = DialoguePairRepairAdapter()
    ScriptPostEditor(llm_adapter=adapter).ensure_overseas_dialogue_pairs(
        source, strategy=_strategy(), overseas_story_profile=story_profile,
    )
    assert "character_voice_reference" not in adapter.prompts[0]
    assert "只读声音参考" not in adapter.prompts[0]


def test_mainland_editor_excludes_overseas_profile_and_voice_examples():
    prompt = editor_prompt(voice_draft(), overseas=False, story_profile=profile())
    assert "伦敦" not in prompt
    assert "overseas_story_profile.v1" not in prompt
    assert "character_voice_reference" not in prompt
    assert "Not tonight." not in prompt
    assert "人物名和人物对白直接使用简体中文" in prompt


def test_editor_projects_original_voice_only_for_editable_speakers_without_mutating_source():
    original = voice_draft()
    original.characters[1].acting_profile["voice"] = "声" * 650
    original.characters[1].acting_profile["permanentVoicePrompt"] = "词" * 650
    snapshot = deepcopy(original.model_dump())
    working = original.model_copy(deep=True)
    working.characters[1].acting_profile["voice"] = "不得使用中间稿改写的声音"
    prompt = editor_prompt(working, approved_speaker_source=original, story_profile=profile())
    context = editable_context(prompt)
    assert context["character_voice_reference"] == [{
        "character_name": "Damian", "voice": "声" * 600, "permanentVoicePrompt": "词" * 600,
    }]
    assert [scene["scene_number"] for scene in context["scenes"]] == [1]
    assert "不会向编辑模型暴露" not in prompt
    assert "不会暴露的未出场人物声音" not in prompt
    assert "不得使用中间稿改写的声音" not in prompt
    assert "声音样本不是已发生的故事事实，不得直接复制到本集对白" in prompt
    assert "每场只返回scene_number、character_actions、body_order、dialogues" in prompt
    assert original.model_dump() == snapshot


@pytest.mark.parametrize("story_profile", [profile(), profile("美国", "纽约"), profile("", ""), None, {"country": "英国"}])
def test_standalone_dialogue_repair_receives_setting_and_only_affected_scene_voices(story_profile):
    source = voice_draft()
    source.scenes[1].dialogues[0].chinese_translation = "问问你母亲为什么先出卖你。"
    source.scenes[1].dialogue_prompts = [source.scenes[1].dialogues[0].text]
    snapshot = deepcopy(source.model_dump())
    adapter = DialoguePairRepairAdapter()
    repaired, attempts = ScriptPostEditor(llm_adapter=adapter).ensure_overseas_dialogue_pairs(
        source, strategy=_strategy(), overseas_story_profile=story_profile,
    )
    assert attempts == 1
    prompt = adapter.prompts[0]
    has_profile = normalize_overseas_story_profile(story_profile) is not None
    if has_profile:
        assert overseas_story_profile_contract(story_profile, planning=False) in prompt
    else:
        assert "【作者设定的海外背景】" not in prompt
    assert [row["character_name"] for row in repair_voice_reference(prompt)] == ["Damian"]
    assert "不会向编辑模型暴露" not in prompt
    assert "不会暴露的未出场人物声音" not in prompt
    assert "不是已发生的故事事实，不得直接复制到本集对白" in prompt
    fields = json.loads(prompt.split("待修字段：\n", 1)[1])
    assert [item["path"] for item in fields] == ["scenes.0.dialogues.0.chinese_translation"]
    assert ("美式英语" in prompt) is not has_profile
    assert "American English" not in prompt
    assert source.model_dump() == snapshot
    assert repaired.scenes[0].dialogues[0].text == source.scenes[0].dialogues[0].text
    assert repaired.characters == source.characters
    assert repaired.scenes[1] == source.scenes[1]
    assert ScriptPostEditor.overseas_dialogue_pair_issues(repaired) == []


@pytest.mark.parametrize("story_profile", [profile(), profile("", ""), None, {**profile(), "schema_version": "v2"}])
def test_editor_and_both_internal_repair_attempts_keep_the_same_author_setting(story_profile):
    source = voice_draft()
    source.scenes[0].dialogues[0].text = "..."
    source.scenes[0].dialogue_prompts = ["..."]
    snapshot = deepcopy(source.model_dump())
    profile_snapshot = deepcopy(story_profile)
    adapter = StickyOverseasFieldRepairAdapter()
    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source, strategy=_strategy(), target_duration_seconds=90,
        overseas_release=True, overseas_story_profile=story_profile,
    )
    assert adapter.call_count == 3
    contract = overseas_story_profile_contract(story_profile, planning=False)
    has_profile = normalize_overseas_story_profile(story_profile) is not None
    if has_profile:
        assert all(contract in prompt for prompt in adapter.prompts)
    else:
        assert all("【作者设定的海外背景】" not in prompt for prompt in adapter.prompts)
        assert "符合美国短剧的口语、节奏、打断、反击和潜台词习惯。" in adapter.prompts[0]
    assert "最后一次窄修复" in adapter.prompts[2]
    for prompt in adapter.prompts[1:]:
        voices = repair_voice_reference(prompt)
        assert {row["character_name"] for row in voices} == {"Elena", "Damian"}
        assert all(set(row) == {"character_name", "voice", "permanentVoicePrompt"} for row in voices)
        assert ("美式英语" in prompt) is not has_profile
        fields = json.loads(prompt.split("待修字段：\n", 1)[1])
        english_language = fields[0]["required_language"]
        assert ("American English" in english_language) is not has_profile
    if not has_profile:
        assert "符合原意的简短美式英语台词。" in adapter.prompts[2]
        assert "不默认美国" not in adapter.prompts[2]
    assert result.draft.scenes[0].dialogues[0].text == "Wait. I need a second."
    assert result.draft.characters == source.characters
    assert source.model_dump() == snapshot
    assert story_profile == profile_snapshot


def test_heading_only_shortcut_receives_setting_and_preserves_the_body():
    source = _heading_only_draft()
    adapter = HeadingPatchAdapter()
    story_profile = profile()
    result = ScriptPostEditor(llm_adapter=adapter).edit(
        source, strategy=_strategy(), target_duration_seconds=90, overseas_release=True,
        require_overseas_narrative_language=True, overseas_story_profile=story_profile,
    )
    assert adapter.call_count == 1
    assert overseas_story_profile_contract(story_profile, planning=False) in adapter.prompts[0]
    expected = source.model_dump(exclude={"llm_metadata"})
    expected["scenes"][0]["slug"] = "内景. 宴会厅 - 夜晚"
    expected["scenes"][1]["slug"] = "内景. 宴会厅走廊 - 连续"
    assert result.draft.model_dump(exclude={"llm_metadata"}) == expected
