import pytest
from pydantic import ValidationError

from app.modules.master_script.models import (
    DraftMasterScript,
    LLMGeneratedDraftMasterScript,
    MasterScriptCreate,
    MasterScriptFinalizeRequest,
    SceneCausality,
)
from tests.test_master_script_service import build_finalize_request


def build_payload() -> dict:
    return {
        "content_spec_id": "content_spec_001",
        "title": "Fake marriage cliffhanger episode",
        "language": "en",
        "tone": "intense",
        "hook": "She said yes before she recognized the groom.",
        "synopsis": "A strategic fake marriage spirals into a public betrayal reveal.",
        "episode_goal": "Deliver a marriage twist and end on a social-status cliffhanger.",
        "target_duration_seconds": 45,
        "scenes": [
            {
                "scene_number": 1,
                "slug": "INT. CEREMONY HALL - DAY",
                "purpose": "Establish the public fake marriage setup.",
                "setting": "Ceremony Hall",
                "beat_summary": "The heroine agrees to a rushed public marriage.",
                "emotional_shift": "confusion_to_commitment",
                "cliffhanger": False,
                "dialogues": [
                    {
                        "character_name": "Nina",
                        "intent": "accept the arrangement",
                        "text": "Fine. I will marry you, but only for one month.",
                    }
                ],
            },
            {
                "scene_number": 2,
                "slug": "INT. CEREMONY STAGE - DAY",
                "purpose": "Reveal the twist and lock the cliffhanger.",
                "setting": "Ceremony Stage",
                "beat_summary": "The groom exposes the true reason for the marriage.",
                "emotional_shift": "relief_to_shock",
                "cliffhanger": True,
                "dialogues": [
                    {
                        "character_name": "Adrian",
                        "intent": "reveal hidden leverage",
                        "text": "You are not my wife, Nina. You are my witness.",
                    }
                ],
            },
        ],
        "qa_notes": ["Hook lands in the first scene."],
    }


def test_master_script_accepts_valid_payload() -> None:
    model = MasterScriptCreate.model_validate(build_payload())
    assert model.content_spec_id == "content_spec_001"
    assert model.scenes[-1].cliffhanger is True


def test_master_script_rejects_duplicate_scene_numbers() -> None:
    payload = build_payload()
    payload["scenes"][1]["scene_number"] = 1

    with pytest.raises(ValidationError, match="Scene numbers must be unique"):
        MasterScriptCreate.model_validate(payload)


def test_master_script_requires_final_cliffhanger() -> None:
    payload = build_payload()
    payload["scenes"][-1]["cliffhanger"] = False

    with pytest.raises(ValidationError, match="final scene must end with a cliffhanger"):
        MasterScriptCreate.model_validate(payload)


def build_draft_payload() -> dict:
    return {
        "content_spec_id": "content_spec_001",
        "generation_strategy_id": "strategy.tiktok.master_script.v1",
        "title": "Fake marriage draft",
        "language": "en",
        "tone": "intense",
        "hook": "The bride recognized the groom one second too late.",
        "synopsis": "A revenge marriage setup accelerates toward a public social cliffhanger.",
        "episode_goal": "Land a strong reveal and preserve sequel momentum.",
        "target_duration_seconds": 45,
        "scenes": [
            {
                "scene_number": 1,
                "slug": "SCENE 1 - HOOK",
                "purpose": "Open with the fake wedding promise.",
                "setting_hint": "Ceremony Hall",
                "beat_summary": "The heroine enters the ceremony under pressure.",
                "emotional_shift": "fear_to_control",
                "cliffhanger": False,
                "dialogue_prompts": [
                    "Advance the wedding setup clearly.",
                    "Express the target emotion: revenge.",
                ],
                "supporting_asset_ids": ["scene.wedding_set", "character.lead_pair"],
            },
            {
                "scene_number": 2,
                "slug": "SCENE 2 - CLIFFHANGER",
                "purpose": "Expose the revenge motive at the altar.",
                "setting_hint": "Ceremony Stage",
                "beat_summary": "The groom reframes the marriage as a public trap.",
                "emotional_shift": "control_to_suspense",
                "cliffhanger": True,
                "dialogue_prompts": [
                    "Advance the reveal beat clearly.",
                    "Express the target emotion: shock.",
                ],
                "supporting_asset_ids": ["scene.wedding_set", "character.lead_pair"],
            },
        ],
        "qa_notes": ["Review dialogue prompts before final script expansion."],
        "llm_metadata": {"provider": "mock"},
    }


def test_draft_master_script_accepts_valid_payload() -> None:
    model = DraftMasterScript.model_validate(build_draft_payload())
    assert model.generation_strategy_id == "strategy.tiktok.master_script.v1"
    assert model.scenes[-1].cliffhanger is True


def test_scene_causality_rejects_outcome_that_restates_goal() -> None:
    with pytest.raises(ValidationError, match="outcome must meaningfully differ"):
        SceneCausality.model_validate(
            {
                "goal": "The lead obtains access to the sealed archive.",
                "conflict": "A guard blocks the only entrance.",
                "outcome": "The lead obtains access to the sealed archive.",
            }
        )


def test_draft_master_script_accepts_complete_causal_chain() -> None:
    payload = build_draft_payload()
    payload["scenes"][0]["scene_causality"] = {
        "goal": "The lead must enter the restricted hearing.",
        "conflict": "Security rejects the lead's credentials.",
        "outcome": "The lead exposes a procedural error and gains conditional entry.",
    }
    payload["scenes"][1]["scene_causality"] = {
        "goal": "The lead must present evidence before access is revoked.",
        "conflict": "The chair challenges the evidence and starts removing the lead.",
        "outcome": "A witness confirms the evidence but names an unexpected sponsor.",
        "caused_by_scene_number": 1,
        "causal_link": "Conditional entry gives the lead one chance to present the evidence.",
    }

    model = DraftMasterScript.model_validate(payload)

    assert model.scenes[0].scene_causality.goal.startswith("The lead must enter")
    assert model.scenes[1].scene_causality.caused_by_scene_number == 1


def test_llm_generated_script_requires_later_scene_to_reference_earlier_outcome() -> None:
    payload = {
        "title": "The Sealed Hearing",
        "logline": "An investigator risks her career to expose a hidden sponsor.",
        "synopsis": "A denied investigator forces her way into a hearing and uncovers a larger scheme.",
        "hook": "They erased her name from the witness list while she was standing outside.",
        "target_audience": "Short-form mystery viewers",
        "target_platform": "short_video_test",
        "language": "en",
        "tone": "suspenseful",
        "episode_goal": "Expose the first layer of the scheme and create a consequential question.",
        "target_duration_seconds": 45,
        "characters": [
            {
                "name": "Iris Vale",
                "role": "investigator",
                "description": "A methodical investigator whose career is already under review.",
                "motivation": "Prove that evidence was removed before the public hearing.",
            }
        ],
        "scenes": [
            {
                "scene_number": 1,
                "slug": "SCENE 1 - LOCKED DOOR",
                "purpose": "Get inside the hearing before evidence is sealed.",
                "setting": "Administrative corridor",
                "beat_summary": "Security rejects Iris until she identifies a filing violation.",
                "emotional_shift": "pressure_to_resolve",
                "emotional_objective": "Turn exclusion into a narrow opportunity.",
                "character_actions": ["Iris records the rejection and cites the public-access rule."],
                "turning_point": "The clerk grants Iris one minute inside the hearing.",
                "scene_causality": {
                    "goal": "Iris must enter the hearing before the evidence is sealed.",
                    "conflict": "Security rejects her credentials and begins closing the doors.",
                    "outcome": "Iris wins one minute to present the evidence in public.",
                },
                "cliffhanger": False,
                "dialogues": [
                    {
                        "character_name": "Iris Vale",
                        "intent": "force procedural access",
                        "text": "Record that refusal. The hearing is still public for one more minute.",
                    }
                ],
            },
            {
                "scene_number": 2,
                "slug": "SCENE 2 - THE SPONSOR",
                "purpose": "Present the evidence before the minute expires.",
                "setting": "Public hearing room",
                "beat_summary": "A witness confirms the deletion but identifies Iris's mentor as sponsor.",
                "emotional_shift": "resolve_to_shock",
                "emotional_objective": "Make the victory reveal a more personal threat.",
                "character_actions": ["Iris places the timestamped record on the public display."],
                "turning_point": "The witness names Iris's mentor as the person who ordered the deletion.",
                "scene_causality": {
                    "goal": "Iris must authenticate the evidence before her minute ends.",
                    "conflict": "The chair disputes the timestamp and orders security forward.",
                    "outcome": "The evidence is confirmed, but it implicates Iris's trusted mentor.",
                },
                "cliffhanger": True,
                "dialogues": [
                    {
                        "character_name": "Witness",
                        "intent": "name the hidden sponsor",
                        "text": "The deletion order came from the person who trained you.",
                    }
                ],
            },
        ],
        "next_episode_question": "Why did Iris's mentor erase the evidence before the hearing?",
    }

    with pytest.raises(ValidationError, match="must reference an earlier scene outcome"):
        LLMGeneratedDraftMasterScript.model_validate(payload)


def test_draft_master_script_requires_final_cliffhanger() -> None:
    payload = build_draft_payload()
    payload["scenes"][-1]["cliffhanger"] = False

    with pytest.raises(
        ValidationError, match="final draft scene must end with a cliffhanger"
    ):
        DraftMasterScript.model_validate(payload)


def test_master_script_finalize_request_accepts_valid_payload() -> None:
    request, _ = build_finalize_request()
    model = MasterScriptFinalizeRequest.model_validate(request.model_dump())
    assert model.script_generation_draft_run.generation_strategy_version == "v1"
    assert model.speaker_name_cycle == ["Heroine", "Counterpart"]


def test_master_script_finalize_request_rejects_duplicate_speaker_names() -> None:
    request, _ = build_finalize_request()
    payload = request.model_dump()
    payload["speaker_name_cycle"] = ["Heroine", "Heroine"]

    with pytest.raises(ValidationError, match="Speaker names must be unique"):
        MasterScriptFinalizeRequest.model_validate(payload)
