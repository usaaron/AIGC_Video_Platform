from __future__ import annotations

from dataclasses import dataclass
import re
import math

from app.script_delivery_contract import EPISODE_RUNTIME_MAX_SECONDS

from app.modules.master_script.models import DraftSceneCard, LLMGeneratedDraftMasterScript
from app.modules.script_engine.screenplay_metrics import count_screenplay_text_characters


CHINESE_CHARACTERS_PER_SECOND = 4.2
ENGLISH_WORDS_PER_SECOND = 2.7
SCENE_TRANSITION_SECONDS = 1.5
ACTION_CHARACTERS_PER_SECOND = 22
ACTION_UNIT_SECONDS = 0.35


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
        dialogue_seconds, visual_seconds = _scene_tracks(scene)
        dialogue_total += dialogue_seconds
        visual_total += visual_seconds
        # Dialogue and blocking commonly happen together; use the dominant track
        # and add a small allowance for scene entry, reaction, and transition.
        total += max(dialogue_seconds, visual_seconds) + SCENE_TRANSITION_SECONDS
    return ScreenplayDurationEstimate(
        total_seconds=max(1, round(total)),
        dialogue_seconds=round(dialogue_total, 1),
        visual_seconds=round(visual_total, 1),
    )


def _scene_tracks(scene: DraftSceneCard) -> tuple[float, float]:
    dialogue = sum(estimate_spoken_line_duration(line.text) for line in scene.dialogues)
    action_characters = sum(count_screenplay_text_characters(action) for action in scene.character_actions)
    visual = action_characters / ACTION_CHARACTERS_PER_SECOND + len(scene.character_actions) * ACTION_UNIT_SECONDS
    return dialogue, visual


def estimate_scene_duration(scene: DraftSceneCard) -> ScreenplayDurationEstimate:
    dialogue, visual = _scene_tracks(scene)
    return ScreenplayDurationEstimate(max(1, round(max(dialogue, visual) + SCENE_TRANSITION_SECONDS)), round(dialogue, 1), round(visual, 1))


def estimate_spoken_line_duration(text: str) -> float:
    chinese_characters = len(_CHINESE.findall(text))
    english_words = len(_ENGLISH_WORD.findall(text))
    if chinese_characters >= english_words:
        return chinese_characters / CHINESE_CHARACTERS_PER_SECOND
    return english_words / ENGLISH_WORDS_PER_SECOND


def screenplay_runtime_prompt_guidance(
    *,
    target_duration_seconds: int,
    scene_count: int,
    chinese_dialogue: bool,
) -> str:
    """Expose the estimator's necessary spoken budget, not a per-line quota.

    Silent scenes and sequential action can require additional time; the total
    spoken budget is never sufficient proof that a scene or episode will fit.
    """

    rate = CHINESE_CHARACTERS_PER_SECOND if chinese_dialogue else ENGLISH_WORDS_PER_SECOND
    unit = "汉字（不含标点）" if chinese_dialogue else "自然英文单词"
    transition_seconds = SCENE_TRANSITION_SECONDS * scene_count
    target_units = round(max(0, target_duration_seconds - transition_seconds) * rate)
    maximum_units = math.floor(max(0, EPISODE_RUNTIME_MAX_SECONDS - transition_seconds) * rate)
    return (
        "【与验收相同的估时口径】每场对白秒数=本场实际说出的"
        f"{unit}总数÷{rate:g}；每场画面秒数=动作有效字数÷"
        f"{ACTION_CHARACTERS_PER_SECOND:g}+动作项数×{ACTION_UNIT_SECONDS:g}；"
        f"逐场取两者较大值再加{SCENE_TRANSITION_SECONDS:g}秒，最后合计。"
        f"本集{scene_count}场、目标{target_duration_seconds}秒，对白总量参考约"
        f"{target_units}{unit}；仅口播加转场就不能超过"
        f"{EPISODE_RUNTIME_MAX_SECONDS}秒，因此总量至多约{maximum_units}{unit}。"
        "这不是逐句配额，也不是实际可拍时长证明；静默场、必须先后完成的动作、"
        "阅读和反应还要另外留余量，不能默认全部与对白并行。"
        "保留批准的逐场对白轮次和每轮真实交流目的，允许长短错落；"
        "超时时收紧重复措辞及已经通过动作演出的说明，不能删减必要信息、合并或减少"
        "对白轮次，也不能用加快语速、拆句、录音或流程播报凑数。"
        "正文总字数包括动作，不是对白配额；其宽松篇幅参考不能反过来撑长口播。"
    )
