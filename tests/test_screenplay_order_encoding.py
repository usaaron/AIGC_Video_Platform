import pytest

from app.modules.master_script.models import (
    LLMGeneratedSceneCard, LLMGeneratedSceneBodyPatch, normalize_screenplay_body_order,
)
from tests.test_master_script_models import _screenplay_scene


@pytest.mark.parametrize("model", [LLMGeneratedSceneCard, LLMGeneratedSceneBodyPatch])
def test_one_based_encoding_preserves_entry_read_and_response_order(model):
    payload = _screenplay_scene().model_dump()
    payload["character_actions"] = ["来访者推门进屋。", "来访者把已付款凭据交给店主。"]
    payload["dialogues"] = [
        {"character_name":"来访者", "intent":"喘着气", "text":"先别取消。"},
        {"character_name":"店主", "intent":"低头看单据", "text":"已经付过了？"},
    ]
    order = ["action_1", "dialogue_1", "action_2", "dialogue_2"]
    payload["body_order"] = order
    if model is LLMGeneratedSceneCard:
        payload.update(setting="店内受理台前", emotional_objective="店主从抗拒转向愿意查看凭据。", turning_point="店主看到付款凭据。",
            scene_causality={"goal":"阻止取消已付款的预订。", "conflict":"店主认为预订无法履行。", "outcome":"店主看到凭据后暂停取消。"})
    payload = {k:v for k,v in payload.items() if k in model.model_fields}
    result = model.model_validate(payload)
    assert result.body_order == ["action:0", "dialogue:0", "action:1", "dialogue:1"]
    assert result.character_actions == payload["character_actions"]
    assert [line.text for line in result.dialogues] == [line["text"] for line in payload["dialogues"]]
    assert order == ["action_1", "dialogue_1", "action_2", "dialogue_2"]


@pytest.mark.parametrize("order", [
    ["action_1","dialogue_1","action:1","dialogue:1"],
    ["action_1","dialogue_1","action_1","dialogue_2"],
    ["action_1","dialogue_1","action_3","dialogue_2"],
    ["action:0","dialogue:0"],
])
def test_ambiguous_generated_order_is_rejected_instead_of_rescheduling_body(order):
    with pytest.raises(ValueError, match="authored performance order"):
        normalize_screenplay_body_order(order, action_count=2, dialogue_count=2, allow_legacy_fallback=False)


def test_strict_wire_schema_exposes_zero_based_reference_encoding():
    for model in [LLMGeneratedSceneCard,LLMGeneratedSceneBodyPatch]:
        assert model.model_json_schema()["properties"]["body_order"]["items"]["pattern"] == r"^(?:action|dialogue):(?:0|[1-9]\d*)$"
