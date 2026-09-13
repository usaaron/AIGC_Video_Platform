from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass
from functools import lru_cache

from app.modules.script_engine.llm_adapter import (
    AdaptiveTransportLLMAdapter,
    AdaptiveTransportState,
    LLMAdapter,
    MarketRoutedLLMAdapter,
    MockLLMAdapter,
    MissingLLMConfigurationError,
    ModelFailoverLLMAdapter,
    ModelFailoverCircuitState,
    RealLLMAdapter,
)


logger = logging.getLogger(__name__)
_SCRIPT_ROUTE_STATE_LOCK = threading.Lock()
_SCRIPT_TRANSPORT_STATES: dict[tuple[str, str, str], AdaptiveTransportState] = {}
_SCRIPT_FAILOVER_STATES: dict[
    tuple[tuple[str, str, str], tuple[str, str, str]],
    ModelFailoverCircuitState,
] = {}
_SCRIPT_MARKET_ROLES = frozenset({"SCRIPT", "SCRIPT_REPAIR", "SCRIPT_EDITOR"})


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
        # Script generation is the user-visible long-running workflow. Keep
        # one bounded retry by default so a transient gateway/empty response
        # does not become a manual "continue" action.
        script_max_retries = (
            parsed_script_max_retries
            if parsed_script_max_retries is not None
            else 1
        )
        script_reasoning_effort = (
            os.getenv("LLM_SCRIPT_REASONING_EFFORT", "high").strip().casefold()
            or "high"
        )
        script_thinking_mode = (
            os.getenv("LLM_SCRIPT_THINKING_MODE", "enabled").strip().casefold()
            or "enabled"
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
        request_deadline_seconds: float | None = None,
        max_retries: int | None = None,
        reasoning_effort: str | None = None,
        thinking_mode: str | None = None,
        wire_api: str | None = None,
        use_strict_schema: bool = True,
        send_response_format: bool = True,
        retry_empty_response: bool = True,
        defer_schema_container_repair: bool = False,
        retry_gateway_stream_as_non_stream: bool = True,
        settings_prefix: str = "LLM",
        apply_astra_fallback: bool = True,
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

        if request_deadline_seconds is None and _is_astra_model(model_name or self.model_name):
            # Interactive planning should fail over after a bounded wait. The
            # role-specific builder uses 45s for Grill Me and 120s elsewhere.
            request_deadline_seconds = _parse_role_positive_int(
                settings_prefix,
                fallback_prefixes=("LLM",) if settings_prefix != "LLM" else (),
                suffix="REQUEST_DEADLINE_SECONDS",
                default=120,
            )
        adapter = RealLLMAdapter(
            provider=selected_provider,
            model_name=model_name or self.model_name,
            api_key=selected_api_key,
            base_url=selected_base_url,
            timeout_seconds=timeout_seconds or self.timeout_seconds,
            request_deadline_seconds=request_deadline_seconds,
            max_retries=self.max_retries if max_retries is None else max_retries,
            wire_api=wire_api or self.wire_api,
            reasoning_effort=reasoning_effort or self.reasoning_effort,
            thinking_mode=thinking_mode or self.thinking_mode,
            use_strict_schema=use_strict_schema,
            send_response_format=send_response_format,
            retry_empty_response=retry_empty_response,
            defer_schema_container_repair=defer_schema_container_repair,
            retry_gateway_stream_as_non_stream=retry_gateway_stream_as_non_stream,
        )
        if not apply_astra_fallback:
            return adapter
        return _with_astra_fallback(adapter, settings_prefix=settings_prefix)


def get_llm_runtime_config() -> LLMRuntimeConfig:
    return LLMRuntimeConfig.from_env()


def build_llm_adapter_from_env() -> LLMAdapter:
    return get_llm_runtime_config().build_adapter(settings_prefix="LLM_OUTLINE")


def build_planning_editor_llm_adapter_from_env() -> LLMAdapter:
    """Build the shared DeepSeek editor for non-screenplay planning changes."""

    return _build_role_adapter_from_env(
        "LLM_PLANNING_EDITOR",
        fallback_prefixes=("LLM_CN_STORYBOARD", "LLM_DEEPSEEK"),
        default_model_env="LLM_DEEPSEEK_MODEL",
        default_timeout_seconds=300,
        default_max_retries=0,
        default_reasoning_effort="high",
        default_thinking_mode="enabled",
        default_use_strict_schema=False,
        default_send_response_format=True,
        default_retry_empty_response=False,
        inherit_fallback_runtime_tuning=False,
        inherit_fallback_flags=False,
    )


def build_input_readiness_llm_adapter_from_env() -> LLMAdapter:
    """Keep classification and supplied-fact extraction on a bounded light role."""

    if not _has_script_route_fields("LLM_INPUT_READINESS"):
        return build_creative_llm_adapter_from_env()
    if os.getenv("LLM_INPUT_READINESS_PROVIDER") != "mock":
        missing = [
            suffix for suffix in ("MODEL", "BASE_URL", "API_KEY")
            if not os.getenv(f"LLM_INPUT_READINESS_{suffix}", "").strip()
            and not (suffix == "API_KEY" and _role_api_key_pool("LLM_INPUT_READINESS"))
        ]
        if missing:
            raise MissingLLMConfigurationError(
                "LLM_INPUT_READINESS requires its own complete profile; missing: "
                + ", ".join(missing)
            )
    return _build_role_adapter_from_env(
        "LLM_INPUT_READINESS",
        default_model_env="LLM_INPUT_READINESS_MODEL",
        default_provider="openai_compatible",
        default_wire_api="chat_completions",
        default_timeout_seconds=60,
        default_max_retries=0,
        default_reasoning_effort="none",
        default_thinking_mode="disabled",
        default_use_strict_schema=False,
        default_send_response_format=True,
        default_retry_empty_response=False,
        inherit_fallback_runtime_tuning=False,
        inherit_fallback_flags=False,
    )


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
        default_thinking_mode="disabled",
        default_retry_empty_response=False,
        default_reasoning_effort="medium",
        inherit_fallback_runtime_tuning=False,
    )


def build_story_architect_llm_adapter_from_env() -> LLMAdapter:
    """Build recursive planning without crossing into the screenplay model role."""

    primary = _build_role_adapter_from_env(
        "LLM_STORY_ARCHITECT",
        fallback_prefixes=("LLM_PLANNING",),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=240,
        default_max_retries=0,
        default_retry_empty_response=False,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=False,
    )
    fallback_prefix = "LLM_STORY_ARCHITECT_FALLBACK"
    if not any(
        key.startswith(f"{fallback_prefix}_") and value.strip()
        for key, value in os.environ.items()
    ):
        return primary
    try:
        fallback = _build_role_adapter_from_env(
            fallback_prefix,
            fallback_prefixes=("LLM_STORY_ARCHITECT", "LLM_PLANNING"),
            default_model_env="LLM_MODEL",
            default_timeout_seconds=240,
            default_max_retries=0,
            default_use_strict_schema=False,
            default_retry_empty_response=False,
            defer_schema_container_repair=True,
            retry_gateway_stream_as_non_stream=False,
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
    if primary_info.model_name.casefold() != fallback_info.model_name.casefold():
        logger.warning(
            "Ignoring story-architect fallback model '%s'; recursive planning "
            "fallbacks must use the primary model '%s'.",
            fallback_info.model_name,
            primary_info.model_name,
        )
        return primary
    if (
        primary_info.provider.casefold() == fallback_info.provider.casefold()
        and getattr(primary, "_base_url", None)
        == getattr(fallback, "_base_url", None)
    ):
        return primary
    return ModelFailoverLLMAdapter(primary=primary, fallback=fallback)


def build_story_architect_recovery_llm_adapter_from_env() -> LLMAdapter:
    """Build the compact GLM profile used only for tree contract recovery."""

    return _build_role_adapter_from_env(
        "LLM_STORY_ARCHITECT_RECOVERY",
        fallback_prefixes=("LLM_STORY_ARCHITECT", "LLM_PLANNING"),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=180,
        default_max_retries=0,
        default_use_strict_schema=False,
        default_reasoning_effort="medium",
        default_thinking_mode="disabled",
        default_retry_empty_response=False,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=False,
        inherit_fallback_runtime_tuning=False,
        inherit_fallback_flags=False,
    )


def get_episode_plan_chunk_size() -> int:
    # Roadmap generation is resumed after every saved episode. A single item
    # keeps provider context and completion latency bounded for real models.
    return _parse_positive_int("LLM_EPISODE_PLAN_CHUNK_SIZE", default=1)


def build_episode_plan_llm_adapter_from_env() -> LLMAdapter:
    """Build the adapter for executable per-episode roadmaps."""

    primary = _build_role_adapter_from_env(
        "LLM_EPISODE_PLAN",
        fallback_prefixes=("LLM_STORY_ARCHITECT", "LLM_PLANNING"),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=180,
        default_max_retries=0,
        default_reasoning_effort="low",
        default_thinking_mode="disabled",
    )
    routes: list[LLMAdapter] = [primary]
    for alternate_index in range(1, 3):
        alternate = _build_explicit_episode_alternate(
            f"LLM_EPISODE_PLAN_ALTERNATE_{alternate_index:02d}"
        )
        if alternate is not None:
            routes.append(alternate)

    fallback_prefixes = (
        "LLM_EPISODE_PLAN_FALLBACK",
        "LLM_SCRIPT_REPAIR",
        "LLM_SCRIPT_FALLBACK",
        "LLM_SCRIPT",
    )
    if any(
        key.startswith(f"{fallback_prefix}_") and value.strip()
        for fallback_prefix in fallback_prefixes
        for key, value in os.environ.items()
    ):
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
                default_thinking_mode="disabled",
            )
        except MissingLLMConfigurationError as exc:
            logger.warning(
                "Ignoring invalid episode-plan fallback configuration; primary planning "
                "model remains available: %s",
                exc,
            )
        else:
            if _adapter_route_identity(routes[-1]) != _adapter_route_identity(
                fallback
            ):
                routes.append(fallback)

    if len(routes) == 1:
        return primary
    return _build_episode_failover_chain(routes)


def _build_explicit_episode_alternate(prefix: str) -> LLMAdapter | None:
    """Build an optional episode route without inheriting the primary secret.

    A partially filled alternate is ignored with a warning so one optional
    gateway cannot take down the configured primary route. It is never allowed
    to fall back to ``LLM_API_KEY`` or ``LLM_BASE_URL``.
    """

    configured = any(
        os.getenv(f"{prefix}_{suffix}", "").strip()
        for suffix in ("PROVIDER", "MODEL", "API_KEY", "BASE_URL", "WIRE_API")
    ) or bool(_role_api_key_pool(prefix))
    if not configured:
        return None
    model = os.getenv(f"{prefix}_MODEL", "").strip()
    base_url = os.getenv(f"{prefix}_BASE_URL", "").strip()
    api_key = os.getenv(f"{prefix}_API_KEY", "").strip()
    if not api_key and not _role_api_key_pool(prefix):
        return None
    if not model or not base_url:
        logger.warning("Ignoring %s: MODEL and BASE_URL are both required.", prefix)
        return None
    try:
        return _build_role_adapter_from_env(
            prefix,
            fallback_prefixes=(),
            default_model_env=f"{prefix}_MODEL",
            default_timeout_seconds=45,
            default_max_retries=0,
            default_use_strict_schema=False,
            default_thinking_mode="disabled",
            inherit_fallback_runtime_tuning=False,
        )
    except MissingLLMConfigurationError as exc:
        logger.warning("Ignoring invalid optional episode route %s: %s", prefix, exc)
        return None


def _build_episode_failover_chain(routes: list[LLMAdapter]) -> LLMAdapter:
    threshold = _parse_role_positive_int(
        "LLM_EPISODE_PLAN",
        fallback_prefixes=(),
        suffix="CIRCUIT_FAILURE_THRESHOLD",
        default=1,
    )
    cooldown = _parse_positive_float_env(
        "LLM_EPISODE_PLAN_CIRCUIT_COOLDOWN_SECONDS",
        default=180.0,
    )
    adapter = routes[-1]
    for route in reversed(routes[:-1]):
        adapter = ModelFailoverLLMAdapter(
            primary=route,
            fallback=adapter,
            circuit_failure_threshold=threshold,
            circuit_cooldown_seconds=cooldown,
        )
    return adapter


def _adapter_route_identity(adapter: LLMAdapter) -> tuple[str, str, str]:
    info = adapter.get_model_info()
    base_url = getattr(adapter, "_base_url", "")
    pooled_adapters = getattr(adapter, "_adapters", ())
    if not base_url and pooled_adapters:
        base_url = getattr(pooled_adapters[0], "_base_url", "")
    return (
        info.provider.casefold(),
        info.model_name.casefold(),
        str(base_url).rstrip("/").casefold(),
    )


def build_script_repair_llm_adapter_from_env() -> LLMAdapter:
    """Build the high-reasoning adapter for bounded screenplay repairs."""

    primary = _build_role_adapter_from_env(
        "LLM_SCRIPT_REPAIR",
        fallback_prefixes=("LLM_SCRIPT",),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=300,
        default_max_retries=1,
        default_reasoning_effort="high",
        default_thinking_mode="enabled",
        default_retry_empty_response=True,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=True,
    )
    return _with_optional_script_alternate(_with_adaptive_script_transport(primary))


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
            retry_empty_response=True,
            defer_schema_container_repair=True,
            retry_gateway_stream_as_non_stream=True,
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
        retry_empty_response=True,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=True,
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
            default_max_retries=1,
            default_reasoning_effort="high",
            default_thinking_mode="enabled",
            default_retry_empty_response=True,
            defer_schema_container_repair=True,
            retry_gateway_stream_as_non_stream=True,
        )
    return _with_optional_script_alternate(
        _with_adaptive_script_transport(primary),
        enable_slow_hedge=True,
    )


def _with_adaptive_script_transport(
    adapter: LLMAdapter,
    *,
    settings_prefix: str = "LLM_SCRIPT",
) -> LLMAdapter:
    if isinstance(adapter, AdaptiveTransportLLMAdapter):
        return adapter
    info = adapter.get_model_info()
    if "deepseek" not in f"{info.provider} {info.model_name}".casefold():
        return adapter
    route_identity = _adapter_route_identity(adapter)
    with _SCRIPT_ROUTE_STATE_LOCK:
        state = _SCRIPT_TRANSPORT_STATES.setdefault(
            route_identity,
            AdaptiveTransportState(),
        )
    return AdaptiveTransportLLMAdapter(
        adapter=adapter,
        failure_threshold=_parse_positive_int(
            _script_setting_name(
                settings_prefix,
                "ADAPTIVE_NON_STREAM_THRESHOLD",
            )
            or "LLM_SCRIPT_ADAPTIVE_NON_STREAM_THRESHOLD",
            default=1,
        ),
        cooldown_seconds=_parse_positive_float_env(
            _script_setting_name(
                settings_prefix,
                "ADAPTIVE_NON_STREAM_COOLDOWN_SECONDS",
            )
            or "LLM_SCRIPT_ADAPTIVE_NON_STREAM_COOLDOWN_SECONDS",
            default=900.0,
        ),
        state=state,
    )


def _with_optional_script_alternate(
    primary: LLMAdapter,
    *,
    enable_slow_hedge: bool = False,
) -> LLMAdapter:
    """Add explicitly configured same-model screenplay inference routes.

    API keys are scoped to their configured host and are never reused for the
    alternate route. Every alternate model must match the primary model so a
    transport failover cannot silently change screenplay behavior.
    """
    return _with_script_alternates(
        primary,
        alternate_root="LLM_SCRIPT_ALTERNATE",
        settings_prefix="LLM_SCRIPT",
        enable_slow_hedge=enable_slow_hedge,
        default_timeout_seconds=180,
        default_max_retries=1,
        default_reasoning_effort="high",
        default_thinking_mode="enabled",
        default_retry_empty_response=True,
        defer_schema_container_repair=True,
        retry_gateway_stream_as_non_stream=True,
    )


def _has_script_alternate_config(alternate_root: str) -> bool:
    """Return whether an alternate route root has any explicit settings."""

    prefixes = [alternate_root]
    prefixes.extend(f"{alternate_root}_{index:02d}" for index in range(2, 101))
    return any(_has_script_route_fields(prefix) for prefix in prefixes)


def _has_script_route_fields(prefix: str) -> bool:
    return bool(
        any(
            os.getenv(f"{prefix}_{suffix}", "").strip()
            for suffix in ("PROVIDER", "MODEL", "API_KEY", "BASE_URL", "WIRE_API")
        )
        or _role_api_key_pool(prefix)
    )


def _with_script_alternates(
    primary: LLMAdapter,
    *,
    alternate_root: str,
    settings_prefix: str,
    enable_slow_hedge: bool,
    default_timeout_seconds: int,
    default_max_retries: int,
    default_reasoning_effort: str | None,
    default_thinking_mode: str | None,
    default_use_strict_schema: bool = True,
    default_send_response_format: bool = True,
    default_retry_empty_response: bool,
    defer_schema_container_repair: bool,
    retry_gateway_stream_as_non_stream: bool,
) -> LLMAdapter:
    """Attach explicitly configured same-model routes to one screenplay role."""

    alternate_prefixes = [alternate_root]
    for index in range(2, 101):
        prefix = f"{alternate_root}_{index:02d}"
        if any(
            os.getenv(f"{prefix}_{suffix}", "").strip()
            for suffix in ("PROVIDER", "MODEL", "API_KEY", "BASE_URL", "WIRE_API")
        ) or _role_api_key_pool(prefix):
            alternate_prefixes.append(prefix)

    routes: list[LLMAdapter] = []
    primary_info = primary.get_model_info()
    primary_model = primary_info.model_name
    for prefix in alternate_prefixes:
        alternate_fields = {
            suffix: os.getenv(f"{prefix}_{suffix}", "").strip()
            for suffix in ("MODEL", "API_KEY", "BASE_URL")
        }
        if not _has_script_route_fields(prefix):
            continue
        missing = [suffix for suffix, value in alternate_fields.items() if not value]
        if missing:
            raise MissingLLMConfigurationError(
                f"{prefix} requires MODEL, API_KEY and BASE_URL together; "
                "missing: " + ", ".join(missing)
            )
        if primary_model.casefold() != alternate_fields["MODEL"].casefold():
            raise MissingLLMConfigurationError(
                f"{settings_prefix} primary and alternate routes must use the same model."
            )
        alternate = _build_role_adapter_from_env(
            prefix,
            fallback_prefixes=(),
            default_model_env=f"{settings_prefix}_MODEL",
            default_provider=primary_info.provider,
            default_timeout_seconds=default_timeout_seconds,
            default_max_retries=default_max_retries,
            default_use_strict_schema=default_use_strict_schema,
            default_send_response_format=default_send_response_format,
            default_reasoning_effort=default_reasoning_effort,
            default_thinking_mode=default_thinking_mode,
            default_retry_empty_response=default_retry_empty_response,
            defer_schema_container_repair=defer_schema_container_repair,
            retry_gateway_stream_as_non_stream=retry_gateway_stream_as_non_stream,
            inherit_fallback_runtime_tuning=False,
            inherit_fallback_flags=False,
        )
        routes.append(
            _with_adaptive_script_transport(
                alternate,
                settings_prefix=settings_prefix,
            )
        )
    if not routes:
        return primary

    circuit_failure_threshold = _parse_positive_int(
        _script_setting_name(settings_prefix, "CIRCUIT_FAILURE_THRESHOLD")
        or "LLM_SCRIPT_CIRCUIT_FAILURE_THRESHOLD",
        default=1,
    )
    circuit_cooldown_seconds = _parse_positive_float_env(
        _script_setting_name(settings_prefix, "CIRCUIT_COOLDOWN_SECONDS")
        or "LLM_SCRIPT_CIRCUIT_COOLDOWN_SECONDS",
        default=600.0,
    )
    hedge_delay_name = _script_setting_name(settings_prefix, "HEDGE_DELAY_SECONDS")
    route = primary
    for index, alternate in enumerate(routes):
        failover_identity = (
            _adapter_route_identity(route),
            _adapter_route_identity(alternate),
        )
        with _SCRIPT_ROUTE_STATE_LOCK:
            circuit_state = _SCRIPT_FAILOVER_STATES.setdefault(
                failover_identity,
                ModelFailoverCircuitState(),
            )
        route = ModelFailoverLLMAdapter(
            primary=route,
            fallback=alternate,
            circuit_failure_threshold=circuit_failure_threshold,
            circuit_cooldown_seconds=circuit_cooldown_seconds,
            hedge_delay_seconds=(
                _parse_positive_float_env(
                    hedge_delay_name or "LLM_SCRIPT_HEDGE_DELAY_SECONDS",
                    default=35.0,
                )
                if enable_slow_hedge and index == 0
                else None
            ),
            circuit_state=circuit_state,
        )
    return route


def build_script_fallback_llm_adapter_from_env() -> LLMAdapter:
    """Build a screenplay fallback that stays on the configured script profile."""

    return build_script_repair_llm_adapter_from_env()


def build_script_editor_llm_adapter_from_env() -> LLMAdapter:
    """Build the quality-gated editor used only when a draft needs repair."""

    return _build_role_adapter_from_env(
        "LLM_SCRIPT_EDITOR",
        fallback_prefixes=("LLM_DIALOGUE",),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=600,
        default_max_retries=1,
        default_reasoning_effort="medium",
    )


def build_dialogue_polish_adapter_from_env() -> LLMAdapter:
    """Build the dialogue presentation adapter with its own role namespace."""

    return _build_role_adapter_from_env(
        "LLM_DIALOGUE",
        fallback_prefixes=("LLM_SCRIPT_EDITOR",),
        default_model_env="LLM_MODEL",
        default_timeout_seconds=300,
        default_max_retries=1,
    )


def build_market_routed_role_adapter_from_env(
    role: str,
    *,
    fallback: LLMAdapter,
    default_timeout_seconds: int,
    default_max_retries: int,
    default_reasoning_effort: str | None = None,
    default_thinking_mode: str | None = None,
    default_use_strict_schema: bool = True,
    default_send_response_format: bool = True,
    default_retry_empty_response: bool = True,
    defer_schema_container_repair: bool = False,
    retry_gateway_stream_as_non_stream: bool = True,
) -> LLMAdapter:
    """Build mainland/overseas role routes while retaining legacy fallback config.

    Only screenplay roles get the transport/circuit/failover wrappers. Planning
    roles intentionally remain direct market adapters so a screenplay outage
    cannot silently change the planning execution path.
    """

    normalized_role = role.strip().upper()
    screenplay_role = normalized_role in _SCRIPT_MARKET_ROLES
    routes: dict[str, LLMAdapter] = {}
    for market_key, market_name in (
        ("cn_mainland", "CN"),
        ("overseas_tiktok", "OVERSEAS"),
    ):
        prefix = f"LLM_{market_name}_{normalized_role}"
        route = fallback
        configured = any(
            os.getenv(f"{prefix}_{suffix}", "").strip()
            for suffix in ("PROVIDER", "MODEL", "API_KEY", "BASE_URL", "WIRE_API")
        )
        if configured:
            missing = [
                suffix
                for suffix in ("MODEL", "API_KEY", "BASE_URL")
                if not os.getenv(f"{prefix}_{suffix}", "").strip()
            ]
            if missing:
                logger.warning(
                    "Ignoring incomplete market route %s; missing %s",
                    prefix,
                    ", ".join(missing),
                )
            else:
                try:
                    route = _build_role_adapter_from_env(
                        prefix,
                        fallback_prefixes=(),
                        default_model_env=f"{prefix}_MODEL",
                        default_timeout_seconds=default_timeout_seconds,
                        default_max_retries=default_max_retries,
                        default_use_strict_schema=default_use_strict_schema,
                        default_send_response_format=default_send_response_format,
                        default_reasoning_effort=default_reasoning_effort,
                        default_thinking_mode=default_thinking_mode,
                        default_retry_empty_response=default_retry_empty_response,
                        defer_schema_container_repair=defer_schema_container_repair,
                        retry_gateway_stream_as_non_stream=retry_gateway_stream_as_non_stream,
                        inherit_fallback_runtime_tuning=False,
                        inherit_fallback_flags=False,
                    )
                except MissingLLMConfigurationError as exc:
                    logger.warning("Ignoring invalid market route %s: %s", prefix, exc)
                    route = fallback
        if screenplay_role and (
            route is not fallback
            or _has_script_alternate_config(f"{prefix}_ALTERNATE")
        ):
            # Market-specific alternates are scoped to the selected market and
            # role. Their credentials are validated independently below;
            # generic LLM_SCRIPT alternates are handled by the role builders.
            route = _with_adaptive_script_transport(
                route,
                settings_prefix=prefix,
            )
            route = _with_script_alternates(
                route,
                alternate_root=f"{prefix}_ALTERNATE",
                settings_prefix=prefix,
                enable_slow_hedge=normalized_role == "SCRIPT",
                default_timeout_seconds=default_timeout_seconds,
                default_max_retries=default_max_retries,
                default_reasoning_effort=default_reasoning_effort,
                default_thinking_mode=default_thinking_mode,
                default_use_strict_schema=default_use_strict_schema,
                default_send_response_format=default_send_response_format,
                default_retry_empty_response=default_retry_empty_response,
                defer_schema_container_repair=defer_schema_container_repair,
                retry_gateway_stream_as_non_stream=retry_gateway_stream_as_non_stream,
            )
        routes[market_key] = route
    if routes["cn_mainland"] is fallback and routes["overseas_tiktok"] is fallback:
        return fallback
    return MarketRoutedLLMAdapter(
        mainland=routes["cn_mainland"],
        overseas=routes["overseas_tiktok"],
    )


def _build_role_adapter_from_env(
    prefix: str,
    *,
    fallback_prefixes: tuple[str, ...] = (),
    default_model_env: str,
    default_provider: str | None = None,
    default_wire_api: str | None = None,
    default_timeout_seconds: int,
    default_max_retries: int,
    default_use_strict_schema: bool = True,
    default_send_response_format: bool = True,
    default_reasoning_effort: str | None = None,
    default_thinking_mode: str | None = None,
    default_retry_empty_response: bool = True,
    defer_schema_container_repair: bool = False,
    retry_gateway_stream_as_non_stream: bool = True,
    inherit_fallback_runtime_tuning: bool = True,
    inherit_fallback_flags: bool = True,
    apply_astra_fallback: bool = True,
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
    flag_fallback_prefixes = fallback_prefixes if inherit_fallback_flags else ()

    provider = value("PROVIDER", default_provider or config.provider) or (
        default_provider or config.provider
    )
    model_name = value("MODEL", os.getenv(default_model_env, config.model_name).strip())
    api_key = value("API_KEY", config.api_key)
    base_url = value("BASE_URL", config.base_url)
    wire_api = value("WIRE_API", default_wire_api or config.wire_api) or config.wire_api
    reasoning_effort = value(
        "REASONING_EFFORT",
        default_reasoning_effort or config.reasoning_effort,
        fallback_chain=runtime_fallback_prefixes,
    )
    thinking_mode = value(
        "THINKING_MODE",
        default_thinking_mode or config.thinking_mode,
        fallback_chain=(
            ()
            if default_thinking_mode is not None
            else runtime_fallback_prefixes
        ),
    )
    timeout_seconds = _parse_role_positive_int(
        prefix,
        fallback_prefixes=runtime_fallback_prefixes,
        suffix="TIMEOUT_SECONDS",
        default=default_timeout_seconds,
    )
    default_request_deadline_seconds = timeout_seconds
    if _is_astra_model(model_name):
        # Older GLM-oriented role defaults disabled transport schemas. Astra
        # supports them; explicit per-role flags still override these defaults.
        default_use_strict_schema = True
        default_send_response_format = True
        default_request_deadline_seconds = (
            45 if "INSPIRATION" in prefix.upper() else 120
        )
    request_deadline_seconds = _parse_role_positive_int(
        prefix,
        fallback_prefixes=runtime_fallback_prefixes,
        suffix="REQUEST_DEADLINE_SECONDS",
        default=default_request_deadline_seconds,
    )
    max_retries = _parse_role_non_negative_int(
        prefix,
        fallback_prefixes=runtime_fallback_prefixes,
        suffix="MAX_RETRIES",
        default=0 if _is_astra_model(model_name) else default_max_retries,
    )
    retry_empty_response = _parse_role_flag(
        prefix,
        fallback_prefixes=flag_fallback_prefixes,
        suffix="RETRY_EMPTY_RESPONSE",
        default=default_retry_empty_response,
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
            fallback_prefixes=flag_fallback_prefixes,
            suffix="USE_STRICT_SCHEMA",
            default=default_use_strict_schema,
        )
        send_response_format = _parse_role_flag(
            prefix,
            fallback_prefixes=flag_fallback_prefixes,
            suffix="SEND_RESPONSE_FORMAT",
            default=default_send_response_format,
        )
        adapter: LLMAdapter = PooledLLMAdapter(
            provider=provider,
            model_name=model_name or config.model_name,
            api_keys=api_keys,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            request_deadline_seconds=request_deadline_seconds,
            max_retries=max_retries,
            wire_api=wire_api,
            reasoning_effort=reasoning_effort,
            thinking_mode=thinking_mode,
            use_strict_schema=use_strict_schema,
            send_response_format=send_response_format,
            retry_empty_response=retry_empty_response,
            defer_schema_container_repair=defer_schema_container_repair,
            retry_gateway_stream_as_non_stream=retry_gateway_stream_as_non_stream,
        )
        if not apply_astra_fallback:
            return adapter
        return _with_astra_fallback(adapter, settings_prefix=prefix)
    adapter = config.build_adapter(
        provider=provider,
        model_name=model_name,
        api_key=api_key,
        base_url=base_url,
        timeout_seconds=timeout_seconds,
        request_deadline_seconds=request_deadline_seconds,
        max_retries=max_retries,
        reasoning_effort=reasoning_effort,
        thinking_mode=thinking_mode,
        wire_api=wire_api,
        use_strict_schema=_parse_role_flag(
            prefix,
            fallback_prefixes=flag_fallback_prefixes,
            suffix="USE_STRICT_SCHEMA",
            default=default_use_strict_schema,
        ),
        send_response_format=_parse_role_flag(
            prefix,
            fallback_prefixes=flag_fallback_prefixes,
            suffix="SEND_RESPONSE_FORMAT",
            default=default_send_response_format,
        ),
        retry_empty_response=retry_empty_response,
        defer_schema_container_repair=defer_schema_container_repair,
        retry_gateway_stream_as_non_stream=retry_gateway_stream_as_non_stream,
        settings_prefix=prefix,
        apply_astra_fallback=apply_astra_fallback,
    )
    return adapter


def _is_astra_model(model_name: str | None) -> bool:
    return bool(model_name and model_name.strip().casefold() == "gpt-6-astra")


def _with_astra_fallback(
    primary: LLMAdapter,
    *,
    settings_prefix: str,
) -> LLMAdapter:
    """Attach one DeepSeek Pro fallback to every Astra-backed role.

    A single fallback namespace reuses the configured mainland screenplay
    gateway by default, so credentials and endpoint settings are not copied
    into every role. The circuit opens after the first recoverable failure and
    cools down after ten minutes; the first request therefore waits only for
    its role deadline before falling back.
    """

    if isinstance(primary, ModelFailoverLLMAdapter):
        return primary
    try:
        primary_info = primary.get_model_info()
    except Exception:
        return primary
    if not _is_astra_model(primary_info.model_name):
        return primary
    # Choose an entire DeepSeek profile before building it. Falling back field by
    # field to the generic Astra profile can recurse or mix gateway credentials.
    fallback_prefix = None
    candidate_prefixes = (
        f"{settings_prefix}_FALLBACK",
        "LLM_ASTRA_FALLBACK",
        "LLM_DEEPSEEK",
        "LLM_CN_SCRIPT",
        "LLM_SCRIPT",
    )
    for candidate in candidate_prefixes:
        model = os.getenv(f"{candidate}_MODEL", "").strip()
        base_url = os.getenv(f"{candidate}_BASE_URL", "").strip()
        has_key = bool(os.getenv(f"{candidate}_API_KEY", "").strip() or _role_api_key_pool(candidate))
        if model.casefold() == "deepseek-v4-pro" and base_url and has_key:
            fallback_prefix = candidate
            break
        if candidate in {"LLM_ASTRA_FALLBACK", f"{settings_prefix}_FALLBACK"} and (
            model or base_url or has_key
        ):
            break
    if fallback_prefix is None:
        logger.warning(
            "Astra fallback is unavailable for %s: a complete deepseek-v4-pro profile is required.",
            settings_prefix,
        )
        return primary
    try:
        fallback_settings_prefix = fallback_prefix
        fallback = _build_role_adapter_from_env(
            fallback_settings_prefix,
            fallback_prefixes=(),
            default_model_env=f"{fallback_prefix}_MODEL",
            default_provider="openai_compatible",
            default_wire_api="chat_completions",
            default_timeout_seconds=300,
            default_max_retries=0,
            default_reasoning_effort="high" if fallback_prefix == "LLM_ASTRA_FALLBACK" else "low",
            default_thinking_mode="enabled" if fallback_prefix == "LLM_ASTRA_FALLBACK" else "disabled",
            default_use_strict_schema=False,
            default_send_response_format=False,
            default_retry_empty_response=False,
            inherit_fallback_runtime_tuning=False,
            inherit_fallback_flags=False,
            apply_astra_fallback=False,
        )
    except MissingLLMConfigurationError as exc:
        logger.warning("Astra fallback is unavailable for %s: %s", settings_prefix, exc)
        return primary
    threshold = _parse_role_positive_int(
        settings_prefix,
        fallback_prefixes=("LLM_ASTRA_FALLBACK",),
        suffix="FAILOVER_FAILURE_THRESHOLD",
        default=1,
    )
    cooldown_name = f"{settings_prefix}_FAILOVER_COOLDOWN_SECONDS"
    if not os.getenv(cooldown_name, "").strip():
        cooldown_name = "LLM_ASTRA_FALLBACK_FAILOVER_COOLDOWN_SECONDS"
    if not os.getenv(cooldown_name, "").strip():
        cooldown_name = "LLM_ASTRA_FAILOVER_COOLDOWN_SECONDS"
    cooldown = _parse_positive_float_env(cooldown_name, default=600.0)
    return ModelFailoverLLMAdapter(
        primary=primary,
        fallback=fallback,
        circuit_failure_threshold=threshold,
        circuit_cooldown_seconds=cooldown,
        failover_on_request_deadline=True,
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


def _script_setting_name(settings_prefix: str, suffix: str) -> str | None:
    """Return the first configured script resilience setting.

    Market routes may override a setting with ``LLM_CN_*``/``LLM_OVERSEAS_*``;
    role-scoped and generic screenplay settings remain valid fallbacks.
    """

    prefixes = [settings_prefix]
    if settings_prefix.startswith("LLM_CN_"):
        prefixes.append(
            f"LLM_{settings_prefix.removeprefix('LLM_CN_')}"
        )
    elif settings_prefix.startswith("LLM_OVERSEAS_"):
        prefixes.append(
            f"LLM_{settings_prefix.removeprefix('LLM_OVERSEAS_')}"
        )
    if "LLM_SCRIPT" not in prefixes:
        prefixes.append("LLM_SCRIPT")
    for prefix in prefixes:
        name = f"{prefix}_{suffix}"
        if os.getenv(name, "").strip():
            return name
    return None


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


def _parse_positive_float_env(name: str, *, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise MissingLLMConfigurationError(
            f"{name} must be a number, received '{raw}'."
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
