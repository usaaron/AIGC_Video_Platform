"""Pure production-count helpers for generated episode drafts."""

from __future__ import annotations

from collections.abc import Iterable
import re
from typing import Any

from app.modules.master_script.models import (
    DraftMasterScript,
    LLMGeneratedDraftMasterScript,
    normalize_screenplay_body_order,
)
from app.script_delivery_contract import (
    EPISODE_DIALOGUE_LINE_MAX,
    EPISODE_DIALOGUE_LINE_MIN,
    EPISODE_SHOT_UNIT_MAX,
    EPISODE_SHOT_UNIT_MIN,
)


def _sentence_split(text: str) -> tuple[str, str] | None:
    boundaries = []
    for match in re.finditer(r"[。！？!?；;]|\.(?=\s+[A-Z])", text):
        left, right = text[:match.end()].strip(), text[match.end():].strip()
        if re.search(r"\b(?:[A-Z]|Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc)\.$", left, re.IGNORECASE):
            continue
        if len(left) >= 3 and len(right) >= 3:
            boundaries.append((left, right))
    return min(boundaries, key=lambda pair: abs(len(pair[0]) - len(pair[1]))) if boundaries else None


def _join_body_text(left: str, right: str) -> str:
    separator = "" if re.search(r"[\u3400-\u9fff]", left + right) else " "
    return left.rstrip() + separator + right.lstrip()


def _merge_dialogue(left: dict, right: dict) -> dict | None:
    if left["character_name"].strip().casefold() != right["character_name"].strip().casefold():
        return None
    if left.get("chinese_character_name") != right.get("chinese_character_name"):
        return None
    translations = (left.get("chinese_translation"), right.get("chinese_translation"))
    if bool(translations[0]) != bool(translations[1]):
        return None
    merged = {**left, "text": _join_body_text(left["text"], right["text"])}
    if left["intent"] != right["intent"]:
        merged["intent"] = left["intent"] + "；" + right["intent"]
    if all(translations):
        merged["chinese_translation"] = _join_body_text(*translations)
    if len(merged["text"]) > 280 or len(merged["intent"]) > 120 or len(merged.get("chinese_translation") or "") > 280:
        return None
    return merged


def _body_order(scene: dict) -> list[str]:
    return normalize_screenplay_body_order(
        scene.get("body_order"), action_count=len(scene["character_actions"]),
        dialogue_count=len(scene["dialogues"]),
    )


def _splice_body_items(scene: dict, kind: str, index: int, removed: int, replacements: list) -> None:
    order = []
    for reference in _body_order(scene):
        ref_kind, _, raw_index = reference.partition(":")
        old_index = int(raw_index)
        if ref_kind != kind or old_index < index:
            order.append(reference)
        elif old_index == index:
            order.extend(f"{kind}:{index + offset}" for offset in range(len(replacements)))
        elif old_index >= index + removed:
            order.append(f"{kind}:{old_index + len(replacements) - removed}")
    field = "character_actions" if kind == "action" else "dialogues"
    scene[field][index:index + removed] = replacements
    scene["body_order"] = order


def rebalance_scene_items(scenes: list[dict[str, Any]], *, kind: str, target: int) -> None:
    """Adjust explicit sentence units while preserving text, translation and order."""
    field = "character_actions" if kind == "action" else "dialogues"
    limit = 24 if kind == "action" else 35
    count = sum(len(scene[field]) for scene in scenes)
    while count != target:
        splitting = count < target
        candidates = []
        for scene_number, scene in enumerate(scenes):
            items = scene[field]
            order = _body_order(scene)
            for index, item in enumerate(items):
                text = item if kind == "action" else item["text"]
                if splitting:
                    if len(items) >= limit or (kind == "dialogue" and item.get("chinese_translation")):
                        continue
                    split = _sentence_split(text)
                    if split is None:
                        continue
                    if kind == "action":
                        existing = {value.strip().casefold() for i, value in enumerate(items) if i != index}
                        if split[0].casefold() == split[1].casefold() or any(value.casefold() in existing for value in split):
                            continue
                    replacements = list(split) if kind == "action" else [{**item, "text": value} for value in split]
                    rank = -len(text)
                else:
                    if index + 1 >= len(items):
                        continue
                    position = order.index(f"{kind}:{index}")
                    if order[position:position + 2] != [f"{kind}:{index}", f"{kind}:{index + 1}"]:
                        continue
                    right = items[index + 1]
                    merged = _join_body_text(item, right) if kind == "action" else _merge_dialogue(item, right)
                    if merged is None:
                        continue
                    replacements = [merged]
                    rank = len(merged) if kind == "action" else len(merged["text"])
                candidates.append((rank, scene_number, index, replacements))
        if not candidates:
            return
        _, scene_number, index, replacements = min(candidates, key=lambda item: item[:3])
        _splice_body_items(scenes[scene_number], kind, index, 1 if splitting else 2, replacements)
        count += 1 if splitting else -1


def deduplicate_draft_strings(
    values: Iterable[str],
    *,
    limit: int | None = None,
) -> list[str]:
    """Match DraftSceneCard's uniqueness rule while preserving order."""

    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        marker = value.strip().casefold()
        if marker in seen:
            continue
        seen.add(marker)
        result.append(value)
        if limit is not None and len(result) >= limit:
            break
    return result


def episode_production_counts(
    script: LLMGeneratedDraftMasterScript | DraftMasterScript,
) -> tuple[int, int, int]:
    return (
        len(script.scenes),
        sum(len(scene.dialogues) for scene in script.scenes),
        sum(len(scene.character_actions) for scene in script.scenes),
    )


def episode_production_counts_are_valid(
    dialogue_count: int,
    shot_count: int,
) -> bool:
    return (
        EPISODE_DIALOGUE_LINE_MIN <= dialogue_count <= EPISODE_DIALOGUE_LINE_MAX
        and EPISODE_SHOT_UNIT_MIN <= shot_count <= EPISODE_SHOT_UNIT_MAX
    )


def record_episode_production_counts(
    output: dict[str, object],
    *,
    scene_count: int,
    dialogue_count: int,
    shot_count: int,
    repaired: bool,
) -> None:
    metadata = output.setdefault("_meta", {})
    if not isinstance(metadata, dict):
        return
    metadata.update(production_count_metadata(
        scene_count=scene_count,
        dialogue_count=dialogue_count,
        shot_count=shot_count,
        repaired=repaired,
    ))
    metadata.setdefault("episode_production_count_model_pass_count", 0)


def production_count_metadata(
    *,
    scene_count: int,
    dialogue_count: int,
    shot_count: int,
    repaired: bool | None = None,
) -> dict[str, object]:
    metadata: dict[str, object] = {
        "episode_scene_count": scene_count,
        "episode_dialogue_line_count": dialogue_count,
        "episode_shot_unit_count": shot_count,
        "episode_production_count_policy": (
            "scenes_1_5_dialogues_25_35_shots_15_20_v2"
        ),
    }
    if repaired is not None:
        metadata["episode_production_counts_repaired"] = repaired
    return metadata
