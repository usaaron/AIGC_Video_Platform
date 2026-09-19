"""Complete only missing episode maps while freezing the authored sibling story.

The temporary map-free validation below is eligibility for a narrow repair, never
acceptance of a planning node. The returned projection still requires the caller's
complete parent/source/semantic validation before anything can be saved.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Callable

from pydantic import ValidationError

from app.modules.script_engine.episode_development_contract import validate_episode_developments
from app.modules.script_engine.long_story_models import (
    StoryPlanNodeChildOutput, StoryPlanNodeDecompositionOutput,
)
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.planning_wire_contract import planning_wire_schema
from app.modules.script_engine.story_decomposition_boundaries import (
    DecompositionBoundaryPlan, validate_output_boundaries,
)


def _validated_child(child: dict[str, Any]) -> StoryPlanNodeChildOutput:
    # The existing normalizer owns compact-reference expansion. Local import
    # keeps this pure helper usable by its service without a module cycle.
    from app.modules.script_engine.story_planning_service import normalize_story_plan_node_generation_output
    normalized = normalize_story_plan_node_generation_output(deepcopy(child), child=True)
    node = StoryPlanNodeChildOutput.model_validate(normalized)
    validate_episode_developments(node, required=True, require_canonical_events=True)
    return node


def _validate_non_map_fields(child: dict[str, Any]) -> None:
    """Strictly check the fixed story without asking incomplete maps to pass."""
    beats = child.get("unit_story_beats")
    turns = child.get("turning_point_indices")
    if any(type(child.get(field)) is not int for field in (
        "planned_start_episode", "planned_end_episode", "estimated_episode_count",
    )):
        raise StoryPlanningInputError("Episode completion requires explicit integer episode boundaries.")
    if (not isinstance(beats, list) or not 4 <= len(beats) <= 12
            or any(not isinstance(beat, str) or not beat.strip() for beat in beats)
            or len(set(beats)) != len(beats)):
        raise StoryPlanningInputError("Episode completion requires a distinct canonical child event table.")
    if (not isinstance(turns, list) or not turns or len(turns) > 12
            or any(type(index) is not int or not 1 <= index <= len(beats) for index in turns)
            or len(set(turns)) != len(turns) or "turning_points" in child):
        raise StoryPlanningInputError("Episode completion requires valid canonical turning_point_indices.")
    if "parent_event_bindings" not in child:
        raise StoryPlanningInputError("Episode completion cannot invent missing parent_event_bindings.")
    non_map = deepcopy(child)
    non_map.pop("turning_point_indices")
    non_map["turning_points"] = [beats[index - 1] for index in turns]
    non_map["episode_developments"] = []
    # Direct domain validation avoids inventing missing emotional direction,
    # correcting readiness or silently dropping extra fields via normalization.
    node = StoryPlanNodeChildOutput.model_validate(non_map)
    validate_episode_developments(node, required=False, require_canonical_events=True)


def prepare_episode_completion(
    candidate: dict[str, Any], plan: DecompositionBoundaryPlan,
) -> tuple[dict[str, Any], Callable[[dict[str, Any]], dict[str, Any]], tuple[int, ...]]:
    """Return a restricted repair schema, immutable projection and 0-based indices."""
    if (not isinstance(candidate, dict) or set(candidate) - {"children", "_meta"}
            or not isinstance(candidate.get("children"), list)
            or any(not isinstance(child, dict) for child in candidate["children"])):
        raise StoryPlanningInputError("Episode completion needs one complete children candidate.")
    frozen = deepcopy(candidate)
    validate_output_boundaries(frozen, plan, require_episode_developments=False)
    pending = []
    try:
        for index, (child, boundary) in enumerate(zip(frozen["children"], plan.ranges, strict=True)):
            _validate_non_map_fields(child)
            if boundary.recommended_next_step != "episode_ready":
                if child.get("episode_developments") != []:
                    raise StoryPlanningInputError("Expandable children cannot receive episode-map repairs.")
                continue
            try:
                _validated_child(child)
            except (ValidationError, StoryPlanningInputError):
                pending.append(index)
    except ValidationError as error:
        raise StoryPlanningInputError("Episode completion cannot repair incomplete or invalid non-map fields.") from error

    wire = planning_wire_schema(StoryPlanNodeDecompositionOutput.model_json_schema())
    episode_shape = wire["$defs"]["EpisodeDevelopment"]
    properties = {}
    for index in pending:
        child, boundary = frozen["children"][index], plan.ranges[index]
        entries = []
        for number in range(boundary.planned_start_episode, boundary.planned_end_episode + 1):
            shape = deepcopy(episode_shape)
            shape["properties"]["episode_number"] = {"type": "integer", "const": number}
            sources = shape["properties"]["source_event_indices"]
            terminal_index = len(child["unit_story_beats"])
            sources["items"]["maximum"] = terminal_index - 1
            sources["uniqueItems"] = True
            if number == boundary.planned_end_episode:
                sources["items"]["maximum"] = terminal_index
                sources["minItems"] = 1
                sources["contains"] = {"const": terminal_index}
                sources["minContains"] = 1
                shape["properties"]["exit_state"] = {"type": "string", "const": child["exit_state"]}
            entries.append(shape)
        properties[f"child_{index + 1}"] = {
            "type": "object", "additionalProperties": False,
            "required": ["episode_developments"], "properties": {
                "episode_developments": {
                    "type": "array", "minItems": boundary.episode_count,
                    "maxItems": boundary.episode_count, "prefixItems": entries, "items": False,
                },
            },
        }
    schema = {"type": "object", "additionalProperties": False,
              "required": list(properties), "properties": properties}
    # The caller may compose this public schema with other narrow repairs.
    # Its edits must not change what this map-only projection accepts.
    map_keys = frozenset(properties)

    def project(repair: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(repair, dict) or set(repair) - {"_meta"} != map_keys:
            raise StoryPlanningInputError("Episode-map repair must contain exactly the pending child keys.")
        merged = deepcopy(frozen)
        for index in pending:
            patch = repair[f"child_{index + 1}"]
            if not isinstance(patch, dict) or set(patch) != {"episode_developments"}:
                raise StoryPlanningInputError("Episode-map repair cannot change ranges or other story fields.")
            merged["children"][index]["episode_developments"] = deepcopy(patch["episode_developments"])
        # Preserve every authored patch before the caller's complete validation.
        # If one map still fails, a subsequent prepare retains the other valid
        # maps and requests only the remainder; none is accepted by this merge.
        return merged

    return schema, project, tuple(pending)


def build_episode_completion_feedback(
    candidate: dict[str, Any], plan: DecompositionBoundaryPlan,
) -> str:
    """Explain concrete map defects without rewriting any authored content."""
    _, _, pending = prepare_episode_completion(candidate, plan)
    if not pending:
        return ""
    lines = [
        "逐集补全的具体修订要求：只修以下子段的 episode_developments，保留其他子段及全部非逐集字段。",
        "末事件必须在该子段最后一集真实发生并兑现结果，此前集不能提前完成该事件。"
        "禁止只挪 source_event_indices 而保留与索引不符的剧情；须同步改写受影响集的 synopsis 和 exit_state，"
        "保持原行动者、触发条件、因果与结果，不新增或删改既定事件。"
        "其余事件仍须完整且唯一归属，最后一集 exit_state 必须等于已给定子段退出状态。",
    ]
    for index in pending:
        child, boundary = candidate["children"][index], plan.ranges[index]
        terminal_index = len(child["unit_story_beats"])
        owners = [str(entry.get("episode_number")) for entry in child.get("episode_developments", [])
                  if isinstance(entry, dict)
                  and isinstance(entry.get("source_event_indices"), list)
                  and terminal_index in entry["source_event_indices"]]
        owner_text = "、".join(owners) if owners else "尚未分配"
        lines.append(
            f"child_{index + 1}（第 {boundary.planned_start_episode}–{boundary.planned_end_episode} 集）："
            f"末事件索引 {terminal_index}，全文：{child['unit_story_beats'][-1]}\n"
            f"当前索引归属集：{owner_text}；必须唯一归属第 {boundary.planned_end_episode} 集。"
            f"该集必须在实际剧情中完成此事件，最终退出状态保持：{child['exit_state']}"
        )
    return "\n".join(lines)
