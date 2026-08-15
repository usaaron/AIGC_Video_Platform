from types import SimpleNamespace

from app.modules.script_engine.mainland_language import (
    mainland_text_violates_language_contract,
)
from app.modules.script_engine.mainland_screenplay import draft_screenplay_style_issues


def _script_with_actions(*actions: str) -> SimpleNamespace:
    return SimpleNamespace(
        scenes=[SimpleNamespace(character_actions=list(actions))]
    )


def test_screenplay_style_accepts_concise_observable_action() -> None:
    script = _script_with_actions(
        "林夏推开仓库铁门，手电光扫过地面的湿脚印。",
        "门外刹车声骤停，她立刻关掉手电，贴到货架后。",
    )

    assert draft_screenplay_style_issues(script) == []


def test_screenplay_style_rejects_private_thought_and_literary_inference() -> None:
    script = _script_with_actions(
        "林夏意识到凶手一直在利用她，心里忽然感到绝望。",
        "走廊尽头的黑影仿佛命运一样等待着她。",
    )

    issues = draft_screenplay_style_issues(script)

    assert "scenes.0.character_actions.0:private_thought" in issues
    assert "scenes.0.character_actions.1:literary_inference" in issues


def test_screenplay_style_rejects_action_array_narrative_paragraph() -> None:
    script = _script_with_actions("林夏沿着走廊往前走。" * 30)

    assert draft_screenplay_style_issues(script) == [
        "scenes.0.character_actions.0:narrative_paragraph"
    ]


def test_screenplay_style_rejects_explicit_camera_direction() -> None:
    script = _script_with_actions(
        "特写镜头：桌上摆着一把刀。",
        "镜头推进，林夏抓起刀退到门后。",
    )

    assert draft_screenplay_style_issues(script) == [
        "scenes.0.character_actions.0:camera_direction",
        "scenes.0.character_actions.1:camera_direction",
    ]


def test_mainland_language_accepts_common_abbreviations_inside_chinese() -> None:
    assert mainland_text_violates_language_contract(
        "林夏拿起DNA报告，转身冲向ICU病房。"
    ) is False
    assert mainland_text_violates_language_contract(
        "VIP通道的3号门已经反锁。"
    ) is False


def test_mainland_language_still_rejects_english_dominant_narrative() -> None:
    assert mainland_text_violates_language_contract("She opens the locked door.") is True
    assert mainland_text_violates_language_contract("Rain追凶") is True
