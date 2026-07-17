import pytest
from pydantic import ValidationError

from app.modules.content_spec.models import ContentSpecCreate


def build_payload() -> dict:
    return {
        "title": "Campus revenge romance with cliffhanger",
        "audience_goal": {
            "summary": "Hook young romance viewers in the first 3 seconds",
            "priority": "primary",
            "success_metric": "3-second view rate",
        },
        "commercial_goal": {
            "summary": "Validate whether the concept can support a later paid arc",
            "priority": "primary",
            "success_metric": "CTR to follow-up profile link",
        },
        "platform_goal": {
            "platform_profile_id": "tiktok_v1",
            "objective": "Maximize completion rate",
            "target_duration_seconds": 45,
            "target_aspect_ratio": "9:16",
        },
        "story_goal": "Deliver a betrayal reveal and end on a reversal cliffhanger.",
        "quality_level": "high",
        "budget_level": "medium",
        "tags": [
            {
                "ontology_node_id": "genre.romance",
                "label": "Romance",
                "category": "Genre",
                "confidence": 0.97,
            },
            {
                "ontology_node_id": "emotion.revenge",
                "label": "Revenge",
                "category": "Emotion",
                "confidence": 0.92,
            },
        ],
        "creative_brief": {
            "hook": "She caught her boyfriend proposing to her best friend.",
            "tone": "melodramatic",
            "pacing": "fast",
            "target_emotion": "shock",
            "asset_constraints": [
                "Prefer reusable school-uniform character assets",
            ],
            "generation_notes": [
                "Keep scene count under 4 for fast iteration.",
            ],
        },
        "metadata": {
            "source": "manual_seed",
        },
    }


def test_content_spec_create_accepts_valid_payload() -> None:
    model = ContentSpecCreate.model_validate(build_payload())
    assert model.platform_goal.platform_profile_id == "tiktok_v1"
    assert len(model.tags) == 2


def test_content_spec_create_rejects_duplicate_tags() -> None:
    payload = build_payload()
    payload["tags"].append(payload["tags"][0].copy())

    with pytest.raises(ValidationError, match="Duplicate tag reference"):
        ContentSpecCreate.model_validate(payload)


def test_content_spec_create_rejects_premium_low_budget_combo() -> None:
    payload = build_payload()
    payload["quality_level"] = "premium"
    payload["budget_level"] = "low"

    with pytest.raises(
        ValidationError,
        match="Premium quality cannot be paired with a low budget level",
    ):
        ContentSpecCreate.model_validate(payload)
