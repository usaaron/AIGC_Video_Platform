"""Shared market, language, and cultural-context contract for generation workflows.

The platform profile remains the delivery/format selector.  This module supplies
the higher-level market path that every planning and generation stage must obey.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.script_delivery_contract import OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT


CN_MAINLAND_MARKET = "cn_mainland"
OVERSEAS_TIKTOK_MARKET = "overseas_tiktok"
SUPPORTED_MARKET_PROFILES = frozenset({CN_MAINLAND_MARKET, OVERSEAS_TIKTOK_MARKET})


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


def content_spec_market_contract(content_spec: Any) -> MarketProfileContract:
    return market_profile_contract(content_spec_market_profile(content_spec))


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
