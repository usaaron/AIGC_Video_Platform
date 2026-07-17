import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


def build_ontology_node_payload(node_id: str, label: str, category: str) -> dict:
    return {
        "id": node_id,
        "label": label,
        "category": category,
        "description": f"Controlled ontology node for {label}.",
        "aliases": [],
        "is_active": True,
    }


def build_platform_profile_payload(profile_id: str) -> dict:
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


def build_payload(profile_id: str) -> dict:
    return {
        "title": "Fake marriage cliffhanger short",
        "audience_goal": {
            "summary": "Capture romance-drama viewers quickly",
            "priority": "primary",
            "success_metric": "Watch-through rate",
        },
        "commercial_goal": {
            "summary": "Test whether the concept can support serialized monetization",
            "priority": "secondary",
            "success_metric": "Profile visits",
        },
        "platform_goal": {
            "platform_profile_id": profile_id,
            "objective": "Drive rewatches",
            "target_duration_seconds": 38,
            "target_aspect_ratio": "9:16",
        },
        "story_goal": "Create a false wedding reveal with a strong episode-ending twist.",
        "quality_level": "medium",
        "budget_level": "medium",
        "tags": [
            {
                "ontology_node_id": "genre.drama",
                "label": "Drama",
                "category": "Genre",
                "confidence": 0.95,
            },
            {
                "ontology_node_id": "hook.fake_marriage",
                "label": "Fake Marriage",
                "category": "Hook",
                "confidence": 0.89,
            },
        ],
        "creative_brief": {
            "hook": "The groom lifted the veil and froze.",
            "tone": "intense",
            "pacing": "fast",
            "target_emotion": "curiosity",
            "asset_constraints": [],
            "generation_notes": [
                "Favor existing wedding hall scene assets.",
            ],
        },
        "metadata": {
            "source": "api_test",
        },
    }


@pytest.mark.anyio
async def test_create_content_spec() -> None:
    profile_id = "tiktok_v1_content_create"
    drama_node_id = "genre.drama_create"
    hook_node_id = "hook.fake_marriage_create"
    payload = build_payload(profile_id)
    payload["tags"][0]["ontology_node_id"] = drama_node_id
    payload["tags"][1]["ontology_node_id"] = hook_node_id
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_response = await client.post(
            "/platform-profiles",
            json=build_platform_profile_payload(profile_id),
        )
        assert profile_response.status_code == 201
        for node_id, label, category in (
            (drama_node_id, "Drama", "Genre"),
            (hook_node_id, "Fake Marriage", "Hook"),
        ):
            ontology_response = await client.post(
                "/ontology-nodes",
                json=build_ontology_node_payload(node_id, label, category),
            )
            assert ontology_response.status_code == 201
        response = await client.post("/content-specs", json=payload)
    assert response.status_code == 201

    data = response.json()["data"]
    assert data["platform_goal"]["platform_profile_id"] == profile_id
    assert data["status"] == "draft"


@pytest.mark.anyio
async def test_get_content_spec_by_id() -> None:
    profile_id = "tiktok_v1_content_get"
    drama_node_id = "genre.drama_get"
    hook_node_id = "hook.fake_marriage_get"
    payload = build_payload(profile_id)
    payload["tags"][0]["ontology_node_id"] = drama_node_id
    payload["tags"][1]["ontology_node_id"] = hook_node_id
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_response = await client.post(
            "/platform-profiles",
            json=build_platform_profile_payload(profile_id),
        )
        assert profile_response.status_code == 201
        for node_id, label, category in (
            (drama_node_id, "Drama", "Genre"),
            (hook_node_id, "Fake Marriage", "Hook"),
        ):
            ontology_response = await client.post(
                "/ontology-nodes",
                json=build_ontology_node_payload(node_id, label, category),
            )
            assert ontology_response.status_code == 201
        create_response = await client.post(
            "/content-specs",
            json=payload,
        )
        created_id = create_response.json()["data"]["id"]
        response = await client.get(f"/content-specs/{created_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == created_id


@pytest.mark.anyio
async def test_create_content_spec_returns_422_for_invalid_payload() -> None:
    profile_id = "tiktok_v1_content_invalid_payload"
    drama_node_id = "genre.drama_invalid"
    hook_node_id = "hook.fake_marriage_invalid"
    payload = build_payload(profile_id)
    payload["tags"][0]["ontology_node_id"] = drama_node_id
    payload["tags"][1]["ontology_node_id"] = hook_node_id
    payload["tags"] = []

    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_response = await client.post(
            "/platform-profiles",
            json=build_platform_profile_payload(profile_id),
        )
        assert profile_response.status_code == 201
        for node_id, label, category in (
            (drama_node_id, "Drama", "Genre"),
            (hook_node_id, "Fake Marriage", "Hook"),
        ):
            ontology_response = await client.post(
                "/ontology-nodes",
                json=build_ontology_node_payload(node_id, label, category),
            )
            assert ontology_response.status_code == 201
        response = await client.post("/content-specs", json=payload)
    assert response.status_code == 422


@pytest.mark.anyio
async def test_create_content_spec_returns_404_for_missing_platform_profile() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/content-specs",
            json=build_payload("tiktok_v1_missing_profile"),
        )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_create_content_spec_returns_404_for_missing_ontology_node() -> None:
    profile_id = "tiktok_v1_missing_ontology"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_response = await client.post(
            "/platform-profiles",
            json=build_platform_profile_payload(profile_id),
        )
        assert profile_response.status_code == 201
        response = await client.post("/content-specs", json=build_payload(profile_id))
    assert response.status_code == 404


@pytest.mark.anyio
async def test_create_content_spec_returns_409_for_mismatched_tag_reference() -> None:
    profile_id = "tiktok_v1_mismatched_tag"
    drama_node_id = "genre.drama_mismatch"
    hook_node_id = "hook.fake_marriage_mismatch"
    payload = build_payload(profile_id)
    payload["tags"][0]["ontology_node_id"] = drama_node_id
    payload["tags"][0]["label"] = "Romance"
    payload["tags"][1]["ontology_node_id"] = hook_node_id

    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_response = await client.post(
            "/platform-profiles",
            json=build_platform_profile_payload(profile_id),
        )
        assert profile_response.status_code == 201
        for node_id, label, category in (
            (drama_node_id, "Drama", "Genre"),
            (hook_node_id, "Fake Marriage", "Hook"),
        ):
            ontology_response = await client.post(
                "/ontology-nodes",
                json=build_ontology_node_payload(node_id, label, category),
            )
            assert ontology_response.status_code == 201
        response = await client.post("/content-specs", json=payload)
    assert response.status_code == 409
