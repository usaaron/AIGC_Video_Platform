"""Narrow, read-only checks of explicit current-scene presence restrictions.

This is not a general natural-language continuity classifier. It reads only
current planning restrictions and registered identities, never historical life
status, locations, retrieval scores, or inferred translations of reference IDs.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any


def _field(value: Any, key: str, default: Any = None) -> Any:
    return value.get(key, default) if isinstance(value, Mapping) else getattr(value, key, default)


def _aliases(ref: str, names: Mapping[str, str]) -> list[str]:
    name = names.get(ref, ref)
    aliases = [ref]
    if ref not in names or sum(other == name for other in names.values()) == 1:
        aliases.append(name)
    # Chinese plans commonly abbreviate a registered identity (林知微→知微,
    # 独居老人→老人). Do not guess translated labels from character.elder.
    # Shared suffixes remain ambiguous and are deliberately not accepted.
    if re.fullmatch(r"[\u3400-\u9fff]{3,8}", name):
        aliases.extend(
            name[index:] for index in range(1, len(name) - 1)
            if sum(str(other).endswith(name[index:]) for other in names.values()) == 1
        )
    return sorted(set(aliases), key=lambda value: (-len(value), value))


def _identity_pattern(aliases: list[str]) -> str:
    return "(?:" + "|".join(
        (r"(?<![A-Za-z0-9_.])" + re.escape(alias) + r"(?![A-Za-z0-9_])")
        if re.search(r"[A-Za-z]", alias) else re.escape(alias)
        for alias in aliases
    ) + ")"


def _current_restriction(text: str, identity: str, *, scene_scoped: bool) -> bool:
    # A start-state absence, another episode, a conditional, or a character's
    # quoted belief cannot become a whole-scene/episode restriction.
    if re.search(r"[“”‘’\"「」]|如果|假如|若|曾经|此前|上集|下集|第\d+集|声称|谎称|转述", text):
        return False
    for clause in re.split(r"[，,。；;\n]", text):
        clause = clause.strip()
        if not clause or re.search(r"[“”‘’\"「」]|如果|假如|若|曾经|此前|上集|下集|第\d+集", clause):
            continue
        scope = r"(?:本集|本场|此场)" if scene_scoped else "本集"
        absence = r"(?:不得|禁止|不能)(?:本人)?(?:到场|出场|在场|现场出现|出现在现场)"
        whole_absence = r"(?:全程|始终)(?:不在场|未到场|缺席|不出场)"
        stated_absence = r"(?:不在场|仅被提及|只被提及)"
        patterns = [
            rf"{scope}{identity}(?:本人)?(?:{absence}|{whole_absence}|{stated_absence})",
            rf"{identity}(?:本人)?{scope}(?:{absence}|{whole_absence}|{stated_absence})",
            rf"{scope}(?:不得|不能|禁止)(?:让)?{identity}(?:本人)?(?:到场|出场|在场|现场出现|出现在现场)",
        ]
        if scene_scoped:
            patterns += [
                rf"{identity}(?:本人)?{absence}",
                rf"(?:不得|不能|禁止)(?:让)?{identity}(?:本人)?(?:到场|出场|在场|现场出现|出现在现场)",
                rf"{identity}(?:本人)?{whole_absence}",
                rf"{identity}(?:本人)?{stated_absence}",
            ]
        if any(re.fullmatch(pattern + r"[。.!！]?", clause, re.IGNORECASE) for pattern in patterns):
            return True
    return False


def _mediated_appearance(scene: Any, identity: str) -> bool:
    heading = str(_field(scene, "scene_heading", ""))
    if re.search(r"(?:[（(]\s*(?:FLASHBACK|回忆|闪回)\s*[）)]|[-—]\s*(?:FLASHBACK|回忆|闪回)\s*$)", heading, re.IGNORECASE):
        return True
    texts = [str(_field(scene, "visible_action", "")), *(_field(scene, "evidence_requirements", []) or [])]
    patterns = [
        rf"{identity}(?:本人)?(?:本场|此场)?(?:仅|只)(?:以|通过|在)"
        r"(?:回忆|闪回|录音|录像|视频|电话|远程|照片|档案|画面|声音)",
        rf"(?:播放|听取|展示|翻看|观看|读取){identity}(?:的)?(?:录音|录像|视频|照片|档案)",
        rf"(?:与{identity}(?:通过)?(?:电话|视频|远程)(?:连线|通话)|"
        rf"{identity}(?:通过|在)(?:电话|视频|远程)(?:中|里)?(?:回应|说|发言))",
    ]
    for text in texts:
        for clause in re.split(r"[，,。；;\n]", text):
            # The same identity must be tied to the represented appearance.
            # An unrelated phone call, photo, or archive somewhere in the
            # scene does not exempt everybody in the roster.
            if re.search(r"如果|假如|若|[“”\"「」]", clause):
                continue
            for pattern in patterns:
                for match in re.finditer(pattern, clause, re.IGNORECASE):
                    # Negation must modify the represented appearance itself;
                    # '播放录音但不能确认地点' still establishes the recording.
                    if not re.search(
                        r"(?:没有|并未|尚未|禁止|不得|不能|未|别|不)(?:实际|直接|再|继续)?\s*$",
                        clause[:match.start()],
                    ):
                        return True
    # Mixed live/media narration needs semantic review; do not infer its time
    # or location from verbs that could describe the recording or flashback.
    return False


def episode_scene_presence_issues(
    plan: Any, *, character_names: Mapping[str, str] | None = None,
) -> list[str]:
    """Report explicit current restrictions that conflict with scene rosters.

    Names must come from the approved registry. Without a registry, only literal
    refs/names can match; ambiguous or unrecognized prose is left to review.
    """
    names = character_names or {}
    episode_rules = _field(plan, "continuity_requirements", []) or []
    issues = []
    for scene in _field(plan, "scene_execution_plan", []) or []:
        number = _field(scene, "scene_number")
        for ref in _field(scene, "character_refs", []) or []:
            if not isinstance(ref, str) or not ref:
                continue
            identity = _identity_pattern(_aliases(ref, names))
            restricted = any(
                isinstance(rule, str) and _current_restriction(rule, identity, scene_scoped=False)
                for rule in episode_rules
            ) or any(
                isinstance(rule, str) and _current_restriction(rule, identity, scene_scoped=True)
                for rule in _field(scene, "forbidden_changes", []) or []
            )
            if restricted and not _mediated_appearance(scene, identity):
                issues.append(f"scene_execution_plan.{number}.scene_presence_conflict:{ref}")
    return list(dict.fromkeys(issues))
