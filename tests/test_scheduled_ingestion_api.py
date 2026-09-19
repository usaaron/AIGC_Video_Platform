import pytest
from httpx import ASGITransport, AsyncClient

from app.dependencies import get_scheduled_ingestion_service
from app.main import create_app
from app.modules.data_intelligence.models import AnalysisResult, DataPipelineResponse, MappedTag


@pytest.mark.parametrize(
    ("tag_groups", "expected"),
    [
        ([], []),
        ([[], []], []),
        (
            [["tag.beta", "tag.alpha", "tag.beta"], ["tag.alpha", "tag.gamma"]],
            ["tag.beta", "tag.alpha", "tag.gamma"],
        ),
        (
            [["tag.alpha", "TAG.ALPHA", "", " tag.alpha "], ["", "TAG.ALPHA"]],
            ["tag.alpha", "TAG.ALPHA", "", " tag.alpha "],
        ),
    ],
)
def test_collect_mapped_tag_ids_preserves_first_occurrence(tag_groups, expected) -> None:
    # Isolate collection from schema validation, including empty IDs without filtering.
    response = DataPipelineResponse.model_construct(analysis_results=[
        AnalysisResult.model_construct(mapped_tags=[
            MappedTag.model_construct(ontology_node_id=tag_id) for tag_id in group
        ])
        for group in tag_groups
    ])
    assert get_scheduled_ingestion_service()._collect_mapped_tag_ids(response) == expected


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
async def test_create_ingestion_job() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "ingestion_create")
        response = await client.post(
            "/ingestion-jobs",
            json=build_manual_json_job_payload(
                "job.manual_json_ingestion_create",
                profile_id,
                "ingestion_create",
            ),
        )
    assert response.status_code == 201
    assert response.json()["data"]["run_status"] == "idle"


@pytest.mark.anyio
async def test_run_ingestion_job_creates_content_spec() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "ingestion_run")
        create_response = await client.post(
            "/ingestion-jobs",
            json=build_manual_json_job_payload(
                "job.manual_json_ingestion_run",
                profile_id,
                "ingestion_run",
            ),
        )
        assert create_response.status_code == 201
        response = await client.post("/ingestion-jobs/job.manual_json_ingestion_run/run")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["job"]["run_status"] == "succeeded"
    assert data["run_history"]["run_status"] == "succeeded"
    assert data["imported_record_count"] == 1
    assert data["content_spec"]["platform_goal"]["platform_profile_id"] == profile_id


@pytest.mark.anyio
async def test_run_ingestion_job_skips_duplicates() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "ingestion_dedup")
        create_response = await client.post(
            "/ingestion-jobs",
            json=build_manual_json_job_payload(
                "job.manual_json_ingestion_dedup",
                profile_id,
                "ingestion_dedup",
            ),
        )
        assert create_response.status_code == 201
        first_run_response = await client.post("/ingestion-jobs/job.manual_json_ingestion_dedup/run")
        assert first_run_response.status_code == 200
        second_run_response = await client.post("/ingestion-jobs/job.manual_json_ingestion_dedup/run")
    assert second_run_response.status_code == 200
    data = second_run_response.json()["data"]
    assert data["job"]["run_status"] == "skipped"
    assert data["run_history"]["run_status"] == "skipped"
    assert data["imported_record_count"] == 0
    assert data["skipped_duplicate_count"] >= 1


@pytest.mark.anyio
async def test_run_ingestion_job_returns_501_for_placeholder_adapter() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "ingestion_placeholder")
        create_response = await client.post(
            "/ingestion-jobs",
            json={
                "id": "job.tiktok_scraper_placeholder",
                "title": "Placeholder scraper job",
                "adapter_type": "tiktok_scraper",
                "schedule_type": "weekly",
                "platform_profile_id": profile_id,
                "audience_hint": "TikTok viewers",
                "commercial_objective": "Collect future data",
                "source_config": {"source_url": "https://www.tiktok.com/example"},
            },
        )
        assert create_response.status_code == 201
        response = await client.post("/ingestion-jobs/job.tiktok_scraper_placeholder/run")
    assert response.status_code == 501


@pytest.mark.anyio
async def test_list_ingestion_job_runs() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "ingestion_history_list")
        create_response = await client.post(
            "/ingestion-jobs",
            json=build_manual_json_job_payload(
                "job.manual_json_ingestion_history_list",
                profile_id,
                "ingestion_history_list",
            ),
        )
        assert create_response.status_code == 201
        run_response = await client.post("/ingestion-jobs/job.manual_json_ingestion_history_list/run")
        assert run_response.status_code == 200
        response = await client.get("/ingestion-jobs/job.manual_json_ingestion_history_list/runs")
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) >= 1
    assert data[-1]["job_id"] == "job.manual_json_ingestion_history_list"


@pytest.mark.anyio
async def test_get_ingestion_run_history_by_id() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "ingestion_history_get")
        create_response = await client.post(
            "/ingestion-jobs",
            json=build_manual_json_job_payload(
                "job.manual_json_ingestion_history_get",
                profile_id,
                "ingestion_history_get",
            ),
        )
        assert create_response.status_code == 201
        run_response = await client.post("/ingestion-jobs/job.manual_json_ingestion_history_get/run")
        assert run_response.status_code == 200
        run_history_id = run_response.json()["data"]["run_history"]["id"]
        response = await client.get(f"/ingestion-jobs/runs/{run_history_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == run_history_id


@pytest.mark.anyio
async def test_placeholder_adapter_run_creates_failed_history() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        profile_id = await seed_dependencies(client, "ingestion_history_failed")
        create_response = await client.post(
            "/ingestion-jobs",
            json={
                "id": "job.tiktok_scraper_history_failed",
                "title": "Placeholder scraper history job",
                "adapter_type": "tiktok_scraper",
                "schedule_type": "weekly",
                "platform_profile_id": profile_id,
                "audience_hint": "TikTok viewers",
                "commercial_objective": "Collect future data",
                "source_config": {"source_url": "https://www.tiktok.com/example"},
            },
        )
        assert create_response.status_code == 201
        run_response = await client.post("/ingestion-jobs/job.tiktok_scraper_history_failed/run")
        assert run_response.status_code == 501
        history_response = await client.get("/ingestion-jobs/job.tiktok_scraper_history_failed/runs")
    assert history_response.status_code == 200
    histories = history_response.json()["data"]
    assert len(histories) == 1
    assert histories[0]["run_status"] == "failed"
