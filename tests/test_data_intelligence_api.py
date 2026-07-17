import json

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


async def seed_dependencies(client: AsyncClient, suffix: str) -> str:
    profile_id = f"tiktok_v1_{suffix}"
    profile_response = await client.post(
        "/platform-profiles",
        json=build_platform_profile_payload(profile_id),
    )
    assert profile_response.status_code == 201

    for node_id, label, category in (
        ("genre.romance", "Romance", "Genre"),
        ("emotion.revenge", "Revenge", "Emotion"),
        ("genre.drama", "Drama", "Genre"),
        ("hook.fake_marriage", "Fake Marriage", "Hook"),
    ):
        ontology_response = await client.post(
            "/ontology-nodes",
            json=build_ontology_node_payload(node_id, label, category),
        )
        assert ontology_response.status_code in (201, 409)

    return profile_id


@pytest.mark.anyio
async def test_manual_json_pipeline_creates_content_spec() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "di_json")
        payload = {
            "platform_profile_id": profile_id,
            "audience_hint": "TikTok viewers who respond to melodramatic romance twists",
            "commercial_objective": "Find high-retention concepts with sequel potential",
            "records": [
                {
                    "source_name": "manual_json",
                    "source_item_id": "item_001",
                    "platform": "tiktok",
                    "title": "Revenge wedding drama",
                    "body_text": "A fake marriage turns into revenge when the bride exposes a betrayal.",
                    "author_handle": "creator_a",
                    "language": "en",
                    "region": "US",
                    "engagement": {
                        "view_count": 220000,
                        "like_count": 18000,
                        "comment_count": 1400,
                        "share_count": 950,
                        "save_count": 720,
                        "completion_rate": 0.68,
                    },
                }
            ],
        }
        response = await client.post("/data-intelligence/manual-json/pipeline", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert len(data["raw_content_records"]) == 1
    assert len(data["analysis_results"]) == 1
    assert data["analysis_results"][0]["keyword_evidence"]
    assert data["analysis_results"][0]["preference_score_breakdown"]["factors"]
    assert data["analysis_results"][0]["recommended_hook_type"]
    assert data["content_spec"]["platform_goal"]["platform_profile_id"] == profile_id
    assert len(data["content_spec_draft"]["tags"]) >= 1


@pytest.mark.anyio
async def test_manual_csv_pipeline_creates_content_spec() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "di_csv")
        csv_content = (
            "source_name,source_item_id,platform,title,body_text,author_handle,language,region,"
            "view_count,like_count,comment_count,share_count,save_count,completion_rate\n"
            "manual_csv,item_002,tiktok,Fake marriage drama,"
            "\"A wedding explodes into romance and revenge after a public betrayal.\",creator_b,en,US,"
            "250000,22000,1600,1100,850,0.72\n"
        )
        payload = {
            "platform_profile_id": profile_id,
            "audience_hint": "Short-form viewers who stay for relationship twists",
            "commercial_objective": "Generate concepts likely to drive rewatch and sequel demand",
            "csv_content": csv_content,
        }
        response = await client.post("/data-intelligence/manual-csv/pipeline", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["content_spec"]["platform_goal"]["platform_profile_id"] == profile_id
    assert data["analysis_results"][0]["preference_score"] >= 0.0
    assert data["analysis_results"][0]["commercial_signal_summary"]


@pytest.mark.anyio
async def test_manual_json_pipeline_returns_409_when_no_tags_can_be_mapped() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "di_empty")
        payload = {
            "platform_profile_id": profile_id,
            "audience_hint": "General short-form viewers",
            "commercial_objective": "Find usable concepts",
            "records": [
                {
                    "source_name": "manual_json",
                    "source_item_id": "item_003",
                    "platform": "tiktok",
                    "title": "Ordinary office update",
                    "body_text": "A calm office check-in with no dramatic angle.",
                    "author_handle": "creator_c",
                    "language": "en",
                    "region": "US",
                    "engagement": {
                        "view_count": 1200,
                        "like_count": 20,
                        "comment_count": 2,
                        "share_count": 1,
                        "save_count": 0,
                        "completion_rate": 0.12,
                    },
                }
            ],
        }
        response = await client.post("/data-intelligence/manual-json/pipeline", json=payload)
    assert response.status_code == 409
