"""Evidence-based repetition checks shared by planning and screenplay execution.

This detects substantial copied narrative contracts, not semantic story quality.
An ongoing goal, a recurring hook or an unchanged location alone is insufficient.
"""

from collections.abc import Iterable, Mapping
from difflib import SequenceMatcher
import re


def _field(plan: object, name: str) -> object:
    return plan.get(name) if isinstance(plan, Mapping) else getattr(plan, name, None)


def _text(plan: object, name: str) -> str:
    return re.sub(r"\W+", "", str(_field(plan, name) or "").casefold())


def episode_repetition_sources(item: object, previous: Iterable[object]) -> list[int]:
    number = _field(item, "episode_number")
    synopsis = _text(item, "synopsis")
    decision = _text(item, "protagonist_decision")
    outcome = _text(item, "exit_state")
    duplicates: set[int] = set()
    for prior in previous:
        prior_number = _field(prior, "episode_number")
        if not isinstance(prior_number, int) or not isinstance(number, int) or prior_number >= number:
            continue
        prior_synopsis = _text(prior, "synopsis")
        same_synopsis = (
            len(synopsis) >= 80 and len(prior_synopsis) >= 80
            and SequenceMatcher(None, synopsis, prior_synopsis, autojunk=False).ratio() >= 0.82
        )
        same_choice_and_result = (
            len(decision) >= 24 and len(outcome) >= 40
            and decision == _text(prior, "protagonist_decision")
            and outcome == _text(prior, "exit_state")
        )
        if same_synopsis or same_choice_and_result:
            duplicates.add(prior_number)
    return sorted(duplicates)


def repetition_message(episode: int, sources: list[int]) -> str:
    return (
        f"第{episode}集规划与第{'、'.join(map(str, sources))}集重复整段剧情或人物选择及结果。"
        "请先回到分集规划修订本集的具体行动与后果，并同步场景蓝图；"
        "原规划及已保存正文已保留。"
    )
