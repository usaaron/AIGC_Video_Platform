import pytest

from app import dependencies
from app.llm_runtime import (
    build_continuity_llm_adapter_from_env,
    build_creative_llm_adapter_from_env,
    build_dialogue_polish_adapter_from_env,
    build_episode_plan_llm_adapter_from_env,
    build_llm_adapter_from_env,
    build_planning_llm_adapter_from_env,
    build_script_fallback_llm_adapter_from_env,
    build_script_editor_llm_adapter_from_env,
    build_script_generation_adapter,
    build_script_generation_adapter_from_env,
    build_script_repair_llm_adapter_from_env,
    build_story_architect_llm_adapter_from_env,
    build_story_bible_llm_adapter_from_env,
    get_llm_runtime_config,
)
from app.modules.script_engine.llm_adapter import (
    MockLLMAdapter,
    MissingLLMConfigurationError,
    ModelFailoverLLMAdapter,
    PooledLLMAdapter,
    RealLLMAdapter,
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


def test_script_generation_defaults_to_medium_reasoning_without_inheriting_planning(
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
    assert config.script_reasoning_effort == "medium"
    assert isinstance(script_adapter, RealLLMAdapter)
    assert script_adapter._reasoning_effort == "medium"


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

    adapter = build_script_generation_adapter_from_env()

    assert isinstance(adapter, ModelFailoverLLMAdapter)
    assert adapter._primary.get_model_info().model_name == "glm-5.2"
    assert adapter._fallback.get_model_info().model_name == "glm-5.2"
    assert adapter._primary._base_url == "https://gateway.example/v1"
    assert adapter._fallback._base_url == "https://glm-backup.example"


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
    assert isinstance(architect, ModelFailoverLLMAdapter)
    assert architect.get_model_info().model_name == "glm-5.2"
    assert architect._primary._base_url == "https://glm.example/v1"
    assert architect._primary._reasoning_effort == "high"
    assert architect._fallback.get_model_info().model_name == (
        "deepseek-v4-flash-repair"
    )
    assert isinstance(episode_plan, ModelFailoverLLMAdapter)
    assert episode_plan.get_model_info().model_name == "glm-5.2-roadmap"
    assert episode_plan._primary._reasoning_effort == "medium"
    assert episode_plan._fallback.get_model_info().model_name == (
        "deepseek-v4-flash-repair"
    )
    assert episode_plan._fallback._base_url == "https://deepseek.example/v1"
    assert script_repair.get_model_info().model_name == "deepseek-v4-flash-repair"
    assert script_repair._wire_api == "chat_completions"
    assert script_repair._thinking_mode == "disabled"
    assert script_repair._use_strict_schema is False
    assert continuity.get_model_info().model_name == "glm-5.2-continuity"
    assert continuity._base_url == "https://glm.example/v1"


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


def test_story_architect_uses_script_route_after_retryable_glm_failure(
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

    assert isinstance(adapter, ModelFailoverLLMAdapter)
    assert adapter._primary.get_model_info().model_name == "glm-5.2"
    assert adapter._fallback.get_model_info().model_name == "deepseek-v4-flash"
    assert adapter._fallback._use_strict_schema is False


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
