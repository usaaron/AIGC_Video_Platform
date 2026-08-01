from types import SimpleNamespace

from app.modules.platform_profile.models import PlatformProfileCreate
from app.modules.script_engine.models import GenerationStrategy, PromptLibraryItemCreate
from scripts.bootstrap_frontend_mvp_runtime import (
    DEFAULT_MARKET_PROFILE,
    FRONTEND_ONTOLOGY_NODES,
    _bootstrap_payloads,
)


def test_frontend_runtime_bootstrap_defaults_to_mainland_china() -> None:
    model_config = SimpleNamespace(
        provider="openai_compatible",
        model_name="test-real-model",
    )

    payloads = _bootstrap_payloads(
        "cn_mainland_comic_drama_v1",
        "frontend_mvp_cn",
        model_config=model_config,
    )

    ontology_payloads = [payload for path, payload in payloads if path == "/ontology-nodes"]
    asset_payloads = [payload for path, payload in payloads if path == "/assets"]
    prompt_payloads = [payload for path, payload in payloads if path == "/prompt-library"]
    strategy_payloads = [
        payload for path, payload in payloads if path == "/generation-strategies"
    ]
    general_strategy = next(
        payload for payload in strategy_payloads if payload["applicable_tags"] == []
    )
    platform_payload = next(
        payload for path, payload in payloads if path == "/platform-profiles"
    )

    assert DEFAULT_MARKET_PROFILE == "cn_mainland"
    assert len(ontology_payloads) == len(FRONTEND_ONTOLOGY_NODES)
    assert len(asset_payloads) == len(FRONTEND_ONTOLOGY_NODES)
    assert len({payload["id"] for payload in ontology_payloads}) == len(ontology_payloads)
    assert len({payload["id"] for payload in asset_payloads}) == len(asset_payloads)
    assert len(prompt_payloads) == 2
    assert len(strategy_payloads) == 1
    assert platform_payload["metadata"]["market_profile"] == "cn_mainland"
    assert platform_payload["metadata"]["runtime_status"] == "active"
    assert general_strategy["model_provider"] == "openai_compatible"
    assert general_strategy["model_name"] == "test-real-model"
    assert general_strategy["target_platform"] == "mainland china comic drama"
    assert general_strategy["deepening_mode"] == "disabled"
    assert general_strategy["deepening_prompt_ids"] == []
    assert general_strategy.get("deepening_knowledge_bundle_id") is None
    PlatformProfileCreate.model_validate(platform_payload)
    for prompt_payload in prompt_payloads:
        PromptLibraryItemCreate.model_validate(prompt_payload)
    GenerationStrategy.model_validate(general_strategy)


def test_overseas_tiktok_runtime_remains_switchable_but_is_not_default() -> None:
    model_config = SimpleNamespace(
        provider="openai_compatible",
        model_name="test-real-model",
    )

    payloads = _bootstrap_payloads(
        "tiktok_frontend_mvp_v1",
        "frontend_mvp",
        model_config=model_config,
        market_profile="overseas_tiktok",
    )
    strategy_payloads = [
        payload for path, payload in payloads if path == "/generation-strategies"
    ]
    dark_romance_strategy = next(
        payload
        for payload in strategy_payloads
        if payload["id"] == "strategy.tiktok.frontend_mvp.dark_romance.v1"
    )
    platform_payload = next(
        payload for path, payload in payloads if path == "/platform-profiles"
    )
    prompt_payloads = [payload for path, payload in payloads if path == "/prompt-library"]
    assert len(strategy_payloads) == 2
    assert dark_romance_strategy["draft_knowledge_bundle_id"] == (
        "knowledge_bundle.draft.dark_romance_tiktok.v1"
    )
    assert dark_romance_strategy["deepening_mode"] == "shadow"
    assert dark_romance_strategy["deepening_knowledge_bundle_id"] == (
        "knowledge_bundle.deepening.dark_romance_tiktok.v1"
    )
    PlatformProfileCreate.model_validate(platform_payload)
    for prompt_payload in prompt_payloads:
        PromptLibraryItemCreate.model_validate(prompt_payload)
    for strategy_payload in strategy_payloads:
        GenerationStrategy.model_validate(strategy_payload)
