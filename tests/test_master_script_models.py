import pytest
from pydantic import ValidationError

from app.modules.master_script.models import (
    DraftMasterScript,
    MasterScriptCreate,
    MasterScriptFinalizeRequest,
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
