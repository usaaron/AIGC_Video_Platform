"""Deterministic checks for the episode-to-screenplay handoff."""

from __future__ import annotations

import re
from typing import Any

from app.modules.script_engine.episode_presence import episode_scene_presence_issues


_PLACEHOLDER_VALUES = {
    "承接当前阶段的具体阻力。",
    "兑现一个可见的阶段推进结果。",
    "当前结果引出更高一级的因果压力。",
    "下一集必须承接本集结尾压力。",
}

# An explicit production TODO is different from a character not knowing a fact.
# Restrict this to statements that say the concrete execution evidence is pending.
_UNRESOLVED_EXECUTION_DETAIL = re.compile(
    r"(?:^|[；;。])\s*具体[^；;。\n]{0,40}(?:待定|待补充|待确认)"
    r"|^\s*(?:待定|待补充)[：:]"
    r"|具体[^；;。\n]{0,40}(?:待定|待补充|待确认)[^。\n]{0,100}(?:影响|正文|只锁定|只规定)"
)


def episode_execution_readiness_issues(plan: Any | None) -> list[str]:
    """Return stable issue codes for the scene blueprint/body handoff.

    This deliberately uses duck typing so both the planner item and the persisted
    approved context can be checked without introducing a model import cycle.
    """

    if plan is None:
        return ["approved_episode_plan_missing"]

    issues: list[str] = []
    if hasattr(plan, "execution_ready") and getattr(plan, "execution_ready") is not True:
        issues.append("execution_ready_false")
    scene_plan = getattr(plan, "scene_execution_plan", None) or []
    planned_scene_count = getattr(plan, "planned_scene_count", None)
    if not scene_plan:
        issues.append("scene_execution_plan_missing")
        return issues
    if isinstance(planned_scene_count, int) and len(scene_plan) != planned_scene_count:
        issues.append("scene_execution_plan_count_mismatch")

    expected_numbers = list(range(1, len(scene_plan) + 1))
    actual_numbers = [getattr(scene, "scene_number", None) for scene in scene_plan]
    if actual_numbers != expected_numbers:
        issues.append("scene_execution_plan_numbering_invalid")

    # A copied scene can satisfy every type, count and budget check while still
    # making the screenplay writer repeat one beat. Compare the whole dramatic
    # contract, so repeated actions at one location remain valid when their
    # objective, resistance or result is genuinely different.
    scene_contract_fields = (
        "scene_heading", "scene_objective", "opposition", "information_shift",
        "choice_or_cost", "turn_or_reveal", "visible_action", "exit_state",
    )
    fingerprints = [
        "|".join(
            re.sub(r"\W+", "", str(getattr(scene, field, "") or "").casefold())
            for field in scene_contract_fields
        )
        for scene in scene_plan
    ]
    if len(set(fingerprints)) < len(fingerprints):
        issues.append("scene_execution_plan.duplicate_scene_beat")

    for index, scene in enumerate(scene_plan, start=1):
        prefix = f"scene_execution_plan.{index}"
        for field_name in ("opposition", "information_shift", "choice_or_cost"):
            value = getattr(scene, field_name, None)
            if not isinstance(value, str) or len(value.strip()) < 3:
                issues.append(f"{prefix}.{field_name}_missing")
        evidence = getattr(scene, "evidence_requirements", None)
        if not isinstance(evidence, list) or not any(
            isinstance(value, str) and value.strip() for value in evidence
        ):
            issues.append(f"{prefix}.evidence_requirements_missing")
        elif any(isinstance(value, str) and _UNRESOLVED_EXECUTION_DETAIL.search(value) for value in evidence):
            issues.append(f"{prefix}.evidence_requirements_unresolved")
        for field_name in ("scene_objective", "visible_action", "turn_or_reveal", "dialogue_objective", "exit_state"):
            value = getattr(scene, field_name, None)
            if not isinstance(value, str) or not value.strip():
                issues.append(f"{prefix}.{field_name}_missing")
            elif _UNRESOLVED_EXECUTION_DETAIL.search(value):
                issues.append(f"{prefix}.{field_name}_unresolved")

    for field_name in (
        "stage_opposition",
        "episode_payoff",
        "pressure_escalation",
        "next_episode_obligation",
    ):
        value = getattr(plan, field_name, None)
        if isinstance(value, str) and value.strip() in _PLACEHOLDER_VALUES:
            issues.append(f"{field_name}_placeholder")

    issues.extend(episode_scene_presence_issues(plan))
    return issues


def episode_execution_ready(plan: Any | None) -> bool:
    return not episode_execution_readiness_issues(plan)
