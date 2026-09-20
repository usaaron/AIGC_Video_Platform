"""Shared market, language, and cultural-context contract for generation workflows.

The platform profile remains the delivery/format selector.  This module supplies
the higher-level market path that every planning and generation stage must obey.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from app.script_delivery_contract import OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT


CN_MAINLAND_MARKET = "cn_mainland"
OVERSEAS_TIKTOK_MARKET = "overseas_tiktok"
SUPPORTED_MARKET_PROFILES = frozenset({CN_MAINLAND_MARKET, OVERSEAS_TIKTOK_MARKET})


CREATOR_INTERACTION_LANGUAGE_CONTRACT = (
    "创作者交互语言合同：无论大陆还是海外发行，所有面向创作者的助手回复、解释、"
    "建议、确认、问题、审校意见、大纲、规划、场景动作和画面描述都使用简体中文。"
    "若接口提供可展示的模型思考过程或摘要，也必须使用简体中文，不因上下文、"
    "技术说明或引用材料含英文而改用英文解释。过程信息仅使用接口原有的过程通道，"
    "不得混入最终正文或JSON结果，不得新增思考字段或改变要求的输出结构。"
    "海外路径的正式剧本人物对白使用英文：dialogues.text保留英文原句，"
    "dialogues.chinese_translation在同一次输出中逐句提供对应的简体中文翻译；"
    "不要将英文对白翻译后替换原句，也不要在同一text字段混写中英台词。"
    "另有一项严格受限的引文例外：仅当当前任务明确授权海外人物声音样本时，"
    "acting_profile.permanentVoicePrompt中按“情境｜EN: …｜中译: …”格式逐行提供的"
    "原创对白风格引文，其EN部分允许英文；情境仅取拒绝、撒谎、示弱、亲近者、对手，"
    "最多三条，每条必须附准确中文释义，字段其余描述仍用简体中文。"
    "这些引文仅作声音风格参考，不是已发生的剧情事实，也不是英文助手回复；"
    "不得直接复制为本集剧情，不得将例外扩展到解释、建议、审校、规划叙述或其他人物字段。"
    "大陆路径及当前任务未明确授权时不启用该引文例外。"
    "大陆路径人物对白直接使用简体中文，按既有合同将chinese_translation填写null。"
    "保留已确认的稳定人物身份和专名：海外人物在中文叙述及译文中仍沿用其稳定英文姓名；"
    "不要翻译或改写JSON键名、枚举值、标识符以及INT./EXT.等技术标记。"
    "OutputLanguage=en仅指定海外正式对白的语言，不改变其余创作者交互语言。"
)


@dataclass(frozen=True)
class MarketProfileContract:
    """Resolved workflow contract for one market path."""

    profile: str
    family: str
    output_language: str
    language_name: str
    cultural_context: str
    prompt_contract: str

    @property
    def is_mainland(self) -> bool:
        return self.family == CN_MAINLAND_MARKET


_CONTRACTS = {
    CN_MAINLAND_MARKET: MarketProfileContract(
        profile=CN_MAINLAND_MARKET,
        family=CN_MAINLAND_MARKET,
        output_language="zh",
        language_name="Simplified Chinese (zh-CN)",
        cultural_context="Chinese-language and Chinese-mainland cultural context.",
        prompt_contract=(
            "Market path: cn_mainland. Use Simplified Chinese (zh-CN) for every "
            "human-readable value, name, label, planning field, and dialogue. "
            "You are creating a Chinese mainland serialized comic story. Follow "
            "Chinese-mainland language and cultural context. Do not switch "
            "to English output or overseas cultural assumptions."
            + "\n" + CREATOR_INTERACTION_LANGUAGE_CONTRACT
        ),
    ),
    OVERSEAS_TIKTOK_MARKET: MarketProfileContract(
        profile=OVERSEAS_TIKTOK_MARKET,
        family="overseas",
        output_language="en",
        # The creator-facing planning artifacts remain in Simplified Chinese.
        # ``output_language`` stays English because the established overseas
        # screenplay contract uses English dialogue for the audience-facing
        # delivery while keeping actions and intent in Chinese.
        language_name="Simplified Chinese (zh-CN), with stable English character names",
        cultural_context=(
            "English-language overseas/international cultural context by default; "
            "do not assume a specific country until a country profile is selected."
        ),
        prompt_contract=(
            "Market path: overseas (current profile: overseas_tiktok). Keep all "
            "creator-facing planning artifacts, including the Story Bible, story tree, "
            "episode roadmap, labels, and review text, in Simplified Chinese so the "
            "Chinese-speaking author can review them. Preserve the established partner "
            "screenplay delivery template: actions, visual descriptions, and performance "
            "intent remain Simplified Chinese. Every character name, including names within Chinese "
            "actions, performance cues, translations, character cards and planning, stays in its "
            "stable English spelling; spoken dialogue uses natural English. Do not translate names "
            "or display Chinese aliases. When adapting Chinese source material, establish each "
            "character's English name once in the character registry and apply it consistently "
            "throughout every newly authored field, especially ending_direction, locked_facts, "
            "entry_state and exit_state. Do not copy Chinese source names back into those fields "
            "after assigning English registry names. Preserve original uploaded documents and "
            "historical versions unchanged. Follow the default "
            "English-language overseas/international cultural context. Do not assume a "
            "specific country; country-specific profiles will be added later. Do not "
            "apply Chinese-mainland cultural assumptions. "
            + OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT
            + "\n" + CREATOR_INTERACTION_LANGUAGE_CONTRACT
        ),
    ),
}


def canonical_market_profile(value: Any, *, platform_profile_id: str | None = None) -> str:
    """Return the current canonical profile key, preserving legacy defaults."""

    token = str(value or "").strip().casefold().replace("-", "_")
    if token in {"overseas", "international", "overseas_tiktok", "tiktok"}:
        return OVERSEAS_TIKTOK_MARKET
    if token in {"cn", "china", "mainland", "cn_mainland", "mainland_china"}:
        return CN_MAINLAND_MARKET

    platform_token = str(platform_profile_id or "").strip().casefold()
    if platform_token.startswith("overseas"):
        return OVERSEAS_TIKTOK_MARKET
    if platform_token.startswith("cn_") or "mainland" in platform_token:
        return CN_MAINLAND_MARKET
    # Existing projects created before market metadata was introduced were
    # mainland by default. Preserve that compatibility boundary explicitly.
    return CN_MAINLAND_MARKET


def market_profile_contract(
    value: Any = None,
    *,
    platform_profile_id: str | None = None,
) -> MarketProfileContract:
    profile = canonical_market_profile(value, platform_profile_id=platform_profile_id)
    return _CONTRACTS[profile]


def content_spec_market_profile(content_spec: Any) -> str:
    metadata = getattr(content_spec, "metadata", None)
    metadata = metadata if isinstance(metadata, dict) else {}
    return canonical_market_profile(
        metadata.get("market_profile"),
        platform_profile_id=getattr(
            getattr(content_spec, "platform_goal", None),
            "platform_profile_id",
            None,
        ),
    )


def content_spec_market_contract(content_spec: Any, *, planning: bool = False) -> MarketProfileContract:
    from app.modules.content_spec.overseas_story_profile import content_spec_overseas_story_profile
    contract = market_profile_contract(content_spec_market_profile(content_spec))
    return market_contract_with_overseas_story_profile(
        contract, content_spec_overseas_story_profile(content_spec), planning=planning,
    )


def market_contract_with_overseas_story_profile(
    contract: MarketProfileContract, value: object, *, planning: bool = False,
) -> MarketProfileContract:
    from app.modules.content_spec.overseas_story_profile import normalize_overseas_story_profile, overseas_story_profile_contract
    profile = normalize_overseas_story_profile(value)
    if contract.is_mainland or profile is None:
        return contract
    prompt = contract.prompt_contract.replace(
        "specific country; country-specific profiles will be added later.",
        "specific country unless the author or approved story explicitly establishes it.",
    )
    return replace(contract, prompt_contract=prompt + "\n" + overseas_story_profile_contract(profile, planning=planning))


def market_profile_metadata(
    *,
    profile: Any = None,
    platform_profile_id: str | None = None,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build normalized metadata persisted on ContentSpec."""

    profile_metadata = getattr(profile, "metadata", None)
    profile_metadata = profile_metadata if isinstance(profile_metadata, dict) else {}
    # A platform profile is authoritative when it explicitly declares a market.
    # A caller-supplied ContentSpec market is still checked against it so a
    # release path cannot be silently changed by normalization.
    declared = profile_metadata.get("market_profile")
    existing_profile = (existing or {}).get("market_profile") if existing else None
    platform_token = str(platform_profile_id or "").strip().casefold()
    platform_profile_market = (
        canonical_market_profile(None, platform_profile_id=platform_profile_id)
        if platform_token.startswith("cn_") or platform_token.startswith("overseas")
        else None
    )
    has_explicit_market = (
        declared is not None
        or existing_profile is not None
        or platform_token.startswith("cn_")
        or platform_token.startswith("overseas")
    )
    if not has_explicit_market:
        # Legacy platform profiles did not carry a market path. Keep their
        # metadata untouched; the resolver still uses mainland as the safe
        # compatibility default when a planning prompt needs a contract.
        return dict(existing or {})
    declared_profile = (
        canonical_market_profile(declared) if declared is not None else None
    )
    existing_canonical = (
        canonical_market_profile(existing_profile)
        if existing_profile is not None
        else None
    )
    for source_name, source_profile in (
        ("platform profile", platform_profile_market),
        ("platform metadata", declared_profile),
    ):
        if (
            source_profile is not None
            and existing_canonical is not None
            and source_profile != existing_canonical
        ):
            raise ValueError(
                "ContentSpec market_profile conflicts with the "
                f"{source_name}: {existing_canonical} vs {source_profile}."
            )
    if (
        platform_profile_market is not None
        and declared_profile is not None
        and platform_profile_market != declared_profile
    ):
        raise ValueError(
            "Platform profile market metadata conflicts with its profile path: "
            f"{platform_profile_market} vs {declared_profile}."
        )
    resolved = canonical_market_profile(
        declared if declared is not None else existing_profile,
        platform_profile_id=platform_profile_id,
    )
    contract = market_profile_contract(resolved)
    return {
        **(existing or {}),
        "market_profile": contract.profile,
        "market_profile_family": contract.family,
        "market_contract_version": "v1",
        "default_output_language": contract.output_language,
        "cultural_context": contract.cultural_context,
    }
