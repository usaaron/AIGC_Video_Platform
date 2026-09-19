"""Compact narrative contracts for recovering an interrupted decomposition.

Transport recovery must preserve narrative ownership. It cannot infer episode
capacity from a field count or assign approved events by array position.
"""
from __future__ import annotations

from collections import Counter

from pydantic import BaseModel, ConfigDict, Field

from app.modules.script_engine.long_story_models import MIN_EPISODE_READY_SPAN, MAX_EPISODE_READY_SPAN
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_decomposition_contracts import (
    TECHNICAL_STORY_ROOT_MARKER, validate_decomposition_ranges,
)


class RecoveryMovement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=2, max_length=160)
    synopsis: str = Field(min_length=10, max_length=800)
    entry_state: str = Field(min_length=5, max_length=1000)
    exit_state: str = Field(min_length=5, max_length=1000)
    parent_turning_points: list[str] = Field(default_factory=list, max_length=20)
    planned_start_episode: int = Field(ge=1, le=2000)
    planned_end_episode: int = Field(ge=1, le=2000)

    @property
    def recommended_next_step(self) -> str:
        span = self.planned_end_episode - self.planned_start_episode + 1
        return "episode_ready" if MIN_EPISODE_READY_SPAN <= span <= MAX_EPISODE_READY_SPAN else "expand"


class RecoveryMovementPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    movements: list[RecoveryMovement] = Field(min_length=2, max_length=12)


def validate_recovery_movement_plan(plan, *, parent, requested_child_count, max_episode_ready_span):
    if requested_child_count is not None and len(plan.movements) != requested_child_count:
        raise StoryPlanningInputError("Recovery movement count must match the creator's requested count.")
    validate_decomposition_ranges(
        plan.movements, parent=parent, max_episode_ready_span=max_episode_ready_span,
    )
    expected = [] if getattr(parent, "decomposition_reason", None) == TECHNICAL_STORY_ROOT_MARKER else parent.turning_points
    assignments = Counter(point.strip() for movement in plan.movements for point in movement.parent_turning_points)
    if assignments != Counter(point.strip() for point in expected):
        raise StoryPlanningInputError(
            "Recovery movements must assign each approved parent turning point exactly once, without inventing assignments."
        )
