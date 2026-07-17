import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


def build_payload(profile_id: str = "tiktok_v1") -> dict:
    return {
        "id": profile_id,
        "platform_name": "TikTok",
        "version": "v1",
        "content_mode": "short_video",
        "primary_regions": ["US"],
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
                "summary": "Completion and rewatch tendencies can influence monetization fit.",
            }
        ],
        "ai_policies": [
            {
                "code": "ai_disclosure",
                "title": "AI Disclosure",
                "summary": "AI-assisted output should match the platform's disclosure expectations.",
            }
        ],
        "community_guidelines": [
            {
                "code": "safety_compliance",
                "title": "Safety Compliance",
                "summary": "Avoid prohibited harmful or abusive content patterns.",
            }
        ],
        "best_practices": [
            {
                "code": "vertical_native",
                "title": "Vertical Native",
                "summary": "Keep the creative optimized for vertical mobile playback.",
            }
        ],
        "publishing_strategy": {
            "recommended_posts_per_day": 2,
            "preferred_time_windows": ["12:00-14:00"],
            "notes": ["Prefer consistent testing windows."],
        },
        "metadata": {"source": "api_test"},
    }


@pytest.mark.anyio
async def test_create_platform_profile() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/platform-profiles",
            json=build_payload("tiktok_v1_create"),
        )
    assert response.status_code == 201
    assert response.json()["data"]["id"] == "tiktok_v1_create"


@pytest.mark.anyio
async def test_get_platform_profile_by_id() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        create_response = await client.post(
            "/platform-profiles",
            json=build_payload("tiktok_v1_get"),
        )
        created_id = create_response.json()["data"]["id"]
        response = await client.get(f"/platform-profiles/{created_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == created_id


@pytest.mark.anyio
async def test_create_platform_profile_returns_409_for_duplicate_id() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        payload = build_payload("tiktok_v1_duplicate")
        first_response = await client.post("/platform-profiles", json=payload)
        second_response = await client.post("/platform-profiles", json=payload)
    assert first_response.status_code == 201
    assert second_response.status_code == 409
