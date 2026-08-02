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


def build_content_spec_payload(profile_id: str, drama_node_id: str, hook_node_id: str) -> dict:
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
                "ontology_node_id": drama_node_id,
                "label": "Drama",
                "category": "Genre",
                "confidence": 0.95,
            },
            {
                "ontology_node_id": hook_node_id,
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
        "metadata": {"source": "api_test"},
    }


async def seed_content_spec(client: AsyncClient, suffix: str) -> str:
    profile_id = f"tiktok_v1_{suffix}"
    drama_node_id = f"genre.drama_{suffix}"
    hook_node_id = f"hook.fake_marriage_{suffix}"

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

    content_spec_response = await client.post(
        "/content-specs",
        json=build_content_spec_payload(profile_id, drama_node_id, hook_node_id),
    )
    assert content_spec_response.status_code == 201
    return content_spec_response.json()["data"]["id"]


async def seed_prompt_only_content_spec(client: AsyncClient, suffix: str) -> str:
    profile_id = f"tiktok_v1_{suffix}"
    profile_response = await client.post(
        "/platform-profiles",
        json=build_platform_profile_payload(profile_id),
    )
    assert profile_response.status_code == 201
    payload = build_content_spec_payload(profile_id, "unused.genre", "unused.hook")
    payload["tags"] = []
    content_spec_response = await client.post("/content-specs", json=payload)
    assert content_spec_response.status_code == 201
    return content_spec_response.json()["data"]["id"]


@pytest.mark.anyio
async def test_create_orchestration_plan() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id = await seed_content_spec(client, "orch_create")
        response = await client.post(
            "/orchestrations",
            json={"content_spec_id": content_spec_id, "desired_scene_count": 3},
        )
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["content_spec_id"] == content_spec_id
    assert data["status"] == "ready"


@pytest.mark.anyio
async def test_create_orchestration_plan_supports_prompt_only_content_spec() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id = await seed_prompt_only_content_spec(
            client,
            "orch_prompt_only",
        )
        response = await client.post(
            "/orchestrations",
            json={"content_spec_id": content_spec_id, "desired_scene_count": 3},
        )

    assert response.status_code == 201
    requests = response.json()["data"]["asset_requests"]
    assert requests
    assert all(item["required_tag_ids"] == [] for item in requests)


@pytest.mark.anyio
async def test_get_orchestration_plan_by_id() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id = await seed_content_spec(client, "orch_get")
        create_response = await client.post(
            "/orchestrations",
            json={"content_spec_id": content_spec_id, "desired_scene_count": 4},
        )
        plan_id = create_response.json()["data"]["id"]
        response = await client.get(f"/orchestrations/{plan_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == plan_id


@pytest.mark.anyio
async def test_create_orchestration_plan_returns_404_for_missing_content_spec() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/orchestrations",
            json={"content_spec_id": "missing_content_spec", "desired_scene_count": 3},
        )
    assert response.status_code == 404
