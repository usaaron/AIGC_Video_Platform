from __future__ import annotations

from typing import Any


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
