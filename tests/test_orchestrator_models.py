import pytest
from pydantic import ValidationError

from app.modules.orchestrator.models import OrchestrationPlanCreate, OrchestrationPlan


def build_create_payload() -> dict:
    return {
        "content_spec_id": "content_spec_001",
        "desired_scene_count": 3,
    }


def build_plan_payload() -> dict:
    return {
        "content_spec_id": "content_spec_001",
        "platform_profile_id": "tiktok_v1",
        "title": "Fake marriage cliffhanger short",
        "creative_hook": "The groom lifted the veil and froze.",
        "episode_goal": "Deliver a false wedding reveal and cliffhanger ending.",
        "target_duration_seconds": 45,
        "desired_scene_count": 3,
        "asset_requests": [
            {
                "request_id": "characters_core",
                "asset_type": "character",
                "reason": "Retrieve reusable character assets aligned with the story tags.",
                "required_tag_ids": ["genre.drama"],
                "optional_tag_ids": ["hook.fake_marriage"],
                "limit": 3,
            }
        ],
        "script_constraints": [
            {
                "source": "creative_brief",
                "rule": "Open with the hook immediately.",
                "priority": "high",
            }
        ],
        "scene_blueprints": [
            {
                "scene_number": 1,
                "purpose": "Establish the public-facing conflict immediately.",
                "target_emotion": "curiosity",
                "recommended_focus": "hook",
            },
            {
                "scene_number": 2,
                "purpose": "Increase pressure on the protagonist.",
                "target_emotion": "curiosity",
                "recommended_focus": "conflict",
            },
        ],
        "status": "ready",
        "blocking_issues": [],
    }


def test_orchestration_plan_create_accepts_valid_payload() -> None:
    model = OrchestrationPlanCreate.model_validate(build_create_payload())
    assert model.desired_scene_count == 3


def test_orchestration_plan_rejects_duplicate_scene_numbers() -> None:
    payload = build_plan_payload()
    payload["scene_blueprints"][1]["scene_number"] = 1

    with pytest.raises(ValidationError, match="Scene blueprint numbers must be unique"):
        OrchestrationPlan.model_validate(payload)


def test_orchestration_plan_create_rejects_invalid_scene_count() -> None:
    payload = build_create_payload()
    payload["desired_scene_count"] = 1

    with pytest.raises(ValidationError):
        OrchestrationPlanCreate.model_validate(payload)
