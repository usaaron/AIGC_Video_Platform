from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path
import sys
from typing import Any

from httpx import AsyncClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.run_real_generation_validation import (
    build_generation_strategy_payload,
    build_ontology_node_payload,
    build_platform_profile_payload,
    build_prompt_library_payload,
)
from app.llm_runtime import get_llm_runtime_config


OVERSEAS_FRONTEND_ONTOLOGY_NODES = (
    ("genre.romance", "Romance", "Genre"),
    ("genre.dark_romance", "Dark Romance", "Genre"),
    ("genre.fantasy", "Fantasy", "Genre"),
    ("genre.scifi", "Sci-Fi", "Genre"),
    ("genre.mystery", "Mystery", "Genre"),
    ("genre.horror", "Horror", "Genre"),
    ("genre.comedy", "Comedy", "Genre"),
    ("genre.action", "Action", "Genre"),
    ("genre.historical", "Historical", "Genre"),
    ("genre.school", "School", "Genre"),
    ("genre.apocalypse", "Apocalypse", "Genre"),
    ("theme.revenge", "Revenge", "Theme"),
    ("theme.vampire", "Vampire", "Theme"),
    ("theme.rebirth", "Rebirth", "Theme"),
    ("theme.hidden_identity", "Hidden Identity", "Theme"),
    ("theme.time_loop", "Time Loop", "Theme"),
    ("theme.supernatural_power", "Supernatural Power", "Theme"),
    ("relationship.forbidden_love", "Forbidden Love", "Relationship"),
    ("relationship.contract", "Contract", "Relationship"),
    ("emotion.dark", "Dark", "Emotion"),
    ("emotion.suspense", "Suspense", "Emotion"),
    ("emotion.healing", "Healing", "Emotion"),
    ("emotion.passion", "Passion", "Emotion"),
    ("emotion.sweet", "Sweet", "Emotion"),
    ("emotion.tragic", "Tragic", "Emotion"),
    ("emotion.righteous_anger", "Righteous Anger", "Emotion"),
    ("audience.romance", "Romance Audience", "Audience"),
    ("audience.fantasy", "Fantasy Audience", "Audience"),
    ("audience.teen", "Teen Audience", "Audience"),
    ("audience.young_adult", "Young Adult", "Audience"),
    ("audience.mystery", "Mystery Fans", "Audience"),
    ("hook.immediate_conflict", "Immediate Conflict", "Hook"),
    ("cliffhanger.unanswered_threat", "Unanswered Threat", "Cliffhanger"),
)

MAINLAND_FRONTEND_ONTOLOGY_NODES = (
    ("genre.romance", "爱情", "Genre"),
    ("genre.dark_romance", "强情感虐恋", "Genre"),
    ("genre.modern_romance", "现代言情", "Genre"),
    ("genre.costume_romance", "古代言情", "Genre"),
    ("genre.urban", "都市", "Genre"),
    ("genre.fantasy", "玄幻", "Genre"),
    ("genre.xianxia", "仙侠", "Genre"),
    ("genre.wuxia", "武侠", "Genre"),
    ("genre.scifi", "科幻", "Genre"),
    ("genre.mystery", "悬疑", "Genre"),
    ("genre.horror", "惊悚", "Genre"),
    ("genre.comedy", "喜剧", "Genre"),
    ("genre.action", "动作", "Genre"),
    ("genre.historical", "历史", "Genre"),
    ("genre.school", "校园", "Genre"),
    ("genre.apocalypse", "末日", "Genre"),
    ("genre.family", "家庭伦理", "Genre"),
    ("theme.revenge", "复仇", "Theme"),
    ("theme.rebirth", "重生", "Theme"),
    ("theme.transmigration", "穿越", "Theme"),
    ("theme.system", "系统", "Theme"),
    ("theme.power_growth", "逆袭成长", "Theme"),
    ("theme.hidden_identity", "隐藏身份", "Theme"),
    ("theme.true_fake_heir", "真假千金", "Theme"),
    ("theme.wealthy_family", "豪门", "Theme"),
    ("theme.business_war", "商战", "Theme"),
    ("theme.palace_intrigue", "权谋", "Theme"),
    ("theme.investigation", "探案", "Theme"),
    ("theme.infinite_flow", "无限流", "Theme"),
    ("theme.apocalypse_survival", "末日求生", "Theme"),
    ("theme.supernatural_power", "异能", "Theme"),
    ("theme.cultivation", "修仙", "Theme"),
    ("theme.time_loop", "时间循环", "Theme"),
    ("theme.vampire", "吸血鬼", "Theme"),
    ("relationship.contract", "契约关系", "Relationship"),
    ("relationship.marriage_first_love_later", "先婚后爱", "Relationship"),
    ("relationship.reconciliation", "破镜重圆", "Relationship"),
    ("relationship.chasing_spouse", "追妻火葬场", "Relationship"),
    ("relationship.forbidden_love", "禁忌关系", "Relationship"),
    ("relationship.rivals_to_allies", "宿敌合作", "Relationship"),
    ("relationship.family_conflict", "家族冲突", "Relationship"),
    ("conflict.class_gap", "阶层差异", "Conflict"),
    ("conflict.identity_exposure", "身份暴露", "Conflict"),
    ("world.modern_city", "现代都市", "World"),
    ("world.ancient_court", "古代朝堂", "World"),
    ("emotion.satisfying", "爽感", "Emotion"),
    ("emotion.suspense", "悬念", "Emotion"),
    ("emotion.sweet", "甜宠", "Emotion"),
    ("emotion.tragic", "虐心", "Emotion"),
    ("emotion.healing", "治愈", "Emotion"),
    ("emotion.hot_blooded", "热血", "Emotion"),
    ("emotion.humorous", "轻松搞笑", "Emotion"),
    ("emotion.oppressive", "压迫感", "Emotion"),
    ("emotion.righteous_anger", "正义之怒", "Emotion"),
    ("audience.female_oriented", "女频受众", "Audience"),
    ("audience.male_oriented", "男频受众", "Audience"),
    ("audience.youth", "青年受众", "Audience"),
    ("audience.mature", "熟龄受众", "Audience"),
    ("audience.romance", "言情受众", "Audience"),
    ("audience.fantasy", "玄幻受众", "Audience"),
    ("audience.mystery", "悬疑受众", "Audience"),
    ("audience.family", "家庭题材受众", "Audience"),
    ("hook.crisis_opening", "开局危机", "Hook"),
    ("hook.goal_first", "目标先行", "Hook"),
    ("twist.identity_reversal", "身份反转", "Twist"),
    ("cliffhanger.new_threat", "新威胁", "Cliffhanger"),
    ("cliffhanger.reveal_withheld", "真相延迟", "Cliffhanger"),
    ("pace.steady_escalation", "稳步升级", "Pace"),
)

# Backward-compatible import for tests and scripts that assume the default market.
FRONTEND_ONTOLOGY_NODES = MAINLAND_FRONTEND_ONTOLOGY_NODES

DEFAULT_MARKET_PROFILE = "cn_mainland"
SUPPORTED_MARKET_PROFILES = {"cn_mainland", "overseas_tiktok"}


async def bootstrap(base_url: str, market_profile: str | None = None) -> None:
    market_profile = (
        market_profile or os.getenv("SCRIPT_MARKET_PROFILE", DEFAULT_MARKET_PROFILE)
    ).strip().lower()
    if market_profile not in SUPPORTED_MARKET_PROFILES:
        supported = ", ".join(sorted(SUPPORTED_MARKET_PROFILES))
        raise ValueError(
            f"Unsupported SCRIPT_MARKET_PROFILE '{market_profile}'. Use one of: {supported}."
        )

    if market_profile == "cn_mainland":
        suffix = "frontend_mvp_cn"
        profile_id = "cn_mainland_comic_drama_v1"
    else:
        suffix = "frontend_mvp"
        profile_id = "tiktok_frontend_mvp_v1"
    created = 0
    existing = 0

    async with AsyncClient(base_url=base_url, timeout=30, trust_env=False) as client:
        for path, payload in _bootstrap_payloads(
            profile_id,
            suffix,
            model_config=get_llm_runtime_config(),
            market_profile=market_profile,
        ):
            response = await client.post(path, json=payload)
            if response.status_code == 201:
                created += 1
                continue
            if response.status_code == 409:
                existing += 1
                continue
            raise RuntimeError(
                f"Frontend runtime bootstrap failed at {path}: "
                f"{response.status_code} {response.text}"
            )

    print(f"Frontend MVP runtime ready at {base_url}")
    print(f"Created resources: {created}")
    print(f"Already present: {existing}")
    print(f"Active market profile: {market_profile}")
    print("Reload the frontend before selecting tags or generating a draft.")


def _bootstrap_payloads(
    profile_id: str,
    suffix: str,
    *,
    model_config: Any | None = None,
    market_profile: str = DEFAULT_MARKET_PROFILE,
) -> list[tuple[str, dict[str, Any]]]:
    model_config = model_config or get_llm_runtime_config()
    if market_profile not in SUPPORTED_MARKET_PROFILES:
        raise ValueError(f"Unsupported market profile: {market_profile}")

    if market_profile == "cn_mainland":
        platform_payload = _build_mainland_platform_profile_payload(profile_id)
        prompt_payloads = _build_mainland_prompt_library_payload(suffix)
        strategy_payloads = [
            _build_mainland_generation_strategy_payload(suffix, model_config),
            _build_mainland_longform_knowledge_candidate_strategy_payload(
                suffix,
                model_config,
            ),
        ]
        ontology_nodes = MAINLAND_FRONTEND_ONTOLOGY_NODES
    else:
        platform_payload = build_platform_profile_payload(profile_id)
        prompt_payloads = build_prompt_library_payload(suffix)
        deepening_prompt = _build_deepening_prompt_payload(suffix)
        prompt_payloads.append(deepening_prompt)
        strategy_payloads = _build_overseas_generation_strategy_payloads(
            suffix,
            model_config,
            deepening_prompt_id=deepening_prompt["id"],
        )
        ontology_nodes = OVERSEAS_FRONTEND_ONTOLOGY_NODES

    payloads: list[tuple[str, dict[str, Any]]] = [
        ("/platform-profiles", platform_payload),
    ]
    payloads.extend(
        (
            "/ontology-nodes",
            _build_market_ontology_node_payload(
                node_id,
                label,
                category,
                market_profile=market_profile,
            ),
        )
        for node_id, label, category in ontology_nodes
    )
    payloads.extend(
        (
            "/assets",
            _build_scene_asset_payload(
                node_id=node_id,
                label=label,
                category=category,
                profile_id=profile_id,
                market_profile=market_profile,
            ),
        )
        for node_id, label, category in ontology_nodes
    )
    payloads.extend(
        ("/prompt-library", prompt_payload)
        for prompt_payload in prompt_payloads
    )
    payloads.extend(
        ("/generation-strategies", strategy_payload)
        for strategy_payload in strategy_payloads
    )
    return payloads


def _build_market_ontology_node_payload(
    node_id: str,
    label: str,
    category: str,
    *,
    market_profile: str,
) -> dict[str, Any]:
    payload = build_ontology_node_payload(node_id, label, category)
    if market_profile == "cn_mainland":
        payload["description"] = f"中国大陆长篇漫剧创作标签：{label}。"
        payload["aliases"] = [label]
    return payload


def _build_mainland_platform_profile_payload(profile_id: str) -> dict[str, Any]:
    return {
        "id": profile_id,
        "platform_name": "Mainland China Comic Drama",
        "version": "v1",
        "content_mode": "longform_story_to_comic_drama",
        "primary_regions": ["CN"],
        "supported_aspect_ratios": ["9:16", "16:9"],
        "recommendation_rules": [
            {
                "code": "serialized_continuity",
                "title": "Serialized Continuity",
                "summary": "Prioritize coherent long-form progression and recoverable setup/payoff.",
            }
        ],
        "creator_rewards": [
            {
                "code": "platform_neutral",
                "title": "Platform Neutral",
                "summary": "Do not assume one distributor's monetization or release rules.",
            }
        ],
        "ai_policies": [
            {
                "code": "ai_provenance",
                "title": "AI Provenance Readiness",
                "summary": "Preserve source and AI-generation lineage for later review and disclosure.",
            }
        ],
        "community_guidelines": [
            {
                "code": "mainland_review",
                "title": "Mainland Content Review",
                "summary": "Keep content suitable for applicable mainland China review and filing workflows.",
            }
        ],
        "best_practices": [
            {
                "code": "source_story_first",
                "title": "Source Story First",
                "summary": "Build a coherent story foundation before adapting it into production episodes.",
            }
        ],
        "publishing_strategy": {
            "recommended_posts_per_day": 1,
            "preferred_time_windows": ["platform_defined"],
            "notes": [
                "Reference profile only; publishing cadence is selected by the eventual platform."
            ],
        },
        "metadata": {
            "source": "frontend_mvp_runtime_bootstrap",
            "market_profile": "cn_mainland",
            "runtime_status": "active",
            "reference_platforms": ["hongguo"],
            "platform_binding": "none",
        },
    }


def _build_mainland_prompt_library_payload(suffix: str) -> list[dict[str, Any]]:
    return [
        {
            "id": f"prompt.story_planning.{suffix}",
            "name": "China Mainland Story Foundation Prompt",
            "prompt_type": "story_planning",
            "target_module": "script_engine",
            "applicable_tags": [],
            "target_platform": "mainland_china",
            "target_audience": "Mainland China serialized comic-drama audience",
            "version": "v1",
            "prompt_template": (
                "根据结构化创作意图和已批准单集线路图，生成中文连载漫剧的单集正式可拍摄剧本正文。"
                "线路图负责约束本集目标、冲突、转折和退出状态，不要重新规划剧情。优先保持人物动机、关系、世界规则和前后状态一致；"
                "每个场景必须包含明确目标、有效阻力和改变故事状态的结果，后续场景应由此前结果推动。"
                "不得套用 TikTok、海外短视频或固定付费卡点规则，不得擅自改变用户锁定的人物设定。"
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
                "target_script_body_characters",
                "output_json_schema",
            ],
            "output_schema": {"type": "object"},
            "evaluation_notes": [
                "Generate one bounded production-readable episode body from the approved route.",
                "Prefer continuity and consequential character choices over disconnected short-form shocks.",
                "Hongguo is a market reference, not a hard platform contract.",
            ],
        },
        {
            "id": f"prompt.mainland_serialization.{suffix}",
            "name": "Mainland China Serialization Prompt",
            "prompt_type": "commercial_evaluation",
            "target_module": "script_engine",
            "applicable_tags": [],
            "target_platform": "mainland_china",
            "target_audience": "Mainland China serialized comic-drama audience",
            "version": "v1",
            "prompt_template": (
                "检查本集是否推进主线或人物关系、是否留下可追踪的后续责任，并避免重复冲突、空转场景和无依据反转。"
                "只使用当前输入提供的题材、人物和约束，不把特定平台爆款公式当作强制结构。"
            ),
            "input_variables": [
                "content_spec_json",
                "platform_constraints",
                "hook_requirement",
                "cliffhanger_requirement",
                "cultural_fit_requirement",
            ],
            "output_schema": {"type": "object"},
            "evaluation_notes": [
                "This is a bounded generation instruction, not professional mainland-market validation.",
                "Recursive planning must preserve short-episode payoff, hook, and continuity contracts.",
            ],
        },
    ]


def _build_mainland_generation_strategy_payload(
    suffix: str,
    model_config: Any,
) -> dict[str, Any]:
    story_prompt_id = f"prompt.story_planning.{suffix}"
    serialization_prompt_id = f"prompt.mainland_serialization.{suffix}"
    return {
        "id": "strategy.cn_mainland.frontend_mvp.general.v1",
        "name": "Mainland China Serialized Short-Drama Foundation Strategy",
        "target_platform": "mainland china comic drama",
        "target_content_type": "serialized_ai_comic_source_story",
        "applicable_tags": [],
        "model_provider": model_config.provider,
        "model_name": model_config.model_name,
        "temperature": 0.6,
        "top_p": 0.9,
        "max_tokens": 6000,
        "workflow_steps": [
            {
                "step_order": 1,
                "name": "story_foundation",
                "description": "Generate a causally connected Chinese episode framework.",
                "prompt_id": story_prompt_id,
                "multi_turn_enabled": False,
                "structured_output_required": True,
            },
            {
                "step_order": 2,
                "name": "mainland_serialization_check",
                "description": "Preserve continuity and avoid unsupported platform formulas.",
                "prompt_id": serialization_prompt_id,
                "multi_turn_enabled": False,
                "structured_output_required": True,
            },
        ],
        "prompt_ids": [story_prompt_id, serialization_prompt_id],
        "draft_knowledge_bundle_id": (
            "knowledge_bundle.draft.cn_mainland_serial_short_drama.v1"
        ),
        "deepening_mode": "disabled",
        "deepening_prompt_ids": [],
        "deepening_knowledge_bundle_id": None,
        "qc_enabled": True,
        "self_check_enabled": True,
        "human_review_required": True,
        "output_schema": {"type": "object"},
        "version": "v1",
        # Keep the foundation strategy available for explicit comparisons; the
        # active compatibility strategy below uses the same short-drama contract.
        "status": "draft",
    }


def _build_mainland_longform_knowledge_candidate_strategy_payload(
    suffix: str,
    model_config: Any,
) -> dict[str, Any]:
    payload = _build_mainland_generation_strategy_payload(suffix, model_config)
    payload.update(
        {
            "id": "strategy.cn_mainland.longform_knowledge_candidate.v2",
            "name": "Mainland China Serialized Short-Drama Strategy v3",
            "draft_knowledge_bundle_id": (
                "knowledge_bundle.draft.cn_mainland_serial_short_drama.v1"
            ),
            "version": "v3",
            "status": "active",
        }
    )
    return payload


def _build_overseas_generation_strategy_payloads(
    suffix: str,
    model_config: Any,
    *,
    deepening_prompt_id: str,
) -> list[dict[str, Any]]:
    general_strategy = build_generation_strategy_payload(suffix, model_config)
    general_strategy.update(
        {
            "name": "TikTok General Creator Strategy",
            "applicable_tags": [],
            "deepening_mode": "shadow",
            "deepening_prompt_ids": [deepening_prompt_id],
            "deepening_max_tokens": 4000,
            "deepening_max_expressive_growth_ratio": 0.35,
        }
    )
    dark_romance_strategy = build_generation_strategy_payload(suffix, model_config)
    dark_romance_strategy.update(
        {
            "id": "strategy.tiktok.frontend_mvp.dark_romance.v1",
            "name": "TikTok Dark Romance Knowledge + Deepening Strategy",
            "applicable_tags": ["genre.dark_romance"],
            "draft_knowledge_bundle_id": (
                "knowledge_bundle.draft.dark_romance_tiktok.v1"
            ),
            "deepening_mode": "shadow",
            "deepening_prompt_ids": [deepening_prompt_id],
            "deepening_knowledge_bundle_id": (
                "knowledge_bundle.deepening.dark_romance_tiktok.v1"
            ),
            "deepening_max_tokens": 4000,
            "deepening_max_expressive_growth_ratio": 0.35,
        }
    )
    return [general_strategy, dark_romance_strategy]


def _build_deepening_prompt_payload(suffix: str) -> dict[str, Any]:
    return {
        "id": f"prompt.creative_deepening.{suffix}",
        "name": "Creative Deepening Shadow Prompt",
        "prompt_type": "creative_deepening",
        "target_module": "script_engine",
        "applicable_tags": ["genre.dark_romance"],
        "target_platform": "tiktok",
        "target_audience": "US short-form drama viewers",
        "version": "v1",
        "prompt_template": (
            "Deepen character expression, dialogue subtext, emotional progression, "
            "visual actions, and scene intensity. Preserve premise, character identity, "
            "major conflicts, scene causal links, ending direction, and cliffhanger purpose."
        ),
        "input_variables": [],
        "output_schema": {"type": "object"},
        "evaluation_notes": [
            "Shadow candidate only; never replace the selected draft automatically.",
            "Reject premise, identity, causal-chain, or cliffhanger-purpose drift.",
        ],
    }


def _build_scene_asset_payload(
    *,
    node_id: str,
    label: str,
    category: str,
    profile_id: str,
    market_profile: str = DEFAULT_MARKET_PROFILE,
) -> dict[str, Any]:
    is_mainland = market_profile == "cn_mainland"
    return {
        "id": f"scene.frontend_mvp_{node_id.replace('.', '_')}",
        "asset_type": "scene",
        "title": f"可适配的{label}创作参考" if is_mainland else f"Adaptable {label} Story Setting",
        "summary": (
            "用于中国大陆长篇漫剧创作的通用标签参考，不预设固定情节。"
            if is_mainland
            else "A generic scene-setting source for local frontend generation validation."
        ),
        "tags": [
            {
                "ontology_node_id": node_id,
                "label": label,
                "category": category,
                "confidence": 1.0,
            }
        ],
        "content": {
            "text": (
                "根据用户创作意图使用该标签，不得将标签扩写成固定套路或替代用户设定。"
                if is_mainland
                else "Adapt the location to the selected story intent without imposing a fixed plot."
            ),
            "payload": {
                "source": "frontend_mvp_runtime_bootstrap",
                "market_profile": market_profile,
            },
        },
        "applicable_platform_profile_ids": [profile_id],
        "metadata": {
            "source": "frontend_mvp_runtime_bootstrap",
            "market_profile": market_profile,
        },
        "is_active": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Initialize the in-memory API resources required by the Frontend MVP.",
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8000",
        help="Running FastAPI base URL.",
    )
    parser.add_argument(
        "--market-profile",
        choices=sorted(SUPPORTED_MARKET_PROFILES),
        default=None,
        help=(
            "Runtime market profile. Defaults to SCRIPT_MARKET_PROFILE or cn_mainland."
        ),
    )
    arguments = parser.parse_args()
    asyncio.run(
        bootstrap(
            arguments.base_url.rstrip("/"),
            market_profile=arguments.market_profile,
        )
    )


if __name__ == "__main__":
    main()
