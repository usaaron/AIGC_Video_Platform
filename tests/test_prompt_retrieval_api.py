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


async def seed_prompt_retrieval_dependencies(client: AsyncClient, suffix: str) -> str:
    response = await client.post(
        "/ontology-nodes",
        json=build_ontology_node_payload(f"genre.romance_{suffix}", "Romance", "Genre"),
    )
    assert response.status_code == 201

    response = await client.post("/prompt-library", json=build_prompt_library_payload(suffix))
    assert response.status_code == 201

    response = await client.post(
        "/generation-strategies",
        json=build_generation_strategy_payload(suffix),
    )
    assert response.status_code == 201
    return response.json()["data"]["id"]


@pytest.mark.anyio
async def test_resolve_prompt_retrieval() -> None:
    suffix = "promptretrieval_api"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        generation_strategy_id = await seed_prompt_retrieval_dependencies(client, suffix)
        response = await client.post(
            "/prompt-retrieval/resolve",
            json={"generation_strategy_id": generation_strategy_id},
        )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["generation_strategy_id"] == generation_strategy_id
    assert data["prompt_ids"] == [f"prompt.story_planning.{suffix}"]
    assert data["prompts"][0]["id"] == f"prompt.story_planning.{suffix}"
    assert data["retrieval_mode"] == "exact_ids"


@pytest.mark.anyio
async def test_resolve_prompt_retrieval_returns_404_for_missing_strategy() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/prompt-retrieval/resolve",
            json={"generation_strategy_id": "missing_strategy"},
        )
    assert response.status_code == 404
