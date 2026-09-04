"""Pure production-count helpers for generated episode drafts."""

from __future__ import annotations

from collections.abc import Iterable

from app.modules.master_script.models import (
    DraftMasterScript,
    LLMGeneratedDraftMasterScript,
)
from app.script_delivery_contract import (
    EPISODE_DIALOGUE_LINE_MAX,
    EPISODE_DIALOGUE_LINE_MIN,
    EPISODE_SHOT_UNIT_MAX,
    EPISODE_SHOT_UNIT_MIN,
)


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
