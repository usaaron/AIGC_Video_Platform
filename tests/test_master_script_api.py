import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from tests.test_script_generation_api import seed_script_generation_dependencies


async def build_finalization_chain_payload(client: AsyncClient, suffix: str) -> dict:
    content_spec_id, generation_strategy_id = await seed_script_generation_dependencies(
        client, suffix
    )
    draft_response = await client.post(
        "/script-generation/generate-draft",
        json={
            "content_spec_id": content_spec_id,
            "generation_strategy_id": generation_strategy_id,
            "output_language": "en",
            "desired_scene_count": 3,
        },
    )
    assert draft_response.status_code == 200
    draft_data = draft_response.json()["data"]

    revision_response = await client.post(
        "/script-generation/revise-draft",
        json={
            "draft_master_script": draft_data["draft_master_script"],
            "revision_plan": draft_data["revision_plan"],
        },
    )
    assert revision_response.status_code == 200
    revision_data = revision_response.json()["data"]

    return {
        "script_generation_draft_run": draft_data,
        "script_revision_run": revision_data,
        "dialogue_line_count_per_scene": 2,
        "speaker_name_cycle": ["Heroine", "Counterpart"],
    }


@pytest.mark.anyio
async def test_create_master_script_endpoint_is_deprecated() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post("/master-scripts", json={})

    assert response.status_code == 410


@pytest.mark.anyio
async def test_create_master_script_from_draft_endpoint_is_deprecated() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post("/master-scripts/from-draft", json={})

    assert response.status_code == 410


@pytest.mark.anyio
async def test_finalize_master_script() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        payload = await build_finalization_chain_payload(client, "master_finalize")
        response = await client.post("/master-scripts/finalize", json=payload)

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["source_draft_id"]
    assert data["master_script"]["scenes"][-1]["cliffhanger"] is True
    assert data["master_script"]["lineage"]["generation_strategy_version"] == "v1"
    assert data["master_script"]["lineage"]["minimum_re_qc_score_required"] == 0.65
    assert data["master_script"]["lineage"]["speaker_name_cycle"] == [
        "Heroine",
        "Counterpart",
    ]


@pytest.mark.anyio
async def test_get_master_script_by_id_after_finalize() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        payload = await build_finalization_chain_payload(client, "master_get")
        create_response = await client.post("/master-scripts/finalize", json=payload)
        assert create_response.status_code == 201
        master_script_id = create_response.json()["data"]["master_script"]["id"]

        response = await client.get(f"/master-scripts/{master_script_id}")

    assert response.status_code == 200
    assert response.json()["data"]["id"] == master_script_id


@pytest.mark.anyio
async def test_finalize_master_script_returns_404_for_missing_content_spec() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        payload = await build_finalization_chain_payload(client, "master_missing_content")
        payload["script_generation_draft_run"]["content_spec_id"] = "missing_content_spec"
        payload["script_generation_draft_run"]["draft_master_script"]["content_spec_id"] = (
            "missing_content_spec"
        )
        payload["script_generation_draft_run"]["revision_plan"]["content_spec_id"] = (
            "missing_content_spec"
        )
        payload["script_revision_run"]["original_draft_master_script"]["content_spec_id"] = (
            "missing_content_spec"
        )
        payload["script_revision_run"]["revision_plan"]["content_spec_id"] = (
            "missing_content_spec"
        )
        payload["script_revision_run"]["revised_draft_master_script"]["content_spec_id"] = (
            "missing_content_spec"
        )

        response = await client.post("/master-scripts/finalize", json=payload)

    assert response.status_code == 404


@pytest.mark.anyio
async def test_finalize_master_script_returns_422_for_mismatched_revision_chain() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        payload = await build_finalization_chain_payload(client, "master_bad_chain")
        payload["script_revision_run"]["revision_plan"]["draft_master_script_id"] = "draft.mismatch"

        response = await client.post("/master-scripts/finalize", json=payload)

    assert response.status_code == 422


@pytest.mark.anyio
async def test_finalize_master_script_returns_422_below_threshold() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        payload = await build_finalization_chain_payload(client, "master_threshold")
        payload["minimum_re_qc_score_override"] = 0.99

        response = await client.post("/master-scripts/finalize", json=payload)

    assert response.status_code == 422
