import pytest
from pydantic import ValidationError

from app.modules.asset.models import AssetCreate


def build_payload() -> dict:
    return {
        "id": "scene.wedding_hall_v1",
        "asset_type": "scene",
        "title": "Luxury Wedding Hall",
        "summary": "Reusable high-drama wedding hall scene for reveal-heavy romance episodes.",
        "tags": [
            {
                "ontology_node_id": "scene.wedding_hall",
                "label": "Wedding Hall",
                "category": "Scene",
                "confidence": 0.96,
            },
            {
                "ontology_node_id": "hook.fake_marriage",
                "label": "Fake Marriage",
                "category": "Hook",
                "confidence": 0.91,
            },
        ],
        "content": {
            "text": "Grand wedding hall with a central aisle, floral arch, and audience reaction space.",
            "payload": {
                "visual_elements": ["floral arch", "aisle", "guest seating"],
            },
        },
        "applicable_platform_profile_ids": ["tiktok_v1"],
        "metadata": {"source": "manual_seed"},
        "is_active": True,
    }


def test_asset_create_accepts_valid_payload() -> None:
    model = AssetCreate.model_validate(build_payload())
    assert model.asset_type == "scene"
    assert len(model.tags) == 2


def test_asset_create_rejects_duplicate_tags() -> None:
    payload = build_payload()
    payload["tags"].append(payload["tags"][0].copy())

    with pytest.raises(ValidationError, match="Duplicate tag reference"):
        AssetCreate.model_validate(payload)


def test_asset_create_rejects_duplicate_platform_profiles() -> None:
    payload = build_payload()
    payload["applicable_platform_profile_ids"].append("tiktok_v1")

    with pytest.raises(ValidationError, match="Applicable platform profile ids must be unique"):
        AssetCreate.model_validate(payload)
