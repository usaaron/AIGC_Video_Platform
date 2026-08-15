from __future__ import annotations

import re
import unicodedata

from app.modules.master_script.models import LLMGeneratedDraftMasterScript


_NOVELISTIC_ACTION_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"(?:^|[。；;])\s*(?:特写(?:镜头)?|镜头(?:推进|推近|拉远|切到|转向|跟随)|"
            r"俯拍|仰拍|航拍|摇镜|推镜|拉镜|近景|中景|远景)"
        ),
        "camera_direction",
    ),
    (
        re.compile(
            r"(?:心想|心里(?:想|明白|知道|觉得)|内心(?:想|明白|知道|觉得)|"
            r"意识到|回忆起|想起了?|感到|觉得|暗自(?:想|决定)|"
            r"没人知道|无人知道|殊不知)"
        ),
        "private_thought",
    ),
    (
        re.compile(r"(?:仿佛|似乎)(?!写着|显示|传来|响起)"),
        "literary_inference",
    ),
    )


def draft_screenplay_style_issues(
    script: LLMGeneratedDraftMasterScript,
) -> list[str]:
    """Return conservative, path-addressed violations in production action lines.

    This deliberately checks only strong signals. Creative style is judged by the
    model and human reviewer; deterministic validation catches inaccessible prose
    and action-array items that have turned into narrative paragraphs.
    """

    issues: list[str] = []
    for scene_index, scene in enumerate(script.scenes):
        for action_index, action in enumerate(scene.character_actions):
            path = f"scenes.{scene_index}.character_actions.{action_index}"
            normalized = " ".join(action.split())
            effective_length = sum(
                1
                for character in unicodedata.normalize("NFKC", normalized)
                if unicodedata.category(character)[0] in {"L", "N"}
            )
            if "\n" in action or effective_length > 180:
                issues.append(f"{path}:narrative_paragraph")
            for pattern, reason in _NOVELISTIC_ACTION_PATTERNS:
                if pattern.search(normalized):
                    issues.append(f"{path}:{reason}")
                    break
    return list(dict.fromkeys(issues))
