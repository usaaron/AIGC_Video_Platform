import pytest

from app import dependencies
from app.llm_runtime import (
    _build_explicit_episode_alternate,
    build_continuity_llm_adapter_from_env,
    build_creative_llm_adapter_from_env,
    build_dialogue_polish_adapter_from_env,
    build_episode_plan_llm_adapter_from_env,
    build_llm_adapter_from_env,
    build_market_routed_role_adapter_from_env,
    build_planning_llm_adapter_from_env,
    build_script_fallback_llm_adapter_from_env,
    build_script_editor_llm_adapter_from_env,
    build_script_generation_adapter,
    build_script_generation_adapter_from_env,
    build_script_repair_llm_adapter_from_env,
    build_story_architect_llm_adapter_from_env,
    build_story_architect_recovery_llm_adapter_from_env,
    build_story_bible_llm_adapter_from_env,
    get_llm_runtime_config,
)
from app.modules.script_engine.llm_adapter import (
    AdaptiveTransportLLMAdapter,
    MockLLMAdapter,
    MissingLLMConfigurationError,
    ModelFailoverLLMAdapter,
    PooledLLMAdapter,
    RealLLMAdapter,
    MarketRoutedLLMAdapter,
)


def test_llm_runtime_defaults_to_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    config = get_llm_runtime_config()
    adapter = build_llm_adapter_from_env()

    assert config.use_mock_adapter is True
    assert isinstance(adapter, MockLLMAdapter)


def test_llm_runtime_builds_real_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "script-model")
    monkeypatch.setenv("LLM_API_KEY", "secret-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "30")
    monkeypatch.setenv("LLM_MAX_RETRIES", "1")
    monkeypatch.setenv("LLM_WIRE_API", "responses")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "medium")

    config = get_llm_runtime_config()
    adapter = config.build_adapter()

    assert config.use_mock_adapter is False
    assert isinstance(adapter, RealLLMAdapter)
    assert adapter.get_model_info().provider == "openai_compatible"
    assert config.wire_api == "responses"
    assert config.reasoning_effort == "medium"


def test_planning_runtime_uses_independent_fail_fast_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "script-model")
    monkeypatch.setenv("LLM_API_KEY", "secret-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "3000")
    monkeypatch.setenv("LLM_MAX_RETRIES", "2")
    monkeypatch.setenv("LLM_PLANNING_TIMEOUT_SECONDS", "180")
    monkeypatch.setenv("LLM_PLANNING_MAX_RETRIES", "0")
    monkeypatch.setenv("LLM_PLANNING_REASONING_EFFORT", "high")
    monkeypatch.setenv("LLM_PLANNING_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_PLANNING_API_KEY", "planning-key")
    monkeypatch.setenv("LLM_PLANNING_BASE_URL", "https://planning.example/v1")
    monkeypatch.setenv("LLM_PLANNING_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_PLANNING_WIRE_API", "responses")
    monkeypatch.setenv("LLM_PLANNING_THINKING_MODE", "disabled")
    monkeypatch.setenv("LLM_PLANNING_USE_STRICT_SCHEMA", "false")
    monkeypatch.setenv("LLM_PLANNING_SEND_RESPONSE_FORMAT", "false")

    adapter = build_planning_llm_adapter_from_env()

    assert isinstance(adapter, RealLLMAdapter)
    assert adapter._timeout_seconds == 180
    assert adapter._max_retries == 0
    assert adapter._reasoning_effort == "high"
    assert adapter._wire_api == "responses"
    assert adapter._client.headers["Authorization"] == "Bearer planning-key"
    assert adapter._base_url == "https://planning.example/v1"
    assert adapter._thinking_mode == "disabled"
    assert adapter._use_strict_schema is False
    assert adapter._send_response_format is False
    assert adapter.get_model_info().model_name == "glm-5.2"


def test_script_generation_runtime_reads_numbered_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "script-model")
    monkeypatch.setenv("LLM_API_KEY", "planning-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")
    for index in range(1, 9):
        monkeypatch.setenv(f"LLM_API_KEY_{index:02d}", f"script-key-{index}")

    adapter = build_llm_adapter_from_env()
    pooled = build_script_generation_adapter(get_llm_runtime_config())

    assert isinstance(adapter, RealLLMAdapter)
    assert isinstance(pooled, PooledLLMAdapter)
    assert get_llm_runtime_config().api_key == "planning-key"
    assert len(get_llm_runtime_config().script_api_keys) == 8


def test_script_generation_runtime_can_use_an_independent_fast_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "planning-model")
    monkeypatch.setenv("LLM_API_KEY", "secret-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "600")
    monkeypatch.setenv("LLM_MAX_RETRIES", "2")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "high")
    monkeypatch.setenv("LLM_SCRIPT_MODEL", "fast-script-model")
    monkeypatch.setenv("LLM_SCRIPT_TIMEOUT_SECONDS", "240")
    monkeypatch.setenv("LLM_SCRIPT_MAX_RETRIES", "0")
    monkeypatch.setenv("LLM_SCRIPT_REASONING_EFFORT", "medium")
    monkeypatch.setenv("LLM_SCRIPT_WIRE_API", "responses")

    config = get_llm_runtime_config()
    planning_adapter = config.build_adapter()
    script_adapter = build_script_generation_adapter(config)

    assert isinstance(planning_adapter, RealLLMAdapter)
    assert isinstance(script_adapter, RealLLMAdapter)
    assert planning_adapter.get_model_info().model_name == "planning-model"
    assert planning_adapter._max_retries == 2
    assert script_adapter.get_model_info().model_name == "fast-script-model"
    assert script_adapter._timeout_seconds == 240
    assert script_adapter._max_retries == 0
    assert script_adapter._reasoning_effort == "medium"
    assert script_adapter._wire_api == "responses"


def test_script_generation_defaults_to_high_reasoning_without_inheriting_planning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "shared-model")
    monkeypatch.setenv("LLM_API_KEY", "secret-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "high")
    monkeypatch.delenv("LLM_SCRIPT_REASONING_EFFORT", raising=False)

    config = get_llm_runtime_config()
    script_adapter = build_script_generation_adapter(config)

    assert config.reasoning_effort == "high"
    assert config.script_reasoning_effort == "high"
    assert config.script_thinking_mode == "enabled"
    assert isinstance(script_adapter, RealLLMAdapter)
    assert script_adapter._reasoning_effort == "high"
    assert script_adapter._thinking_mode == "enabled"


def test_script_service_uses_script_repair_profile_for_every_recovery_stage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script_adapter = MockLLMAdapter()
    script_repair_adapter = MockLLMAdapter()
    script_editor_adapter = MockLLMAdapter(provider="gpt", model_name="gpt-editor")
    continuity_adapter = MockLLMAdapter(provider="glm", model_name="glm-continuity")
    monkeypatch.setattr(
        dependencies,
        "build_script_generation_adapter_from_env",
        lambda: script_adapter,
    )
    monkeypatch.setattr(
        dependencies,
        "build_script_repair_llm_adapter_from_env",
        lambda: script_repair_adapter,
    )
    monkeypatch.setattr(
        dependencies,
        "build_script_editor_llm_adapter_from_env",
        lambda: script_editor_adapter,
    )
    monkeypatch.setattr(
        dependencies,
        "build_continuity_llm_adapter_from_env",
        lambda: continuity_adapter,
    )
    dependencies._get_script_generation_service.cache_clear()
    try:
        service = dependencies._get_script_generation_service((("test", "roles"),))

        assert service._llm_adapter is script_adapter
        assert service._repair_llm_adapter is script_repair_adapter
        assert service._json_repair_llm_adapter is script_editor_adapter
        assert service._initial_fallback_llm_adapter is script_repair_adapter
        assert service._contract_fallback_llm_adapter is script_repair_adapter
        assert service._continuity_llm_adapter is continuity_adapter
        assert service._script_editor_llm_adapter is script_editor_adapter
        assert service._script_editor_enabled is True
    finally:
        dependencies._get_script_generation_service.cache_clear()


def test_script_fallback_inherits_configured_script_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_SCRIPT_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_SCRIPT_API_KEY", "glm-key")
    monkeypatch.setenv("LLM_SCRIPT_BASE_URL", "https://glm.example")
    monkeypatch.setenv("LLM_SCRIPT_WIRE_API", "responses")
    monkeypatch.setenv("LLM_SCRIPT_REASONING_EFFORT", "medium")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_USE_STRICT_SCHEMA", "true")
    monkeypatch.setenv("LLM_SCRIPT_FALLBACK_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_SCRIPT_FALLBACK_WIRE_API", "responses")

    adapter = build_script_fallback_llm_adapter_from_env()

    assert isinstance(adapter, RealLLMAdapter)
    assert adapter.get_model_info().model_name == "glm-5.2"
    assert adapter._base_url == "https://glm.example"
    assert adapter._wire_api == "responses"
    assert adapter._reasoning_effort == "medium"


def test_script_runtime_can_use_an_explicit_same_model_alternate_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_SCRIPT_API_KEY", "gateway-key")
    monkeypatch.setenv("LLM_SCRIPT_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_API_KEY", "official-key")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_BASE_URL", "https://glm-backup.example")
    monkeypatch.setenv("LLM_SCRIPT_HEDGE_DELAY_SECONDS", "45")

    adapter = build_script_generation_adapter_from_env()
    repair_adapter = build_script_repair_llm_adapter_from_env()

    assert isinstance(adapter, ModelFailoverLLMAdapter)
    assert adapter._primary.get_model_info().model_name == "glm-5.2"
    assert adapter._fallback.get_model_info().model_name == "glm-5.2"
    assert adapter._primary._base_url == "https://gateway.example/v1"
    assert adapter._fallback._base_url == "https://glm-backup.example"
    assert adapter._primary._reasoning_effort == "high"
    assert adapter._fallback._reasoning_effort == "high"
    assert adapter._primary._thinking_mode == "enabled"
    assert adapter._fallback._thinking_mode == "enabled"
    assert adapter._primary._retry_empty_response is True
    assert adapter._fallback._retry_empty_response is True
    assert adapter._primary._defer_schema_container_repair is True
    assert adapter._fallback._defer_schema_container_repair is True
    assert adapter._primary._retry_gateway_stream_as_non_stream is True
    assert adapter._fallback._retry_gateway_stream_as_non_stream is True
    assert adapter._circuit_failure_threshold == 1
    assert adapter._circuit_cooldown_seconds == 600
    assert adapter._hedge_delay_seconds == 45
    assert isinstance(repair_adapter, ModelFailoverLLMAdapter)
    assert repair_adapter._hedge_delay_seconds is None


def test_script_runtime_can_chain_a_second_same_model_alternate_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_SCRIPT_API_KEY", "gateway-key")
    monkeypatch.setenv("LLM_SCRIPT_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_API_KEY", "relay-key")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_BASE_URL", "https://relay.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_02_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_02_API_KEY", "dashscope-key")
    monkeypatch.setenv(
        "LLM_SCRIPT_ALTERNATE_02_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )

    adapter = build_script_generation_adapter_from_env()

    assert isinstance(adapter, ModelFailoverLLMAdapter)
    assert isinstance(adapter._primary, ModelFailoverLLMAdapter)
    assert adapter._fallback._adapter._base_url == (
        "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    assert adapter._primary._fallback._adapter._base_url == "https://relay.example/v1"


def test_deepseek_script_runtime_enables_adaptive_transport_without_lowering_reasoning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_SCRIPT_API_KEY", "deepseek-key")
    monkeypatch.setenv("LLM_SCRIPT_BASE_URL", "https://deepseek.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_REASONING_EFFORT", "high")
    monkeypatch.setenv("LLM_SCRIPT_THINKING_MODE", "enabled")
    monkeypatch.setenv("LLM_SCRIPT_ADAPTIVE_NON_STREAM_THRESHOLD", "3")
    monkeypatch.setenv("LLM_SCRIPT_ADAPTIVE_NON_STREAM_COOLDOWN_SECONDS", "1200")

    adapter = build_script_generation_adapter_from_env()

    assert isinstance(adapter, AdaptiveTransportLLMAdapter)
    assert adapter._failure_threshold == 3
    assert adapter._cooldown_seconds == 1200
    assert adapter._reasoning_effort == "high"
    assert adapter._thinking_mode == "enabled"


def test_deepseek_script_runtime_switches_transport_after_one_length_exhaustion_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_SCRIPT_API_KEY", "deepseek-key")
    monkeypatch.setenv("LLM_SCRIPT_BASE_URL", "https://deepseek-defaults.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_REASONING_EFFORT", "high")
    monkeypatch.setenv("LLM_SCRIPT_THINKING_MODE", "enabled")
    monkeypatch.delenv("LLM_SCRIPT_ADAPTIVE_NON_STREAM_THRESHOLD", raising=False)
    monkeypatch.delenv("LLM_SCRIPT_ADAPTIVE_NON_STREAM_COOLDOWN_SECONDS", raising=False)

    adapter = build_script_generation_adapter_from_env()

    assert isinstance(adapter, AdaptiveTransportLLMAdapter)
    assert adapter._failure_threshold == 1
    assert adapter._cooldown_seconds == 900
    assert adapter._reasoning_effort == "high"
    assert adapter._thinking_mode == "enabled"


def test_script_runtime_rejects_a_different_alternate_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_SCRIPT_API_KEY", "gateway-key")
    monkeypatch.setenv("LLM_SCRIPT_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_MODEL", "glm-5.2-air")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_API_KEY", "glm-key")
    monkeypatch.setenv("LLM_SCRIPT_ALTERNATE_BASE_URL", "https://glm.example/v1")

    with pytest.raises(MissingLLMConfigurationError, match="use the same model"):
        build_script_generation_adapter_from_env()


def test_dialogue_polish_runtime_can_use_an_independent_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "deepseek-script")
    monkeypatch.setenv("LLM_API_KEY", "deepseek-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://deepseek.example/v1")
    monkeypatch.setenv("LLM_DIALOGUE_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_DIALOGUE_MODEL", "gpt-dialogue-model")
    monkeypatch.setenv("LLM_DIALOGUE_API_KEY", "dialogue-key")
    monkeypatch.setenv("LLM_DIALOGUE_BASE_URL", "https://dialogue.example/v1")
    monkeypatch.setenv("LLM_DIALOGUE_WIRE_API", "responses")
    monkeypatch.setenv("LLM_DIALOGUE_REASONING_EFFORT", "medium")
    monkeypatch.setenv("LLM_DIALOGUE_THINKING_MODE", "disabled")
    monkeypatch.setenv("LLM_DIALOGUE_USE_STRICT_SCHEMA", "false")
    monkeypatch.setenv("LLM_DIALOGUE_SEND_RESPONSE_FORMAT", "false")

    adapter = build_dialogue_polish_adapter_from_env()

    assert isinstance(adapter, RealLLMAdapter)
    assert adapter.get_model_info().model_name == "gpt-dialogue-model"
    assert adapter._base_url == "https://dialogue.example/v1"
    assert adapter._wire_api == "responses"
    assert adapter._reasoning_effort == "medium"
    assert adapter._thinking_mode == "disabled"
    assert adapter._use_strict_schema is False
    assert adapter._send_response_format is False


def test_script_editor_runtime_uses_dedicated_gpt_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "glm-planning")
    monkeypatch.setenv("LLM_API_KEY", "planning-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://planning.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_EDITOR_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_SCRIPT_EDITOR_MODEL", "gpt-screenplay-editor")
    monkeypatch.setenv("LLM_SCRIPT_EDITOR_API_KEY", "gpt-key")
    monkeypatch.setenv("LLM_SCRIPT_EDITOR_BASE_URL", "https://gpt.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_EDITOR_WIRE_API", "responses")
    monkeypatch.setenv("LLM_SCRIPT_EDITOR_REASONING_EFFORT", "medium")

    adapter = build_script_editor_llm_adapter_from_env()

    assert isinstance(adapter, RealLLMAdapter)
    assert adapter.get_model_info().model_name == "gpt-screenplay-editor"
    assert adapter._base_url == "https://gpt.example/v1"
    assert adapter._wire_api == "responses"
    assert adapter._reasoning_effort == "medium"


def test_role_adapters_route_each_story_artifact_to_its_configured_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_API_KEY", "shared-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://shared.example/v1")
    monkeypatch.setenv("LLM_WIRE_API", "responses")
    monkeypatch.setenv("LLM_CREATIVE_MODEL", "kimi-k3")
    monkeypatch.setenv("LLM_CREATIVE_API_KEY", "kimi-key")
    monkeypatch.setenv("LLM_CREATIVE_BASE_URL", "https://kimi.example/v1")
    monkeypatch.setenv("LLM_CREATIVE_WIRE_API", "chat_completions")
    monkeypatch.setenv("LLM_CREATIVE_USE_STRICT_SCHEMA", "false")
    monkeypatch.setenv("LLM_STORY_BIBLE_MODEL", "kimi-k3")
    monkeypatch.setenv("LLM_STORY_BIBLE_API_KEY", "kimi-key")
    monkeypatch.setenv("LLM_STORY_BIBLE_BASE_URL", "https://kimi.example/v1")
    monkeypatch.setenv("LLM_STORY_BIBLE_WIRE_API", "chat_completions")
    monkeypatch.setenv("LLM_STORY_BIBLE_USE_STRICT_SCHEMA", "false")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_API_KEY", "glm-key")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_BASE_URL", "https://glm.example/v1")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_REASONING_EFFORT", "high")
    monkeypatch.setenv("LLM_EPISODE_PLAN_MODEL", "glm-5.2-roadmap")
    monkeypatch.setenv("LLM_EPISODE_PLAN_REASONING_EFFORT", "medium")
    monkeypatch.setenv("LLM_EPISODE_PLAN_RETRY_EMPTY_RESPONSE", "false")
    monkeypatch.setenv("LLM_EPISODE_PLAN_FALLBACK_RETRY_EMPTY_RESPONSE", "false")
    monkeypatch.setenv("LLM_SCRIPT_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_SCRIPT_API_KEY", "deepseek-role-key")
    monkeypatch.setenv("LLM_SCRIPT_BASE_URL", "https://deepseek.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_THINKING_MODE", "enabled")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_MODEL", "deepseek-v4-flash-repair")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_THINKING_MODE", "disabled")
    monkeypatch.setenv("LLM_CONTINUITY_MODEL", "glm-5.2-continuity")

    creative = build_creative_llm_adapter_from_env()
    story_bible = build_story_bible_llm_adapter_from_env()
    architect = build_story_architect_llm_adapter_from_env()
    architect_recovery = build_story_architect_recovery_llm_adapter_from_env()
    episode_plan = build_episode_plan_llm_adapter_from_env()
    script_repair = build_script_repair_llm_adapter_from_env()
    continuity = build_continuity_llm_adapter_from_env()

    assert isinstance(creative, RealLLMAdapter)
    assert creative.get_model_info().model_name == "kimi-k3"
    assert creative._base_url == "https://kimi.example/v1"
    assert creative._wire_api == "chat_completions"
    assert creative._use_strict_schema is False
    assert story_bible.get_model_info().model_name == "kimi-k3"
    assert story_bible._base_url == "https://kimi.example/v1"
    assert story_bible._wire_api == "chat_completions"
    assert story_bible._use_strict_schema is False
    # Story Bible is a planning artifact; it intentionally keeps the
    # generation role's success-first retry policy separate.
    assert story_bible._retry_empty_response is False
    assert story_bible._max_retries == 0
    assert story_bible._thinking_mode == "disabled"
    assert story_bible._send_response_format is True
    assert isinstance(architect, RealLLMAdapter)
    assert architect.get_model_info().model_name == "glm-5.2"
    assert architect._base_url == "https://glm.example/v1"
    assert architect._reasoning_effort == "high"
    assert architect._retry_empty_response is False
    assert architect._defer_schema_container_repair is True
    assert architect._retry_gateway_stream_as_non_stream is False
    assert isinstance(architect_recovery, RealLLMAdapter)
    assert architect_recovery.get_model_info().model_name == "glm-5.2"
    assert architect_recovery._base_url == "https://glm.example/v1"
    assert architect_recovery._reasoning_effort == "medium"
    assert architect_recovery._thinking_mode == "disabled"
    assert architect_recovery._use_strict_schema is False
    assert architect_recovery._retry_empty_response is False
    assert architect_recovery._defer_schema_container_repair is True
    assert architect_recovery._retry_gateway_stream_as_non_stream is False
    assert isinstance(episode_plan, ModelFailoverLLMAdapter)
    assert episode_plan.get_model_info().model_name == "glm-5.2-roadmap"
    assert episode_plan._primary._reasoning_effort == "medium"
    assert episode_plan._primary._thinking_mode == "disabled"
    assert episode_plan._primary._retry_empty_response is False
    assert episode_plan._fallback.get_model_info().model_name == (
        "deepseek-v4-flash-repair"
    )
    assert episode_plan._fallback._base_url == "https://deepseek.example/v1"
    assert episode_plan._fallback._retry_empty_response is False
    assert script_repair.get_model_info().model_name == "deepseek-v4-flash-repair"
    assert script_repair._wire_api == "chat_completions"
    assert script_repair._thinking_mode == "disabled"
    assert script_repair._use_strict_schema is False
    assert continuity.get_model_info().model_name == "glm-5.2-continuity"
    assert continuity._base_url == "https://glm.example/v1"


def test_episode_plan_builds_explicit_cross_gateway_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_API_KEY", "primary-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://primary.example/v1")
    monkeypatch.setenv("LLM_EPISODE_PLAN_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_EPISODE_PLAN_API_KEY", "episode-primary-key")
    monkeypatch.setenv("LLM_EPISODE_PLAN_BASE_URL", "https://primary.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_API_KEY", "legacy-fallback-key")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_BASE_URL", "https://legacy.example/v1")
    monkeypatch.setenv("LLM_EPISODE_PLAN_ALTERNATE_01_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_EPISODE_PLAN_ALTERNATE_01_API_KEY", "cloudflare-key")
    monkeypatch.setenv(
        "LLM_EPISODE_PLAN_ALTERNATE_01_BASE_URL",
        "https://openrouter.icu/v1",
    )
    monkeypatch.setenv("LLM_EPISODE_PLAN_ALTERNATE_01_RETRY_EMPTY_RESPONSE", "false")
    monkeypatch.setenv("LLM_EPISODE_PLAN_ALTERNATE_02_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_EPISODE_PLAN_ALTERNATE_02_API_KEY", "direct-key")
    monkeypatch.setenv(
        "LLM_EPISODE_PLAN_ALTERNATE_02_BASE_URL",
        "https://tokenadvent.com/v1",
    )
    monkeypatch.setenv("LLM_EPISODE_PLAN_CIRCUIT_FAILURE_THRESHOLD", "1")
    monkeypatch.setenv("LLM_EPISODE_PLAN_CIRCUIT_COOLDOWN_SECONDS", "240")

    adapter = build_episode_plan_llm_adapter_from_env()

    assert isinstance(adapter, ModelFailoverLLMAdapter)
    cloudflare_route = adapter._fallback
    assert isinstance(cloudflare_route, ModelFailoverLLMAdapter)
    assert cloudflare_route._primary._base_url == "https://openrouter.icu/v1"
    assert cloudflare_route._primary._client.headers["Authorization"] == (
        "Bearer cloudflare-key"
    )
    assert cloudflare_route._primary._retry_empty_response is False
    assert cloudflare_route._primary._thinking_mode == "disabled"
    direct_route = cloudflare_route._fallback
    assert isinstance(direct_route, ModelFailoverLLMAdapter)
    assert direct_route._primary._base_url == "https://tokenadvent.com/v1"
    assert direct_route._primary._client.headers["Authorization"] == "Bearer direct-key"
    assert direct_route._primary._thinking_mode == "disabled"
    assert direct_route._fallback._base_url == "https://legacy.example/v1"
    assert direct_route._fallback._thinking_mode == "disabled"
    assert adapter._circuit_failure_threshold == 1
    assert adapter._circuit_cooldown_seconds == 240


def test_episode_plan_thinking_default_does_not_inherit_architect_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_API_KEY", "shared-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://shared.example/v1")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_THINKING_MODE", "enabled")

    adapter = build_episode_plan_llm_adapter_from_env()

    assert isinstance(adapter, RealLLMAdapter)
    assert adapter._thinking_mode == "disabled"


def test_episode_plan_alternate_never_inherits_primary_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prefix = "LLM_EPISODE_PLAN_ALTERNATE_01"
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_API_KEY", "must-not-cross-domains")
    monkeypatch.setenv("LLM_BASE_URL", "https://primary.example/v1")
    monkeypatch.setenv(f"{prefix}_MODEL", "glm-5.2")
    monkeypatch.setenv(f"{prefix}_BASE_URL", "https://openrouter.icu/v1")
    monkeypatch.delenv(f"{prefix}_API_KEY", raising=False)
    for index in range(1, 101):
        monkeypatch.delenv(f"{prefix}_API_KEY_{index:02d}", raising=False)

    assert _build_explicit_episode_alternate(prefix) is None


def test_role_adapter_supports_independent_numbered_key_pool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "shared-model")
    monkeypatch.setenv("LLM_API_KEY", "shared-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://shared.example/v1")
    monkeypatch.setenv("LLM_CREATIVE_MODEL", "kimi-k3")
    monkeypatch.setenv("LLM_CREATIVE_API_KEY", "kimi-primary-key")
    monkeypatch.setenv("LLM_CREATIVE_API_KEY_01", "kimi-key-1")
    monkeypatch.setenv("LLM_CREATIVE_API_KEY_02", "kimi-key-2")
    monkeypatch.setenv("LLM_CREATIVE_USE_STRICT_SCHEMA", "false")

    adapter = build_creative_llm_adapter_from_env()

    assert isinstance(adapter, PooledLLMAdapter)
    assert len(adapter._adapters) == 3
    assert adapter._adapters[0]._use_strict_schema is False


def test_story_planning_roles_inherit_planning_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_PLANNING_MODEL", "planning-model")
    monkeypatch.setenv("LLM_PLANNING_API_KEY", "planning-key")
    monkeypatch.setenv("LLM_PLANNING_BASE_URL", "https://planning.example/v1")
    monkeypatch.setenv("LLM_PLANNING_WIRE_API", "responses")
    monkeypatch.setenv("LLM_PLANNING_REASONING_EFFORT", "high")
    monkeypatch.delenv("LLM_STORY_ARCHITECT_MODEL", raising=False)
    monkeypatch.delenv("LLM_STORY_BIBLE_MODEL", raising=False)
    monkeypatch.delenv("LLM_CREATIVE_MODEL", raising=False)
    monkeypatch.delenv("LLM_EPISODE_PLAN_MODEL", raising=False)
    monkeypatch.delenv("LLM_CONTINUITY_MODEL", raising=False)

    story_bible = build_story_bible_llm_adapter_from_env()
    architect = build_story_architect_llm_adapter_from_env()
    architect_recovery = build_story_architect_recovery_llm_adapter_from_env()
    episode_plan = build_episode_plan_llm_adapter_from_env()
    continuity = build_continuity_llm_adapter_from_env()

    for adapter in (story_bible, architect, episode_plan, continuity):
        assert isinstance(adapter, RealLLMAdapter)
        assert adapter.get_model_info().model_name == "planning-model"
        assert adapter._base_url == "https://planning.example/v1"
        assert adapter._wire_api == "responses"

    assert story_bible._reasoning_effort == "medium"
    assert story_bible._timeout_seconds == 300
    assert story_bible._max_retries == 0
    assert architect._timeout_seconds == 240
    assert architect._max_retries == 0
    for adapter in (architect, episode_plan, continuity):
        assert adapter._reasoning_effort == "high"
    assert architect_recovery.get_model_info().model_name == "planning-model"
    assert architect_recovery._base_url == "https://planning.example/v1"
    assert architect_recovery._reasoning_effort == "medium"
    assert architect_recovery._thinking_mode == "disabled"
    assert architect_recovery._timeout_seconds == 180
    assert architect_recovery._max_retries == 0


def test_story_architect_does_not_inherit_script_fallback_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_API_KEY", "glm-key")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_BASE_URL", "https://glm.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_API_KEY", "deepseek-key")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_BASE_URL", "https://deepseek.example/v1")

    adapter = build_story_architect_llm_adapter_from_env()

    assert isinstance(adapter, RealLLMAdapter)
    assert adapter.get_model_info().model_name == "glm-5.2"
    assert adapter._base_url == "https://glm.example/v1"


def test_story_architect_accepts_explicit_same_model_fallback_gateway(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_API_KEY", "glm-key")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_BASE_URL", "https://glm.example/v1")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_FALLBACK_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_FALLBACK_API_KEY", "backup-key")
    monkeypatch.setenv(
        "LLM_STORY_ARCHITECT_FALLBACK_BASE_URL",
        "https://glm-backup.example/v1",
    )

    adapter = build_story_architect_llm_adapter_from_env()

    assert isinstance(adapter, ModelFailoverLLMAdapter)
    assert adapter._primary.get_model_info().model_name == "glm-5.2"
    assert adapter._fallback.get_model_info().model_name == "glm-5.2"
    assert adapter._fallback._base_url == "https://glm-backup.example/v1"
    assert adapter._primary._defer_schema_container_repair is True
    assert adapter._fallback._defer_schema_container_repair is True
    assert adapter._primary._retry_gateway_stream_as_non_stream is False
    assert adapter._fallback._retry_gateway_stream_as_non_stream is False


def test_invalid_script_repair_profile_does_not_disable_planning_primaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_API_KEY", "glm-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://glm.example/v1")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "high")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_API_KEY", "deepseek-key")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_BASE_URL", "https://deepseek.example/v1")
    monkeypatch.setenv("LLM_SCRIPT_REPAIR_REASONING_EFFORT", "mediun")

    architect = build_story_architect_llm_adapter_from_env()
    episode_plan = build_episode_plan_llm_adapter_from_env()

    for adapter in (architect, episode_plan):
        assert isinstance(adapter, RealLLMAdapter)
        assert adapter.get_model_info().model_name == "glm-5.2"
        assert adapter._reasoning_effort == "high"


def test_story_bible_inherits_story_architect_profile_before_creative_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "default-model")
    monkeypatch.setenv("LLM_API_KEY", "default-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://default.example/v1")
    monkeypatch.setenv("LLM_CREATIVE_MODEL", "creative-model")
    monkeypatch.setenv("LLM_CREATIVE_API_KEY", "creative-key")
    monkeypatch.setenv("LLM_CREATIVE_BASE_URL", "https://creative.example/v1")
    monkeypatch.setenv("LLM_CREATIVE_WIRE_API", "chat_completions")
    monkeypatch.setenv("LLM_CREATIVE_USE_STRICT_SCHEMA", "false")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_MODEL", "planning-model")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_API_KEY", "planning-key")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_BASE_URL", "https://planning.example/v1")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_WIRE_API", "responses")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_REASONING_EFFORT", "high")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_USE_STRICT_SCHEMA", "true")
    monkeypatch.delenv("LLM_STORY_BIBLE_MODEL", raising=False)

    story_bible = build_story_bible_llm_adapter_from_env()

    assert isinstance(story_bible, RealLLMAdapter)
    assert story_bible.get_model_info().model_name == "planning-model"
    assert story_bible._base_url == "https://planning.example/v1"
    assert story_bible._wire_api == "responses"
    assert story_bible._reasoning_effort == "medium"
    assert story_bible._timeout_seconds == 300
    assert story_bible._max_retries == 0
    assert story_bible._use_strict_schema is True


def test_story_bible_can_use_a_dedicated_deepseek_chat_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_API_KEY", "shared-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://shared.example/v1")
    monkeypatch.setenv("LLM_WIRE_API", "responses")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "high")
    monkeypatch.setenv("LLM_STORY_BIBLE_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_STORY_BIBLE_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_STORY_BIBLE_WIRE_API", "chat_completions")
    monkeypatch.setenv("LLM_STORY_BIBLE_REASONING_EFFORT", "medium")
    monkeypatch.setenv("LLM_STORY_BIBLE_TIMEOUT_SECONDS", "240")
    monkeypatch.setenv("LLM_STORY_BIBLE_MAX_RETRIES", "1")
    monkeypatch.setenv("LLM_STORY_BIBLE_THINKING_MODE", "enabled")
    monkeypatch.setenv("LLM_STORY_BIBLE_USE_STRICT_SCHEMA", "false")
    monkeypatch.setenv("LLM_STORY_BIBLE_SEND_RESPONSE_FORMAT", "true")

    story_bible = build_story_bible_llm_adapter_from_env()

    assert isinstance(story_bible, RealLLMAdapter)
    assert story_bible.get_model_info().model_name == "deepseek-v4-flash"
    assert story_bible._wire_api == "chat_completions"
    assert story_bible._reasoning_effort == "medium"
    assert story_bible._timeout_seconds == 240
    assert story_bible._max_retries == 1
    assert story_bible._thinking_mode == "enabled"
    assert story_bible._use_strict_schema is False
    assert story_bible._send_response_format is True


def test_llm_runtime_requires_api_key_for_real_adapter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "script-model")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")

    with pytest.raises(MissingLLMConfigurationError, match="LLM_API_KEY"):
        build_llm_adapter_from_env()


def test_market_role_adapter_routes_models_by_prompt_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_CN_CREATIVE_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_CN_CREATIVE_MODEL", "glm-5.2")
    monkeypatch.setenv("LLM_CN_CREATIVE_API_KEY", "cn-key")
    monkeypatch.setenv("LLM_CN_CREATIVE_BASE_URL", "https://cn.example/v1")
    monkeypatch.setenv("LLM_CN_CREATIVE_WIRE_API", "chat_completions")
    monkeypatch.setenv("LLM_CN_CREATIVE_THINKING_MODE", "enabled")
    monkeypatch.setenv("LLM_OVERSEAS_CREATIVE_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_OVERSEAS_CREATIVE_MODEL", "gpt-5.6-sol")
    monkeypatch.setenv("LLM_OVERSEAS_CREATIVE_API_KEY", "overseas-key")
    monkeypatch.setenv("LLM_OVERSEAS_CREATIVE_BASE_URL", "https://overseas.example/v1")
    monkeypatch.setenv("LLM_OVERSEAS_CREATIVE_WIRE_API", "responses")

    routed = build_market_routed_role_adapter_from_env(
        "CREATIVE",
        fallback=MockLLMAdapter(),
        default_timeout_seconds=300,
        default_max_retries=1,
    )

    assert isinstance(routed, MarketRoutedLLMAdapter)
    assert routed._mainland.get_model_info().model_name == "glm-5.2"
    assert routed._overseas.get_model_info().model_name == "gpt-5.6-sol"
    assert routed._select("Market path: cn_mainland") is routed._mainland
    assert routed._select("Market path: overseas (current profile: overseas_tiktok)") is routed._overseas
    assert routed._select('{"market_profile":"overseas_tiktok"}') is routed._overseas


def test_market_role_adapter_honors_response_format_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_CN_STORY_ARCHITECT_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_CN_STORY_ARCHITECT_MODEL", "qwen-test")
    monkeypatch.setenv("LLM_CN_STORY_ARCHITECT_API_KEY", "cn-key")
    monkeypatch.setenv("LLM_CN_STORY_ARCHITECT_BASE_URL", "https://cn.example/v1")
    monkeypatch.setenv("LLM_CN_STORY_ARCHITECT_WIRE_API", "chat_completions")
    monkeypatch.delenv("LLM_CN_STORY_ARCHITECT_SEND_RESPONSE_FORMAT", raising=False)

    routed = build_market_routed_role_adapter_from_env(
        "STORY_ARCHITECT",
        fallback=MockLLMAdapter(),
        default_timeout_seconds=300,
        default_max_retries=1,
        default_use_strict_schema=False,
        default_send_response_format=False,
    )

    assert isinstance(routed, MarketRoutedLLMAdapter)
    assert isinstance(routed._mainland, RealLLMAdapter)
    assert routed._mainland._send_response_format is False


def test_market_script_overseas_alternate_is_wrapped_without_touching_planning_route(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_CN_SCRIPT_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_CN_SCRIPT_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("LLM_CN_SCRIPT_API_KEY", "cn-key")
    monkeypatch.setenv("LLM_CN_SCRIPT_BASE_URL", "https://cn.example/v1")
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_MODEL", "gpt-5.6-sol")
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_API_KEY", "overseas-key")
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_BASE_URL",
        "https://overseas.example/v1",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_ALTERNATE_MODEL",
        "gpt-5.6-sol",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_ALTERNATE_API_KEY",
        "overseas-backup-key",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_ALTERNATE_BASE_URL",
        "https://overseas-backup.example/v1",
    )
    for name in (
        "LLM_SCRIPT_ALTERNATE_MODEL",
        "LLM_SCRIPT_ALTERNATE_API_KEY",
        "LLM_SCRIPT_ALTERNATE_BASE_URL",
        "LLM_SCRIPT_HEDGE_DELAY_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)

    routed = build_market_routed_role_adapter_from_env(
        "SCRIPT",
        fallback=MockLLMAdapter(),
        default_timeout_seconds=600,
        default_max_retries=1,
    )

    assert isinstance(routed, MarketRoutedLLMAdapter)
    assert isinstance(routed._mainland, AdaptiveTransportLLMAdapter)
    assert isinstance(routed._overseas, ModelFailoverLLMAdapter)
    assert routed._overseas._primary._base_url == "https://overseas.example/v1"
    assert routed._overseas._fallback._base_url == (
        "https://overseas-backup.example/v1"
    )
    assert routed._overseas._primary.get_model_info().model_name == "gpt-5.6-sol"
    assert routed._overseas._fallback.get_model_info().model_name == "gpt-5.6-sol"


def test_market_script_alternate_rejects_a_different_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_MODEL", "gpt-5.6-sol")
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_API_KEY", "overseas-key")
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_BASE_URL", "https://overseas.example/v1")
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_ALTERNATE_MODEL",
        "gpt-5.6-mini",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_ALTERNATE_API_KEY",
        "overseas-backup-key",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_ALTERNATE_BASE_URL",
        "https://overseas-backup.example/v1",
    )

    with pytest.raises(MissingLLMConfigurationError, match="same model"):
        build_market_routed_role_adapter_from_env(
            "SCRIPT",
            fallback=MockLLMAdapter(),
            default_timeout_seconds=600,
            default_max_retries=1,
        )


def test_market_script_alternate_requires_all_route_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_MODEL", "gpt-5.6-sol")
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_API_KEY", "overseas-key")
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_BASE_URL", "https://overseas.example/v1")
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_ALTERNATE_PROVIDER",
        "openai_compatible",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_ALTERNATE_MODEL",
        "gpt-5.6-sol",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_SCRIPT_ALTERNATE_BASE_URL",
        "https://overseas-backup.example/v1",
    )
    monkeypatch.delenv("LLM_OVERSEAS_SCRIPT_ALTERNATE_API_KEY", raising=False)

    with pytest.raises(MissingLLMConfigurationError, match="API_KEY"):
        build_market_routed_role_adapter_from_env(
            "SCRIPT",
            fallback=MockLLMAdapter(),
            default_timeout_seconds=600,
            default_max_retries=1,
        )


def test_market_planning_route_does_not_get_script_failover_wrappers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_OVERSEAS_STORY_ARCHITECT_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_OVERSEAS_STORY_ARCHITECT_MODEL", "qwen3.8-max")
    monkeypatch.setenv("LLM_OVERSEAS_STORY_ARCHITECT_API_KEY", "planning-key")
    monkeypatch.setenv(
        "LLM_OVERSEAS_STORY_ARCHITECT_BASE_URL",
        "https://planning.example/v1",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_STORY_ARCHITECT_ALTERNATE_MODEL",
        "qwen3.8-max",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_STORY_ARCHITECT_ALTERNATE_API_KEY",
        "planning-backup-key",
    )
    monkeypatch.setenv(
        "LLM_OVERSEAS_STORY_ARCHITECT_ALTERNATE_BASE_URL",
        "https://planning-backup.example/v1",
    )

    routed = build_market_routed_role_adapter_from_env(
        "STORY_ARCHITECT",
        fallback=MockLLMAdapter(),
        default_timeout_seconds=300,
        default_max_retries=0,
    )

    assert isinstance(routed, MarketRoutedLLMAdapter)
    assert isinstance(routed._overseas, RealLLMAdapter)
    assert routed._overseas._base_url == "https://planning.example/v1"
