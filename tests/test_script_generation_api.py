from copy import deepcopy
import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.dependencies import get_script_generation_service
from app.main import create_app
from app.modules.script_engine.generation_service import (
    InvalidDraftMasterScriptOutputError,
)


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


def build_generation_strategy_payload(
    suffix: str,
    *,
    draft_knowledge_bundle_id: str | None = None,
) -> dict:
    payload = {
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
    if draft_knowledge_bundle_id is not None:
        payload["draft_knowledge_bundle_id"] = draft_knowledge_bundle_id
    return payload


async def seed_script_generation_dependencies(
    client: AsyncClient,
    suffix: str,
    *,
    draft_knowledge_bundle_id: str | None = None,
) -> tuple[str, str]:
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
        json=build_generation_strategy_payload(
            suffix,
            draft_knowledge_bundle_id=draft_knowledge_bundle_id,
        ),
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
    assert data["resolved_creative_context"] is None
    assert "ResolvedCreativeContext:" not in data["prompt_build_result"]["prompt_text"]
    assert data["knowledge_bundle"] is None
    assert data["knowledge_selection_trace"] is None
    assert "CreativeKnowledgeBundle:" not in data["prompt_build_result"]["prompt_text"]


@pytest.mark.anyio
async def test_generate_script_draft_stream_reports_progress_and_result() -> None:
    suffix = "scriptgen_stream_api"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id, generation_strategy_id = await seed_script_generation_dependencies(
            client, suffix
        )
        response = await client.post(
            "/script-generation/generate-draft/stream",
            json={
                "content_spec_id": content_spec_id,
                "generation_strategy_id": generation_strategy_id,
                "output_language": "en",
                "desired_scene_count": 3,
                "episode_context": {
                    "generation_mode": "full",
                    "episode_number": 1,
                    "total_episodes": 10,
                },
            },
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = [
        json.loads(line[5:].strip())
        for line in response.text.splitlines()
        if line.startswith("data:")
    ]
    assert events[0]["type"] == "stage"
    assert events[0]["stage"] == "preparing"
    assert any(event["type"] == "draft_delta" for event in events)
    result = next(event for event in events if event["type"] == "result")
    assert result["episode_number"] == 1
    assert result["data"]["draft_master_script"]["content_spec_id"] == content_spec_id
    assert result["data"]["llm_raw_output"] == {}
    assert result["data"]["prompt_build_result"]["rendered_variables"] == {}
    assert result["data"]["prompt_build_result"]["prompt_text"] == (
        "Prompt omitted after streamed generation."
    )


@pytest.mark.anyio
async def test_generate_script_draft_stream_hides_internal_model_diagnostics() -> None:
    private_diagnostic = (
        "Real LLM output did not validate; Invalid paths: scenes.1.slug; "
        "json_error=line:1,column:1"
    )

    class InvalidDraftService:
        def generate_draft(self, _payload, *, progress_callback=None):
            if progress_callback is not None:
                progress_callback("stage", {"stage": "validating_draft"})
            raise InvalidDraftMasterScriptOutputError(private_diagnostic)

    app = create_app()
    app.dependency_overrides[get_script_generation_service] = InvalidDraftService
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/script-generation/generate-draft/stream",
            json={
                "content_spec_id": "content.private-diagnostic",
                "generation_strategy_id": "strategy.private-diagnostic",
                "output_language": "zh",
                "desired_scene_count": 3,
            },
        )

    events = [
        json.loads(line[5:].strip())
        for line in response.text.splitlines()
        if line.startswith("data:")
    ]
    error = next(event for event in events if event["type"] == "error")
    assert error["message"] == (
        "本集正文结构尚未完整生成，已保存的内容不会丢失，请重试当前集。"
    )
    assert private_diagnostic not in response.text
    assert error["error_type"] == "output_incomplete"
    assert "InvalidDraftMasterScriptOutputError" not in response.text


@pytest.mark.anyio
async def test_build_bilingual_script_view_endpoint() -> None:
    suffix = "bilingual_view_api"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id, generation_strategy_id = (
            await seed_script_generation_dependencies(client, suffix)
        )
        generated_response = await client.post(
            "/script-generation/generate-draft",
            json={
                "content_spec_id": content_spec_id,
                "generation_strategy_id": generation_strategy_id,
                "output_language": "en",
                "desired_scene_count": 3,
            },
        )
        assert generated_response.status_code == 200
        draft = generated_response.json()["data"]["draft_master_script"]

        response = await client.post(
            "/script-generation/build-bilingual-view",
            json={
                "generation_strategy_id": generation_strategy_id,
                "draft_master_script": draft,
                "target_language": "zh-CN",
            },
        )

    assert response.status_code == 200
    view = response.json()["data"]
    assert view["source_draft_master_script_id"] == draft["id"]
    assert view["source_language"] == "en"
    assert view["target_language"] == "zh-CN"
    assert any(item["path"] == "hook" for item in view["items"])
    assert any(
        item["path"] == "scenes.0.beat_summary"
        for item in view["items"]
    )
    assert view["warnings"]


@pytest.mark.anyio
async def test_episode_context_review_and_user_modification_api() -> None:
    suffix = "episode_authoring_api"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id, generation_strategy_id = await seed_script_generation_dependencies(
            client, suffix
        )
        generated_response = await client.post(
            "/script-generation/generate-draft",
            json={
                "content_spec_id": content_spec_id,
                "generation_strategy_id": generation_strategy_id,
                "output_language": "en",
                "desired_scene_count": 3,
                "episode_context": {
                    "generation_mode": "sequential",
                    "episode_number": 2,
                    "total_episodes": 4,
                    "previous_episode_summary": "The heroine rejected the false confession.",
                    "previous_episode_question": "Who forged the confession?",
                    "episode_instruction": "Make the reluctant ally take a visible risk.",
                    "project_continuity_summary": (
                        "Active story line: expose the conspiracy without sacrificing "
                        "the witness. Mara and Adrian remain distrustful allies."
                    ),
                    "batch_context": {
                        "batch_number": 2,
                        "start_episode": 2,
                        "end_episode": 4,
                        "batch_instruction": "Introduce a newly selected topical element.",
                    },
                },
            },
        )
        assert generated_response.status_code == 200
        source_run = generated_response.json()["data"]
        edited_draft = deepcopy(source_run["draft_master_script"])
        edited_draft["hook"] = "The reluctant ally burns his alibi to protect her."

        review_response = await client.post(
            "/script-generation/review-draft",
            json={
                "source_generation_run": source_run,
                "draft_master_script": edited_draft,
            },
        )
        assert review_response.status_code == 200
        reviewed_run = review_response.json()["data"]

        modification_response = await client.post(
            "/script-generation/modify-draft",
            json={
                "source_generation_run": reviewed_run,
                "source_draft_master_script": edited_draft,
                "instruction": "Increase the cost of the ally's decision.",
            },
        )

    assert source_run["episode_context"]["episode_number"] == 2
    assert source_run["episode_context"]["batch_context"]["batch_number"] == 2
    assert "SerializedEpisodeContract:" in source_run["prompt_build_result"]["prompt_text"]
    assert "Mara and Adrian remain distrustful allies" in (
        source_run["prompt_build_result"]["prompt_text"]
    )
    assert reviewed_run["draft_master_script"]["hook"] == edited_draft["hook"]
    assert modification_response.status_code == 200
    modification = modification_response.json()["data"]
    assert modification["instruction"] == "Increase the cost of the ally's decision."
    assert "UserDirectedModificationContract:" in (
        modification["candidate_generation_run"]["prompt_build_result"]["prompt_text"]
    )


@pytest.mark.anyio
async def test_generate_script_draft_rejects_unknown_static_knowledge_bundle() -> None:
    suffix = "scriptgen_unknown_knowledge_bundle"
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        content_spec_id, generation_strategy_id = (
            await seed_script_generation_dependencies(
                client,
                suffix,
                draft_knowledge_bundle_id="knowledge_bundle.draft.missing.v1",
            )
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
    assert "not present in the static catalog" in response.json()["detail"]


@pytest.mark.anyio
async def test_generate_script_draft_accepts_resolved_character_context() -> None:
    suffix = "scriptgen_creative_context_api"
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
                "resolved_creative_context": {
                    "schema_version": "v1",
                    "content_spec_id": content_spec_id,
                    "characters": [
                        {
                            "character_ref": "character.lena_api",
                            "name": "Lena",
                            "role": "protagonist",
                            "desire": "Discover the truth",
                            "belief": "Technology must be understood before trusted",
                            "moral_boundaries": [
                                "Never sacrifice humans for progress"
                            ],
                            "locked_fields": ["name", "moral_boundaries"],
                            "field_sources": {"belief": "ai_inferred"},
                        }
                    ],
                    "excluded_patterns": ["love triangle"],
                },
            },
        )

    assert response.status_code == 200
    data = response.json()["data"]
    character = data["resolved_creative_context"]["characters"][0]
    assert character["name"] == "Lena"
    assert character["field_sources"]["belief"] == "ai_inferred"
    prompt_text = data["prompt_build_result"]["prompt_text"]
    assert "ResolvedCreativeContext:" in prompt_text
    assert "Never sacrifice humans for progress" in prompt_text


@pytest.mark.anyio
async def test_generate_script_draft_rejects_mismatched_creative_context() -> None:
    suffix = "scriptgen_creative_context_mismatch"
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
                "resolved_creative_context": {
                    "content_spec_id": "different_content_spec",
                    "characters": [],
                },
            },
        )

    assert response.status_code == 422
    assert "does not match" in response.json()["detail"]


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
async def test_generate_script_draft_returns_503_for_missing_real_llm_config(
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

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "生成服务配置尚未完成，请联系管理员检查模型角色配置。"
    )
