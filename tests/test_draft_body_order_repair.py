from copy import deepcopy
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine import draft_contract
from app.modules.script_engine.generation_service import ScriptGenerationService
from tests.test_script_generation_service import _mainland_single_scene_payload, seed_dependencies


@pytest.fixture
def missing_order_payload():
    source = ScriptGenerationService._normalize_mechanical_draft_contract(
        _mainland_single_scene_payload(action="林夏打开记录本核对时间。")
    )
    source = LLMGeneratedDraftMasterScript.model_validate(
        draft_contract.without_metadata(source)
    ).model_dump(mode="json")
    scene = source["scenes"][0]
    scene["character_actions"] = [f"林夏核对第{i + 1}条记录。" for i in range(17)]
    scene["dialogues"] = [
        {**deepcopy(scene["dialogues"][0]), "text": f"第{i + 1}条记录已经核对。"}
        for i in range(25)
    ]
    # Mirrors the observed 17-action / 25-line episode: only action:6 is absent.
    scene["body_order"] = [
        "action:0", "action:1", "action:2", "dialogue:0", "dialogue:1",
        "action:3", "dialogue:2", "dialogue:3", "action:4", "dialogue:4",
        "dialogue:5", "action:5", "dialogue:6", "action:7", "dialogue:7",
        "dialogue:8", "dialogue:9", "action:8", "dialogue:10", "dialogue:11",
        "action:9", "action:10", "dialogue:12", "dialogue:13", "action:11",
        "dialogue:14", "dialogue:15", "action:12", "dialogue:16", "action:13",
        "dialogue:18", "dialogue:21", "action:14", "dialogue:17", "dialogue:22",
        "action:15", "dialogue:19", "dialogue:20", "dialogue:23", "dialogue:24", "action:16",
    ]
    return source


def _error(source):
    with pytest.raises(ValidationError) as caught:
        LLMGeneratedDraftMasterScript.model_validate(draft_contract.without_metadata(source))
    return caught.value


def _patch(source):
    order = list(source["scenes"][0]["body_order"])
    order.insert(order.index("action:7"), "action:6")
    return {"scenes": [{"scene_number": 1, "body_order": order}]}


def test_order_only_patch_preserves_every_body_and_ledger_field(missing_order_payload):
    source = missing_order_payload
    before = deepcopy(source)
    context = draft_contract.missing_body_order_repair_context(source, _error(source))
    assert context is not None
    assert context[0]["missing_references"] == ["action:6"]
    result = draft_contract.merge_body_order_repair_fragment(source, _patch(source), context)
    assert result is not None
    LLMGeneratedDraftMasterScript.model_validate(result)
    expected = deepcopy(source)
    expected["scenes"][0]["body_order"] = _patch(source)["scenes"][0]["body_order"]
    assert result == expected
    assert source == before
    assert len(json.dumps(_patch(source))) < 1000


def test_multiple_order_patches_leave_unrequested_scene_unchanged(missing_order_payload):
    source = missing_order_payload
    complete_order = _patch(source)["scenes"][0]["body_order"]
    for number in (2, 3):
        scene = deepcopy(source["scenes"][0])
        scene["scene_number"] = number
        scene["scene_causality"].update({
            "caused_by_scene_number": number - 1,
            "causal_link": "上一场发现新线索，因此接着核对材料。",
        })
        if number == 2:
            scene["body_order"] = list(complete_order)
        source["scenes"].append(scene)
    before = deepcopy(source)
    context = draft_contract.missing_body_order_repair_context(source, _error(source))
    assert [scene["scene_number"] for scene in context] == [1, 3]
    patch = {"scenes": [
        {"scene_number": number, "body_order": list(complete_order)} for number in (3, 1)
    ]}
    result = draft_contract.merge_body_order_repair_fragment(source, patch, context)
    LLMGeneratedDraftMasterScript.model_validate(result)
    assert result["scenes"][1] == before["scenes"][1]
    assert source == before
    patch["scenes"][0]["scene_number"] = 2
    assert draft_contract.merge_body_order_repair_fragment(source, patch, context) is None


@pytest.mark.parametrize("fault", ["reorder", "omit", "duplicate", "out_of_range", "body_text", "other_scene", "duplicate_scene", "root_field", "non_string"])
def test_order_patch_rejects_drift_and_invalid_references(missing_order_payload, fault):
    source = missing_order_payload
    context = draft_contract.missing_body_order_repair_context(source, _error(source))
    patch = _patch(source)
    scene = patch["scenes"][0]
    if fault == "reorder":
        scene["body_order"][0:2] = reversed(scene["body_order"][0:2])
    elif fault == "omit":
        scene["body_order"].remove("action:6")
    elif fault == "duplicate":
        scene["body_order"].append("action:6")
    elif fault == "out_of_range":
        scene["body_order"][0] = "action:99"
    elif fault == "body_text":
        scene["character_actions"] = ["改写正文。"]
    elif fault == "other_scene":
        scene["scene_number"] = 2
    elif fault == "duplicate_scene":
        patch["scenes"].append(deepcopy(scene))
    elif fault == "root_field":
        patch["title"] = "改写标题"
    elif fault == "non_string":
        scene["body_order"].append(None)
    assert draft_contract.merge_body_order_repair_fragment(source, patch, context) is None


@pytest.mark.parametrize("fault", ["mixed_encoding", "duplicate", "out_of_range", "hidden_scene_field", "root_field"])
def test_non_order_or_ambiguous_errors_keep_generic_repair(missing_order_payload, fault):
    source = missing_order_payload
    scene = source["scenes"][0]
    if fault == "mixed_encoding":
        scene["body_order"][0] = "action_1"
    elif fault == "duplicate":
        scene["body_order"].append("action:0")
    elif fault == "out_of_range":
        scene["body_order"][0] = "action:99"
    elif fault == "hidden_scene_field":
        scene["emotional_objective"] = ""
    elif fault == "root_field":
        source["unexpected"] = "must stay invalid"
    assert draft_contract.missing_body_order_repair_context(source, _error(source)) is None


def test_service_repairs_only_order_in_one_existing_model_pass(missing_order_payload):
    source = missing_order_payload
    before = deepcopy(source)
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    calls = []

    def repair(prompt, **kwargs):
        calls.append((prompt, kwargs))
        return {**_patch(source), "_meta": {"adapter_model_pass_count": 1}}

    def no_fallback(*args, **kwargs):
        pytest.fail("A valid order-only patch must not add a fallback model pass")

    service._repair_llm_adapter = SimpleNamespace(generate_structured_output_stream=repair)
    service._contract_fallback_llm_adapter = SimpleNamespace(generate_structured_output=no_fallback)
    result = service._ensure_valid_draft_contract(output=source, strategy=strategy)
    assert len(calls) == 1
    prompt, kwargs = calls[0]
    schema = kwargs["output_schema"]
    assert schema["title"] == "DraftBodyOrderRepairPatch"
    assert "$defs" not in schema
    assert set(schema["properties"]["scenes"]["items"]["properties"]) == {"scene_number", "body_order"}
    assert "character_state_updates" not in prompt
    assert "missing_references" in prompt
    assert kwargs["strategy"] == service._with_repair_output_budget(strategy)
    assert result["_meta"]["draft_contract_body_order_repaired"] is True
    assert result["_meta"]["draft_contract_model_pass_count"] == 1
    assert result["_meta"]["draft_contract_fragment_merged"] is True
    assert draft_contract.without_metadata(result) == {
        **source, "scenes": [{**source["scenes"][0], "body_order": _patch(source)["scenes"][0]["body_order"]}]
    }
    assert source == before


def test_service_rejected_order_patch_uses_existing_bounded_fallback(missing_order_payload):
    source = missing_order_payload
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    calls = []

    def repair(prompt, **kwargs):
        calls.append("patch")
        return {"scenes": [{"scene_number": 1, "body_order": ["action:0"], "character_actions": ["不能替换正文。"]}]}

    def fallback(prompt, **kwargs):
        calls.append("fallback")
        assert "不能替换正文" not in prompt
        complete = deepcopy(source)
        complete["scenes"][0]["body_order"] = _patch(source)["scenes"][0]["body_order"]
        return complete

    service._repair_llm_adapter = SimpleNamespace(generate_structured_output_stream=repair)
    service._contract_fallback_llm_adapter = SimpleNamespace(generate_structured_output=fallback)
    result = service._ensure_valid_draft_contract(output=source, strategy=strategy)
    assert calls == ["patch", "fallback"]
    assert result["_meta"]["draft_contract_model_pass_count"] == 2
    assert result["_meta"].get("draft_contract_body_order_repaired") is not True
    assert result["scenes"][0]["character_actions"] == source["scenes"][0]["character_actions"]
