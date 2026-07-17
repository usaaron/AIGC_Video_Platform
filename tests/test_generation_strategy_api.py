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
        "applicable_tags": [f"genre.romance_{suffix}"],
        "target_platform": "tiktok",
        "target_audience": "women 18-34",
        "version": "v1",
        "prompt_template": "Plan {content_spec_title} from {creative_brief_summary}.",
        "input_variables": ["content_spec_title", "creative_brief_summary"],
        "output_schema": {"type": "object", "properties": {"title": {"type": "string"}}},
        "evaluation_notes": ["Open with immediate emotional conflict."],
    }


def build_generation_strategy_payload(suffix: str) -> dict:
    return {
        "id": f"strategy.tiktok.{suffix}.v1",
        "name": "TikTok Master Script Strategy",
        "target_platform": "tiktok",
        "target_content_type": "ai_comic_drama",
        "applicable_tags": [f"genre.romance_{suffix}"],
        "model_provider": "mock",
        "model_name": "mock-script-generator",
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 4000,
        "workflow_steps": [
            {
                "step_order": 1,
                "name": "story_planning",
                "description": "Build the initial story plan.",
                "prompt_id": f"prompt.story_planning.{suffix}",
            }
        ],
        "prompt_ids": [f"prompt.story_planning.{suffix}"],
        "qc_enabled": True,
        "self_check_enabled": True,
        "human_review_required": False,
        "output_schema": {"type": "object", "properties": {"title": {"type": "string"}}},
        "version": "v1",
        "status": "active",
    }


async def seed_generation_strategy_dependencies(client: AsyncClient, suffix: str) -> None:
    response = await client.post(
        "/ontology-nodes",
        json=build_ontology_node_payload(f"genre.romance_{suffix}", "Romance", "Genre"),
    )
    assert response.status_code == 201

    response = await client.post(
        "/prompt-library",
        json=build_prompt_library_payload(suffix),
    )
    assert response.status_code == 201


@pytest.mark.anyio
async def test_create_generation_strategy() -> None:
    suffix = "genstrategy_create"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_generation_strategy_dependencies(client, suffix)
        response = await client.post(
            "/generation-strategies",
            json=build_generation_strategy_payload(suffix),
        )
    assert response.status_code == 201
    assert response.json()["data"]["id"] == "strategy.tiktok.genstrategy_create.v1"


@pytest.mark.anyio
async def test_get_generation_strategy_by_id() -> None:
    suffix = "genstrategy_get"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_generation_strategy_dependencies(client, suffix)
        create_response = await client.post(
            "/generation-strategies",
            json=build_generation_strategy_payload(suffix),
        )
        created_id = create_response.json()["data"]["id"]
        response = await client.get(f"/generation-strategies/{created_id}")
    assert response.status_code == 200
    assert response.json()["data"]["id"] == created_id


@pytest.mark.anyio
async def test_create_generation_strategy_returns_409_for_duplicate_id() -> None:
    suffix = "genstrategy_duplicate"
    payload = build_generation_strategy_payload(suffix)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        await seed_generation_strategy_dependencies(client, suffix)
        first_response = await client.post("/generation-strategies", json=payload)
        second_response = await client.post("/generation-strategies", json=payload)
    assert first_response.status_code == 201
    assert second_response.status_code == 409


@pytest.mark.anyio
async def test_create_generation_strategy_returns_404_for_missing_prompt() -> None:
    suffix = "genstrategy_missing_prompt"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/ontology-nodes",
            json=build_ontology_node_payload(f"genre.romance_{suffix}", "Romance", "Genre"),
        )
        assert response.status_code == 201
        response = await client.post(
            "/generation-strategies",
            json=build_generation_strategy_payload(suffix),
        )
    assert response.status_code == 404
