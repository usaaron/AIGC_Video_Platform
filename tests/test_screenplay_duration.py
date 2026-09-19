from types import SimpleNamespace

from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration


def _script(*, action: str, dialogue: str):
    return SimpleNamespace(
        scenes=[
            SimpleNamespace(
                character_actions=[action],
                dialogues=[SimpleNamespace(text=dialogue)],
            )
        ]
    )


def test_duration_estimate_flags_a_visibly_short_episode() -> None:
    estimate = estimate_screenplay_duration(
        _script(action="林夏推开门。", dialogue="谁在里面？")
    )

    assert estimate.total_seconds < 60


def test_duration_estimate_accepts_a_sixty_to_ninety_second_episode() -> None:
    estimate = estimate_screenplay_duration(
        _script(
            action="林夏推开铁门，绕过倒下的货架，把录音机放到桌上。" * 20,
            dialogue="你说这件事和我无关，可你从来不敢看着我说。" * 18,
        )
    )

    assert 60 <= estimate.total_seconds <= 90


def test_duration_estimate_flags_an_overlong_episode() -> None:
    estimate = estimate_screenplay_duration(
        _script(action="林夏沿着走廊奔跑。" * 100, dialogue="你必须告诉我真相。" * 80)
    )

    assert estimate.total_seconds > 90


def test_runtime_prompt_budget_uses_same_estimator_and_preserves_dialogue_contract() -> None:
    from app.modules.script_engine.screenplay_duration import screenplay_runtime_prompt_guidance

    guidance = screenplay_runtime_prompt_guidance(
        target_duration_seconds=95, scene_count=3, chinese_dialogue=True,
    )
    # 380 spoken Chinese characters fit 95 seconds under the actual estimator.
    script = SimpleNamespace(scenes=[
        SimpleNamespace(character_actions=[], dialogues=[SimpleNamespace(text="字" * count)])
        for count in (127, 127, 126)
    ])
    assert estimate_screenplay_duration(script).total_seconds == 95
    assert "目标95秒，对白总量参考约380汉字" in guidance
    assert "至多约464汉字" in guidance
    assert "静默场" in guidance and "不能默认全部与对白并行" in guidance
    assert "不能删减必要信息、合并或减少对白轮次" in guidance
    assert "正文总字数包括动作，不是对白配额" in guidance


def test_runtime_prompt_uses_spoken_english_words_without_changing_rate() -> None:
    from app.modules.script_engine.screenplay_duration import screenplay_runtime_prompt_guidance

    guidance = screenplay_runtime_prompt_guidance(
        target_duration_seconds=95, scene_count=3, chinese_dialogue=False,
    )
    assert "自然英文单词总数÷2.7" in guidance
    assert "目标95秒，对白总量参考约244自然英文单词" in guidance
    assert "至多约298自然英文单词" in guidance
