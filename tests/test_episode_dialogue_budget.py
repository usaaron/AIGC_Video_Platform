from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.modules.script_engine.long_story_models import EpisodePlanGenerationItem
from app.modules.script_engine.models import ApprovedEpisodePlanContext
from tests.test_long_story_models import (
    build_episode_plan_generation_item,
    build_scene_execution_plan,
)


@pytest.fixture(params=[EpisodePlanGenerationItem, ApprovedEpisodePlanContext])
def plan_model(request):
    return request.param


def episode_payload(dialogue_targets, total):
    scenes = build_scene_execution_plan()
    for scene, count in zip(scenes, dialogue_targets, strict=True):
        if count is None:
            scene.pop("dialogue_line_target")
        else:
            scene["dialogue_line_target"] = count
    return {
        **build_episode_plan_generation_item(),
        "planned_scene_count": 2,
        "planned_dialogue_line_count": total,
        "planned_shot_count": 16,
        "scene_execution_plan": scenes,
    }


@pytest.mark.parametrize(("targets", "total", "expected"), [
    ([0, 20], 20, [0, 25]),
    ([20, 0], 25, [25, 0]),
    ([0, 30], 35, [0, 35]),
    ([0, 35], 25, [0, 25]),
    ([None, 20], 25, [0, 25]),
])
def test_plan_and_approved_handoff_keep_silence_when_adjusting_budget(
    plan_model, targets, total, expected,
):
    payload = episode_payload(targets, total)
    original = deepcopy(payload)

    plan = plan_model.model_validate(payload)

    assert [scene.dialogue_line_target for scene in plan.scene_execution_plan] == expected
    assert 25 <= plan.planned_dialogue_line_count <= 35
    assert payload == original
    assert plan_model.model_validate_json(plan.model_dump_json()) == plan


@pytest.mark.parametrize("zero", [0, 0.0, "0"])
def test_wholly_silent_plan_cannot_be_made_executable_by_inventing_speech(plan_model, zero):
    with pytest.raises(ValidationError, match="Scene dialogue targets must equal"):
        plan_model.model_validate(episode_payload([zero, zero], 25))


def test_legacy_undeclared_scene_budgets_remain_readable(plan_model):
    plan = plan_model.model_validate(episode_payload([None, None], 25))

    assert sum(scene.dialogue_line_target for scene in plan.scene_execution_plan) == 25
    assert all(scene.dialogue_line_target > 0 for scene in plan.scene_execution_plan)
