from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys
from typing import Any

from httpx import ASGITransport, AsyncClient

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.llm_runtime import get_llm_runtime_config
from app.main import create_app


OUTPUT_DIR = ROOT_DIR / "examples" / "real_generation"


def build_platform_profile_payload(profile_id: str) -> dict[str, Any]:
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
                "summary": "Open with the core contradiction in the first seconds.",
            }
        ],
        "creator_rewards": [
            {
                "code": "retention_signal",
                "title": "Retention Signal",
                "summary": "Prioritize retention, rewatches, and comment-provoking reveals.",
            }
        ],
        "ai_policies": [
            {
                "code": "ai_disclosure",
                "title": "AI Disclosure",
                "summary": "Keep the output safe for AI-assisted publishing workflows.",
            }
        ],
        "community_guidelines": [
            {
                "code": "safety_compliance",
                "title": "Safety Compliance",
                "summary": "Avoid explicit harm, hateful framing, or disallowed shock content.",
            }
        ],
        "best_practices": [
            {
                "code": "vertical_native",
                "title": "Vertical Native",
                "summary": "Favor short scenes, public reveals, and audio-friendly lines.",
            }
        ],
        "publishing_strategy": {
            "recommended_posts_per_day": 2,
            "preferred_time_windows": ["12:00-14:00"],
            "notes": ["Use consistent test windows for serialized drama."],
        },
        "metadata": {"source": "real_generation_validation"},
    }


def build_ontology_node_payload(node_id: str, label: str, category: str) -> dict[str, Any]:
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
) -> dict[str, Any]:
    return {
        "id": asset_id,
        "asset_type": asset_type,
        "title": asset_id.replace(".", " ").title(),
        "summary": f"Reusable {asset_type} asset for dark romance revenge episodes.",
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
            "text": f"{asset_type} asset prepared for wedding-reveal serialized shorts.",
            "payload": {"source": "real_generation_validation"},
        },
        "applicable_platform_profile_ids": [profile_id],
        "metadata": {"source": "real_generation_validation"},
        "is_active": True,
    }


def build_prompt_library_payload(suffix: str) -> list[dict[str, Any]]:
    return [
        {
            "id": f"prompt.story_planning.{suffix}",
            "name": "Story Planning Prompt",
            "prompt_type": "story_planning",
            "target_module": "script_engine",
            "applicable_tags": ["genre.romance"],
            "target_platform": "tiktok",
            "target_audience": "US women 18-34",
            "version": "v2",
            "prompt_template": (
                "Generate a high-retention short-form dramatic episode from the supplied structured context. "
                "The opening hook must stop the scroll immediately, the protagonist must show agency, "
                "and the ending must force the next episode."
            ),
            "input_variables": [
                "content_spec_json",
                "creative_brief_json",
                "platform_profile_json",
                "retrieved_assets_json",
                "generation_strategy_json",
                "output_language",
                "desired_scene_count",
                "target_duration_seconds",
                "output_json_schema",
            ],
            "output_schema": {"type": "object"},
            "evaluation_notes": [
                "Prefer natural dialogue over slogans.",
                "Keep every scene causally connected.",
            ],
        },
        {
            "id": f"prompt.tiktok_optimization.{suffix}",
            "name": "TikTok Optimization Prompt",
            "prompt_type": "tiktok_optimization",
            "target_module": "script_engine",
            "applicable_tags": ["genre.romance"],
            "target_platform": "tiktok",
            "target_audience": "US women 18-34",
            "version": "v1",
            "prompt_template": (
                "Optimize for TikTok pacing, cultural clarity, and sequel curiosity. "
                "Keep lines short enough to perform and subtitle cleanly."
            ),
            "input_variables": [
                "platform_constraints",
                "hook_requirement",
                "cliffhanger_requirement",
                "cultural_fit_requirement",
            ],
            "output_schema": {"type": "object"},
            "evaluation_notes": [
                "Front-load tension.",
                "End with a comment-driving unanswered question.",
            ],
        },
    ]


def build_generation_strategy_payload(suffix: str, config) -> dict[str, Any]:
    return {
        "id": f"strategy.tiktok.real_validation.{suffix}.v1",
        "name": "TikTok Real Validation Strategy",
        "target_platform": "tiktok",
        "target_content_type": "ai_comic_drama",
        "applicable_tags": ["genre.romance"],
        "model_provider": config.provider,
        "model_name": config.model_name,
        "temperature": 0.6,
        "top_p": 0.9,
        "max_tokens": 4000,
        "workflow_steps": [
            {
                "step_order": 1,
                "name": "story_planning",
                "description": "Generate the dramatic episode draft as structured JSON.",
                "prompt_id": f"prompt.story_planning.{suffix}",
                "multi_turn_enabled": False,
                "structured_output_required": True,
            },
            {
                "step_order": 2,
                "name": "tiktok_optimization",
                "description": "Tighten pacing, hook density, and cliffhanger pressure.",
                "prompt_id": f"prompt.tiktok_optimization.{suffix}",
                "multi_turn_enabled": False,
                "structured_output_required": True,
            },
        ],
        "prompt_ids": [
            f"prompt.story_planning.{suffix}",
            f"prompt.tiktok_optimization.{suffix}",
        ],
        "qc_enabled": True,
        "self_check_enabled": True,
        "human_review_required": False,
        "output_schema": {"type": "object"},
        "version": "v1",
        "status": "active",
    }


def build_pipeline_payload(profile_id: str, suffix: str) -> dict[str, Any]:
    return {
        "platform_profile_id": profile_id,
        "audience_hint": "US TikTok viewers who binge dark romance, betrayal, and revenge arcs",
        "commercial_objective": "Find sequel-friendly concepts with strong retention and comment debate",
        "records": [
            {
                "source_name": "manual_json",
                "source_item_id": f"item_{suffix}",
                "platform": "tiktok",
                "title": "Bride's revenge wedding reveal",
                "body_text": (
                    "A fake marriage explodes into revenge when the bride realizes the groom "
                    "is tied to the betrayal she came to expose, and the ceremony becomes a public trap."
                ),
                "author_handle": "creator_real_validation",
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
                "metadata": {
                    "hashtags": ["#darkromance", "#revenge", "#weddingdrama"],
                },
            }
        ],
    }


async def main() -> None:
    config = get_llm_runtime_config()
    if config.use_mock_adapter:
        raise RuntimeError(
            "Real generation validation requires a non-mock LLM configuration. "
            "Set LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, and LLM_BASE_URL first."
        )

    suffix = "real_generation"
    profile_id = f"tiktok_v1_{suffix}"
    app = create_app()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        await _post_json(
            client,
            "/platform-profiles",
            build_platform_profile_payload(profile_id),
            expected_status=201,
        )

        for node_id, label, category in (
            ("genre.romance", "Romance", "Genre"),
            ("emotion.revenge", "Revenge", "Emotion"),
            ("genre.drama", "Drama", "Genre"),
            ("hook.wedding_reveal", "Wedding Reveal", "Hook"),
            ("cliffhanger.identity_reveal", "Identity Reveal", "Cliffhanger"),
        ):
            await _post_json(
                client,
                "/ontology-nodes",
                build_ontology_node_payload(node_id, label, category),
                expected_statuses={201, 409},
            )

        for asset_id, asset_type in (
            (f"character.lead_pair_{suffix}", "character"),
            (f"scene.wedding_set_{suffix}", "scene"),
        ):
            await _post_json(
                client,
                "/assets",
                build_asset_payload(
                    asset_id=asset_id,
                    asset_type=asset_type,
                    profile_id=profile_id,
                ),
                expected_status=201,
            )

        for prompt_payload in build_prompt_library_payload(suffix):
            await _post_json(
                client,
                "/prompt-library",
                prompt_payload,
                expected_status=201,
            )

        generation_strategy_response = await _post_json(
            client,
            "/generation-strategies",
            build_generation_strategy_payload(suffix, config),
            expected_status=201,
        )
        generation_strategy_id = generation_strategy_response["data"]["id"]

        pipeline_response = await _post_json(
            client,
            "/data-intelligence/manual-json/pipeline",
            build_pipeline_payload(profile_id, suffix),
            expected_status=201,
        )
        content_spec_id = pipeline_response["content_spec"]["id"]

        draft_response = await _post_json(
            client,
            "/script-generation/generate-draft",
            {
                "content_spec_id": content_spec_id,
                "generation_strategy_id": generation_strategy_id,
                "output_language": "en",
                "desired_scene_count": 3,
            },
            expected_status=200,
        )

        revision_response = await _post_json(
            client,
            "/script-generation/revise-draft",
            {
                "draft_master_script": draft_response["data"]["draft_master_script"],
                "revision_plan": draft_response["data"]["revision_plan"],
            },
            expected_status=200,
        )

        finalization_response = await _post_json(
            client,
            "/master-scripts/finalize",
            {
                "script_generation_draft_run": draft_response["data"],
                "script_revision_run": revision_response["data"],
                "dialogue_line_count_per_scene": 2,
                "speaker_name_cycle": ["Heroine", "Counterpart"],
            },
            expected_status=201,
        )

    final_master_script = finalization_response["data"]["master_script"]
    _write_json(OUTPUT_DIR / "final_master_script.json", final_master_script)
    _write_json(
        OUTPUT_DIR / "story_qc_report.json",
        {
            "draft_story_qc_report": draft_response["data"]["story_qc_report"],
            "re_qc_report": revision_response["data"]["revised_story_qc_report"],
            "revision_mode": "rule_based_placeholder",
        },
    )
    _write_json(
        OUTPUT_DIR / "revision_plan.json",
        draft_response["data"]["revision_plan"],
    )
    _write_text(
        OUTPUT_DIR / "generated_prompt.txt",
        draft_response["data"]["prompt_build_result"]["prompt_text"],
    )
    _write_text(
        OUTPUT_DIR / "final_master_script.md",
        render_master_script_markdown(final_master_script),
    )

    lineage = final_master_script["lineage"]
    print("Step 1. AnalysisResult -> ContentSpec complete")
    print(f"  ContentSpec ID: {content_spec_id}")
    print(f"  GenerationStrategy ID: {generation_strategy_id}")
    print("Step 2. Draft generation complete")
    print(
        f"  Draft ID: {draft_response['data']['draft_master_script']['id']} | "
        f"Prompt IDs: {', '.join(draft_response['data']['selected_prompt_ids'])}"
    )
    print("Step 3. Revision complete")
    print(
        f"  Revised Draft ID: {revision_response['data']['revised_draft_master_script']['id']} | "
        f"Re-QC Score: {revision_response['data']['revised_story_qc_report']['overall_score']}"
    )
    print("Step 4. Finalization complete")
    print(f"  Final MasterScript ID: {final_master_script['id']}")
    print("Final lineage:")
    print(json.dumps(lineage, indent=2, ensure_ascii=False))


async def _post_json(
    client: AsyncClient,
    path: str,
    payload: dict[str, Any],
    *,
    expected_status: int | None = None,
    expected_statuses: set[int] | None = None,
) -> dict[str, Any]:
    response = await client.post(path, json=payload)
    allowed_statuses = expected_statuses or ({expected_status} if expected_status is not None else set())
    if response.status_code not in allowed_statuses:
        raise RuntimeError(
            f"{path} failed with status {response.status_code}: {response.text}"
        )
    if response.status_code == 409:
        return {"detail": "already_exists"}
    return response.json()


def render_master_script_markdown(master_script: dict[str, Any]) -> str:
    lines = [
        f"# {master_script['title']}",
        "",
        f"**Logline**: {master_script.get('logline') or 'N/A'}",
        f"**Synopsis**: {master_script['synopsis']}",
        f"**Hook**: {master_script['hook']}",
        f"**Target Audience**: {master_script.get('target_audience') or 'N/A'}",
        f"**Target Platform**: {master_script.get('target_platform') or 'N/A'}",
        f"**Language**: {master_script['language']}",
        f"**Episode Goal**: {master_script['episode_goal']}",
        "",
        "## Characters",
        "",
    ]

    for character in master_script.get("characters", []):
        lines.extend(
            [
                f"### {character['name']}",
                f"- Role: {character['role']}",
                f"- Description: {character['description']}",
                f"- Motivation: {character['motivation']}",
                "",
            ]
        )

    lines.extend(["## Scenes", ""])
    for scene in master_script["scenes"]:
        lines.extend(
            [
                _render_scene_heading(scene),
                f"- Purpose: {scene['purpose']}",
                f"- Setting: {scene['setting']}",
                f"- Beat Summary: {scene['beat_summary']}",
                f"- Emotional Shift: {_humanize_emotional_shift(scene['emotional_shift'])}",
                f"- Emotional Objective: {scene.get('emotional_objective') or 'N/A'}",
                f"- Turning Point: {scene.get('turning_point') or 'N/A'}",
                f"- Cliffhanger: {'Yes' if scene['cliffhanger'] else 'No'}",
                "",
                "#### Character Actions",
                "",
            ]
        )
        character_actions = scene.get("character_actions", [])
        if character_actions:
            for action in character_actions:
                lines.append(f"- {_normalize_sentence(action)}")
        else:
            lines.append("- N/A")
        lines.extend(
            [
                "",
                "#### Dialogue",
                "",
            ]
        )
        for dialogue in scene["dialogues"]:
            lines.append(
                f"- **{dialogue['character_name']}** ({_normalize_sentence(dialogue['intent'], trailing_period=False)}): {_normalize_sentence(dialogue['text'])}"
            )
        lines.append("")

    lines.extend(
        [
            "## Ending",
            "",
            f"- Cliffhanger Strength: {'Episode ends on a cliffhanger.' if master_script['scenes'][-1]['cliffhanger'] else 'No cliffhanger.'}",
            f"- Next Episode Question: {master_script.get('next_episode_question') or 'N/A'}",
            "",
            "## Lineage",
            "",
            "```json",
            json.dumps(master_script["lineage"], indent=2, ensure_ascii=False),
            "```",
            "",
        ]
    )
    return "\n".join(lines)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _write_text(path: Path, content: str) -> None:
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def _humanize_emotional_shift(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return "N/A"
    if "_to_" in normalized:
        start, end = normalized.split("_to_", maxsplit=1)
        return f"{_humanize_token_group(start)} to {_humanize_token_group(end)}."
    return _normalize_sentence(normalized.replace("_", " "))


def _humanize_token_group(value: str) -> str:
    return value.replace("_", " ").strip().capitalize()


def _render_scene_heading(scene: dict[str, Any]) -> str:
    scene_number = scene["scene_number"]
    slug = scene["slug"].strip()
    lowered = slug.lower()
    if lowered.startswith(f"scene {scene_number}".lower()):
        return f"### {slug}"
    return f"### Scene {scene_number}: {slug}"


def _normalize_sentence(value: str, *, trailing_period: bool = True) -> str:
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return "N/A"
    if trailing_period:
        return cleaned if cleaned.endswith((".", "!", "?")) else f"{cleaned}."
    return cleaned


if __name__ == "__main__":
    asyncio.run(main())
