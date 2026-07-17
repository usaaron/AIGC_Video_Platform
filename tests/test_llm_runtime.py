import pytest

from app.llm_runtime import build_llm_adapter_from_env, get_llm_runtime_config
from app.modules.script_engine.llm_adapter import (
    MockLLMAdapter,
    MissingLLMConfigurationError,
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

    config = get_llm_runtime_config()
    adapter = config.build_adapter()

    assert config.use_mock_adapter is False
    assert isinstance(adapter, RealLLMAdapter)
    assert adapter.get_model_info().provider == "openai_compatible"


def test_llm_runtime_requires_api_key_for_real_adapter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "script-model")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")

    with pytest.raises(MissingLLMConfigurationError, match="LLM_API_KEY"):
        build_llm_adapter_from_env()
