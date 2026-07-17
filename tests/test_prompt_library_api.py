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


def build_prompt_library_payload(suffix: str) -> dict:
    return {
        "id": f"prompt.story_planning.{suffix}",
        "name": "Story Planning Prompt",
        "prompt_type": "story_planning",
        "target_module": "script_engine",
        "applicable_tags": [f"genre.romance_{suffix}", f"theme.revenge_{suffix}"],
        "target_platform": "tiktok",
        "target_audience": "women 18-34",
        "version": "v1",
        "prompt_template": "Plan {content_spec_title} from {creative_brief_summary}.",
        "input_variables": ["content_spec_title", "creative_brief_summary"],
        "output_schema": {"type": "object", "properties": {"title": {"type": "string"}}},
        "evaluation_notes": ["Open with immediate emotional conflict."],
    }


async def seed_prompt_tags(client: AsyncClient, suffix: str) -> None:
    for node_id, label, category in (
        (f"genre.romance_{suffix}", "Romance", "Genre"),
        (f"theme.revenge_{suffix}", "Revenge", "Theme"),
    ):
        response = await client.post(
            "/ontology-nodes",
            json=build_ontology_node_payload(node_id, label, category),
        )
        assert response.status_code == 201


@pytest.mark.anyio
async def test_create_prompt_library_item() -> None:
    suffix = "promptlib_create"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_prompt_tags(client, suffix)
        response = await client.post(
            "/prompt-library",
            json=build_prompt_library_payload(suffix),
        )
    assert response.status_code == 201
    assert response.json()["data"]["id"] == "prompt.story_planning.promptlib_create"


@pytest.mark.anyio
async def test_get_prompt_library_item_by_id() -> None:
    suffix = "promptlib_get"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_prompt_tags(client, suffix)
        create_response = await client.post(
            "/prompt-library",
            json=build_prompt_library_payload(suffix),
        )
        created_id = create_response.json()["data"]["id"]
        response = await client.get(f"/prompt-library/{created_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == created_id


@pytest.mark.anyio
async def test_create_prompt_library_item_returns_409_for_duplicate_id() -> None:
    suffix = "promptlib_duplicate"
    payload = build_prompt_library_payload(suffix)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_prompt_tags(client, suffix)
        first_response = await client.post("/prompt-library", json=payload)
        second_response = await client.post("/prompt-library", json=payload)
    assert first_response.status_code == 201
    assert second_response.status_code == 409


@pytest.mark.anyio
async def test_create_prompt_library_item_returns_404_for_missing_ontology_node() -> None:
    suffix = "promptlib_missing_ontology"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/prompt-library",
            json=build_prompt_library_payload(suffix),
        )
    assert response.status_code == 404
