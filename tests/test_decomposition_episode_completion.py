"""Real R168 second reply: retain story, complete only three empty episode maps."""

import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.script_engine.decomposition_episode_completion import (
    build_episode_completion_feedback, prepare_episode_completion,
)
from app.modules.script_engine.episode_development_contract import validate_episode_developments
from app.modules.script_engine.long_story_models import StoryPlanNodeDecompositionOutput
from app.modules.script_engine.json_schema_contract import compact_json_schema
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_decomposition_boundaries import ChildEpisodeBoundary, DecompositionBoundaryPlan
from app.modules.script_engine.story_planning_service import planning_payload_for_validation


def fixture():
    return json.loads((Path(__file__).parent / "fixtures/r168_decomposition_missing_episode_maps.json").read_text())


def plan():
    return DecompositionBoundaryPlan(tuple(ChildEpisodeBoundary(first, first + 7) for first in (1, 9, 17)), "candidate")


def episode_map(child):
    first, last = child["planned_start_episode"], child["planned_end_episode"]
    beats = child["unit_story_beats"]
    entries = []
    for number in range(first, last + 1):
        offset = number - first
        sources = [offset + 1] if offset < len(beats) - 1 else [len(beats)] if number == last else []
        entries.append({
            "episode_number": number,
            "synopsis": f"第{number}集，主角承接前一集已经产生的实际结果，并在现有剧情范围内采取下一步行动。",
            "exit_state": child["exit_state"] if number == last else f"第{number}集的既定行动已经完成，原有处境及尚未解决的困难继续影响后续。",
            "source_event_indices": sources,
        })
    return entries


def repair(candidate, indices=(0, 1, 2)):
    return {f"child_{index + 1}": {"episode_developments": episode_map(candidate["children"][index])}
            for index in indices}


def test_real_second_reply_repairs_all_three_maps_without_changing_any_other_field():
    candidate = fixture()
    before = deepcopy(candidate)
    schema, project, pending = prepare_episode_completion(candidate, plan())
    assert pending == (0, 1, 2)
    assert list(schema["properties"]) == ["child_1", "child_2", "child_3"]
    result = project(repair(candidate))
    assert candidate == before
    for old, new in zip(before["children"], result["children"]):
        assert {k: v for k, v in old.items() if k != "episode_developments"} == {
            k: v for k, v in new.items() if k != "episode_developments"}
        assert len(new["episode_developments"]) == 8
    output = StoryPlanNodeDecompositionOutput.model_validate(planning_payload_for_validation(result, StoryPlanNodeDecompositionOutput))
    for child in output.children:
        validate_episode_developments(child, required=True, require_canonical_events=True)


def test_schema_fixes_every_episode_final_state_and_local_event_index_domain():
    candidate = fixture()
    schema, _, _ = prepare_episode_completion(candidate, plan())
    assert schema["additionalProperties"] is False
    for index, child in enumerate(candidate["children"]):
        patch = schema["properties"][f"child_{index + 1}"]
        assert patch["required"] == ["episode_developments"]
        assert patch["additionalProperties"] is False
        maps = patch["properties"]["episode_developments"]
        assert (maps["minItems"], maps["maxItems"], maps["items"]) == (8, 8, False)
        assert [entry["properties"]["episode_number"]["const"] for entry in maps["prefixItems"]] == list(range(index * 8 + 1, index * 8 + 9))
        assert maps["prefixItems"][-1]["properties"]["exit_state"]["const"] == child["exit_state"]
        terminal = len(child["unit_story_beats"])
        assert all(entry["properties"]["source_event_indices"]["items"]["maximum"] == terminal - 1 for entry in maps["prefixItems"][:-1])
        final_sources = maps["prefixItems"][-1]["properties"]["source_event_indices"]
        assert final_sources["items"]["maximum"] == terminal
        assert final_sources["contains"] == {"const": terminal}
        assert final_sources["minContains"] == final_sources["minItems"] == 1


def test_valid_leaf_is_preserved_and_only_invalid_maps_are_requested():
    candidate = fixture()
    candidate["children"][1]["episode_developments"] = episode_map(candidate["children"][1])
    before = deepcopy(candidate)
    schema, project, pending = prepare_episode_completion(candidate, plan())
    assert pending == (0, 2)
    assert set(schema["properties"]) == {"child_1", "child_3"}
    merged = project(repair(candidate, pending))
    assert merged["children"][1] == before["children"][1]
    assert candidate == before
    # A caller cannot mutate the frozen source behind the prepared projection.
    candidate["children"][1]["title"] = "must not replace saved candidate"
    assert project(repair(before, pending))["children"][1] == before["children"][1]


def test_composing_public_schema_does_not_mutate_map_projection_allowed_keys():
    candidate = fixture()
    schema, project, pending = prepare_episode_completion(candidate, plan())
    schema["properties"]["parent_event_2"] = {"type": "object"}
    schema["required"].append("parent_event_2")
    merged = project(repair(candidate, pending))
    assert len(merged["children"][0]["episode_developments"]) == 8
    with pytest.raises(StoryPlanningInputError, match="exactly the pending child keys"):
        project({**repair(candidate, pending), "parent_event_2": {}})


@pytest.mark.parametrize("damage", ["range", "missing_field", "duplicate_beats", "turn_index", "parent_index", "extra_field"])
def test_non_map_defects_are_not_hidden_by_episode_completion(damage):
    candidate = fixture()
    child = candidate["children"][0]
    if damage == "range": child["planned_end_episode"] = 7
    elif damage == "missing_field": child.pop("emotional_direction")
    elif damage == "duplicate_beats": child["unit_story_beats"][1] = child["unit_story_beats"][0]
    elif damage == "turn_index": child["turning_point_indices"] = [True]
    elif damage == "parent_index": child["parent_event_bindings"][0]["child_event_indices"] = [12]
    else: child["unexpected_metadata"] = "do not silently drop"
    with pytest.raises(StoryPlanningInputError):
        prepare_episode_completion(candidate, plan())


@pytest.mark.parametrize("damage", ["title", "changed_range", "extra_child", "missing_child", "episode_number", "last_exit", "missing_source", "duplicate_source", "early_terminal", "extra_episode_field"])
def test_projection_rejects_metadata_changes_and_complete_validator_rejects_invalid_maps(damage):
    candidate = fixture()
    _, project, _ = prepare_episode_completion(candidate, plan())
    patch = repair(candidate)
    first = patch["child_1"]
    entries = first["episode_developments"]
    if damage == "title": first["title"] = "rewritten story"
    elif damage == "changed_range": first["planned_end_episode"] = 7
    elif damage == "extra_child": patch["child_4"] = first
    elif damage == "missing_child": patch.pop("child_3")
    elif damage == "episode_number": entries[-1]["episode_number"] = 7
    elif damage == "last_exit": entries[-1]["exit_state"] = "未经批准的结局改动。"
    elif damage == "missing_source": entries[0]["source_event_indices"] = []
    elif damage == "duplicate_source": entries[1]["source_event_indices"] = [1, 2]
    elif damage == "early_terminal": entries[-2]["source_event_indices"], entries[-1]["source_event_indices"] = entries[-1]["source_event_indices"], []
    else: entries[0]["entry_state"] = "不得增加竞争的继承状态。"
    if damage in {"title", "changed_range", "extra_child", "missing_child"}:
        with pytest.raises(StoryPlanningInputError):
            project(patch)
    else:
        merged = project(patch)
        assert merged["children"][0]["episode_developments"] == entries
        with pytest.raises((ValidationError, StoryPlanningInputError)):
            StoryPlanNodeDecompositionOutput.model_validate(planning_payload_for_validation(merged, StoryPlanNodeDecompositionOutput))
        _, _, still_pending = prepare_episode_completion(merged, plan())
        assert still_pending == (0,)


def test_partial_completion_keeps_two_valid_maps_and_only_requests_remaining_bad_leaf():
    candidate = fixture()
    _, project, _ = prepare_episode_completion(candidate, plan())
    patch = repair(candidate)
    patch["child_2"]["episode_developments"].pop()
    merged = project(patch)
    with pytest.raises(ValidationError):
        StoryPlanNodeDecompositionOutput.model_validate(planning_payload_for_validation(merged, StoryPlanNodeDecompositionOutput))
    next_schema, next_project, pending = prepare_episode_completion(merged, plan())
    assert pending == (1,)
    assert list(next_schema["properties"]) == ["child_2"]
    completed = next_project(repair(candidate, pending))
    assert completed["children"][0] == merged["children"][0]
    assert completed["children"][2] == merged["children"][2]
    output = StoryPlanNodeDecompositionOutput.model_validate(planning_payload_for_validation(completed, StoryPlanNodeDecompositionOutput))
    for child in output.children:
        validate_episode_developments(child, required=True, require_canonical_events=True)


def real_terminal_failure():
    records = json.loads((Path(__file__).parent / "fixtures/r169_fixed_ranges_terminal_event_failure.json").read_text())["records"]
    candidates = [record["candidate"] for record in records if isinstance(record.get("candidate"), dict)]
    return candidates[0], candidates[1:]


def test_real_repeated_terminal_failure_is_rejected_by_repair_schema_and_preserves_valid_map():
    candidate, patches = real_terminal_failure()
    before = deepcopy(candidate)
    for patch in patches:
        schema, project, pending = prepare_episode_completion(candidate, plan())
        assert pending == (0, 1)
        assert set(schema["properties"]) == {"child_1", "child_2"}
        # These are the actual first, second and third identical failed repairs:
        # event 5 at episode 5 instead of 8; event 6 at episode 13 instead of 16.
        for key in ("child_1", "child_2"):
            entries = patch[key]["episode_developments"]
            shapes = schema["properties"][key]["properties"]["episode_developments"]["prefixItems"]
            assert entries[4]["source_event_indices"][0] > shapes[4]["properties"]["source_event_indices"]["items"]["maximum"]
            final_sources = shapes[7]["properties"]["source_event_indices"]
            assert final_sources["contains"]["const"] not in entries[7]["source_event_indices"]
            assert len(entries[7]["source_event_indices"]) < final_sources["minItems"]
        candidate = project(patch)
        assert candidate["children"][2] == before["children"][2]
        with pytest.raises(ValidationError, match="terminal event must belong to the final episode"):
            planning_payload_for_validation(candidate, StoryPlanNodeDecompositionOutput)


def test_real_terminal_feedback_names_each_event_owner_and_requires_story_change():
    candidate, _ = real_terminal_failure()
    before = deepcopy(candidate)
    feedback = build_episode_completion_feedback(candidate, plan())
    assert "child_1（第 1–8 集）" in feedback
    assert "child_2（第 9–16 集）" in feedback
    assert "child_3" not in feedback
    assert "当前索引归属集：5；必须唯一归属第 8 集" in feedback
    assert "当前索引归属集：13；必须唯一归属第 16 集" in feedback
    for child in candidate["children"][:2]:
        assert child["unit_story_beats"][-1] in feedback
        assert child["exit_state"] in feedback
    assert "禁止只挪 source_event_indices" in feedback
    assert "synopsis 和 exit_state" in feedback
    assert candidate == before


def test_terminal_schema_allows_structurally_correct_map_without_claiming_semantic_approval():
    candidate, _ = real_terminal_failure()
    schema, _, pending = prepare_episode_completion(candidate, plan())
    schema = compact_json_schema(schema)
    # Synthetic maps only check the schema; they are not generated story content.
    for key, child in repair(candidate, pending).items():
        shapes = schema["properties"][key]["properties"]["episode_developments"]["prefixItems"]
        for entry, shape in zip(child["episode_developments"], shapes, strict=True):
            sources = shape["properties"]["source_event_indices"]
            assert all(index <= sources["items"]["maximum"] for index in entry["source_event_indices"])
            if "contains" in sources:
                assert sources["contains"]["const"] in entry["source_event_indices"]
