"""Append model-selected missing parent references without rewriting story text."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any, Callable

from pydantic import ValidationError

from app.modules.script_engine.long_story_models import ParentEventBinding, StoryPlanNode
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_decomposition_contracts import TECHNICAL_STORY_ROOT_MARKER


def prepare_parent_binding_completion(
    candidate: dict[str, Any], parent: StoryPlanNode,
) -> tuple[dict[str, Any], Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]], str]:
    """Prepare missing references only; full structural and semantic gates remain required."""
    frozen = deepcopy(candidate)
    children = frozen.get("children") if isinstance(frozen, dict) else None
    if not isinstance(children, list) or not children or any(not isinstance(c, dict) for c in children):
        raise StoryPlanningInputError("Parent reference completion requires complete children.")
    technical_root = parent.decomposition_reason == TECHNICAL_STORY_ROOT_MARKER
    expected = [] if technical_root else list(range(1, len(parent.unit_story_beats) + 1))
    assigned: list[int] = []
    for child in children:
        beats, bindings = child.get("unit_story_beats"), child.get("parent_event_bindings")
        if (not isinstance(beats, list) or not 1 <= len(beats) <= 12
                or any(not isinstance(beat, str) or not beat.strip() for beat in beats)
                or not isinstance(bindings, list)):
            raise StoryPlanningInputError("Parent reference completion needs explicit events and bindings.")
        for raw in bindings:
            try:
                binding = ParentEventBinding.model_validate(raw)
            except ValidationError as error:
                raise StoryPlanningInputError("Existing parent event bindings are invalid.") from error
            if (binding.parent_event_index not in expected
                    or any(index > len(beats) for index in binding.child_event_indices)):
                raise StoryPlanningInputError("Existing parent event bindings reference unknown events.")
            assigned.append(binding.parent_event_index)
    if len(set(assigned)) != len(assigned) or assigned != sorted(assigned):
        raise StoryPlanningInputError("Existing parent event bindings repeat or reorder approved events.")
    missing = [index for index in expected if index not in assigned]
    variants = [{
        "type": "object", "additionalProperties": False,
        "required": ["child_number", "child_event_indices"], "properties": {
            "child_number": {"type": "integer", "const": number},
            "child_event_indices": {
                "type": "array", "minItems": 1, "maxItems": len(child["unit_story_beats"]),
                "uniqueItems": True, "items": {
                    "type": "integer", "minimum": 1, "maximum": len(child["unit_story_beats"]),
                },
            },
        },
    } for number, child in enumerate(children, 1)]
    properties = {f"parent_event_{index}": {"oneOf": deepcopy(variants)} for index in missing}

    def project(merged_candidate: dict[str, Any], repair_refs: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(repair_refs, dict) or set(repair_refs) != set(properties):
            raise StoryPlanningInputError("Parent reference repair must contain exactly the missing parent keys.")
        if (not isinstance(merged_candidate, dict)
                or set(merged_candidate) != set(frozen)
                or not isinstance(merged_candidate.get("children"), list)
                or len(merged_candidate["children"]) != len(children)):
            raise StoryPlanningInputError("Parent reference repair cannot change the candidate structure.")
        for key in frozen.keys() - {"children"}:
            if merged_candidate[key] != frozen[key]:
                raise StoryPlanningInputError("Parent reference repair cannot change candidate metadata.")
        for before, after in zip(children, merged_candidate["children"], strict=True):
            if (not isinstance(after, dict)
                    or {k: v for k, v in before.items() if k != "episode_developments"}
                    != {k: v for k, v in after.items() if k != "episode_developments"}):
                raise StoryPlanningInputError("Parent reference repair cannot rewrite story or existing references.")
        merged = deepcopy(merged_candidate)
        for index in missing:
            patch = repair_refs[f"parent_event_{index}"]
            if (not isinstance(patch, dict) or set(patch) != {"child_number", "child_event_indices"}
                    or type(patch["child_number"]) is not int
                    or not 1 <= patch["child_number"] <= len(children)):
                raise StoryPlanningInputError("Parent reference repair has an invalid child selection.")
            try:
                binding = ParentEventBinding.model_validate({
                    "parent_event_index": index, "child_event_indices": patch["child_event_indices"],
                })
            except ValidationError as error:
                raise StoryPlanningInputError("Parent reference repair has invalid local event indices.") from error
            child = merged["children"][patch["child_number"] - 1]
            if any(value > len(child["unit_story_beats"]) for value in binding.child_event_indices):
                raise StoryPlanningInputError("Parent reference repair references an unknown local event.")
            child["parent_event_bindings"].append(binding.model_dump(mode="json"))
            child["parent_event_bindings"].sort(key=lambda value: value["parent_event_index"])
        return merged

    if not missing:
        return properties, project, ""
    lines = [
        "以下已批准父事件缺少来源引用。仅在候选具体事件已经完整兑现父事件时补引用；"
        "不得用索引掩盖正文缺失、错误行动者、因果结果或先后顺序。若内容未兑现，不能伪造引用通过。"
        "模型必须依据下列全文选择实际承接的子段与事件；保留已有引用与所有正文，不新增剧情。"
        "补充后仍须完整父事件及语义校验。",
        *[f"parent_event_{index}: {parent.unit_story_beats[index - 1]}" for index in missing],
        "候选子段完整事件表：",
        json.dumps([{"child_number": number, "unit_story_beats": child["unit_story_beats"],
                     "parent_event_bindings": child["parent_event_bindings"]}
                    for number, child in enumerate(children, 1)], ensure_ascii=False),
    ]
    return properties, project, "\n".join(lines)
