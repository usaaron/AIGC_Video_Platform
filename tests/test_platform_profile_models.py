import pytest
from pydantic import ValidationError

from app.modules.platform_profile.models import PlatformProfileCreate


def build_payload() -> dict:
    return {
        "id": "tiktok_v1",
        "platform_name": "TikTok",
        "version": "v1",
        "content_mode": "short_video",
        "primary_regions": ["US", "CA"],
        "supported_aspect_ratios": ["9:16"],
        "recommendation_rules": [
            {
                "code": "fast_hook",
                "title": "Fast Hook",
                "summary": "The opening moments should establish the core conflict quickly.",
            }
        ],
        "creator_rewards": [
            {
                "code": "retention_signal",
                "title": "Retention Signal",
                "summary": "Completion and rewatch tendencies can influence downstream monetization potential.",
            }
        ],
        "ai_policies": [
            {
                "code": "ai_disclosure",
                "title": "AI Disclosure",
                "summary": "AI-assisted content must remain compatible with platform labeling expectations.",
            }
        ],
        "community_guidelines": [
            {
                "code": "safety_compliance",
                "title": "Safety Compliance",
                "summary": "Content should avoid prohibited harmful or abusive framing.",
            }
        ],
        "best_practices": [
            {
                "code": "vertical_native",
                "title": "Vertical Native",
                "summary": "Native vertical framing should be preserved through production.",
            }
        ],
        "publishing_strategy": {
            "recommended_posts_per_day": 3,
            "preferred_time_windows": ["11:00-13:00", "18:00-21:00"],
            "notes": ["Prioritize consistent daily cadence over burst posting."],
        },
        "metadata": {"source": "manual_seed"},
    }


def test_platform_profile_accepts_valid_payload() -> None:
    model = PlatformProfileCreate.model_validate(build_payload())
    assert model.id == "tiktok_v1"
    assert model.publishing_strategy.recommended_posts_per_day == 3


def test_platform_profile_rejects_duplicate_rule_codes() -> None:
    payload = build_payload()
    payload["recommendation_rules"].append(payload["recommendation_rules"][0].copy())

    with pytest.raises(ValidationError, match="Rule codes must be unique"):
        PlatformProfileCreate.model_validate(payload)


def test_platform_profile_rejects_duplicate_time_windows() -> None:
    payload = build_payload()
    payload["publishing_strategy"]["preferred_time_windows"].append("11:00-13:00")

    with pytest.raises(ValidationError, match="Preferred time windows must be unique"):
        PlatformProfileCreate.model_validate(payload)
