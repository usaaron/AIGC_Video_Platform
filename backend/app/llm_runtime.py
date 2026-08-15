from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache

from app.modules.script_engine.llm_adapter import (
    LLMAdapter,
    MockLLMAdapter,
    MissingLLMConfigurationError,
    ModelFailoverLLMAdapter,
    RealLLMAdapter,
)


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LLMRuntimeConfig:
    provider: str = "mock"
    model_name: str = "mock-script-generator"
    api_key: str | None = None
    base_url: str | None = None
    timeout_seconds: int = 60
    max_retries: int = 2
    script_api_keys: tuple[str, ...] = ()
    script_model_name: str | None = None
    script_timeout_seconds: int | None = None
    script_max_retries: int | None = None
    script_reasoning_effort: str | None = None
    script_thinking_mode: str | None = None
    script_wire_api: str | None = None
    wire_api: str = "chat_completions"
    reasoning_effort: str | None = None
    thinking_mode: str | None = None

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
        wire_api = os.getenv("LLM_WIRE_API", "chat_completions").strip() or "chat_completions"
        reasoning_effort = os.getenv("LLM_REASONING_EFFORT", "").strip() or None
        thinking_mode = os.getenv("LLM_THINKING_MODE", "").strip() or None
        script_api_keys = tuple(
            value
            for index in range(1, 101)
            for value in [os.getenv(f"LLM_API_KEY_{index:02d}", "").strip()]
            if value
        )
        script_model_name = os.getenv("LLM_SCRIPT_MODEL", "").strip() or None
        script_timeout_seconds = (
            _parse_optional_positive_int("LLM_SCRIPT_TIMEOUT_SECONDS")
            or min(timeout_seconds, 600)
        )
        parsed_script_max_retries = _parse_optional_non_negative_int(
            "LLM_SCRIPT_MAX_RETRIES"
        )
        script_max_retries = (
            parsed_script_max_retries
            if parsed_script_max_retries is not None
            else 0
        )
        script_reasoning_effort = (
            os.getenv("LLM_SCRIPT_REASONING_EFFORT", "medium").strip().casefold()
            or "medium"
        )
        script_thinking_mode = (
            os.getenv("LLM_SCRIPT_THINKING_MODE", "").strip().casefold() or None
        )
        script_wire_api = os.getenv("LLM_SCRIPT_WIRE_API", "").strip() or None
        return cls(
            provider=provider,
            model_name=model_name,
            api_key=api_key,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            script_api_keys=script_api_keys,
            script_model_name=script_model_name,
            script_timeout_seconds=script_timeout_seconds,
            script_max_retries=script_max_retries,
            script_reasoning_effort=script_reasoning_effort,
            script_thinking_mode=script_thinking_mode,
            script_wire_api=script_wire_api,
            wire_api=wire_api,
            reasoning_effort=reasoning_effort,
            thinking_mode=thinking_mode,
        )

    def build_adapter(
        self,
        *,
        provider: str | None = None,
        model_name: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout_seconds: int | None = None,
        max_retries: int | None = None,
        reasoning_effort: str | None = None,
        thinking_mode: str | None = None,
        wire_api: str | None = None,
        use_strict_schema: bool = True,
        send_response_format: bool = True,
    ) -> LLMAdapter:
        selected_provider = provider or self.provider
        selected_api_key = api_key or self.api_key
        selected_base_url = base_url or self.base_url
        if selected_provider.strip().lower() == "mock":
            return MockLLMAdapter(
                provider=selected_provider,
                model_name=model_name or self.model_name,
            )

        if selected_api_key is None:
            raise MissingLLMConfigurationError(
                "LLM_API_KEY is required when LLM_PROVIDER is not 'mock'."
            )
        if selected_base_url is None:
            raise MissingLLMConfigurationError(
                "LLM_BASE_URL is required for the OpenAI-compatible RealLLMAdapter."
            )

        return RealLLMAdapter(
            provider=selected_provider,
            model_name=model_name or self.model_name,
            api_key=selected_api_key,
            base_url=selected_base_url,
            timeout_seconds=timeout_seconds or self.timeout_seconds,
            max_retries=self.max_retries if max_retries is None else max_retries,
            wire_api=wire_api or self.wire_api,
            reasoning_effort=reasoning_effort or self.reasoning_effort,
            thinking_mode=thinking_mode or self.thinking_mode,
            use_strict_schema=use_strict_schema,
            send_response_format=send_response_format,
        )


def get_llm_runtime_config() -> LLMRuntimeConfig:
    return LLMRuntimeConfig.from_env()


def build_llm_adapter_from_env() -> LLMAdapter:
    return get_llm_runtime_config().build_adapter()


def build_planning_llm_adapter_from_env() -> LLMAdapter:
    """Build the adapter used by interactive recursive-tree requests."""

    config = get_llm_runtime_config()
    return _build_role_adapter_from_env(
        "LLM_PLANNING",
        default_model_env="LLM_MODEL",
        default_timeout_seconds=min(config.timeout_seconds, 300),
        default_max_retries=1,
    )


def build_creative_llm_adapter_from_env() -> LLMAdapter:
    """Build the Kimi-oriented adapter for references and creative directions."""

    return _build_role_adapter_from_env(
        "LLM_CREATIVE",
        default_model_env="LLM_MODEL",
        default_timeout_seconds=300,
        default_max_retries=1,
    )


def build_story_bible_llm_adapter_from_env() -> LLMAdapter:
    """Build the adapter used for the compact long-form Story Bible draft."""

    return _build_role_adapter_from_env(
        "LLM_STORY_BIBLE",
        fallback_prefixes=(
            "LLM_STORY_ARCHITECT",
            "LLM_PLANNING",
            "LLM_CREATIVE",
        ),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=300,
        default_max_retries=0,
        default_reasoning_effort="medium",
        inherit_fallback_runtime_tuning=False,
    )


def build_story_architect_llm_adapter_from_env() -> LLMAdapter:
    """Build the recursive-planning adapter with an independent bounded fallback."""

    primary = _build_role_adapter_from_env(
        "LLM_STORY_ARCHITECT",
        fallback_prefixes=("LLM_PLANNING",),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=600,
        default_max_retries=1,
    )
    fallback_prefixes = (
        "LLM_STORY_ARCHITECT_FALLBACK",
        "LLM_SCRIPT_REPAIR",
        "LLM_SCRIPT",
    )
    if not any(
        key.startswith(f"{fallback_prefix}_") and value.strip()
        for fallback_prefix in fallback_prefixes
        for key, value in os.environ.items()
    ):
        return primary
    try:
        fallback = _build_role_adapter_from_env(
            "LLM_STORY_ARCHITECT_FALLBACK",
            fallback_prefixes=("LLM_SCRIPT_REPAIR", "LLM_SCRIPT"),
            default_model_env="LLM_MODEL",
            default_timeout_seconds=300,
            default_max_retries=0,
            default_use_strict_schema=False,
        )
    except MissingLLMConfigurationError as exc:
        logger.warning(
            "Ignoring invalid story-architect fallback configuration; primary "
            "planning model remains available: %s",
            exc,
        )
        return primary
    primary_info = primary.get_model_info()
    fallback_info = fallback.get_model_info()
    if (
        primary_info.provider.casefold() == fallback_info.provider.casefold()
        and primary_info.model_name.casefold() == fallback_info.model_name.casefold()
    ):
        return primary
    return ModelFailoverLLMAdapter(primary=primary, fallback=fallback)


def build_episode_plan_llm_adapter_from_env() -> LLMAdapter:
    """Build the adapter for executable per-episode roadmaps."""

    primary = _build_role_adapter_from_env(
        "LLM_EPISODE_PLAN",
        fallback_prefixes=("LLM_STORY_ARCHITECT", "LLM_PLANNING"),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=600,
        default_max_retries=1,
    )
    fallback_prefixes = (
        "LLM_EPISODE_PLAN_FALLBACK",
        "LLM_SCRIPT_REPAIR",
        "LLM_SCRIPT_FALLBACK",
        "LLM_SCRIPT",
    )
    if not any(
        key.startswith(f"{fallback_prefix}_") and value.strip()
        for fallback_prefix in fallback_prefixes
        for key, value in os.environ.items()
    ):
        return primary
    try:
        fallback = _build_role_adapter_from_env(
            "LLM_EPISODE_PLAN_FALLBACK",
            fallback_prefixes=(
                "LLM_SCRIPT_REPAIR",
                "LLM_SCRIPT_FALLBACK",
                "LLM_SCRIPT",
            ),
            default_model_env="LLM_MODEL",
            default_timeout_seconds=300,
            default_max_retries=0,
            default_use_strict_schema=False,
        )
    except MissingLLMConfigurationError as exc:
        logger.warning(
            "Ignoring invalid episode-plan fallback configuration; primary planning "
            "model remains available: %s",
            exc,
        )
        return primary
    primary_info = primary.get_model_info()
    fallback_info = fallback.get_model_info()
    if (
        primary_info.provider.casefold() == fallback_info.provider.casefold()
        and primary_info.model_name.casefold() == fallback_info.model_name.casefold()
    ):
        return primary
    return ModelFailoverLLMAdapter(primary=primary, fallback=fallback)


def build_script_repair_llm_adapter_from_env() -> LLMAdapter:
    """Build the fast adapter for bounded JSON and screenplay repairs."""

    primary = _build_role_adapter_from_env(
        "LLM_SCRIPT_REPAIR",
        fallback_prefixes=("LLM_SCRIPT",),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=300,
        default_max_retries=0,
    )
    return _with_optional_script_alternate(primary)


def build_continuity_llm_adapter_from_env() -> LLMAdapter:
    """Build the high-reasoning adapter for blocking continuity conflicts."""

    return _build_role_adapter_from_env(
        "LLM_CONTINUITY",
        fallback_prefixes=("LLM_STORY_ARCHITECT", "LLM_PLANNING"),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=600,
        default_max_retries=0,
    )


@lru_cache(maxsize=8)
def build_script_generation_adapter(config: LLMRuntimeConfig) -> LLMAdapter:
    """Build the pooled adapter used only by script-generation calls.

    Story planning keeps using ``build_llm_adapter_from_env`` and therefore the
    primary ``LLM_API_KEY``. The pool is cached by its immutable configuration
    so concurrent FastAPI requests share key rotation and per-key limits.
    """
    if config.use_mock_adapter or not config.script_api_keys:
        return config.build_adapter(
            model_name=config.script_model_name,
            timeout_seconds=config.script_timeout_seconds,
            max_retries=config.script_max_retries,
            reasoning_effort=config.script_reasoning_effort,
            thinking_mode=config.script_thinking_mode,
            wire_api=config.script_wire_api,
        )

    from app.modules.script_engine.llm_adapter import PooledLLMAdapter

    return PooledLLMAdapter(
        provider=config.provider,
        model_name=config.script_model_name or config.model_name,
        api_keys=config.script_api_keys,
        base_url=config.base_url or "",
        timeout_seconds=config.script_timeout_seconds or config.timeout_seconds,
        max_retries=config.script_max_retries if config.script_max_retries is not None else config.max_retries,
        wire_api=config.script_wire_api or config.wire_api,
        reasoning_effort=config.script_reasoning_effort or config.reasoning_effort,
        thinking_mode=config.script_thinking_mode or config.thinking_mode,
    )


def build_script_generation_adapter_from_env() -> LLMAdapter:
    explicit_role_settings = any(
        os.getenv(f"LLM_SCRIPT_{suffix}", "").strip()
        for suffix in ("PROVIDER", "API_KEY", "BASE_URL")
    ) or bool(_role_api_key_pool("LLM_SCRIPT"))
    if not explicit_role_settings:
        primary = build_script_generation_adapter(get_llm_runtime_config())
    else:
        primary = _build_role_adapter_from_env(
            "LLM_SCRIPT",
            default_model_env="LLM_MODEL",
            default_timeout_seconds=600,
            default_max_retries=0,
        )
    return _with_optional_script_alternate(primary)


def _with_optional_script_alternate(primary: LLMAdapter) -> LLMAdapter:
    """Add an explicitly configured second screenplay inference route.

    API keys are scoped to their configured host and are never reused for the
    alternate route. The alternate model must match the primary model so a
    transport failover cannot silently change screenplay behavior.
    """

    alternate_fields = {
        suffix: os.getenv(f"LLM_SCRIPT_ALTERNATE_{suffix}", "").strip()
        for suffix in ("MODEL", "API_KEY", "BASE_URL")
    }
    if not any(alternate_fields.values()):
        return primary
    missing = [suffix for suffix, value in alternate_fields.items() if not value]
    if missing:
        raise MissingLLMConfigurationError(
            "LLM_SCRIPT_ALTERNATE requires MODEL, API_KEY and BASE_URL together; "
            "missing: " + ", ".join(missing)
        )
    primary_model = primary.get_model_info().model_name
    alternate_model = alternate_fields["MODEL"]
    if primary_model.casefold() != alternate_model.casefold():
        raise MissingLLMConfigurationError(
            "Script primary and alternate routes must use the same model."
        )
    alternate = _build_role_adapter_from_env(
        "LLM_SCRIPT_ALTERNATE",
        default_model_env="LLM_SCRIPT_MODEL",
        default_timeout_seconds=600,
        default_max_retries=0,
    )
    return ModelFailoverLLMAdapter(primary=primary, fallback=alternate)


def build_script_fallback_llm_adapter_from_env() -> LLMAdapter:
    """Build a screenplay fallback that stays on the configured script profile."""

    return build_script_repair_llm_adapter_from_env()


def build_script_editor_llm_adapter_from_env() -> LLMAdapter:
    """Build the mandatory GPT editor used after a validated DeepSeek draft."""

    return _build_role_adapter_from_env(
        "LLM_SCRIPT_EDITOR",
        fallback_prefixes=("LLM_DIALOGUE",),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=600,
        default_max_retries=1,
    )


def build_dialogue_polish_adapter_from_env() -> LLMAdapter:
    """Build the optional American-dialogue polish adapter."""

    return _build_role_adapter_from_env(
        "LLM_DIALOGUE",
        fallback_prefixes=("LLM_SCRIPT_EDITOR",),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=300,
        default_max_retries=1,
    )


def _build_role_adapter_from_env(
    prefix: str,
    *,
    fallback_prefixes: tuple[str, ...] = (),
    default_model_env: str,
    default_timeout_seconds: int,
    default_max_retries: int,
    default_use_strict_schema: bool = True,
    default_reasoning_effort: str | None = None,
    inherit_fallback_runtime_tuning: bool = True,
) -> LLMAdapter:
    """Build one independently configurable model role with safe legacy fallbacks."""

    config = get_llm_runtime_config()

    def value(
        suffix: str,
        default: str | None = None,
        *,
        fallback_chain: tuple[str, ...] | None = None,
    ) -> str | None:
        direct = os.getenv(f"{prefix}_{suffix}", "").strip()
        if direct:
            return direct
        selected_fallbacks = (
            fallback_prefixes if fallback_chain is None else fallback_chain
        )
        for fallback_prefix in selected_fallbacks:
            fallback = os.getenv(f"{fallback_prefix}_{suffix}", "").strip()
            if fallback:
                return fallback
        return default

    runtime_fallback_prefixes = (
        fallback_prefixes if inherit_fallback_runtime_tuning else ()
    )

    provider = value("PROVIDER", config.provider) or config.provider
    model_name = value("MODEL", os.getenv(default_model_env, config.model_name).strip())
    api_key = value("API_KEY", config.api_key)
    base_url = value("BASE_URL", config.base_url)
    wire_api = value("WIRE_API", config.wire_api) or config.wire_api
    reasoning_effort = value(
        "REASONING_EFFORT",
        default_reasoning_effort or config.reasoning_effort,
        fallback_chain=runtime_fallback_prefixes,
    )
    thinking_mode = value(
        "THINKING_MODE",
        config.thinking_mode,
        fallback_chain=runtime_fallback_prefixes,
    )
    timeout_seconds = _parse_role_positive_int(
        prefix,
        fallback_prefixes=runtime_fallback_prefixes,
        suffix="TIMEOUT_SECONDS",
        default=default_timeout_seconds,
    )
    max_retries = _parse_role_non_negative_int(
        prefix,
        fallback_prefixes=runtime_fallback_prefixes,
        suffix="MAX_RETRIES",
        default=default_max_retries,
    )
    api_keys = _role_api_key_pool(prefix)
    if not api_keys:
        for fallback_prefix in fallback_prefixes:
            api_keys = _role_api_key_pool(fallback_prefix)
            if api_keys:
                break
    explicit_api_key = value("API_KEY")
    if api_keys and explicit_api_key:
        api_keys = tuple(dict.fromkeys((explicit_api_key, *api_keys)))
    if provider.casefold() == "mock":
        return MockLLMAdapter(provider=provider, model_name=model_name or config.model_name)
    if not api_key and not api_keys:
        raise MissingLLMConfigurationError(
            f"{prefix}_API_KEY (or LLM_API_KEY fallback) is required."
        )
    if not base_url:
        raise MissingLLMConfigurationError(
            f"{prefix}_BASE_URL (or LLM_BASE_URL fallback) is required."
        )
    if api_keys:
        from app.modules.script_engine.llm_adapter import PooledLLMAdapter

        use_strict_schema = _parse_role_flag(
            prefix,
            fallback_prefixes=fallback_prefixes,
            suffix="USE_STRICT_SCHEMA",
            default=default_use_strict_schema,
        )
        send_response_format = _parse_role_flag(
            prefix,
            fallback_prefixes=fallback_prefixes,
            suffix="SEND_RESPONSE_FORMAT",
            default=True,
        )
        return PooledLLMAdapter(
            provider=provider,
            model_name=model_name or config.model_name,
            api_keys=api_keys,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            wire_api=wire_api,
            reasoning_effort=reasoning_effort,
            thinking_mode=thinking_mode,
            use_strict_schema=use_strict_schema,
            send_response_format=send_response_format,
        )
    return config.build_adapter(
        provider=provider,
        model_name=model_name,
        api_key=api_key,
        base_url=base_url,
        timeout_seconds=timeout_seconds,
        max_retries=max_retries,
        reasoning_effort=reasoning_effort,
        thinking_mode=thinking_mode,
        wire_api=wire_api,
        use_strict_schema=_parse_role_flag(
            prefix,
            fallback_prefixes=fallback_prefixes,
            suffix="USE_STRICT_SCHEMA",
            default=default_use_strict_schema,
        ),
        send_response_format=_parse_role_flag(
            prefix,
            fallback_prefixes=fallback_prefixes,
            suffix="SEND_RESPONSE_FORMAT",
            default=True,
        ),
    )


def _role_api_key_pool(prefix: str) -> tuple[str, ...]:
    return tuple(
        key
        for index in range(1, 101)
        for key in [os.getenv(f"{prefix}_API_KEY_{index:02d}", "").strip()]
        if key
    )


def _role_env_value(
    prefix: str,
    *,
    fallback_prefixes: tuple[str, ...],
    suffix: str,
) -> str:
    direct = os.getenv(f"{prefix}_{suffix}", "").strip()
    if direct:
        return direct
    for fallback_prefix in fallback_prefixes:
        fallback = os.getenv(f"{fallback_prefix}_{suffix}", "").strip()
        if fallback:
            return fallback
    return ""


def _parse_role_positive_int(
    prefix: str,
    *,
    fallback_prefixes: tuple[str, ...],
    suffix: str,
    default: int,
) -> int:
    raw = _role_env_value(
        prefix,
        fallback_prefixes=fallback_prefixes,
        suffix=suffix,
    )
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise MissingLLMConfigurationError(
            f"{prefix}_{suffix} must be an integer, received '{raw}'."
        ) from exc
    if value <= 0:
        raise MissingLLMConfigurationError(f"{prefix}_{suffix} must be greater than 0.")
    return value


def _parse_role_non_negative_int(
    prefix: str,
    *,
    fallback_prefixes: tuple[str, ...],
    suffix: str,
    default: int,
) -> int:
    raw = _role_env_value(
        prefix,
        fallback_prefixes=fallback_prefixes,
        suffix=suffix,
    )
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise MissingLLMConfigurationError(
            f"{prefix}_{suffix} must be an integer, received '{raw}'."
        ) from exc
    if value < 0:
        raise MissingLLMConfigurationError(
            f"{prefix}_{suffix} must be zero or greater."
        )
    return value


def _parse_role_flag(
    prefix: str,
    *,
    fallback_prefixes: tuple[str, ...],
    suffix: str,
    default: bool,
) -> bool:
    raw = _role_env_value(
        prefix,
        fallback_prefixes=fallback_prefixes,
        suffix=suffix,
    )
    if not raw:
        return default
    normalized = raw.casefold()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise MissingLLMConfigurationError(
        f"{prefix}_{suffix} must be true or false, received '{raw}'."
    )


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


def _parse_optional_positive_int(name: str) -> int | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    return _parse_positive_int(name, default=1)


def _parse_optional_non_negative_int(name: str) -> int | None:
    raw = os.getenv(name, "").strip()
    if not raw:
        return None
    return _parse_non_negative_int(name, default=0)


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
