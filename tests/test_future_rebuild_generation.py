from copy import deepcopy
import json

import pytest

from app.modules.script_engine.future_leaf_rebuild import extract_budget
from app.modules.script_engine.future_rebuild_generation import bind_future_rebuild_budget
from app.modules.script_engine.long_story_models import EpisodePlanItemDraftRequest
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from tests.test_future_episode_source_revision import revision_case


def rebuild_case():
    service, node, original, workspace, response, calls = revision_case()
    context = {
        "episode_number": 2, "ending_mode": original.current_plan.ending_mode.value,
        "budget": extract_budget(original.current_plan.model_dump(mode="json")),
        "source_evidence": {key: getattr(node.episode_developments[1], key) for key in (
            "entry_state", "exit_state", "source_turning_points", "source_unit_story_beats")},
    }
    service._long_story_service.prepare_future_leaf_rebuild_context = lambda *_args: deepcopy(context)
    candidate = deepcopy(response)
    response.clear()
    response["episode_plans"] = [candidate]
    request = EpisodePlanItemDraftRequest(
        **original.model_dump(exclude={"current_plan", "instruction", "selection_context", "revision_mode", "future_rebuild"}),
        future_rebuild=True,
    )
    return service, request, response, calls, context


def test_rebuild_uses_existing_roadmap_writer_with_exact_server_budget_and_owned_events():
    service, request, _response, calls, context = rebuild_case()
    service._episode_plan_chunk_size = 6
    result = service.generate_episode_plan_chunk(request)
    assert len(calls) == len(result) == 1
    item = result[0]
    assert item.episode_number == 2
    assert extract_budget(item.model_dump(mode="json")) == context["budget"]
    assert [scene.dialogue_line_target for scene in item.scene_execution_plan] == [0, 30]
    for key, value in context["source_evidence"].items():
        assert getattr(item, key) == value
    assert item.execution_ready and item.layer_contracts.meets_contract
    prompt, schema = calls[0]
    assert schema is None
    assert "不是润色旧梗概" in prompt
    assert "旧事件尚未公开材料" not in prompt
    wire, _ = json.JSONDecoder().raw_decode(prompt.split("AUTHORITATIVE JSON SCHEMA:\n", 1)[1])
    episode = wire["$defs"]["EpisodePlanGenerationItem"]["properties"]
    assert not {"target_duration_seconds", "planned_scene_count", "planned_dialogue_line_count", "planned_shot_count"} & episode.keys()
    scene = wire["$defs"]["EpisodeSceneExecutionBeat"]
    assert not {"dialogue_line_target", "shot_target"} & scene["properties"].keys()
    assert not {"dialogue_line_target", "shot_target"} & set(scene["required"])
    assert episode["scene_execution_plan"]["prefixItems"][0]["properties"] == {"scene_number": {"const": 1}}
    assert episode["scene_execution_plan"]["allOf"] == [{"minItems": 2, "maxItems": 2}]
    assert "Plan production load independently" not in prompt
    assert "Choose the load" not in prompt
    assert "本次JSON不输出target_duration_seconds" in prompt
    assert service._long_story_service.saved_nodes == []


@pytest.mark.parametrize("change", ["silent", "total", "duration", "scene_count", "ending"])
def test_wrong_raw_budget_is_rejected_before_any_normalizer_or_acceptance(change):
    service, request, response, calls, _context = rebuild_case()
    item = response["episode_plans"][0]
    if change == "silent":
        item["scene_execution_plan"][0]["dialogue_line_target"] = 1
        item["scene_execution_plan"][1]["dialogue_line_target"] = 29
    elif change == "total":
        item["planned_dialogue_line_count"] = 24
    elif change == "duration":
        item["target_duration_seconds"] = 91
    elif change == "scene_count":
        item["scene_execution_plan"].pop(0)
    else:
        item["ending_mode"] = "series_finale"
    with pytest.raises(LongStoryPersistenceConflictError, match="rebuild changed|saved scene_number"):
        service.generate_episode_plan_chunk(request)
    assert len(calls) == 1
    assert service._long_story_service.saved_nodes == []


def test_future_writer_omits_bound_budget_and_server_restores_exact_values_before_normalization():
    service, request, response, calls, context = rebuild_case()
    raw = response["episode_plans"][0]
    for field in ("target_duration_seconds", "planned_scene_count", "planned_shot_count", "planned_dialogue_line_count"):
        raw.pop(field, None)
    for scene in raw["scene_execution_plan"]:
        scene.pop("dialogue_line_target"); scene.pop("shot_target")
    original = deepcopy(response)
    result = service.generate_episode_plan_chunk(request)[0]
    assert len(calls) == 1
    assert extract_budget(result.model_dump(mode="json")) == context["budget"]
    assert [scene.dialogue_line_target for scene in result.scene_execution_plan] == [0, 30]
    assert result.synopsis == raw["synopsis"]
    assert [scene.visible_action for scene in result.scene_execution_plan] == [scene["visible_action"] for scene in raw["scene_execution_plan"]]
    assert response == original, "binding must not mutate provider content in place"
    assert result.execution_ready and result.layer_contracts.meets_contract


@pytest.mark.parametrize("problem", ["episode", "missing_scene", "duplicate_scene", "reordered_scene", "bool_scene", "missing_episode"])
def test_budget_binding_never_guesses_episode_or_scene_identity(problem):
    _service, _request, response, _calls, context = rebuild_case()
    raw = response["episode_plans"][0]
    if problem == "episode": raw["episode_number"] = 3
    elif problem == "missing_episode": raw.pop("episode_number")
    elif problem == "missing_scene": raw["scene_execution_plan"].pop()
    elif problem == "duplicate_scene": raw["scene_execution_plan"][1]["scene_number"] = 1
    elif problem == "reordered_scene": raw["scene_execution_plan"].reverse()
    else: raw["scene_execution_plan"][0]["scene_number"] = True
    with pytest.raises(LongStoryPersistenceConflictError, match="binding requires"):
        bind_future_rebuild_budget(response, context)


def test_ordinary_roadmap_generation_still_authors_its_own_budget():
    service, request, _response, calls, _context = rebuild_case()
    service._episode_plan_chunk_size = 1
    service.generate_episode_plan_chunk(request.model_copy(update={"future_rebuild": False}))
    prompt, _schema = calls[0]
    assert "Plan production load independently" in prompt
    wire, _ = json.JSONDecoder().raw_decode(prompt.split("AUTHORITATIVE JSON SCHEMA:\n", 1)[1])
    assert "target_duration_seconds" in wire["$defs"]["EpisodePlanGenerationItem"]["properties"]
    assert "dialogue_line_target" in wire["$defs"]["EpisodeSceneExecutionBeat"]["properties"]
