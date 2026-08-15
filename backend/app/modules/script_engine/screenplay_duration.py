from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata

from app.modules.master_script.models import LLMGeneratedDraftMasterScript


_CHINESE = re.compile(r"[\u3400-\u9fff]")
_ENGLISH_WORD = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")


@dataclass(frozen=True)
class ScreenplayDurationEstimate:
    total_seconds: int
    dialogue_seconds: float
    visual_seconds: float


def estimate_screenplay_duration(
    script: LLMGeneratedDraftMasterScript,
) -> ScreenplayDurationEstimate:
    """Estimate finished runtime without treating action prose as spoken narration."""

    total = 0.0
    dialogue_total = 0.0
    visual_total = 0.0
    for scene in script.scenes:
        dialogue_seconds = sum(
            _spoken_line_seconds(dialogue.text) for dialogue in scene.dialogues
        )
        action_characters = sum(
            _effective_character_count(action) for action in scene.character_actions
        )
        visual_seconds = action_characters / 22 + len(scene.character_actions) * 0.35
        dialogue_total += dialogue_seconds
        visual_total += visual_seconds
        # Dialogue and blocking commonly happen together; use the dominant track
        # and add a small allowance for scene entry, reaction, and transition.
        total += max(dialogue_seconds, visual_seconds) + 1.5
    return ScreenplayDurationEstimate(
        total_seconds=max(1, round(total)),
        dialogue_seconds=round(dialogue_total, 1),
        visual_seconds=round(visual_total, 1),
    )


def _spoken_line_seconds(text: str) -> float:
    chinese_characters = len(_CHINESE.findall(text))
    english_words = len(_ENGLISH_WORD.findall(text))
    if chinese_characters >= english_words:
        return chinese_characters / 4.2
    return english_words / 2.7


def _effective_character_count(text: str) -> int:
    return sum(
        1
        for character in unicodedata.normalize("NFKC", text)
        if unicodedata.category(character)[0] in {"L", "N"}
    )
