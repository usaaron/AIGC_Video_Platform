"""R169 real missing provenance repair, with no story rewrite or model call."""
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.modules.script_engine.decomposition_parent_completion import prepare_parent_binding_completion
from app.modules.script_engine.long_story_models import ParentEventBinding, StoryPlanNode
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_decomposition_contracts import validate_inherited_parent_events


def example():
    fixtures = Path(__file__).parent / "fixtures"
    records = json.loads((fixtures / "r169_fixed_ranges_terminal_event_failure.json").read_text())["records"]
    candidate = next(record["candidate"] for record in records if isinstance(record.get("candidate"), dict))
    parent = StoryPlanNode.model_validate(json.loads((fixtures / "r166_decomposition_parent_v3.json").read_text())["parent"])
    return candidate, parent


def validate_parent(candidate, parent):
    # Exercise the complete parent gate independently of known-invalid episode maps.
    output = SimpleNamespace(children=[SimpleNamespace(
        unit_story_beats=child["unit_story_beats"],
        parent_event_bindings=[ParentEventBinding.model_validate(binding) for binding in child["parent_event_bindings"]],
    ) for child in candidate["children"]])
    validate_inherited_parent_events(output, parent, require_bindings=True)


def test_real_missing_second_parent_event_can_be_bound_without_changing_story_or_new_maps():
    candidate, parent = example()
    before = deepcopy(candidate)
    properties, project, feedback = prepare_parent_binding_completion(candidate, parent)
    assert set(properties) == {"parent_event_2"}
    variants = properties["parent_event_2"]["oneOf"]
    assert [v["properties"]["child_number"]["const"] for v in variants] == [1, 2, 3]
    assert [v["properties"]["child_event_indices"]["items"]["maximum"] for v in variants] == [5, 6, 9]
    assert parent.unit_story_beats[1] in feedback
    assert all(beat in feedback for child in candidate["children"] for beat in child["unit_story_beats"])
    assert "不得用索引掩盖正文缺失" in feedback
    with pytest.raises(StoryPlanningInputError, match="exactly once"):
        validate_parent(candidate, parent)
    merged = deepcopy(candidate)
    merged["children"][0]["episode_developments"][0]["synopsis"] = "map projection already repaired this entry"
    result = project(merged, {"parent_event_2": {"child_number": 1, "child_event_indices": [3, 4]}})
    validate_parent(result, parent)
    assert result["children"][0]["parent_event_bindings"] == [
        *before["children"][0]["parent_event_bindings"],
        {"parent_event_index": 2, "child_event_indices": [3, 4]},
    ]
    result_without_new_binding = deepcopy(result)
    result_without_new_binding["children"][0]["parent_event_bindings"].pop()
    assert result_without_new_binding == merged
    assert candidate == before


@pytest.mark.parametrize("mutation", ["extra_parent", "existing_parent", "extra_field", "unknown_child", "boolean_child", "unknown_local", "empty_local", "duplicate_local", "rewrite_beat", "overwrite_binding"])
def test_projection_rejects_extra_existing_out_of_range_or_changed_content(mutation):
    candidate, parent = example()
    _, project, _ = prepare_parent_binding_completion(candidate, parent)
    patch = {"parent_event_2": {"child_number": 1, "child_event_indices": [3, 4]}}
    merged = deepcopy(candidate)
    if mutation == "extra_parent": patch["parent_event_11"] = patch["parent_event_2"]
    elif mutation == "existing_parent": patch["parent_event_1"] = patch.pop("parent_event_2")
    elif mutation == "extra_field": patch["parent_event_2"]["title"] = "rewrite"
    elif mutation == "unknown_child": patch["parent_event_2"]["child_number"] = 4
    elif mutation == "boolean_child": patch["parent_event_2"]["child_number"] = True
    elif mutation == "unknown_local": patch["parent_event_2"]["child_event_indices"] = [6]
    elif mutation == "empty_local": patch["parent_event_2"]["child_event_indices"] = []
    elif mutation == "duplicate_local": patch["parent_event_2"]["child_event_indices"] = [3, 3]
    elif mutation == "rewrite_beat": merged["children"][0]["unit_story_beats"][2] = "rewritten"
    else: merged["children"][0]["parent_event_bindings"][0]["child_event_indices"] = [3]
    with pytest.raises(StoryPlanningInputError): project(merged, patch)


@pytest.mark.parametrize("mutation", ["duplicate", "parent_range", "local_range", "order"])
def test_existing_invalid_bindings_are_not_hidden(mutation):
    candidate, parent = example()
    refs = candidate["children"][1]["parent_event_bindings"]
    if mutation == "duplicate": refs.append(deepcopy(refs[0]))
    elif mutation == "parent_range": refs[0]["parent_event_index"] = 99
    elif mutation == "local_range": refs[0]["child_event_indices"] = [12]
    else: refs.reverse()
    with pytest.raises(StoryPlanningInputError): prepare_parent_binding_completion(candidate, parent)


def test_no_missing_or_technical_root_requests_no_repair():
    candidate, parent = example()
    _, project, _ = prepare_parent_binding_completion(candidate, parent)
    complete = project(candidate, {"parent_event_2": {"child_number": 1, "child_event_indices": [3, 4]}})
    properties, project, feedback = prepare_parent_binding_completion(complete, parent)
    assert properties == {} and feedback == "" and project(complete, {}) == complete
    parent.decomposition_reason = "system_story_bible_root.v1"
    for child in candidate["children"]: child["parent_event_bindings"] = []
    properties, project, feedback = prepare_parent_binding_completion(candidate, parent)
    assert properties == {} and feedback == "" and project(candidate, {}) == candidate
