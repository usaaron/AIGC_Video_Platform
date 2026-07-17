import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


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


def build_ontology_node_payload(node_id: str, label: str, category: str) -> dict:
    return {
        "id": node_id,
        "label": label,
        "category": category,
        "description": f"Controlled ontology node for {label}.",
        "aliases": [],
        "is_active": True,
    }


def build_asset_payload(profile_id: str, suffix: str) -> dict:
    return {
        "id": f"scene.wedding_hall_asset_{suffix}",
        "asset_type": "scene",
        "title": "Wedding Hall Reveal Set",
        "summary": "Scene asset for fake-marriage reveal episodes with strong audience reaction space.",
        "tags": [
            {
                "ontology_node_id": f"scene.wedding_hall_asset_{suffix}",
                "label": "Wedding Hall",
                "category": "Scene",
                "confidence": 0.94,
            },
            {
                "ontology_node_id": f"hook.fake_marriage_asset_{suffix}",
                "label": "Fake Marriage",
                "category": "Hook",
                "confidence": 0.9,
            },
        ],
        "content": {
            "text": "Large wedding hall with reveal-friendly staging and reaction cutaway positions.",
            "payload": {
                "camera_notes": ["wide establishing", "aisle push-in"],
                "tone": "luxury melodrama",
            },
        },
        "applicable_platform_profile_ids": [profile_id],
        "metadata": {"source": "api_test"},
        "is_active": True,
    }


async def seed_dependencies(client: AsyncClient, profile_id: str, suffix: str) -> None:
    profile_response = await client.post(
        "/platform-profiles",
        json=build_platform_profile_payload(profile_id),
    )
    assert profile_response.status_code == 201

    for node_id, label, category in (
        (f"scene.wedding_hall_asset_{suffix}", "Wedding Hall", "Scene"),
        (f"hook.fake_marriage_asset_{suffix}", "Fake Marriage", "Hook"),
    ):
        ontology_response = await client.post(
            "/ontology-nodes",
            json=build_ontology_node_payload(node_id, label, category),
        )
        assert ontology_response.status_code == 201


@pytest.mark.anyio
async def test_create_asset() -> None:
    profile_id = "tiktok_v1_asset_create"
    suffix = "create"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_dependencies(client, profile_id, suffix)
        response = await client.post("/assets", json=build_asset_payload(profile_id, suffix))
    assert response.status_code == 201
    assert response.json()["data"]["id"] == "scene.wedding_hall_asset_create"


@pytest.mark.anyio
async def test_get_asset_by_id() -> None:
    profile_id = "tiktok_v1_asset_get"
    suffix = "get"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_dependencies(client, profile_id, suffix)
        create_response = await client.post("/assets", json=build_asset_payload(profile_id, suffix))
        created_id = create_response.json()["data"]["id"]
        response = await client.get(f"/assets/{created_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == created_id


@pytest.mark.anyio
async def test_create_asset_returns_409_for_duplicate_id() -> None:
    profile_id = "tiktok_v1_asset_duplicate"
    suffix = "duplicate"
    payload = build_asset_payload(profile_id, suffix)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_dependencies(client, profile_id, suffix)
        first_response = await client.post("/assets", json=payload)
        second_response = await client.post("/assets", json=payload)
    assert first_response.status_code == 201
    assert second_response.status_code == 409


@pytest.mark.anyio
async def test_create_asset_returns_404_for_missing_ontology_node() -> None:
    profile_id = "tiktok_v1_asset_missing_ontology"
    suffix = "missing_ontology"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_response = await client.post(
            "/platform-profiles",
            json=build_platform_profile_payload(profile_id),
        )
        assert profile_response.status_code == 201
        response = await client.post(
            "/assets",
            json=build_asset_payload(profile_id, suffix),
        )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_create_asset_returns_409_for_mismatched_tag_reference() -> None:
    profile_id = "tiktok_v1_asset_mismatch"
    suffix = "mismatch"
    payload = build_asset_payload(profile_id, suffix)
    payload["tags"][0]["label"] = "Ballroom"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_dependencies(client, profile_id, suffix)
        response = await client.post("/assets", json=payload)
    assert response.status_code == 409


@pytest.mark.anyio
async def test_create_asset_returns_404_for_missing_platform_profile_reference() -> None:
    suffix = "missing_profile"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        for node_id, label, category in (
            (f"scene.wedding_hall_asset_{suffix}", "Wedding Hall", "Scene"),
            (f"hook.fake_marriage_asset_{suffix}", "Fake Marriage", "Hook"),
        ):
            ontology_response = await client.post(
                "/ontology-nodes",
                json=build_ontology_node_payload(node_id, label, category),
            )
            assert ontology_response.status_code in (201, 409)
        response = await client.post(
            "/assets",
            json=build_asset_payload("tiktok_v1_asset_missing_profile", suffix),
        )
    assert response.status_code == 404
