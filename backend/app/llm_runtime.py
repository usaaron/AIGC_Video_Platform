from __future__ import annotations

import os
from dataclasses import dataclass

from app.modules.script_engine.llm_adapter import (
    LLMAdapter,
    MockLLMAdapter,
    MissingLLMConfigurationError,
    RealLLMAdapter,
)


@dataclass(frozen=True)
class LLMRuntimeConfig:
    provider: str = "mock"
    model_name: str = "mock-script-generator"
    api_key: str | None = None
    base_url: str | None = None
    timeout_seconds: int = 60
    max_retries: int = 2

    @property
    def use_mock_adapter(self) -> bool:
        return self.provider.strip().lower() == "mock"

    @classmethod
    def from_env(cls) -> "LLMRuntimeConfig":
        provider = os.getenv("LLM_PROVIDER", "mock").strip() or "mock"
        model_name = os.getenv("LLM_MODEL", "mock-script-generator").strip() or "mock-script-generator"
        api_key = os.getenv("LLM_API_KEY", "").strip() or None
        base_url = os.getenv("LLM_BASE_URL", "").strip() or None
        timeout_seconds = _parse_positive_int("LLM_TIMEOUT_SECONDS", default=60)
        max_retries = _parse_non_negative_int("LLM_MAX_RETRIES", default=2)
        return cls(
            provider=provider,
            model_name=model_name,
            api_key=api_key,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
        )

    def build_adapter(self) -> LLMAdapter:
        if self.use_mock_adapter:
            return MockLLMAdapter(
                provider=self.provider,
                model_name=self.model_name,
            )

        if self.api_key is None:
            raise MissingLLMConfigurationError(
                "LLM_API_KEY is required when LLM_PROVIDER is not 'mock'."
            )
        if self.base_url is None:
            raise MissingLLMConfigurationError(
                "LLM_BASE_URL is required for the OpenAI-compatible RealLLMAdapter."
            )

        return RealLLMAdapter(
            provider=self.provider,
            model_name=self.model_name,
            api_key=self.api_key,
            base_url=self.base_url,
            timeout_seconds=self.timeout_seconds,
            max_retries=self.max_retries,
        )


def get_llm_runtime_config() -> LLMRuntimeConfig:
    return LLMRuntimeConfig.from_env()


def build_llm_adapter_from_env() -> LLMAdapter:
    return get_llm_runtime_config().build_adapter()


def _parse_positive_int(name: str, *, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise MissingLLMConfigurationError(
            f"{name} must be an integer, received '{raw}'."
        ) from exc
    if value <= 0:
        raise MissingLLMConfigurationError(f"{name} must be greater than 0.")
    return value


def _parse_non_negative_int(name: str, *, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise MissingLLMConfigurationError(
            f"{name} must be an integer, received '{raw}'."
        ) from exc
    if value < 0:
        raise MissingLLMConfigurationError(f"{name} must be 0 or greater.")
    return value
