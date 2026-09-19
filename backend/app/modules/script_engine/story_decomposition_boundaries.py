"""Pure episode boundary plans, before authoring a complete sibling output.

A numeric plan is a generation constraint, not evidence of narrative capacity.
It never rewrites a candidate, invents an event, or relaxes semantic acceptance.
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from app.modules.script_engine.long_story_models import MIN_EPISODE_READY_SPAN, MAX_EPISODE_READY_SPAN
from app.modules.script_engine.planning_errors import StoryPlanningInputError


def _field(value: object, name: str) -> object:
    return value.get(name) if isinstance(value, Mapping) else getattr(value, name, None)


def _integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _legal_span(span: int) -> bool:
    return MIN_EPISODE_READY_SPAN <= span <= MAX_EPISODE_READY_SPAN or span >= 16


@dataclass(frozen=True, slots=True)
class ChildEpisodeBoundary:
    planned_start_episode: int
    planned_end_episode: int

    @property
    def episode_count(self) -> int:
        return self.planned_end_episode - self.planned_start_episode + 1

    @property
    def recommended_next_step(self) -> str:
        return "episode_ready" if self.episode_count <= MAX_EPISODE_READY_SPAN else "expand"

    def as_dict(self) -> dict[str, object]:
        return {
            "planned_start_episode": self.planned_start_episode,
            "planned_end_episode": self.planned_end_episode,
            "estimated_episode_count": self.episode_count,
            "recommended_next_step": self.recommended_next_step,
        }


@dataclass(frozen=True, slots=True)
class DecompositionBoundaryPlan:
    ranges: tuple[ChildEpisodeBoundary, ...]
    source: Literal["candidate", "initial"]

    def as_ranges(self) -> list[list[int]]:
        return [[item.planned_start_episode, item.planned_end_episode] for item in self.ranges]

    def prompt_context(self) -> str:
        import json
        return (
            "Fixed child episode boundaries for this generation:\n"
            + json.dumps([item.as_dict() for item in self.ranges], ensure_ascii=False, separators=(",", ":"))
            + "\nAuthor the complete causal movement and episode assignments inside each fixed range. "
            "Do not change numbers, drop episodes, or count one event as necessarily one episode. "
            "This structural plan does not prove dramatic capacity: preserve parent event ownership, "
            "actors, causes, outcomes and handoffs, and develop supported intermediate actions. "
            "If the source cannot support the range, report the actual missing causal function; "
            "never fabricate core facts, repeat resolved actions or edit a candidate's numbers to simulate completion."
        )


def _group_ranges(group: object) -> list[object] | None:
    if isinstance(group, Mapping):
        group = group.get("children", group.get("movements"))
    elif hasattr(group, "children"):
        group = group.children
    elif hasattr(group, "movements"):
        group = group.movements
    return list(group) if isinstance(group, Sequence) and not isinstance(group, (str, bytes)) else None


def _complete_candidate_ranges(
    group: object, *, start: int, end: int, requested_child_count: int | None,
) -> tuple[ChildEpisodeBoundary, ...] | None:
    children = _group_ranges(group)
    if children is None or not 2 <= len(children) <= 12:
        return None
    if requested_child_count is not None and len(children) != requested_child_count:
        return None
    expected = start
    ranges = []
    for child in children:
        first = _field(child, "planned_start_episode")
        last = _field(child, "planned_end_episode")
        if not _integer(first) or not _integer(last) or first != expected or last > end or not _legal_span(last - first + 1):
            return None
        ranges.append(ChildEpisodeBoundary(first, last))
        expected = last + 1
    return tuple(ranges) if expected == end + 1 else None


def _can_partition(total: int, count: int) -> bool:
    if count == 0:
        return total == 0
    if count == 1:
        return _legal_span(total)
    # For >=2 slots, the 8..12 leaf window overlaps with one expandable
    # slot (16+) plus remaining 8-episode leaves. No further numeric gaps.
    return total >= count * MIN_EPISODE_READY_SPAN


def build_decomposition_boundary_plan(
    parent: object, *, candidate_groups: Sequence[object] = (),
    requested_child_count: int | None = None, preferred_child_count: int | None = None,
) -> DecompositionBoundaryPlan:
    """Reuse the first complete legal candidate before considering a new plan.

    Callers pass candidates in their preferred order (usually newest first).
    An initial plan requires an explicit count or a caller's narrative count
    hypothesis: this module does not infer story load from text lengths/events.
    Numeric fallback is balanced only when no authored legal partition exists;
    it must never be applied over an existing uneven narrative allocation.
    """
    start, end = _field(parent, "planned_start_episode"), _field(parent, "planned_end_episode")
    if not _integer(start) or not _integer(end) or start < 1 or end > 2000 or end < start:
        raise StoryPlanningInputError("A fixed boundary plan needs a complete valid parent episode range.")
    span = end - start + 1
    if span < 16:
        raise StoryPlanningInputError("This parent cannot be decomposed into two legal child ranges; coordinate at its parent.")
    for count in (requested_child_count, preferred_child_count):
        if count is not None and (not _integer(count) or not 2 <= count <= 12):
            raise StoryPlanningInputError("A decomposition boundary count must be an integer from 2 to 12.")
    if requested_child_count is not None and not _can_partition(span, requested_child_count):
        raise StoryPlanningInputError("The requested child count cannot fit the parent's fixed range.")
    for group in candidate_groups:
        ranges = _complete_candidate_ranges(group, start=start, end=end, requested_child_count=requested_child_count)
        if ranges is not None:
            return DecompositionBoundaryPlan(ranges, "candidate")
    count = requested_child_count if requested_child_count is not None else preferred_child_count
    if count is None:
        raise StoryPlanningInputError("Without existing legal boundaries, supply a narrative child-count hypothesis before generation.")
    if not _can_partition(span, count):
        raise StoryPlanningInputError("The proposed child count cannot fit the parent's fixed range.")
    ranges = []
    remaining, first = span, start
    for slots in range(count, 0, -1):
        choices = [size for size in range(MIN_EPISODE_READY_SPAN, remaining + 1)
                   if _legal_span(size) and _can_partition(remaining - size, slots - 1)]
        # Nearest feasible density for an unallocated range; this is not a
        # content allocator and does not redistribute any existing events.
        size = min(choices, key=lambda value: (abs(value * slots - remaining), value))
        ranges.append(ChildEpisodeBoundary(first, first + size - 1))
        first += size
        remaining -= size
    return DecompositionBoundaryPlan(tuple(ranges), "initial")


def validate_child_boundary(
    child: object, boundary: ChildEpisodeBoundary, *, require_episode_developments: bool = True,
) -> None:
    """Reject drift; never stamp expected numbers over authored content."""
    if (_field(child, "planned_start_episode"), _field(child, "planned_end_episode")) != (
        boundary.planned_start_episode, boundary.planned_end_episode,
    ):
        raise StoryPlanningInputError(
            f"Child must preserve its fixed episode range {boundary.planned_start_episode}-{boundary.planned_end_episode}."
        )
    if _field(child, "estimated_episode_count") != boundary.episode_count:
        raise StoryPlanningInputError("Child estimated_episode_count must equal its fixed range.")
    if _field(child, "recommended_next_step") != boundary.recommended_next_step:
        raise StoryPlanningInputError("Child readiness must match its fixed episode range.")
    if not require_episode_developments:
        return
    entries = _field(child, "episode_developments")
    if not isinstance(entries, (list, tuple)):
        raise StoryPlanningInputError("Child must supply its episode_developments array.")
    expected = list(range(boundary.planned_start_episode, boundary.planned_end_episode + 1)) if boundary.recommended_next_step == "episode_ready" else []
    if [_field(entry, "episode_number") for entry in entries] != expected:
        raise StoryPlanningInputError("Child episode_developments must cover its fixed range exactly, in order; expandable nodes use [].")


def validate_output_boundaries(
    output: object, plan: DecompositionBoundaryPlan, *, require_episode_developments: bool = True,
) -> None:
    children = _group_ranges(output)
    if children is None or len(children) != len(plan.ranges):
        raise StoryPlanningInputError("Output child count must match the fixed boundary plan.")
    for child, boundary in zip(children, plan.ranges, strict=True):
        validate_child_boundary(child, boundary, require_episode_developments=require_episode_developments)


def boundary_plan_schema(base_decomp_schema: dict[str, object], plan: DecompositionBoundaryPlan) -> dict[str, object]:
    """Constrain the requested output shape, without altering any candidate.

    JSON Schema 2020-12 prefixItems binds each sibling and each leaf episode to
    its exact position. Original field/event constraints remain through allOf.
    """
    from copy import deepcopy

    schema = deepcopy(base_decomp_schema)
    children = schema.get("properties", {}).get("children")
    if not isinstance(children, dict) or not isinstance(children.get("items"), dict):
        raise StoryPlanningInputError("A fixed boundary schema requires a decomposition children array schema.")
    original_child = deepcopy(children["items"])
    fixed_children = []
    for boundary in plan.ranges:
        fixed = {name: {"const": value} for name, value in boundary.as_dict().items()}
        if boundary.recommended_next_step == "episode_ready":
            fixed["episode_developments"] = {
                "type": "array", "minItems": boundary.episode_count, "maxItems": boundary.episode_count,
                "prefixItems": [{"type": "object", "properties": {"episode_number": {"const": number}},
                                 "required": ["episode_number"]}
                                for number in range(boundary.planned_start_episode, boundary.planned_end_episode + 1)],
                "items": False,
            }
        else:
            fixed["episode_developments"] = {"type": "array", "minItems": 0, "maxItems": 0}
        fixed_children.append({"allOf": [deepcopy(original_child), {
            "type": "object", "properties": fixed, "required": list(fixed),
        }]})
    children.update(minItems=len(plan.ranges), maxItems=len(plan.ranges), prefixItems=fixed_children, items=False)
    return schema
