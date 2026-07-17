import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from evaluation.script_evaluation import ScriptEvaluator


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
                "summary": "Open quickly with the core contradiction.",
            }
        ],
        "creator_rewards": [
            {
                "code": "retention_signal",
                "title": "Retention Signal",
                "summary": "Retention and rewatches matter.",
            }
        ],
        "ai_policies": [
            {
                "code": "ai_disclosure",
                "title": "AI Disclosure",
                "summary": "Match platform disclosure expectations.",
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
                "summary": "Keep it native to short-form vertical viewing.",
            }
        ],
        "publishing_strategy": {
            "recommended_posts_per_day": 2,
            "preferred_time_windows": ["12:00-14:00"],
            "notes": ["Prefer consistent test windows."],
        },
        "metadata": {"source": "e2e_test"},
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


def build_asset_payload(
    *,
    asset_id: str,
    asset_type: str,
    profile_id: str,
) -> dict:
    return {
        "id": asset_id,
        "asset_type": asset_type,
        "title": asset_id.replace(".", " ").title(),
        "summary": f"Reusable {asset_type} asset for short-form romance drama.",
        "tags": [
            {
                "ontology_node_id": "genre.romance",
                "label": "Romance",
                "category": "Genre",
                "confidence": 0.94,
            },
            {
                "ontology_node_id": "emotion.revenge",
                "label": "Revenge",
                "category": "Emotion",
                "confidence": 0.9,
            },
        ],
        "content": {
            "text": f"{asset_type} asset prepared for revenge-romance episodes.",
            "payload": {"source": "e2e_test"},
        },
        "applicable_platform_profile_ids": [profile_id],
        "metadata": {"source": "e2e_test"},
        "is_active": True,
    }


def build_prompt_library_payload(suffix: str) -> dict:
    return {
        "id": f"prompt.story_planning.{suffix}",
        "name": "Story Planning Prompt",
        "prompt_type": "story_planning",
        "target_module": "script_engine",
        "applicable_tags": ["genre.romance"],
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
                "synopsis": {"type": "string"},
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
        "applicable_tags": ["genre.romance"],
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
                "synopsis": {"type": "string"},
            },
        },
        "version": "v1",
        "status": "active",
    }


@pytest.mark.anyio
async def test_e2e_content_planning_pipeline_smoke() -> None:
    suffix = "e2e_smoke"
    profile_id = f"tiktok_v1_{suffix}"
    evaluator = ScriptEvaluator()

    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/platform-profiles",
            json=build_platform_profile_payload(profile_id),
        )
        assert response.status_code == 201

        for node_id, label, category in (
            ("genre.romance", "Romance", "Genre"),
            ("emotion.revenge", "Revenge", "Emotion"),
            ("genre.drama", "Drama", "Genre"),
            ("hook.fake_marriage", "Fake Marriage", "Hook"),
        ):
            response = await client.post(
                "/ontology-nodes",
                json=build_ontology_node_payload(node_id, label, category),
            )
            assert response.status_code in (201, 409)

        for asset_id, asset_type in (
            (f"character.lead_pair_{suffix}", "character"),
            (f"scene.wedding_set_{suffix}", "scene"),
        ):
            response = await client.post(
                "/assets",
                json=build_asset_payload(
                    asset_id=asset_id,
                    asset_type=asset_type,
                    profile_id=profile_id,
                ),
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

        pipeline_response = await client.post(
            "/data-intelligence/manual-json/pipeline",
            json={
                "platform_profile_id": profile_id,
                "audience_hint": "US TikTok viewers who love revenge-romance twists",
                "commercial_objective": "Find sequel-friendly concepts with strong retention potential",
                "records": [
                    {
                        "source_name": "manual_json",
                        "source_item_id": f"item_{suffix}",
                        "platform": "tiktok",
                        "title": "Bride's revenge wedding reveal",
                        "body_text": (
                            "A fake marriage explodes into revenge when the bride exposes "
                            "her fiance's betrayal in front of everyone."
                        ),
                        "author_handle": "creator_e2e",
                        "language": "en",
                        "region": "US",
                        "engagement": {
                            "view_count": 280000,
                            "like_count": 24000,
                            "comment_count": 1800,
                            "share_count": 1300,
                            "save_count": 920,
                            "completion_rate": 0.74,
                        },
                    }
                ],
            },
        )
        assert pipeline_response.status_code == 201
        pipeline_data = pipeline_response.json()
        content_spec_id = pipeline_data["content_spec"]["id"]

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

        finalization_response = await client.post(
            "/master-scripts/finalize",
            json={
                "script_generation_draft_run": draft_data,
                "script_revision_run": revision_data,
                "dialogue_line_count_per_scene": 2,
                "speaker_name_cycle": ["Heroine", "Counterpart"],
            },
        )
        assert finalization_response.status_code == 201
        final_data = finalization_response.json()["data"]

    revised_score = evaluator.evaluate(
        revision_data["revised_draft_master_script"],
        stage="revised_draft",
    ).score
    final_score = evaluator.evaluate(
        final_data["master_script"],
        stage="final",
    ).score

    assert len(pipeline_data["analysis_results"]) == 1
    assert pipeline_data["analysis_results"][0]["recommended_hook_type"]
    assert draft_data["draft_master_script"]["content_spec_id"] == content_spec_id
    assert draft_data["revision_plan"]["actions"]
    assert revision_data["improved"] is True
    assert (
        revision_data["revised_story_qc_report"]["overall_score"]
        >= revision_data["original_story_qc_report"]["overall_score"]
    )
    assert final_data["master_script"]["content_spec_id"] == content_spec_id
    assert final_data["master_script"]["scenes"][-1]["cliffhanger"] is True
    assert len(final_data["master_script"]["scenes"][0]["dialogues"]) == 2
    assert final_score >= revised_score
