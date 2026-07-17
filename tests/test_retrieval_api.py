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


def build_asset_payload(
    asset_id: str,
    asset_type: str,
    profile_id: str,
    drama_node_id: str,
    hook_node_id: str,
) -> dict:
    return {
        "id": asset_id,
        "asset_type": asset_type,
        "title": asset_id.replace(".", " ").title(),
        "summary": f"Reusable {asset_type} asset aligned with fake-marriage drama concepts.",
        "tags": [
            {
                "ontology_node_id": drama_node_id,
                "label": "Drama",
                "category": "Genre",
                "confidence": 0.93,
            },
            {
                "ontology_node_id": hook_node_id,
                "label": "Fake Marriage",
                "category": "Hook",
                "confidence": 0.9,
            },
        ],
        "content": {
            "text": f"{asset_type} asset prepared for melodramatic cliffhanger episodes.",
            "payload": {"source": "api_test"},
        },
        "applicable_platform_profile_ids": [profile_id],
        "metadata": {"source": "api_test"},
        "is_active": True,
    }


async def seed_plan(client: AsyncClient, suffix: str) -> tuple[str, str, str, str]:
    profile_id = f"tiktok_v1_retrieval_{suffix}"
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
    content_spec_id = content_spec_response.json()["data"]["id"]

    plan_response = await client.post(
        "/orchestrations",
        json={"content_spec_id": content_spec_id, "desired_scene_count": 3},
    )
    assert plan_response.status_code == 201
    return (
        plan_response.json()["data"]["id"],
        profile_id,
        drama_node_id,
        hook_node_id,
    )


@pytest.mark.anyio
async def test_resolve_retrieval_plan() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        plan_id, profile_id, drama_node_id, hook_node_id = await seed_plan(client, "resolve")
        for asset_id, asset_type in (
            ("character.lead_pair_resolve", "character"),
            ("scene.wedding_set_resolve", "scene"),
        ):
            asset_response = await client.post(
                "/assets",
                json=build_asset_payload(
                    asset_id,
                    asset_type,
                    profile_id,
                    drama_node_id,
                    hook_node_id,
                ),
            )
            assert asset_response.status_code == 201

        response = await client.post("/retrieval/resolve", json={"plan_id": plan_id})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["plan_id"] == plan_id
    assert data["status"] == "resolved"
    assert len(data["resolved_requests"]) == 2
    assert all(len(item["candidates"]) >= 1 for item in data["resolved_requests"])


@pytest.mark.anyio
async def test_resolve_retrieval_plan_returns_partial_when_assets_missing() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        plan_id, profile_id, drama_node_id, hook_node_id = await seed_plan(client, "partial")
        asset_response = await client.post(
            "/assets",
            json=build_asset_payload(
                "scene.wedding_set_partial",
                "scene",
                profile_id,
                drama_node_id,
                hook_node_id,
            ),
        )
        assert asset_response.status_code == 201

        response = await client.post("/retrieval/resolve", json={"plan_id": plan_id})
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "partial"
    assert "characters_core" in data["unresolved_request_ids"]


@pytest.mark.anyio
async def test_resolve_retrieval_plan_returns_404_for_missing_plan() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/retrieval/resolve",
            json={"plan_id": "missing_plan"},
        )
    assert response.status_code == 404
