"""Deterministic checks for the episode-to-screenplay handoff."""

from __future__ import annotations

from typing import Any


_PLACEHOLDER_VALUES = {
    "承接当前阶段的具体阻力。",
    "兑现一个可见的阶段推进结果。",
    "当前结果引出更高一级的因果压力。",
    "下一集必须承接本集结尾压力。",
}


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
        for field_name in ("scene_objective", "visible_action", "turn_or_reveal", "dialogue_objective", "exit_state"):
            value = getattr(scene, field_name, None)
            if not isinstance(value, str) or not value.strip():
                issues.append(f"{prefix}.{field_name}_missing")

    for field_name in (
        "stage_opposition",
        "episode_payoff",
        "pressure_escalation",
        "next_episode_obligation",
    ):
        value = getattr(plan, field_name, None)
        if isinstance(value, str) and value.strip() in _PLACEHOLDER_VALUES:
            issues.append(f"{field_name}_placeholder")

    return issues


def episode_execution_ready(plan: Any | None) -> bool:
    return not episode_execution_readiness_issues(plan)
