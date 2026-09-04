"""Pure allocation helpers used by recursive story-plan compilation."""

from __future__ import annotations

import math
import re

from app.modules.script_engine.long_story_models import (
    ShortDramaEscalationStage,
    StoryLinePlan,
)


class PlanningAllocationError(ValueError):
    """Raised when episode ranges cannot satisfy the allocation policy."""


def escalation_stage_weight(stage: ShortDramaEscalationStage) -> int:
    return max(
        1,
        len(stage.stage_goal)
        + len(stage.stage_opposition)
        + len(stage.stage_payoff)
        + len(stage.escalation_to_next),
    )


def group_escalation_stages(
    stages: list[ShortDramaEscalationStage],
    child_count: int,
) -> list[list[ShortDramaEscalationStage]]:
    groups: list[list[ShortDramaEscalationStage]] = []
    cursor = 0
    for index in range(child_count):
        remaining_stages = len(stages) - cursor
        remaining_groups = child_count - index
        size = math.ceil(remaining_stages / remaining_groups)
        groups.append(stages[cursor : cursor + size])
        cursor += size
    return groups


def planning_match_tokens(value: str) -> set[str]:
    normalized = re.sub(r"\s+", "", value).casefold()
    chinese_bigrams = {
        normalized[index : index + 2]
        for index in range(len(normalized) - 1)
        if "\u4e00" <= normalized[index] <= "\u9fff"
        and "\u4e00" <= normalized[index + 1] <= "\u9fff"
    }
    return chinese_bigrams | set(re.findall(r"[a-z0-9_.-]{3,}", value.casefold()))


def assign_story_lines_to_stage_groups(
    story_lines: list[StoryLinePlan],
    stage_groups: list[list[ShortDramaEscalationStage]],
) -> list[list[StoryLinePlan]]:
    if not story_lines:
        return [[] for _ in stage_groups]
    main_lines = [
        line
        for line in story_lines
        if getattr(line.story_line_type, "value", line.story_line_type) == "main"
    ]
    base_lines = main_lines or [story_lines[0]]
    assignments = [list(base_lines) for _ in stage_groups]
    stage_tokens = [
        planning_match_tokens(
            " ".join(
                value
                for stage in group
                for value in (
                    stage.title,
                    stage.stage_goal,
                    stage.stage_opposition,
                    stage.stage_payoff,
                    stage.escalation_to_next,
                )
            )
        )
        for group in stage_groups
    ]
    secondary_lines = [line for line in story_lines if line not in base_lines]
    for line_index, line in enumerate(secondary_lines):
        line_tokens = planning_match_tokens(
            f"{line.title} {line.premise} {line.planned_resolution}"
        )
        scores = [len(line_tokens & tokens) for tokens in stage_tokens]
        best_score = max(scores, default=0)
        if best_score:
            target_index = scores.index(best_score)
        else:
            target_index = line_index % len(stage_groups)
        assignments[target_index].append(line)
    return assignments


def allocate_compiled_stage_spans(
    *,
    total_episodes: int,
    desired_child_count: int,
    stage_weights: list[int],
) -> list[int]:
    for child_count in range(desired_child_count, 1, -1):
        grouped_weights = []
        cursor = 0
        for index in range(child_count):
            remaining = len(stage_weights) - cursor
            group_size = math.ceil(remaining / (child_count - index))
            grouped_weights.append(sum(stage_weights[cursor : cursor + group_size]))
            cursor += group_size
        if total_episodes >= 16 * child_count:
            return weighted_integer_allocation(
                total=total_episodes,
                minimum=16,
                weights=grouped_weights,
            )
        if 8 * child_count <= total_episodes <= 12 * child_count:
            return weighted_integer_allocation(
                total=total_episodes,
                minimum=8,
                maximum=12,
                weights=grouped_weights,
            )
    if 25 <= total_episodes <= 31:
        first = total_episodes - 16
        return [first, 16]
    raise PlanningAllocationError(
        "The approved escalation stages cannot be allocated into valid recursive "
        "episode ranges."
    )


def weighted_integer_allocation(
    *,
    total: int,
    minimum: int,
    weights: list[int],
    maximum: int | None = None,
) -> list[int]:
    allocations = [minimum for _ in weights]
    remaining = total - minimum * len(weights)
    if remaining <= 0:
        return allocations
    positive_weights = [max(1, weight) for weight in weights]
    while remaining:
        candidates = [
            index
            for index, allocation in enumerate(allocations)
            if maximum is None or allocation < maximum
        ]
        if not candidates:
            raise PlanningAllocationError(
                "Episode allocation exceeded the valid child range."
            )
        index = max(
            candidates,
            key=lambda item: positive_weights[item] / (allocations[item] + 1),
        )
        allocations[index] += 1
        remaining -= 1
    return allocations
