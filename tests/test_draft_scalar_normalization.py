from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest

from app.modules.script_engine.draft_scalar_normalization import (
    normalize_draft_scalar_contracts,
)
from app.script_delivery_contract import EndingMode


def test_scene_renumbering_is_shared_by_causality_ledgers_and_hook():
    output = {
        "language": "en",
        "scenes": [
            {"scene_number": "Scene 10", "character_actions": "Open the door.",
             "dialogues": [], "cliffhanger": "no"},
            {"scene_number": "unknown", "character_actions": [], "dialogues": [],
             "scene_causality": {"caused_by_scene_number": "Scene 10"}},
        ],
        "continuity_state_updates": {
            "entity_type": "item", "entity_key": "item.key",
            "evidence_scene_numbers": ["Scene 10", "unknown"],
        },
        "continuation_hook": {
            "hook_type": "reveal", "summary": "The key matches the lock.",
            "obligation": "Find the owner.", "response_scene_numbers": "Scene 10",
            "target_episode": "Episode 3",
        },
    }

    normalize_draft_scalar_contracts(output)

    assert [scene["scene_number"] for scene in output["scenes"]] == [1, 2]
    assert output["scenes"][0]["character_actions"] == ["Open the door."]
    assert output["scenes"][0]["cliffhanger"] is False
    assert output["scenes"][1]["scene_causality"]["caused_by_scene_number"] == 1
    assert output["continuity_state_updates"][0]["evidence_scene_numbers"] == [1, "unknown"]
    hook = output["continuation_hook"]
    assert hook["response_evidence_scene_numbers"] == [1]
    assert hook["target_payoff_episode"] == 3
    assert hook["ending_hook_summary"] == "The key matches the lock."


@pytest.mark.parametrize("ending_mode", list(EndingMode))
def test_partial_patch_preserves_absolute_scene_numbers_and_ending_flags(ending_mode):
    output = {
        "scenes": [
            {"scene_number": "Scene 7", "character_actions": [], "dialogues": [],
             "cliffhanger": False},
            {"scene_number": "Scene 8", "character_actions": [], "dialogues": [],
             "cliffhanger": False, "scene_causality": {"caused_by_scene_number": "Scene 7"}},
        ],
    }

    normalize_draft_scalar_contracts(output, ending_mode=ending_mode)

    assert [scene["scene_number"] for scene in output["scenes"]] == [7, 8]
    assert output["scenes"][1]["scene_causality"]["caused_by_scene_number"] == 7
    assert not any(scene["cliffhanger"] for scene in output["scenes"])


def test_named_character_states_use_expanded_characters_before_ledger_aliases():
    output = {
        "language": "en", "characters": ["Nina"],
        "scenes": [{"scene_number": "Scene 7", "character_actions": [], "dialogues": []}],
        "character_state_updates": {
            "Nina": "Nina guards the door.",
            "Unknown": "This name is absent from the cast.",
            "knowledge_states": {
                "knowledge_key": "fact.key_owner", "statement": "The key may be stolen.",
                "status": "suspected",
            },
            "evidence_scene_numbers": "Scene 7",
        },
    }

    normalize_draft_scalar_contracts(output)

    assert output["characters"][0]["name"] == "Nina"
    states = output["character_state_updates"]
    assert len(states) == 1
    assert states[0]["character_name"] == "Nina"
    assert states[0]["current_goal"] == "Nina guards the door."
    assert states[0]["evidence_scene_numbers"] == [7]
    assert states[0]["knowledge_states"][0]["status"] == "suspected"


@pytest.mark.parametrize("duration", [True, False, 75.5, "75.5 seconds", "unknown"])
def test_non_integer_duration_remains_available_to_schema_validation(duration):
    output = {"target_duration_seconds": duration}
    normalize_draft_scalar_contracts(output)
    assert output["target_duration_seconds"] == duration
    assert type(output["target_duration_seconds"]) is type(duration)


def test_approved_series_finale_overrides_legacy_string_hook():
    output = {
        "ending_mode": "serial_hook",
        "continuation_hook": "A legacy provider hook.",
        "_meta": {"model_pass_count": 2, "provider": "test"},
    }
    metadata = deepcopy(output["_meta"])
    normalize_draft_scalar_contracts(output, ending_mode=EndingMode.series_finale)
    assert output["continuation_hook"] is None
    assert output["_meta"] == metadata


def test_normalization_keeps_complete_body_and_explicit_hook_fields():
    output = {
        "tone": "SUSPENSEFUL", "target_duration_seconds": "75 seconds",
        "scenes": [{
            "scene_number": 1, "character_actions": ["Nina closes the drawer."],
            "dialogues": [{"character_name": "Nina", "text": "Leave it here.",
                           "intent": "protect evidence"}],
            "body_order": ["dialogue:0", "action:0"],
        }],
        "continuation_hook": {
            "ending_hook_type": "decision", "ending_hook_summary": "Keep the ledger.",
            "next_episode_obligation": "Identify the owner.",
            "summary": "Do not overwrite the approved summary.",
        },
    }
    body = deepcopy(output["scenes"])
    normalize_draft_scalar_contracts(output)
    assert output["tone"] == "suspenseful"
    assert output["target_duration_seconds"] == 75
    assert output["scenes"] == body
    assert output["continuation_hook"]["ending_hook_summary"] == "Keep the ledger."
    assert "summary" not in output["continuation_hook"]


@pytest.mark.parametrize("partial", [False, True])
@pytest.mark.parametrize("has_canonical_values", [False, True])
def test_hook_next_step_aliases_preserve_evidence_and_canonical_values(partial, has_canonical_values):
    output = {
        "continuation_hook": {
            "hook_type": "decision",
            "hook_text": "Mara takes the letter to its owner.",
            "next_required_step": "Ask the owner to identify the seal.",
            "payoff_target_episode": "Episode 8",
            "responds_to_episode": 6,
            "previous_hook_response": "Mara found the address inside the letter.",
            "response_evidence_scene_numbers": [2],
        },
    }
    if has_canonical_values:
        output["continuation_hook"].update({
            "next_episode_obligation": "Follow the already approved courier.",
            "target_payoff_episode": 9,
        })
    normalize_draft_scalar_contracts(output, partial=partial)

    from app.modules.master_script.models import ContinuationHookState

    hook = ContinuationHookState.model_validate(output["continuation_hook"])
    assert hook.next_episode_obligation == (
        "Follow the already approved courier." if has_canonical_values
        else "Ask the owner to identify the seal."
    )
    assert hook.target_payoff_episode == (9 if has_canonical_values else 8)
    assert hook.previous_hook_response == "Mara found the address inside the letter."
    assert hook.responds_to_episode == 6
    assert hook.response_evidence_scene_numbers == [2]
    assert hook.ending_hook_summary == "Mara takes the letter to its owner."


def test_concurrent_payloads_do_not_share_scene_maps_or_mutate_alias_policy():
    def normalize(scene_number):
        output = {
            "scenes": [{"scene_number": str(scene_number)}, {"scene_number": "unknown"}],
            "continuity_state_updates": {
                "entity_type": "person", "state_domain": "information",
                "evidence_scene_numbers": str(scene_number),
            },
        }
        normalize_draft_scalar_contracts(output)
        state = output["continuity_state_updates"][0]
        return state["entity_type"], state["state_domain"], state["evidence_scene_numbers"]

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(normalize, range(10, 30)))
    assert results == [("character", "knowledge", [1])] * 20
