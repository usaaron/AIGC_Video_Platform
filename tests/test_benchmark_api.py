import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


@pytest.mark.anyio
async def test_run_benchmark_api() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/benchmarks/run",
            json={
                "dataset_id": "us_female_dark_romance",
                "dataset_type": "benchmark",
            },
        )
    assert response.status_code == 201
    data = response.json()["data"]
    assert data["benchmark_id"] == "us_female_dark_romance"
    assert data["analysis_evaluation"]["score"] >= 0.7
    assert len(data["revision_plan"]["actions"]) >= 1
    assert data["revision_improves_over_draft"] is True
    assert data["score_summary"]["revision_qc_gain"] >= 0.0
    assert data["score_summary"]["final_gain_over_draft"] >= 0.0
    assert data["revision_summary"]["action_count"] >= 1
    assert data["highlights"]["headline"]
    assert data["highlights"]["strongest_gain_stage"]
    assert (
        data["revised_story_qc_report"]["overall_score"]
        >= data["story_qc_report"]["overall_score"]
    )
    assert data["final_improves_over_draft"] is True
    assert data["final_improves_over_revised_draft"] is True


@pytest.mark.anyio
async def test_run_benchmark_api_returns_404_for_missing_dataset() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/benchmarks/run",
            json={
                "dataset_id": "missing_benchmark",
                "dataset_type": "benchmark",
            },
        )
    assert response.status_code == 404
