from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.modules.master_script.models import DraftMasterScript, LLMGeneratedDraftMasterScript
from app.modules.script_engine import draft_contract
from tests.test_master_script_models import build_draft_payload


def test_envelope_uses_best_coverage_and_preserves_metadata_without_changing_source():
    source = {
        "title": "Outer placeholder",
        "data": {"output": {
            "title": "Actual episode",
            "scenes": [{"scene_number": 1}],
            "characters": [],
            "_meta": {"provider": "fallback"},
        }},
        "_meta": {"provider": "primary", "model_pass_count": 2},
    }
    before = deepcopy(source)

    result = draft_contract.unwrap_response_envelope(source)

    assert result["title"] == "Actual episode"
    assert result["_meta"] == {
        "provider": "fallback", "model_pass_count": 2,
        "draft_response_envelope_unwrapped": True,
    }
    result["scenes"][0]["scene_number"] = 2
    assert source == before


def test_envelope_keeps_root_on_ties_and_stops_at_three_levels():
    source = {"title": "Root", "data": {"title": "Nested"}}
    assert draft_contract.unwrap_response_envelope(source) == source
    too_deep = {"data": {"data": {"data": {"data": {"title": "Deep"}}}}}
    assert draft_contract.unwrap_response_envelope(too_deep) == too_deep


def test_metadata_projection_keeps_unknown_fields_for_schema_validation():
    source = {"title": "Episode", "unexpected": "must not disappear", "_meta": {}}
    assert draft_contract.without_metadata(source) == {
        "title": "Episode", "unexpected": "must not disappear",
    }
    assert "_meta" in source


def test_contract_schema_requires_selected_fields_and_keeps_references():
    schema = draft_contract.build_contract_repair_schema(["scenes", "setup_payoff_updates"])
    assert schema["required"] == ["scenes", "setup_payoff_updates"]
    assert set(schema["properties"]) == set(schema["required"])
    assert schema["additionalProperties"] is False
    for prop in schema["properties"].values():
        assert "default" not in prop
        reference = prop["items"]["$ref"].split("/")[-1]
        assert reference in schema["$defs"]
    schema["properties"]["scenes"]["items"]["$ref"] = "broken"
    rebuilt = draft_contract.build_contract_repair_schema(["scenes"])
    assert rebuilt["properties"]["scenes"]["items"]["$ref"] != "broken"


def test_nested_validation_errors_select_root_repair_fields_in_schema_order():
    with pytest.raises(ValidationError) as caught:
        LLMGeneratedDraftMasterScript.model_validate({"scenes": [{}], "characters": [{}]})
    paths = draft_contract.validation_error_paths(caught.value)
    assert "scenes.0.scene_number" in paths
    assert "characters.0.name" in paths
    assert len(paths) == len(set(paths)) <= 24
    fields = draft_contract.contract_repair_fields(caught.value)
    assert "characters" in fields and "scenes" in fields
    assert fields == [field for field in LLMGeneratedDraftMasterScript.model_fields if field in fields]


def test_scene_body_fragment_preserves_other_scenes_and_protected_fields():
    source = {
        "ending_mode": "season_finale_closed",
        "scenes": [
            {"scene_number": 1, "setting": "Archive", "purpose": "Find the ledger",
             "character_actions": ["Open the drawer."], "dialogues": []},
            {"scene_number": 2, "setting": "Hallway", "character_actions": ["Leave."]},
        ],
        "_meta": {"model_pass_count": 1},
    }
    before = deepcopy(source)
    result = draft_contract.merge_contract_repair_fragment(source, {
        "scene_number": 1, "character_actions": ["Unlock the drawer."],
        "_meta": {"model_pass_count": 99},
    })
    assert result["scenes"][0] == {
        **source["scenes"][0], "character_actions": ["Unlock the drawer."],
    }
    assert result["scenes"][1] == source["scenes"][1]
    assert result["ending_mode"] == source["ending_mode"]
    assert result["_meta"] == source["_meta"]
    assert source == before


@pytest.mark.parametrize("patch", [{}, {"_meta": {}}, {"unknown": "value"}])
def test_unrecognized_fragment_cannot_replace_source(patch):
    source = {"title": "Keep this title"}
    assert draft_contract.merge_contract_repair_fragment(source, patch) is None
    assert source == {"title": "Keep this title"}


def test_nested_root_repair_preserves_omitted_siblings_and_explicit_replacements():
    source = {"continuation_hook": {
        "ending_hook_summary": "", "next_episode_obligation": "Verify the sealed register.",
        "response_evidence_scene_numbers": [1, 2], "hook_payoff_target_episode": 18,
    }, "scenes": [{"scene_number": 1, "character_actions": ["Open the register."]}]}
    before = deepcopy(source)
    patch = {"continuation_hook": {"ending_hook_summary": "The register names a second witness.",
                                    "response_evidence_scene_numbers": [2], "hook_payoff_target_episode": None}}
    result = draft_contract.merge_contract_repair_fragment(source, patch)
    assert result["continuation_hook"]["next_episode_obligation"] == source["continuation_hook"]["next_episode_obligation"]
    assert result["continuation_hook"]["response_evidence_scene_numbers"] == [2]
    assert result["continuation_hook"]["hook_payoff_target_episode"] is None
    assert result["scenes"] == source["scenes"]
    result["scenes"][0]["character_actions"].append("Wait.")
    assert source == before
    assert patch["continuation_hook"]["response_evidence_scene_numbers"] == [2]


def test_body_and_style_locks_share_protected_fields_but_differ_on_dialogue():
    payload = build_draft_payload()
    payload["scenes"][0]["dialogues"] = [{
        "character_name": "Nina", "intent": "protect evidence", "text": "Leave the ledger here.",
    }]
    source = DraftMasterScript.model_validate(payload)
    before = source.model_dump()
    changed = source.model_copy(deep=True)
    changed.scenes[0].character_actions = ["Close the drawer."]
    assert draft_contract.body_lock_signature(changed) == draft_contract.body_lock_signature(source)
    assert draft_contract.body_lock_signature(changed, allow_dialogue_changes=False) == (
        draft_contract.body_lock_signature(source, allow_dialogue_changes=False)
    )
    changed.scenes[0].dialogues = []
    assert draft_contract.body_lock_signature(changed) == draft_contract.body_lock_signature(source)
    assert draft_contract.body_lock_signature(changed, allow_dialogue_changes=False) != (
        draft_contract.body_lock_signature(source, allow_dialogue_changes=False)
    )
    changed.scenes[0].setting_hint = "New location"
    assert draft_contract.body_lock_signature(changed) != draft_contract.body_lock_signature(source)
    assert source.model_dump() == before


@pytest.mark.parametrize("source_meta,target_meta,expected", [
    ({"provider": "old", "elapsed_ms": 10}, {"provider": "new"}, {"provider": "new", "elapsed_ms": 10}),
    (None, {"provider": "new"}, {"provider": "new"}),
    ({"provider": "old"}, "invalid", {"provider": "old"}),
])
def test_metadata_merge_preserves_target_precedence(source_meta, target_meta, expected):
    source = {"_meta": source_meta}
    target = {"title": "Episode", "_meta": target_meta}
    before = deepcopy(source)
    draft_contract.merge_output_metadata(source=source, target=target)
    assert target == {"title": "Episode", "_meta": expected}
    assert source == before
