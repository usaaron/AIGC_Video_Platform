"""Pure metrics shared by screenplay validation and runtime estimation."""

from __future__ import annotations

import unicodedata

from app.modules.master_script.models import LLMGeneratedDraftMasterScript


def count_screenplay_text_characters(text: str) -> int:
    """Count normalized letters and numbers used as screenplay body content."""

    return sum(
        1
        for character in unicodedata.normalize("NFKC", text)
        if unicodedata.category(character)[0] in {"L", "N"}
    )


def screenplay_scene_character_counts(
    script: LLMGeneratedDraftMasterScript,
) -> list[int]:
    return [
        sum(
            count_screenplay_text_characters(text)
            for text in (
                *scene.character_actions,
                *(dialogue.text for dialogue in scene.dialogues),
            )
        )
        for scene in script.scenes
    ]


def screenplay_character_count(script: LLMGeneratedDraftMasterScript) -> int:
    return sum(screenplay_scene_character_counts(script))


def is_chinese_language(language: str) -> bool:
    normalized = language.strip().lower().replace("_", "-")
    return normalized.startswith("zh") or any(
        marker in normalized for marker in ("中文", "简体", "汉语", "普通话")
    )
