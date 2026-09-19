"""R166: failed compact maps must reach repair, never fail an empty-shell probe.

The parent is a read-only saved v3 fixture. Child responses reconstruct the real
reported shape; no raw provider response was persisted, so they are not a replay.
"""

from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.modules.script_engine.episode_development_contract import validate_episode_developments
from app.modules.script_engine.long_story_models import (
    StoryPlanNode, StoryPlanNodeChildOutput, StoryPlanNodeDecompositionOutput,
)
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_planning_service import (
    StoryPlanningService, _decomposition_children_are_structurally_empty,
    planning_payload_for_validation,
)
from tests.test_story_planning_service import build_strategy


def reconstructed_response():
    fixture = json.loads((Path(__file__).parent / "fixtures/r166_decomposition_parent_v3.json").read_text())
    parent = StoryPlanNode.model_validate(fixture["parent"])
    fields = set(StoryPlanNodeChildOutput.model_fields) - {"turning_points"}
    first = parent.model_dump(mode="json", include=fields)
    first.update(
        title="碉堡中的首次突围", unit_story_beats=parent.unit_story_beats[:4],
        planned_start_episode=1, planned_end_episode=8, estimated_episode_count=8,
        recommended_next_step="episode_ready", turning_point_indices=[1, 4],
        exit_state=parent.unit_story_beats[3], episode_developments=[],
    )
    assignments = {1: [1], 3: [2], 5: [3], 8: [4]}
    for number in range(1, 9):
        first["episode_developments"].append({
            "episode_number": number,
            "synopsis": f"测试夹具第{number}集的已写安排：" + first["unit_story_beats"][min((number - 1) // 2, 3)],
            "exit_state": first["exit_state"] if number == 8 else f"测试夹具第{number}集的前置行动已经完成，随后行动仍未开始。",
            "source_event_indices": assignments.get(number, []),
        })
    second = parent.model_dump(mode="json", include=fields)
    second.update(
        title="独立兵权与人员集结", unit_story_beats=parent.unit_story_beats[4:],
        planned_start_episode=9, planned_end_episode=24, estimated_episode_count=16,
        recommended_next_step="expand", turning_point_indices=[1, len(parent.unit_story_beats[4:])],
        entry_state=first["exit_state"], episode_developments=[],
    )
    return parent, {"_meta": {"finish_reason": "completed"}, "children": [first, second]}


def fake_service(responses):
    service = object.__new__(StoryPlanningService)
    service._adapter_for_artifact = lambda _name: SimpleNamespace()
    calls = []
    iterator = iter(responses)

    def respond(*args, **kwargs):
        calls.append({"prompt": args[1], **kwargs})
        return deepcopy(next(iterator))

    service._generate_structured_planning_response = respond
    return service, calls


def request(service, parent):
    return service._generate_planning_output(
        prompt=(f"Parent node: {parent.node_id} v{parent.version}\n"
                f"Parent range: episodes {parent.planned_start_episode}-{parent.planned_end_episode}\n"
                f"Parent entry state: {parent.entry_state}\nParent exit state: {parent.exit_state}\n"
                "Return exactly 2 children. Preserve the authored events and write complete leaf ownership."),
        strategy=build_strategy(), output_model=StoryPlanNodeDecompositionOutput,
        artifact_name=f"Story Plan Node decomposition node={parent.node_id}",
    )


@pytest.mark.parametrize("recommended", ["episode_ready", "expand"])
def test_real_error_shape_reaches_existing_batch_repair_without_bypassing_leaf_map(recommended):
    parent, fixed = reconstructed_response()
    failed = deepcopy(fixed)
    failed["children"][0].update(episode_developments=[], recommended_next_step=recommended)
    before = deepcopy(failed)
    with pytest.raises(ValidationError, match="episode_developments must cover the leaf exactly in order"):
        planning_payload_for_validation(failed, StoryPlanNodeDecompositionOutput)
    assert not _decomposition_children_are_structurally_empty(failed)

    service, calls = fake_service([failed, fixed])
    output = request(service, parent)
    assert len(calls) == 2  # Initial request plus the existing single batch repair.
    assert calls[1]["artifact_name"] == calls[0]["artifact_name"]
    assert "episode_developments must cover the leaf exactly in order" in calls[1]["prompt"]
    assert f"Parent node: {parent.node_id} v3" in calls[1]["prompt"]
    validate_episode_developments(output.children[0], required=True, require_canonical_events=True)
    assert [entry.episode_number for entry in output.children[0].episode_developments] == list(range(1, 9))
    assert output.children[1].episode_developments == []  # The 16-episode parent stays unexpanded.
    assert failed == before


@pytest.mark.parametrize("failure", ["missing_map", "gap", "duplicate_owner"])
def test_child_repair_catches_reference_normalization_and_keeps_valid_sibling(failure):
    parent, fixed = reconstructed_response()
    failed = deepcopy(fixed)
    entries = failed["children"][0]["episode_developments"]
    if failure == "missing_map":
        entries.clear()
    elif failure == "gap":
        entries.pop(3)
    else:
        entries[1]["source_event_indices"] = [1]
    before = deepcopy(failed)
    service, calls = fake_service([failed, failed, fixed["children"][0]])
    output = request(service, parent)
    assert len(calls) == 3  # Existing batch repair, then only the invalid child.
    assert "REPAIR ONE INCOMPLETE DECOMPOSITION CHILD" in calls[-1]["prompt"]
    assert json.loads(output.children[1].model_dump_json()) == planning_payload_for_validation(
        fixed["children"][1], StoryPlanNodeChildOutput,
    )
    validate_episode_developments(output.children[0], required=True, require_canonical_events=True)
    assert failed == before


def test_exhausted_reference_repair_does_not_return_placeholder_or_ready_node():
    parent, fixed = reconstructed_response()
    failed = deepcopy(fixed)
    failed["children"][0]["episode_developments"] = []
    service, calls = fake_service([failed, failed, failed["children"][0]])
    with pytest.raises(StoryPlanningInputError):
        request(service, parent)
    assert len(calls) == 3
    assert failed["children"][0]["episode_developments"] == []
    # The final production gate remains strict even for the legacy public shape.
    valid = StoryPlanNodeChildOutput.model_validate(planning_payload_for_validation(fixed["children"][0], StoryPlanNodeChildOutput))
    with pytest.raises(StoryPlanningInputError, match="缺少逐集事件分配"):
        validate_episode_developments(valid.model_copy(update={"episode_developments": []}), required=True)


def test_empty_probe_accepts_wrappers_and_legacy_aliases_without_reference_validation():
    _, fixed = reconstructed_response()
    failed = deepcopy(fixed["children"][0])
    failed["episode_developments"] = []
    assert not _decomposition_children_are_structurally_empty({"children": [{"node": failed}, {"child": failed}]})
    assert not _decomposition_children_are_structurally_empty({"children": [
        {"标题": "已有故事", "剧情梗概": "已有行动和后果", "进入状态": "人物处于已建立的初始状态"},
        {},
    ]})
    assert _decomposition_children_are_structurally_empty({"children": [{"title": "空壳"}, {}]})
