from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.modules.master_script.models import (
    DraftMasterScript,
    DraftSceneCard,
    LLMGeneratedDraftMasterScript,
    LLMGeneratedSceneBodyPatch,
    LLMGeneratedSceneCard,
    LLMMainlandBodyRepairPatch,
    LLMScriptEditorialPatch,
    SceneCard,
    build_screenplay_body_order,
)
from app.modules.script_engine import draft_contract
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.production_count_utils import episode_production_counts_are_valid
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from app.modules.script_engine.script_post_editor import ScriptPostEditor
from tests.test_script_generation_service import (
    CountingMockLLMAdapter,
    _mainland_single_scene_payload,
    seed_dependencies,
)


@pytest.fixture
def silent_opening_episode():
    output = ScriptGenerationService._normalize_mechanical_draft_contract(
        _mainland_single_scene_payload(action="林夏打开记录本核对时间。")
    )
    output = LLMGeneratedDraftMasterScript.model_validate(
        draft_contract.without_metadata(output)
    ).model_dump(mode="json")
    output["target_duration_seconds"] = 90
    opening = output["scenes"][0]
    closing = deepcopy(opening)
    opening["cliffhanger"] = False
    opening["character_actions"] = [
        f"林夏翻到第{index}页，按住卷起的页角。" for index in range(1, 8)
    ]
    opening["dialogues"] = []
    opening["body_order"] = build_screenplay_body_order(7, 0)
    closing["scene_number"] = 2
    closing["scene_causality"].update({
        "caused_by_scene_number": 1,
        "causal_link": "核对记录之后，林夏转向持有钥匙的同伴追问。",
    })
    closing["character_actions"] = [
        f"林夏指向第{index}处划痕，把钥匙推回桌边。" for index in range(1, 9)
    ]
    closing["dialogues"] = [
        {**deepcopy(closing["dialogues"][0]), "text": f"第{index}处也相同，钥匙先放回桌上。"}
        for index in range(1, 26)
    ]
    closing["body_order"] = build_screenplay_body_order(8, 25)
    output["scenes"] = [opening, closing]
    return output


def _stored_draft(output):
    payload = {key: value for key, value in output.items() if key in DraftMasterScript.model_fields}
    payload.update(content_spec_id="content.silent.test", generation_strategy_id="strategy.silent.test")
    payload["scenes"] = [
        {**{key: value for key, value in scene.items() if key in DraftSceneCard.model_fields},
         "setting_hint": scene["setting"]}
        for scene in output["scenes"]
    ]
    return DraftMasterScript.model_validate(payload)


def test_silent_opening_passes_initial_contract_counts_and_editor_without_model_work(silent_opening_episode):
    source = silent_opening_episode
    original = deepcopy(source)
    generated = LLMGeneratedDraftMasterScript.model_validate(source)
    assert [len(scene.dialogues) for scene in generated.scenes] == [0, 25]
    assert generated.scenes[0].body_order == [f"action:{index}" for index in range(7)]
    assert 75 <= estimate_screenplay_duration(generated).total_seconds <= 115

    adapter = CountingMockLLMAdapter()
    service, _ = seed_dependencies(llm_adapter=adapter, repair_llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    accepted = service._ensure_mainland_draft_acceptance(
        original_prompt="按批准的两场蓝图执行，首场以动作完成，不新增对白。",
        output=deepcopy(source), strategy=strategy, target_characters=None,
        target_duration_seconds=90,
    )
    accepted = service._ensure_episode_production_counts(output=accepted, strategy=strategy)
    assert [len(scene["dialogues"]) for scene in accepted["scenes"]] == [0, 25]
    assert accepted["_meta"]["episode_production_counts_repaired"] is False
    assert adapter.structured_call_count == 0
    draft = _stored_draft(source)
    assert ScriptPostEditor.assess_source(draft).issues == ()
    assert source == original


def test_silent_scene_survives_body_and_editorial_patch_without_changing_other_scene(silent_opening_episode):
    source = silent_opening_episode
    original = deepcopy(source)
    patch = {
        "scenes": [{
            "scene_number": 1,
            "character_actions": [
                "林夏将卷起的页角压平，指尖停在日期下方。",
                *source["scenes"][0]["character_actions"][1:],
            ],
            "dialogues": [],
            "body_order": source["scenes"][0]["body_order"],
        }],
    }
    repaired = ScriptGenerationService._apply_mainland_body_repair_patch(
        source, LLMMainlandBodyRepairPatch.model_validate(patch),
    )
    LLMGeneratedDraftMasterScript.model_validate(repaired)
    assert repaired["scenes"][0]["dialogues"] == []
    assert repaired["scenes"][1] == original["scenes"][1]
    assert repaired["character_state_updates"] == original["character_state_updates"]

    draft = _stored_draft(source)
    edited = ScriptPostEditor._apply_patch(
        draft, LLMScriptEditorialPatch.model_validate(patch), expected_scene_numbers=[1],
    )
    assert [len(scene.dialogues) for scene in edited.scenes] == [0, 25]
    assert edited.scenes[0].dialogue_prompts == []
    assert edited.scenes[1] == draft.scenes[1]
    assert ScriptPostEditor.assess_source(edited).issues == ()
    assert source == original


@pytest.mark.parametrize("model", [SceneCard, LLMGeneratedSceneCard, LLMGeneratedSceneBodyPatch])
def test_silent_scene_keeps_required_body_and_dialogue_upper_bound(model, silent_opening_episode):
    scene = silent_opening_episode["scenes"][0]
    payload = {key: value for key, value in scene.items() if key in model.model_fields}
    assert model.model_validate(payload).dialogues == []
    assert model.model_json_schema()["properties"]["dialogues"]["minItems"] == 0
    assert "dialogues" in model.model_json_schema()["required"]
    with pytest.raises(ValidationError):
        model.model_validate({**payload, "character_actions": [], "body_order": []})
    with pytest.raises(ValidationError):
        model.model_validate({
            **payload, "dialogues": silent_opening_episode["scenes"][1]["dialogues"] * 2,
            "body_order": build_screenplay_body_order(7, 50),
        })
    if model is not SceneCard:  # Generated bodies retain strict authored references.
        with pytest.raises(ValidationError, match="body_order"):
            model.model_validate({**payload, "body_order": ["dialogue:0"]})


def test_silent_scene_support_does_not_relax_episode_count_or_runtime_gates(silent_opening_episode):
    assert not episode_production_counts_are_valid(0, 15)
    assert not episode_production_counts_are_valid(24, 15)
    assert not episode_production_counts_are_valid(36, 15)
    assert not episode_production_counts_are_valid(25, 14)
    short = deepcopy(silent_opening_episode)
    short["scenes"][1]["dialogues"] = [
        {**dialogue, "text": "放下。"} for dialogue in short["scenes"][1]["dialogues"]
    ]
    assessment = ScriptPostEditor.assess_source(_stored_draft(short))
    assert any("预计时长仅" in issue for issue in assessment.issues)
