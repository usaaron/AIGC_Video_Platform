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
