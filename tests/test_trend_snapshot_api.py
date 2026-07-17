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


def build_manual_json_job_payload(job_id: str, profile_id: str, suffix: str) -> dict:
    return {
        "id": job_id,
        "title": "Scheduled manual json import",
        "adapter_type": "manual_json",
        "schedule_type": "daily",
        "platform_profile_id": profile_id,
        "audience_hint": "TikTok viewers who respond to melodramatic romance twists",
        "commercial_objective": "Find high-retention concepts with sequel potential",
        "manual_json_records": [
            {
                "source_name": "manual_json",
                "source_item_id": f"item_{suffix}",
                "platform": "tiktok",
                "source_url": f"https://example.com/{suffix}",
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


@pytest.mark.anyio
async def test_generate_trend_snapshot() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "trend_snapshot_generate")
        job_id = "job.manual_json_trend_snapshot_generate"
        create_response = await client.post(
            "/ingestion-jobs",
            json=build_manual_json_job_payload(job_id, profile_id, "trend_snapshot_generate"),
        )
        assert create_response.status_code == 201
        first_run_response = await client.post(f"/ingestion-jobs/{job_id}/run")
        assert first_run_response.status_code == 200
        second_run_response = await client.post(f"/ingestion-jobs/{job_id}/run")
        assert second_run_response.status_code == 200
        response = await client.post(
            "/trend-snapshots/generate",
            json={"job_id": job_id, "lookback_runs": 2},
        )
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["job_id"] == job_id
    assert data["successful_run_count"] == 1
    assert data["skipped_run_count"] == 1
    assert len(data["top_mapped_tags"]) >= 1


@pytest.mark.anyio
async def test_get_trend_snapshot_by_id() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "trend_snapshot_get")
        job_id = "job.manual_json_trend_snapshot_get"
        create_response = await client.post(
            "/ingestion-jobs",
            json=build_manual_json_job_payload(job_id, profile_id, "trend_snapshot_get"),
        )
        assert create_response.status_code == 201
        run_response = await client.post(f"/ingestion-jobs/{job_id}/run")
        assert run_response.status_code == 200
        generate_response = await client.post(
            "/trend-snapshots/generate",
            json={"job_id": job_id, "lookback_runs": 1},
        )
        assert generate_response.status_code == 201
        snapshot_id = generate_response.json()["data"]["id"]
        response = await client.get(f"/trend-snapshots/{snapshot_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == snapshot_id


@pytest.mark.anyio
async def test_generate_trend_snapshot_returns_409_without_history() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "trend_snapshot_empty")
        job_id = "job.manual_json_trend_snapshot_empty"
        create_response = await client.post(
            "/ingestion-jobs",
            json=build_manual_json_job_payload(job_id, profile_id, "trend_snapshot_empty"),
        )
        assert create_response.status_code == 201
        response = await client.post(
            "/trend-snapshots/generate",
            json={"job_id": job_id, "lookback_runs": 3},
        )
    assert response.status_code == 409
