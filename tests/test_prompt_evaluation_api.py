import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app


def load_default_request_payload() -> dict:
    payload = json.loads(
        Path("examples/prompt_evaluations/default_request.json").read_text()
    )
    payload["save_report"] = False
    return payload


@pytest.mark.anyio
async def test_run_prompt_evaluation_api() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/benchmarks/prompt-evaluations/run",
            json=load_default_request_payload(),
        )
        result_id = response.json()["data"]["id"]
        list_response = await client.get("/benchmarks/prompt-evaluations")
        detail_response = await client.get(
            f"/benchmarks/prompt-evaluations/results/{result_id}"
        )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["evaluation_case_id"] == "prompt_eval_minimal_v1"
    assert data["benchmark_dataset_id"] == "us_female_dark_romance"
    assert len(data["variants"]) == 3
    assert data["decision_summary"]["best_variant_case_id"] == "strategy_v2_repeat"
    assert data["variants"][1]["explainability"]["compare_to_case_id"] == "prompt_v1"
    assert data["variants"][0]["samples"][0]["llm_model_info"]["provider"] == "mock"
    assert data["placeholder_notes"]
    assert list_response.status_code == 200
    assert len(list_response.json()["data"]) >= 1
    assert detail_response.status_code == 200
    assert detail_response.json()["data"]["id"] == result_id


@pytest.mark.anyio
async def test_run_prompt_evaluation_api_returns_404_for_missing_dataset() -> None:
    payload = load_default_request_payload()
    payload["dataset_id"] = "missing_benchmark"

    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/benchmarks/prompt-evaluations/run",
            json=payload,
        )

    assert response.status_code == 404
