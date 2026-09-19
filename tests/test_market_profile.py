from types import SimpleNamespace

import pytest

from app.modules.content_spec.market_profile import (
    OVERSEAS_TIKTOK_MARKET,
    content_spec_market_contract,
    market_profile_metadata,
)


def test_market_profile_metadata_defaults_legacy_platforms_to_mainland() -> None:
    metadata = market_profile_metadata(
        platform_profile_id="legacy_comic_profile",
        existing={"source": "test"},
    )

    assert metadata == {"source": "test"}


def test_overseas_market_contract_keeps_creator_chinese_and_delivery_english() -> None:
    metadata = market_profile_metadata(
        profile=SimpleNamespace(
            metadata={"market_profile": OVERSEAS_TIKTOK_MARKET},
        ),
        platform_profile_id="tiktok_frontend_mvp_v1",
    )
    contract = content_spec_market_contract(
        SimpleNamespace(
            metadata=metadata,
            platform_goal=SimpleNamespace(
                platform_profile_id="tiktok_frontend_mvp_v1",
            ),
        )
    )

    assert metadata["market_profile"] == OVERSEAS_TIKTOK_MARKET
    assert contract.output_language == "en"
    assert "specific country" in contract.prompt_contract
    assert "creator-facing planning artifacts" in contract.prompt_contract
    assert "English-language overseas/international cultural context" in contract.prompt_contract
    assert contract.language_name == "Simplified Chinese (zh-CN), with stable English character names"


def test_platform_and_content_spec_market_paths_cannot_conflict() -> None:
    with pytest.raises(ValueError, match="conflicts with the platform profile"):
        market_profile_metadata(
            profile=SimpleNamespace(
                metadata={"market_profile": OVERSEAS_TIKTOK_MARKET},
            ),
            platform_profile_id="overseas_tiktok_v1",
            existing={"market_profile": "cn_mainland"},
        )


def test_platform_path_and_explicit_market_metadata_cannot_conflict() -> None:
    with pytest.raises(ValueError, match="platform profile"):
        market_profile_metadata(
            profile=SimpleNamespace(metadata={}),
            platform_profile_id="cn_mainland_comic_drama_v1",
            existing={"market_profile": OVERSEAS_TIKTOK_MARKET},
        )
