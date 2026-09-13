from copy import deepcopy

import pytest

from app.modules.script_engine.generation_service import ScriptGenerationService
from app.script_delivery_contract import EndingMode


def _draft():
    return {
        "language": "en",
        "ending_mode": "series_finale",
        "characters": [
            {"name": name, "role": "Witness", "description": "A witness to the exchange.",
             "motivation": "Protect the original records."}
            for name in ("Nina", "Omar")
        ],
        "scenes": [
            {
                "scene_number": number,
                "character_actions": [action],
                "dialogues": [],
                "body_order": ["action:0"],
                "cliffhanger": False,
                "scene_causality": {
                    "goal": "Protect the records.", "conflict": "The door is locked.",
                    "outcome": "The records are secured.",
                    "caused_by_scene_number": predecessor,
                    "causal_link": link,
                },
            }
            for number, action, predecessor, link in (
                (7, "Nina hands Omar the records.", None, None),
                (9, "Nina closes the drawer.", 7, "The exchange puts the records at risk."),
            )
        ],
    }


def test_unchanged_full_draft_returns_original_without_adding_metadata():
    output = _draft()
    before = deepcopy(output)
    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)
    assert result is output
    assert result == before
    assert "_meta" not in result


@pytest.mark.parametrize("metadata", [None, "provider annotation", [], {"model_pass_count": 2}])
def test_reconciliation_preserves_source_and_metadata_shape(metadata):
    output = _draft()
    output["_meta"] = metadata
    output["relationship_state_updates"] = [{
        "source_character_name": "Nina", "target_character_name": "Unknown",
        "evidence_scene_numbers": [7],
    }]
    before = deepcopy(output)

    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)

    assert output == before
    assert result is not output
    assert result["scenes"] == before["scenes"]
    assert result["relationship_state_updates"] == []
    if isinstance(metadata, dict):
        assert result["_meta"] == {
            "model_pass_count": 2,
            "unsupported_relationship_updates_removed": 1,
            "draft_contract_locally_normalized": True,
        }
    else:
        assert result["_meta"] == metadata


@pytest.mark.parametrize("collection,key_fields,fields", [
    ("continuity_state_updates", ("entity_key", "state_domain"),
     {"entity_key": "item.records", "state_domain": "condition"}),
    ("story_line_updates", ("story_line_id",),
     {"story_line_id": "story.truth", "status": "active", "contribution_type": "progress"}),
    ("setup_payoff_updates", ("setup_payoff_ref",),
     {"setup_payoff_ref": "setup.records", "action": "reinforce", "status": "active"}),
])
def test_ledger_rows_keep_first_supported_key_and_ordered_real_scene_references(
    collection, key_fields, fields,
):
    output = _draft()
    first = {**fields, "evidence_scene_numbers": [9, True, 7, 9, 99, None, "7"]}
    missing_key = {**fields, key_fields[0]: "", "evidence_scene_numbers": [7]}
    output[collection] = [
        first,
        {**fields, "evidence_scene_numbers": [7]},
        {**fields, "evidence_scene_numbers": [99]},
        missing_key,
        "invalid row",
    ]
    before = deepcopy(output)

    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)

    assert output == before
    assert result[collection] == [{**fields, "evidence_scene_numbers": [9, 7]}]
    assert result["_meta"][f"unsupported_{collection}_removed"] == 4


def test_continuity_identity_includes_state_domain():
    output = _draft()
    output["continuity_state_updates"] = [
        {"entity_key": "item.records", "state_domain": domain, "evidence_scene_numbers": [7]}
        for domain in ("location", "ownership")
    ]
    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)
    assert result["continuity_state_updates"] == output["continuity_state_updates"]
    assert "_meta" not in result


def test_character_evidence_filters_visibility_before_claiming_unique_name():
    output = _draft()
    output["character_state_updates"] = [
        {"character_name": name, "evidence_scene_numbers": numbers}
        for name, numbers in (("Omar", [9]), ("Omar", [9, 7]), ("OMAR", [7]))
    ]
    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)
    assert len(result["character_state_updates"]) == 1
    assert result["character_state_updates"][0]["evidence_scene_numbers"] == [7]
    assert result["_meta"]["unsupported_character_state_updates_removed"] == 2


def test_legacy_required_state_fallback_does_not_supply_relationship_evidence():
    output = _draft()
    output["scenes"][0]["character_actions"] = ["Omar locks the cabinet."]
    knowledge = [{"knowledge_key": "fact.owner", "statement": "The owner may be Omar.",
                  "status": "suspected"}]
    output["character_state_updates"] = [{
        "character_name": "Nina", "evidence_scene_numbers": [99],
        "knowledge_states": knowledge,
    }]
    output["relationship_state_updates"] = [{
        "source_character_name": "Nina", "target_character_name": "Omar",
        "evidence_scene_numbers": [7],
    }]
    before = deepcopy(output)

    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)

    assert output == before
    assert result["scenes"][0]["character_actions"] == [
        "Omar locks the cabinet.", "Nina在场并观察局势。",
    ]
    state = result["character_state_updates"][0]
    assert state["character_name"] == "Nina"
    assert state["evidence_scene_numbers"] == [7]
    assert state["knowledge_states"] == knowledge
    assert state["knowledge_states"] is not knowledge
    assert result["relationship_state_updates"] == []
    assert result["_meta"]["unsupported_character_state_updates_removed"] == 1
    assert result["_meta"]["unsupported_relationship_updates_removed"] == 1


@pytest.mark.parametrize("life_status,expected_count", [("alive", 0), ("dead", 1)])
def test_death_transition_requires_retained_dead_character_state(life_status, expected_count):
    output = _draft()
    output["character_state_updates"] = [{
        "character_name": "Nina", "life_status": life_status, "evidence_scene_numbers": [7],
    }]
    output["continuity_state_updates"] = [{
        "entity_key": "character.nina", "entity_name": "Nina", "entity_type": "character",
        "state_domain": "life", "transition": "died", "evidence_scene_numbers": [7],
    }]
    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)
    assert len(result["continuity_state_updates"]) == expected_count
    assert result["_meta"].get("unsupported_continuity_death_updates_removed", 0) == 1 - expected_count


def test_relationships_require_both_names_in_every_referenced_scene_and_unique_pair():
    output = _draft()
    output["relationship_state_updates"] = [
        {"source_character_name": source, "target_character_name": target,
         "evidence_scene_numbers": evidence}
        for source, target, evidence in (
            ("Nina", "Omar", [7, 9]),
            ("Nina", "Omar", [7, 99]),
            ("Omar", "Nina", [7]),
            ("Nina", "Nina", [7]),
        )
    ]
    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)
    assert result["relationship_state_updates"] == [{
        "source_character_name": "Nina", "target_character_name": "Omar",
        "evidence_scene_numbers": [7],
    }]
    assert result["_meta"]["unsupported_relationship_updates_removed"] == 3


@pytest.mark.parametrize("response,expected_episode,expected_evidence", [
    (None, None, []),
    ("The records explain the missing payment.", 2, [9, 7]),
])
def test_hook_response_references_require_response_text(response, expected_episode, expected_evidence):
    output = _draft()
    output["continuation_hook"] = {
        "responds_to_episode": 2, "previous_hook_response": response,
        "response_evidence_scene_numbers": [9, 99, 7],
        "ending_hook_type": "resolution", "ending_hook_summary": "The records are secured.",
        "next_episode_obligation": "No further obligation.",
    }
    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)
    assert result["continuation_hook"]["responds_to_episode"] == expected_episode
    assert result["continuation_hook"]["response_evidence_scene_numbers"] == expected_evidence


def test_causality_uses_prior_scene_order_and_preserves_explicit_links():
    output = _draft()
    first, second = output["scenes"]
    first["scene_causality"].update(caused_by_scene_number=9, causal_link="A future event.")
    second["scene_causality"]["caused_by_scene_number"] = 99
    explicit_link = second["scene_causality"]["causal_link"]
    third = deepcopy(second)
    third["scene_number"] = 12
    third["scene_causality"].update(caused_by_scene_number=99, causal_link="")
    output["scenes"].append(third)
    before = deepcopy(output)

    result = ScriptGenerationService._normalize_mechanical_draft_contract(output)

    assert output == before
    causalities = [scene["scene_causality"] for scene in result["scenes"]]
    assert [item["caused_by_scene_number"] for item in causalities] == [None, 7, 9]
    assert causalities[0]["causal_link"] is None
    assert causalities[1]["causal_link"] == explicit_link
    assert causalities[2]["causal_link"]
    assert [scene["character_actions"] for scene in result["scenes"]] == [
        scene["character_actions"] for scene in before["scenes"]
    ]


@pytest.mark.parametrize("ending_mode", list(EndingMode))
def test_fragment_normalization_does_not_run_full_episode_reconciliation(ending_mode):
    output = {
        "scenes": [{"scene_number": 7, "character_actions": ["Nina closes the drawer."],
                    "dialogues": [], "cliffhanger": False}],
        "character_state_updates": [{"character_name": "Nina", "evidence_scene_numbers": [99]}],
    }
    result = ScriptGenerationService._normalize_draft_fragment_contract(output, ending_mode=ending_mode)
    assert result["character_state_updates"][0]["evidence_scene_numbers"] == [99]
    assert result["scenes"] == output["scenes"]
    assert "_meta" not in result


@pytest.mark.parametrize("scenes", [None, []])
def test_missing_scenes_preserve_authoritative_ending_for_bounded_repair(scenes):
    output = {"scenes": scenes, "ending_mode": "serial_hook"}
    result = ScriptGenerationService._normalize_mechanical_draft_contract(
        output, ending_mode=EndingMode.series_finale,
    )
    assert result == {"scenes": scenes, "ending_mode": "series_finale"}
    assert output["ending_mode"] == "serial_hook"
