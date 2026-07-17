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
                "summary": "Open quickly.",
            }
        ],
        "creator_rewards": [
            {
                "code": "retention_signal",
                "title": "Retention Signal",
                "summary": "Retention matters.",
            }
        ],
        "ai_policies": [
            {
                "code": "ai_disclosure",
                "title": "AI Disclosure",
                "summary": "Match disclosure expectations.",
            }
        ],
        "community_guidelines": [
            {
                "code": "safety_compliance",
                "title": "Safety Compliance",
                "summary": "Avoid harmful content patterns.",
            }
        ],
        "best_practices": [
            {
                "code": "vertical_native",
                "title": "Vertical Native",
                "summary": "Keep it vertical.",
            }
        ],
        "publishing_strategy": {
            "recommended_posts_per_day": 2,
            "preferred_time_windows": ["12:00-14:00"],
            "notes": ["Consistent testing windows."],
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


def build_content_spec_payload(profile_id: str, suffix: str) -> dict:
    return {
        "title": "Fake marriage cliffhanger short",
        "audience_goal": {
            "summary": "Capture romance-drama viewers quickly",
            "priority": "primary",
            "success_metric": "Watch-through rate",
        },
        "commercial_goal": {
            "summary": "Test serialized monetization potential",
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
                "ontology_node_id": f"genre.romance_{suffix}",
                "label": "Romance",
                "category": "Genre",
                "confidence": 0.95,
            },
            {
                "ontology_node_id": f"emotion.revenge_{suffix}",
                "label": "Revenge",
                "category": "Emotion",
                "confidence": 0.89,
            },
        ],
        "creative_brief": {
            "hook": "The groom lifted the veil and froze.",
            "tone": "intense",
            "pacing": "fast",
            "target_emotion": "revenge",
            "asset_constraints": [],
            "generation_notes": ["Favor wedding assets."],
        },
        "metadata": {"source": "api_test"},
    }


def build_asset_payload(asset_id: str, asset_type: str, profile_id: str, suffix: str) -> dict:
    return {
        "id": asset_id,
        "asset_type": asset_type,
        "title": asset_id.replace(".", " ").title(),
        "summary": f"Reusable {asset_type} asset aligned with fake marriage drama concepts.",
        "tags": [
            {
                "ontology_node_id": f"genre.romance_{suffix}",
                "label": "Romance",
                "category": "Genre",
                "confidence": 0.93,
            },
            {
                "ontology_node_id": f"emotion.revenge_{suffix}",
                "label": "Revenge",
                "category": "Emotion",
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
        "prompt_template": "Plan {content_spec_title} using assets {retrieved_asset_ids}.",
        "input_variables": ["content_spec_title", "retrieved_asset_ids"],
        "output_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "hook": {"type": "string"},
            },
        },
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
        "output_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "hook": {"type": "string"},
            },
        },
        "version": "v1",
        "status": "active",
    }


async def seed_script_generation_dependencies(client: AsyncClient, suffix: str) -> tuple[str, str]:
    profile_id = f"tiktok_v1_{suffix}"
    response = await client.post(
        "/platform-profiles",
        json=build_platform_profile_payload(profile_id),
    )
    assert response.status_code == 201

    for node_id, label, category in (
        (f"genre.romance_{suffix}", "Romance", "Genre"),
        (f"emotion.revenge_{suffix}", "Revenge", "Emotion"),
    ):
        response = await client.post(
            "/ontology-nodes",
            json=build_ontology_node_payload(node_id, label, category),
        )
        assert response.status_code == 201

    response = await client.post(
        "/content-specs",
        json=build_content_spec_payload(profile_id, suffix),
    )
    assert response.status_code == 201
    content_spec_id = response.json()["data"]["id"]

    for asset_id, asset_type in (
        (f"character.lead_pair_{suffix}", "character"),
        (f"scene.wedding_set_{suffix}", "scene"),
    ):
        response = await client.post(
            "/assets",
            json=build_asset_payload(asset_id, asset_type, profile_id, suffix),
        )
        assert response.status_code == 201

    response = await client.post(
        "/prompt-library",
        json=build_prompt_library_payload(suffix),
    )
    assert response.status_code == 201

    response = await client.post(
        "/generation-strategies",
        json=build_generation_strategy_payload(suffix),
    )
    assert response.status_code == 201
    generation_strategy_id = response.json()["data"]["id"]

    return content_spec_id, generation_strategy_id


@pytest.mark.anyio
async def test_generate_script_draft() -> None:
    suffix = "scriptgen_api"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id, generation_strategy_id = await seed_script_generation_dependencies(
            client, suffix
        )
        response = await client.post(
            "/script-generation/generate-draft",
            json={
                "content_spec_id": content_spec_id,
                "generation_strategy_id": generation_strategy_id,
                "output_language": "en",
                "desired_scene_count": 3,
            },
        )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["content_spec_id"] == content_spec_id
    assert data["generation_strategy_id"] == generation_strategy_id
    assert data["retrieval_result"]["status"] == "resolved"
    assert data["prompt_retrieval_result"]["generation_strategy_id"] == generation_strategy_id
    assert data["prompt_retrieval_result"]["prompt_ids"] == [
        f"prompt.story_planning.{suffix}"
    ]
    assert data["llm_model_info"]["model_name"] == "mock-script-generator"
    assert data["draft_master_script"]["content_spec_id"] == content_spec_id
    assert data["draft_master_script"]["generation_strategy_id"] == generation_strategy_id
    assert len(data["draft_master_script"]["scenes"]) == 3
    assert data["draft_master_script"]["scenes"][-1]["cliffhanger"] is True
    assert data["llm_raw_output"]["title"]
    assert data["story_qc_report"]["status"] == "placeholder"
    assert data["revision_plan"]["content_spec_id"] == content_spec_id
    assert data["revision_plan"]["must_re_qc"] is True
    assert len(data["revision_plan"]["actions"]) >= 1


@pytest.mark.anyio
async def test_generate_script_draft_returns_404_for_missing_strategy() -> None:
    suffix = "scriptgen_missing_strategy"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id, _ = await seed_script_generation_dependencies(client, suffix)
        response = await client.post(
            "/script-generation/generate-draft",
            json={
                "content_spec_id": content_spec_id,
                "generation_strategy_id": "missing_strategy",
                "output_language": "en",
                "desired_scene_count": 3,
            },
        )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_build_revision_plan_endpoint() -> None:
    suffix = "scriptgen_revision_api"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
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

        response = await client.post(
            "/script-generation/build-revision-plan",
            json={
                "draft_master_script": draft_data["draft_master_script"],
                "story_qc_report": draft_data["story_qc_report"],
            },
        )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["content_spec_id"] == content_spec_id
    assert data["generation_strategy_id"] == generation_strategy_id
    assert data["must_re_qc"] is True
    assert len(data["actions"]) >= 1


@pytest.mark.anyio
async def test_revise_draft_endpoint() -> None:
    suffix = "scriptgen_revise_api"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
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

        response = await client.post(
            "/script-generation/revise-draft",
            json={
                "draft_master_script": draft_data["draft_master_script"],
                "revision_plan": draft_data["revision_plan"],
            },
        )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["applied_action_ids"]
    assert data["improved"] is True
    assert (
        data["revised_story_qc_report"]["overall_score"]
        >= data["original_story_qc_report"]["overall_score"]
    )


@pytest.mark.anyio
async def test_revise_draft_endpoint_returns_422_for_mismatched_plan() -> None:
    suffix = "scriptgen_revise_invalid_api"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
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
        draft_data["revision_plan"]["draft_master_script_id"] = "draft.mismatch"

        response = await client.post(
            "/script-generation/revise-draft",
            json={
                "draft_master_script": draft_data["draft_master_script"],
                "revision_plan": draft_data["revision_plan"],
            },
        )

    assert response.status_code == 422


@pytest.mark.anyio
async def test_generate_script_draft_returns_422_for_missing_real_llm_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    suffix = "scriptgen_real_config_missing"
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "script-model")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")

    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id, generation_strategy_id = await seed_script_generation_dependencies(
            client, suffix
        )
        response = await client.post(
            "/script-generation/generate-draft",
            json={
                "content_spec_id": content_spec_id,
                "generation_strategy_id": generation_strategy_id,
                "output_language": "en",
                "desired_scene_count": 3,
            },
        )

    assert response.status_code == 422
    assert "LLM_API_KEY" in response.json()["detail"]
