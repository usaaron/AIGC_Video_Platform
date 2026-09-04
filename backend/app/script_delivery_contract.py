from __future__ import annotations

import re
import unicodedata
from enum import Enum
from typing import Any


_ENDING_MODE_ALIASES: dict[str, str] = {
    # Continuing/serial episodes.
    "serial": "serial_hook",
    "serialhook": "serial_hook",
    "continuing": "serial_hook",
    "continuingepisode": "serial_hook",
    "ongoing": "serial_hook",
    "regular": "serial_hook",
    "regularepisode": "serial_hook",
    "连载": "serial_hook",
    "连载集": "serial_hook",
    "连载钩子": "serial_hook",
    "普通集": "serial_hook",
    "常规集": "serial_hook",
    "非最终集": "serial_hook",
    "非终局集": "serial_hook",
    # Season finales.
    "seasonfinale": "season_finale",
    "seasonfinal": "season_finale",
    "seasonfinaleclosing": "season_finale",
    "seasonfinaleend": "season_finale",
    "seasonend": "season_finale",
    "seasonending": "season_finale",
    "seasonclosing": "season_finale",
    "季终": "season_finale",
    "季终集": "season_finale",
    "季终收束": "season_finale",
    "本季终": "season_finale",
    "本季收束": "season_finale",
    "季末": "season_finale",
    "季末集": "season_finale",
    # Series finales.
    "seriesfinale": "series_finale",
    "seriesfinal": "series_finale",
    "seriesfinaleclosing": "series_finale",
    "seriesfinaleend": "series_finale",
    "seriesend": "series_finale",
    "seriesending": "series_finale",
    "seriesclosing": "series_finale",
    "剧终": "series_finale",
    "剧终集": "series_finale",
    "全剧终": "series_finale",
    "全剧收束": "series_finale",
    "全剧最终集": "series_finale",
    "大结局": "series_finale",
    "全剧大结局": "series_finale",
    "最终集": "series_finale",
    "完结篇": "series_finale",
    "收官": "series_finale",
}


def _ending_mode_token(value: str) -> str:
    """Normalize presentation-only spelling around a closing-mode label."""

    token = unicodedata.normalize("NFKC", value).strip().casefold()
    # Providers sometimes append a bilingual explanation in parentheses. It
    # is metadata, not part of the mode; remove it before alias lookup.
    token = re.sub(r"[\[(\u3010\uff08].*?[\])\u3011\uff09]", "", token)
    return re.sub(r"[\s_\-—–/\\|:：，,。;；]+", "", token)


class EndingMode(str, Enum):
    """How an episode is allowed to close.

    ``serial_hook`` is the legacy/default behaviour.  The two finale modes are
    deliberately additive so old payloads keep the existing cliffhanger
    contract while a series can opt into an honest resolution.
    """

    serial_hook = "serial_hook"
    season_finale = "season_finale"
    series_finale = "series_finale"

    @classmethod
    def _missing_(cls, value: object) -> "EndingMode | None":
        """Accept common bilingual labels emitted by unconstrained LLMs.

        The persisted/API representation remains one of the three canonical
        enum values. Unknown prose still returns ``None`` so callers retain
        the legacy serial-hook fallback instead of guessing a finale.
        """

        if not isinstance(value, str):
            return None
        alias = _ENDING_MODE_ALIASES.get(_ending_mode_token(value))
        return cls(alias) if alias is not None else None


DEFAULT_ENDING_MODE = EndingMode.serial_hook


def ending_mode_requires_hook(mode: EndingMode | str | None) -> bool:
    """Return whether the final scene must carry a serial continuation hook.

    Missing/unknown values intentionally preserve the legacy contract.  This
    helper is shared by validation and prompt/export layers so they cannot
    silently disagree about finale behaviour.
    """

    try:
        normalized = EndingMode(mode or DEFAULT_ENDING_MODE)
    except (TypeError, ValueError):
        normalized = DEFAULT_ENDING_MODE
    return normalized == EndingMode.serial_hook


def ending_mode_requires_next_question(mode: EndingMode | str | None) -> bool:
    """Return whether ``next_episode_question`` is required for this ending."""

    return ending_mode_requires_hook(mode)


def normalize_finale_legacy_fields(
    value: Any,
    *,
    require_legacy_obligation: bool = False,
    include_legacy_hook_type: bool = True,
) -> Any:
    """Keep legacy roadmap fields usable when a finale omits hook prose.

    The first versions of the roadmap contract made ``cliffhanger`` mandatory
    even for a closing episode.  A model is now allowed to omit that obsolete
    field, but downstream v1 consumers still expect a string slot.  Populate
    it from the approved resolution/exit evidence before Pydantic validates
    the old shape.  This is a transport compatibility shim, not a new story
    decision: the three-layer contract still checks the real resolution fields.
    """

    if not isinstance(value, dict):
        return value
    normalized = dict(value)
    raw_mode = normalized.get("ending_mode")
    try:
        mode = EndingMode(raw_mode or DEFAULT_ENDING_MODE)
    except (TypeError, ValueError):
        mode = DEFAULT_ENDING_MODE
    # Normalize aliases and explicit null/unknown legacy values before the
    # strict Pydantic enum field sees them. Unknown values deliberately keep
    # the safe historical serial contract rather than guessing a finale.
    if raw_mode is None or not isinstance(raw_mode, EndingMode) or raw_mode != mode.value:
        normalized["ending_mode"] = mode.value
    if ending_mode_requires_hook(mode):
        return normalized

    def _text(candidate: Any) -> str:
        return candidate.strip() if isinstance(candidate, str) else ""

    if not _text(normalized.get("cliffhanger")):
        closure = next(
            (
                _text(normalized.get(field_name))
                for field_name in (
                    "episode_payoff",
                    "exit_state",
                    "turning_point",
                    "resolution",
                    "unit_resolution",
                )
                if len(_text(normalized.get(field_name))) >= 5
            ),
            "本集完成正式收束。",
        )
        normalized["cliffhanger"] = closure

    if include_legacy_hook_type and not _text(normalized.get("ending_hook_type")):
        normalized["ending_hook_type"] = "正式收束"

    if require_legacy_obligation and not _text(
        normalized.get("next_episode_obligation")
    ):
        normalized["next_episode_obligation"] = (
            "本集完成正式收束；后续内容仅按已批准方向承接。"
        )
    return normalized


EPISODE_RUNTIME_MIN_SECONDS = 75
EPISODE_RUNTIME_MAX_SECONDS = 115
EPISODE_RUNTIME_PREFERRED_MIN_SECONDS = 90
EPISODE_RUNTIME_PREFERRED_MAX_SECONDS = 105
EPISODE_SCENE_MIN = 1
EPISODE_SCENE_MAX = 5
EPISODE_DIALOGUE_LINE_MIN = 25
EPISODE_DIALOGUE_LINE_MAX = 35
EPISODE_SHOT_UNIT_MIN = 15
EPISODE_SHOT_UNIT_MAX = 20
SERIES_RUNTIME_MIN_MINUTES = 100
PARTNER_SCREENPLAY_FORMAT_VERSION = "partner_screenplay.v1"
OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT = (
    "海外路径每一集都必须遵守同一语言与人物身份合同。OutputLanguage=en仅表示"
    "dialogues.text使用英文，不表示整份剧本使用英文；dialogues.text使用自然英文，"
    "必须简洁、可表演。"
    "dialogues.character_name使用"
    "稳定英文名作为内部说话人标识；除这两个字段外，title、logline、synopsis、hook、"
    "episode_goal、next_episode_question、characters人物卡、人物与关系状态、场景标题、"
    "动作、画面描述、因果字段、表演intent及所有其他创作者可见文字必须在首次输出时直接"
    "生成，所有可见叙事字段统一使用简体中文，不得先生成英文再整集翻译。每条"
    "dialogues.chinese_translation必须在同一次输出中写该句准确、自然的简体中文对照，"
    "语义、语气、称谓和信息量必须一致；"
    "dialogues.chinese_character_name写该说话人的稳定中文名。动作中提到人物时只用"
    "对应中文名，不得混入英文名；"
    "显示层会呈现中文名（ENGLISH NAME），不得在同一个text字段中混写中英台词。"
    "characters中的name、role、description、motivation全部只用简体中文，并且同一真实人物"
    "在一集内只能出现一条人物记录。职位、亲属称谓、昵称、代号、假名、曾用名、公开身份、"
    "秘密身份或身份变化只能作为同一人物的称呼或身份事实记录，绝不能据此新建重复人物。"
    "跨集必须沿用Story Bible、人物卡、连续性账本和canonical_character_names已经确认的"
    "同一身份；不得把同名的不同人物错误合并，也不得把同一人物的不同称呼错误拆分。"
    "如果两个不同人物确实同名，必须沿用稳定的纯中文消歧名，例如李伟（医生）与"
    "李伟（记者），并在后续每集保持不变；不得用英文消歧。"
)
PARTNER_SCREENPLAY_SAMPLE_SHA256 = (
    "05ae1a5df1bde3c885ad009c863d5a2bf1b13ae49084f6ccfc7c7678efbee876",
    "e72af663ae1c9fa9de059ef55e1bf591bd982a3bcb47a62804a6906ed595e92a",
)


def clamp_legacy_numeric(
    value: Any,
    *,
    minimum: int,
    maximum: int,
) -> Any:
    """Preserve legacy non-numeric values while normalizing numeric budgets."""

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    return min(maximum, max(minimum, round(value)))


def normalize_episode_dialogue_plan_payload(value: Any) -> Any:
    """Upgrade legacy episode dialogue budgets without changing story content."""

    if not isinstance(value, dict):
        return value
    normalized = dict(value)
    raw_scenes = normalized.get("scene_execution_plan")
    scenes = [dict(scene) for scene in raw_scenes] if (
        isinstance(raw_scenes, list)
        and raw_scenes
        and all(isinstance(scene, dict) for scene in raw_scenes)
    ) else []
    raw_total = normalized.get("planned_dialogue_line_count")
    if isinstance(raw_total, bool) or not isinstance(raw_total, (int, float)):
        raw_total = sum(
            max(0, round(scene.get("dialogue_line_target", 0)))
            for scene in scenes
            if isinstance(scene.get("dialogue_line_target", 0), (int, float))
            and not isinstance(scene.get("dialogue_line_target", 0), bool)
        ) or 30
    target = min(
        EPISODE_DIALOGUE_LINE_MAX,
        max(EPISODE_DIALOGUE_LINE_MIN, round(raw_total)),
    )
    normalized["planned_dialogue_line_count"] = target
    if not scenes:
        return normalized

    counts = [
        max(0, round(scene.get("dialogue_line_target", 0)))
        if isinstance(scene.get("dialogue_line_target", 0), (int, float))
        and not isinstance(scene.get("dialogue_line_target", 0), bool)
        else 0
        for scene in scenes
    ]
    total = sum(counts)
    cursor = 0
    while total < target:
        counts[cursor % len(counts)] += 1
        total += 1
        cursor += 1
    while total > target:
        index = max(range(len(counts)), key=counts.__getitem__)
        if counts[index] == 0:
            break
        counts[index] -= 1
        total -= 1
    for scene, count in zip(scenes, counts, strict=True):
        scene["dialogue_line_target"] = count
    normalized["scene_execution_plan"] = scenes
    return normalized
