"""Bind quick-plan transport to author settings without rewriting story choices."""
from __future__ import annotations

from copy import deepcopy
import re
from typing import Any

from app.modules.script_engine.scene_heading_metadata import explicit_scene_environment
from app.script_delivery_contract import EndingMode, normalize_finale_legacy_fields

from .models import QuickSettings


SCENE_HEADING_CONTRACT = (
    "scene_heading必须是带内外景标记的字符串：INT. 中文地点 - 中文时段（内景），"
    "EXT. 中文地点 - 中文时段（外景）；确有内外连续转换才用INT./EXT.或EXT./INT.。"
    "INT./EXT.是固定制作标记，不能翻译或省略；地点、时段和故事说明仍使用中文，"
    "不能只写地点与时段。每场根据已确定的实际空间明确内外景。"
)

_ENGLISH_PREFIX = re.compile(r"^(?:INT\./EXT\.|EXT\./INT\.|INT\.|EXT\.)", re.IGNORECASE)
_CHINESE_PREFIX = re.compile(
    r"^(?P<environment>内景\s*[/／]\s*外景|外景\s*[/／]\s*内景|"
    r"内\s*[/／]\s*外景?|外\s*[/／]\s*内景?|内外景|外内景|室内|室外|内景|外景|内|外)"
    r"(?P<separator>[\s，,。·、:：/／—–-]+)(?P<body>\S.*)$",
    re.DOTALL,
)


def episode_ending_contract(settings: QuickSettings) -> list[dict[str, Any]]:
    """Explicit compact per-episode metadata, also understood by JSON-only models."""
    closure = normalize_finale_legacy_fields(
        {"ending_mode": EndingMode.series_finale}, require_legacy_obligation=True,
    )["next_episode_obligation"]
    return [{"episode_number": number,
             "ending_mode": "series_finale" if number == settings.episode_count else "serial_hook",
             **({"next_episode_obligation": closure, "hook_payoff_target_episode": None}
                if number == settings.episode_count else {})}
            for number in range(1, settings.episode_count + 1)]


def normalize_quick_scene_heading(value: Any) -> Any:
    """Translate explicit environment markers only; never infer location or time."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    english = _ENGLISH_PREFIX.match(text)
    if english:
        return english.group().upper() + text[english.end():]
    match = _CHINESE_PREFIX.match(text)
    if not match:
        return value
    token = re.sub(r"\s+", "", match["environment"]).replace("／", "/")
    if token in {"内景/外景", "内/外景", "内/外", "内外景"}:
        prefix = "INT./EXT."
    elif token in {"外景/内景", "外/内景", "外/内", "外内景"}:
        prefix = "EXT./INT."
    else:
        environment = explicit_scene_environment(token)
        if environment is None:
            return value
        prefix = environment + "."
    return f"{prefix} {match['body']}"


def normalize_quick_plan_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Leave unsupported shapes for the existing model to reject with field paths."""
    normalized = deepcopy(payload)
    episodes = normalized.get("episodes")
    if isinstance(episodes, list):
        for episode in episodes:
            if not isinstance(episode, dict) or not isinstance(episode.get("scene_execution_plan"), list):
                continue
            for scene in episode["scene_execution_plan"]:
                if isinstance(scene, dict) and "scene_heading" in scene:
                    scene["scene_heading"] = normalize_quick_scene_heading(scene["scene_heading"])
    return normalized


def quick_plan_output_schema(schema: dict[str, Any], settings: QuickSettings) -> dict[str, Any]:
    """Make the generation contract reflect the same settings as local validation."""
    result = deepcopy(schema)
    properties = result["properties"]
    if settings.storyline_count == 1:
        properties["subplot"] = {"type": "null", "description": "仅一条主线，subplot必须为null，不得另设支线。"}
    result["required"] = list(dict.fromkeys([*result.get("required", []), "subplot"]))
    episodes = properties["episodes"]
    episodes.update(minItems=settings.episode_count, maxItems=settings.episode_count)
    closure = normalize_finale_legacy_fields(
        {"ending_mode": EndingMode.series_finale}, require_legacy_obligation=True,
    )["next_episode_obligation"]
    for shape in result.get("$defs", {}).values():
        fields = shape.get("properties", {})
        if {"scene_heading", "scene_objective"} <= fields.keys():
            fields["scene_heading"].update(
                pattern=r"^(?:INT\./EXT\.|EXT\./INT\.|INT\.|EXT\.)\s*\S",
                description=SCENE_HEADING_CONTRACT,
            )
        if {"episode_number", "scene_execution_plan", "ending_mode"} <= fields.keys():
            fields["episode_number"].update(minimum=1, maximum=settings.episode_count)
            fields["ending_mode"] = {"type": "string", "enum": ["serial_hook", "series_finale"]}
            shape["required"] = list(dict.fromkeys([*shape.get("required", []), "ending_mode"]))
            shape.setdefault("allOf", []).append({
                "if": {"properties": {"episode_number": {"const": settings.episode_count}},
                       "required": ["episode_number"]},
                "then": {"properties": {
                    "ending_mode": {"type": "string", "enum": ["series_finale"]},
                    "next_episode_obligation": {"type": "string", "const": closure},
                    "hook_payoff_target_episode": {"type": "null"},
                }},
                "else": {"properties": {"ending_mode": {"type": "string", "enum": ["serial_hook"]}}},
            })
    return result
