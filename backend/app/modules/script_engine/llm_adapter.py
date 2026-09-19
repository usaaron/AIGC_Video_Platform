from __future__ import annotations

import ast
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from functools import wraps
import hashlib
import json
import logging
import math
import re
import threading
import time
from abc import ABC, abstractmethod
from copy import deepcopy
from queue import Empty, Queue
from typing import Any, Callable, Sequence
from urllib.parse import urlparse

import httpx

from app.modules.script_engine.models import GenerationStrategy, LLMModelInfo
from app.modules.content_spec.market_profile import canonical_market_profile
from app.modules.script_engine.llm_deadline import (
    LLMDeadlineExceeded,
    cap_timeout,
    check_deadline,
    deadline_scope,
    install_deadline_backends,
    remaining_deadline_seconds,
)
from app.modules.script_engine.llm_stream_progress import LLMStreamProgress
from app.modules.script_engine.llm_protocol import ModelProtocol
from app.modules.script_engine.json_schema_contract import compact_json_schema
from app.modules.script_engine.planning_call_budget import (
    PlanningCallBudgetExceeded, charge_planning_model_request,
)
from app.modules.script_engine.planning_attempts import capture_planning_candidate, capture_planning_error


logger = logging.getLogger(__name__)


_LLM_LOG_CONTEXT: ContextVar[dict[str, str]] = ContextVar(
    "llm_log_context",
    default={},
)
_LLM_MARKET_PATH: ContextVar[str | None] = ContextVar("llm_market_path", default=None)
_DEEPSEEK_FULL_EPISODE_STREAM: ContextVar[bool] = ContextVar(
    "deepseek_full_episode_stream", default=False,
)
_LLM_LOCAL_OUTPUT_SCHEMA: ContextVar[dict[str, Any] | None] = ContextVar(
    "llm_local_output_schema", default=None,
)


@contextmanager
def bind_local_output_schema(schema: dict[str, Any] | None):
    """Check native JSON locally without changing the provider's wire format."""
    token = _LLM_LOCAL_OUTPUT_SCHEMA.set(schema)
    try:
        yield
    finally:
        _LLM_LOCAL_OUTPUT_SCHEMA.reset(token)


@contextmanager
def bind_deepseek_full_episode_stream():
    """Use existing SSE inside the selected DeepSeek route for one full edit."""
    token = _DEEPSEEK_FULL_EPISODE_STREAM.set(True)
    try:
        yield
    finally:
        _DEEPSEEK_FULL_EPISODE_STREAM.reset(token)


@contextmanager
def bind_llm_market(release_region: object):
    """Keep nested generation and repair calls on the request's market route."""
    token = _LLM_MARKET_PATH.set(
        canonical_market_profile(getattr(release_region, "value", release_region))
    )
    try:
        yield
    finally:
        _LLM_MARKET_PATH.reset(token)


@contextmanager
def bind_llm_log_context(**fields: object):
    """Attach safe workflow identifiers to every route log in this context."""

    normalized = {
        key: str(value).strip()[:160]
        for key, value in fields.items()
        if value not in (None, "")
    }
    token = _LLM_LOG_CONTEXT.set({**_LLM_LOG_CONTEXT.get(), **normalized})
    try:
        yield
    finally:
        _LLM_LOG_CONTEXT.reset(token)


def _llm_log_context_fields() -> tuple[str, str, str, str]:
    context = _LLM_LOG_CONTEXT.get()
    return (
        context.get("project_id", "-"),
        context.get("episode", "-"),
        context.get("stage", "-"),
        context.get("agent_run_id", "-"),
    )


class MissingLLMConfigurationError(ValueError):
    """Raised when the runtime LLM configuration is incomplete."""


class LLMStructuredOutputError(ValueError):
    """Raised when a model response cannot be parsed into valid structured output."""

    def __init__(
        self,
        message: str,
        *,
        raw_content: str | None = None,
        json_error_line: int | None = None,
        json_error_column: int | None = None,
        json_error_position: int | None = None,
        stream_termination: str | None = None,
        empty_response: bool = False,
        refusal: str | None = None,
    ) -> None:
        super().__init__(message)
        self.raw_content = raw_content
        self.json_error_line = json_error_line
        self.json_error_column = json_error_column
        self.json_error_position = json_error_position
        self.stream_termination = stream_termination
        self.empty_response = empty_response
        self.empty_response_retry_attempted = False
        self.refusal = refusal


class LLMRequestError(RuntimeError):
    """Raised when a real model request fails after retries."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        category: str = "unknown",
        recoverable: bool | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.category = category
        self.recoverable = recoverable


class LLMRequestCancelledError(Exception):
    """Stop a model request when its streaming client disconnects."""


class _HedgedRequestCancelled(LLMRequestCancelledError):
    """Stop a losing same-model route after another route has completed."""


def deadline_request_error(error: LLMDeadlineExceeded) -> LLMRequestError:
    failure = LLMRequestError(
        "LLM cumulative time budget exhausted; this invocation has stopped.",
        category="deadline",
        recoverable=False,
    )
    failure.deadline_scope = error.scope
    return failure


def _bounded_llm_request(operation: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(operation)
    def bounded(self: Any, *args: Any, **kwargs: Any) -> Any:
        try:
            with deadline_scope(self._request_deadline_seconds, scope="request"):
                check_deadline()
                result = operation(self, *args, **kwargs)
                check_deadline()
                return result
        except LLMDeadlineExceeded as error:
            raise deadline_request_error(error) from error

    return bounded


def _raise_if_cancelled(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise _HedgedRequestCancelled()


def is_recoverable_llm_request_error(
    error: LLMRequestError,
    *,
    for_key_rotation: bool = False,
) -> bool:
    """Return whether another configured route/key can reasonably recover.

    Provider gateways frequently wrap transport failures in names such as
    ``RemoteProtocolError`` or ``incomplete chunked read``.  Keep this
    compatibility check centralized so pooled keys and model failover cannot
    disagree about the same outage.
    """
    if error.recoverable is not None:
        if not error.recoverable:
            return False
        if for_key_rotation and error.status_code is not None:
            return error.status_code in {401, 403, 408, 429} or error.status_code >= 500
        return True
    message = str(error).casefold()
    status_markers = (
        ("status 401", "status 403", "status 408", "status 429", "status 5")
        if for_key_rotation
        else (
            "status 401", "status 403", "status 404", "status 408",
            "status 409", "status 422", "status 429", "status 5",
        )
    )
    return any(
        marker in message
        for marker in (
            *status_markers,
            "timed out", "timeout", "connection", "connecterror",
            "remoteprotocolerror", "incomplete chunked", "peer closed",
            "connection reset", "broken pipe", "network", "socket",
            "eof", "stream did not contain output text",
            "non-json success response",
        )
    )


class LLMAdapter(ABC):
    @abstractmethod
    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        raise NotImplementedError

    @abstractmethod
    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        raise NotImplementedError

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
    ) -> dict[str, Any]:
        """Generate structured output while optionally exposing text deltas.

        Adapters without native streaming retain the existing behavior and emit
        one complete JSON preview. The boolean marks the first delta of an
        attempt so clients can replace an invalid or superseded preview.
        """
        output = self.generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        if on_delta is not None:
            preview = {key: value for key, value in output.items() if key != "_meta"}
            on_delta(json.dumps(preview, ensure_ascii=False), True)
        return output

    def generate_structured_output_stream_cancellable(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
        cancel_event: threading.Event,
    ) -> dict[str, Any]:
        """Generate a stream that may be superseded by an equivalent route."""

        if cancel_event.is_set():
            raise _HedgedRequestCancelled()
        return self.generate_structured_output_stream(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
            on_delta=on_delta,
        )

    @abstractmethod
    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys: Sequence[str] | None = None,
    ) -> bool:
        raise NotImplementedError

    @abstractmethod
    def get_model_info(self) -> LLMModelInfo:
        raise NotImplementedError


class MarketRoutedLLMAdapter(LLMAdapter):
    """Use the bound request market, or the legacy prompt contract when unbound."""

    def __init__(
        self,
        *,
        mainland: LLMAdapter,
        overseas: LLMAdapter,
    ) -> None:
        self._mainland = mainland
        self._overseas = overseas

    @staticmethod
    def _is_overseas(prompt: str) -> bool:
        market = re.search(
            r"Market path:\s*(cn_mainland|overseas_tiktok|overseas)\b",
            prompt,
            re.IGNORECASE,
        )
        if market is not None:
            return market.group(1).casefold() != "cn_mainland"
        # Bounded repair prompts may contain only the serialized artifact and
        # its market field, without the original planning contract.
        return bool(
            re.search(
                r"(?:market_profile|market_path|release_region)\s*[\"']?\s*[:=]\s*[\"']?overseas(?:_tiktok)?",
                prompt,
                re.IGNORECASE,
            )
            or re.search(r"\boverseas_tiktok\b", prompt, re.IGNORECASE)
        )

    def _select_with_market(self, prompt: str) -> tuple[str, LLMAdapter]:
        market = _LLM_MARKET_PATH.get()
        if market == "overseas_tiktok" or (market is None and self._is_overseas(prompt)):
            return "overseas_tiktok", self._overseas
        return "cn_mainland", self._mainland

    def _select(self, prompt: str) -> LLMAdapter:
        return self._select_with_market(prompt)[1]

    @staticmethod
    def _annotate_market_result(
        result: dict[str, Any],
        *,
        market_path: str,
        adapter: LLMAdapter,
    ) -> dict[str, Any]:
        metadata = result.setdefault("_meta", {})
        if isinstance(metadata, dict):
            info = adapter.get_model_info()
            metadata.update({
                "market_path": market_path,
                "market_route_provider": info.provider,
                "market_route_model": info.model_name,
            })
        return result

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        return self._select(prompt).generate_text(prompt, strategy=strategy)

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        market_path, adapter = self._select_with_market(prompt)
        result = adapter.generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        return self._annotate_market_result(
            result,
            market_path=market_path,
            adapter=adapter,
        )

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
    ) -> dict[str, Any]:
        market_path, adapter = self._select_with_market(prompt)
        result = adapter.generate_structured_output_stream(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
            on_delta=on_delta,
        )
        return self._annotate_market_result(
            result,
            market_path=market_path,
            adapter=adapter,
        )

    def generate_structured_output_stream_cancellable(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
        cancel_event: threading.Event,
    ) -> dict[str, Any]:
        market_path, adapter = self._select_with_market(prompt)
        result = adapter.generate_structured_output_stream_cancellable(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
            on_delta=on_delta,
            cancel_event=cancel_event,
        )
        return self._annotate_market_result(
            result,
            market_path=market_path,
            adapter=adapter,
        )

    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys: Sequence[str] | None = None,
    ) -> bool:
        # Validation is schema-independent of market, so either route is valid.
        return self._mainland.validate_output(output, required_keys=required_keys)

    def get_model_info(self) -> LLMModelInfo:
        mainland = self._mainland.get_model_info()
        overseas = self._overseas.get_model_info()
        return mainland.model_copy(
            update={
                "model_name": (
                    f"market-routed[{mainland.model_name}|{overseas.model_name}]"
                )[:120],
            }
        )


class RealLLMAdapter(LLMAdapter):
    """OpenAI-compatible adapter for real structured script generation."""

    def __init__(
        self,
        *,
        provider: str,
        model_name: str,
        api_key: str,
        base_url: str,
        timeout_seconds: int = 60,
        request_deadline_seconds: float | None = None,
        max_retries: int = 2,
        max_context_tokens: int = 128_000,
        wire_api: str = "chat_completions",
        reasoning_effort: str | None = None,
        thinking_mode: str | None = None,
        use_strict_schema: bool = True,
        send_response_format: bool = True,
        retry_empty_response: bool = True,
        defer_schema_container_repair: bool = False,
        retry_gateway_stream_as_non_stream: bool = True,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_key.strip():
            raise MissingLLMConfigurationError("LLM_API_KEY must not be empty.")
        if not base_url.strip():
            raise MissingLLMConfigurationError("LLM_BASE_URL must not be empty.")
        normalized_wire_api = wire_api.strip().casefold()
        if normalized_wire_api not in {"chat_completions", "responses"}:
            raise MissingLLMConfigurationError(
                "LLM_WIRE_API must be 'chat_completions' or 'responses'."
            )
        normalized_reasoning_effort = (
            reasoning_effort.strip().casefold() if reasoning_effort else None
        )
        if normalized_reasoning_effort not in {
            None,
            "none",
            "minimal",
            "low",
            "medium",
            "high",
            "max",
            "xhigh",
        }:
            raise MissingLLMConfigurationError(
                "LLM_REASONING_EFFORT must be none, minimal, low, medium, high, "
                "max or xhigh."
            )
        normalized_thinking_mode = (
            thinking_mode.strip().casefold() if thinking_mode else None
        )
        if normalized_thinking_mode not in {None, "enabled", "disabled"}:
            raise MissingLLMConfigurationError(
                "LLM_THINKING_MODE must be enabled or disabled."
            )

        self._provider = provider
        self._model_name = model_name
        self._protocol = ModelProtocol.identify(provider, model_name)
        self._is_deepseek = self._protocol.family == "deepseek"
        self._is_glm = self._protocol.family == "glm"
        self._is_qwen = self._protocol.family == "qwen"
        if self._is_deepseek:
            use_strict_schema = False
        elif self._is_glm and normalized_wire_api == "chat_completions":
            # GLM's native structured-output transport is Chat Completions
            # with json_object. OpenAI's strict json_schema envelope is not a
            # portable contract across GLM-compatible gateways.
            use_strict_schema = False
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._request_deadline_seconds = (
            float(timeout_seconds) if request_deadline_seconds is None else request_deadline_seconds
        )
        if not math.isfinite(self._request_deadline_seconds) or self._request_deadline_seconds <= 0:
            raise MissingLLMConfigurationError("LLM request deadline must be finite and positive.")
        self._max_retries = max_retries
        self._max_context_tokens = max_context_tokens
        self._wire_api = normalized_wire_api
        self._reasoning_effort = normalized_reasoning_effort
        self._effective_reasoning_effort = self._protocol.reasoning_effort(
            normalized_reasoning_effort, normalized_thinking_mode
        )
        self._thinking_mode = (
            self._protocol.thinking_mode(normalized_thinking_mode, normalized_reasoning_effort)
            if self._protocol.family in {"deepseek", "glm", "qwen"}
            else normalized_thinking_mode
        )
        self._use_strict_schema = use_strict_schema
        self._send_response_format = send_response_format
        self._retry_empty_response = retry_empty_response
        # Script responses are already validated by the artifact-aware service.
        # Avoid asking a high-reasoning model to regenerate an entire episode
        # merely because one JSON array/object was encoded as a scalar.
        self._defer_schema_container_repair = defer_schema_container_repair
        self._retry_gateway_stream_as_non_stream = retry_gateway_stream_as_non_stream
        self._client = httpx.Client(
            timeout=timeout_seconds,
            transport=transport,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        install_deadline_backends(self._client)

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        payload = self._build_payload(
            prompt=prompt,
            strategy=strategy,
            output_schema=None,
        )
        response_payload = self._post_with_retries(payload)
        return self._extract_text_content(response_payload)

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if _DEEPSEEK_FULL_EPISODE_STREAM.get() and self._is_deepseek:
            # Keep market/pool/failover on the existing ordinary-call chain.
            # Consume the preference here so a legitimate SSE->JSON fallback
            # does not recursively re-enter SSE or add another attempt.
            token = _DEEPSEEK_FULL_EPISODE_STREAM.set(False)
            try:
                return self._generate_structured_output_stream(
                    prompt,
                    strategy=strategy,
                    output_schema=output_schema,
                    on_delta=None,
                    cancel_event=None,
                )
            finally:
                _DEEPSEEK_FULL_EPISODE_STREAM.reset(token)
        payload = self._build_payload(
            prompt=prompt,
            strategy=strategy,
            output_schema=output_schema,
        )

        response_payload = self._post_with_retries(payload)
        adapter_model_pass_count = 1
        try:
            structured_output = self._extract_structured_output(
                response_payload,
                output_schema=output_schema,
            )
        except LLMStructuredOutputError as error:
            if response_payload.get("_gateway_retry_transport") == "stream":
                setattr(error, "gateway_deadline", True)
                setattr(error, "non_stream_gateway_retry_attempted", True)
                setattr(error, "stream_fallback_attempted", True)
                error.stream_termination = response_payload.get("_gateway_retry_stream_termination")
            response_is_empty = self._response_content_is_empty(response_payload)
            if response_is_empty:
                error.empty_response = True
            self._annotate_empty_response_diagnostics(error, response_payload)
            self._log_route_output_rejected(
                transport="non_stream",
                error=error,
                response_payload=response_payload,
            )
            if (
                not self._retry_empty_response
                or (
                    self._wire_api != "responses"
                    and not self._is_deepseek
                )
                or not response_is_empty
            ):
                raise
            # A successful HTTP response can still contain no usable text
            # (empty ``output``, a gateway wrapper, or a missing message). Give
            # every Responses-compatible provider one bounded protocol retry.
            retry_payload = self._empty_json_retry_payload(payload)
            response_payload = self._post_with_retries(retry_payload)
            adapter_model_pass_count += 1
            try:
                structured_output = self._extract_structured_output(
                    response_payload,
                    output_schema=output_schema,
                )
            except LLMStructuredOutputError as retry_error:
                if self._response_content_is_empty(response_payload):
                    retry_error.empty_response = True
                    retry_error.empty_response_retry_attempted = True
                self._annotate_empty_response_diagnostics(
                    retry_error,
                    response_payload,
                )
                self._log_route_output_rejected(
                    transport="non_stream",
                    error=retry_error,
                    response_payload=response_payload,
                )
                raise
        structured_output = self._decode_stringified_dynamic_objects(
            structured_output,
            output_schema=output_schema,
        )
        original_structured_output = structured_output
        structured_output, root_repaired_response = self._repair_schema_root_shape(
            payload,
            structured_output,
            output_schema=output_schema,
        )
        repaired_response = root_repaired_response
        root_unwrapped = (
            structured_output is not original_structured_output
            and root_repaired_response is None
        )
        if root_repaired_response is not None:
            adapter_model_pass_count += 1
        (
            structured_output,
            container_repaired_response,
            container_repair_pass_count,
            container_locally_normalized,
            deferred_container_issues,
        ) = self._repair_schema_container_shape(
            payload,
            structured_output,
            output_schema=output_schema,
        )
        adapter_model_pass_count += container_repair_pass_count
        if container_repaired_response is not None:
            repaired_response = container_repaired_response
        if repaired_response is not None:
            response_payload = repaired_response
        structured_output["_meta"] = {
            "provider": self._provider,
            "model_name": self._model_name,
            "strategy_id": strategy.id,
            "adapter_model_pass_count": adapter_model_pass_count,
        }
        if root_unwrapped:
            structured_output["_meta"]["schema_root_unwrapped"] = True
        if root_repaired_response is not None:
            structured_output["_meta"]["schema_root_repaired"] = True
        if container_repaired_response is not None:
            structured_output["_meta"]["schema_container_repaired"] = True
        if container_locally_normalized:
            structured_output["_meta"]["schema_container_locally_normalized"] = True
        if deferred_container_issues:
            structured_output["_meta"]["schema_container_repair_deferred"] = True
            structured_output["_meta"]["schema_container_issues"] = deferred_container_issues[:20]
        if self._is_deepseek or self._is_glm or self._is_qwen:
            structured_output["_meta"]["thinking_mode"] = (
                self._thinking_mode or "enabled"
            )
        usage = response_payload.get("usage")
        if isinstance(usage, dict):
            structured_output["_meta"]["usage"] = usage
        response_id = response_payload.get("id")
        if isinstance(response_id, str) and response_id.strip():
            structured_output["_meta"]["response_id"] = response_id.strip()
        if response_payload.get("_gateway_retry_transport") == "stream":
            structured_output["_meta"]["gateway_retry_transport"] = "stream"
            structured_output["_meta"]["gateway_retry_status_code"] = 524
            structured_output["_meta"]["stream_termination"] = response_payload.get("_gateway_retry_stream_termination")
        return structured_output

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
    ) -> dict[str, Any]:
        return self._generate_structured_output_stream(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
            on_delta=on_delta,
            cancel_event=None,
        )

    def generate_structured_output_stream_cancellable(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
        cancel_event: threading.Event,
    ) -> dict[str, Any]:
        return self._generate_structured_output_stream(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
            on_delta=on_delta,
            cancel_event=cancel_event,
        )

    def _generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None,
        on_delta: Callable[[str, bool], None] | None,
        cancel_event: threading.Event | None,
    ) -> dict[str, Any]:
        payload = self._build_payload(
            prompt=prompt,
            strategy=strategy,
            output_schema=output_schema,
        )

        try:
            text, usage, response_id, stream_termination = self._stream_text(
                payload,
                on_delta=on_delta,
                cancel_event=cancel_event,
            )
        except LLMRequestError as error:
            if not self._should_fallback_from_stream(error):
                raise
            if cancel_event is not None and cancel_event.is_set():
                raise _HedgedRequestCancelled() from error
            try:
                fallback = self.generate_structured_output(
                    prompt,
                    strategy=strategy,
                    output_schema=output_schema,
                )
            except (LLMRequestError, LLMStructuredOutputError) as fallback_error:
                # Preserve transport history across pooled-key rotation so the
                # episode service does not submit a third copy of the same
                # request after both SSE and ordinary JSON already failed.
                setattr(fallback_error, "stream_fallback_attempted", True)
                setattr(
                    fallback_error,
                    "stream_failure_status_code",
                    error.status_code,
                )
                raise
            fallback.setdefault("_meta", {})["stream_fallback"] = True
            if on_delta is not None:
                preview = {
                    key: value for key, value in fallback.items() if key != "_meta"
                }
                on_delta(json.dumps(preview, ensure_ascii=False), True)
            return fallback

        if cancel_event is not None and cancel_event.is_set():
            raise _HedgedRequestCancelled()

        try:
            structured_output = self._parse_json_content(
                text,
                output_schema=output_schema,
            )
            if self._stream_has_failure_termination(stream_termination):
                raise LLMStructuredOutputError(
                    "LLM stream terminated without completing the response.",
                    raw_content=text,
                    stream_termination=stream_termination,
                )
        except LLMStructuredOutputError as error:
            error.stream_termination = stream_termination
            self._log_route_output_rejected(
                transport="stream",
                error=error,
                content_chars=len(text),
                finish_reason=stream_termination,
            )
            raise
        if cancel_event is not None and cancel_event.is_set():
            raise _HedgedRequestCancelled()
        structured_output = self._decode_stringified_dynamic_objects(
            structured_output,
            output_schema=output_schema,
        )
        adapter_model_pass_count = 1
        original_structured_output = structured_output
        structured_output, root_repaired_response = self._repair_schema_root_shape(
            payload,
            structured_output,
            output_schema=output_schema,
        )
        repaired_response = root_repaired_response
        root_unwrapped = (
            structured_output is not original_structured_output
            and root_repaired_response is None
        )
        if root_repaired_response is not None:
            adapter_model_pass_count += 1
        (
            structured_output,
            container_repaired_response,
            container_repair_pass_count,
            container_locally_normalized,
            deferred_container_issues,
        ) = self._repair_schema_container_shape(
            payload,
            structured_output,
            output_schema=output_schema,
        )
        adapter_model_pass_count += container_repair_pass_count
        if container_repaired_response is not None:
            repaired_response = container_repaired_response
        if repaired_response is not None:
            usage_value = repaired_response.get("usage")
            usage = usage_value if isinstance(usage_value, dict) else usage
            response_id_value = repaired_response.get("id")
            response_id = (
                response_id_value.strip()
                if isinstance(response_id_value, str) and response_id_value.strip()
                else response_id
            )
            if on_delta is not None:
                on_delta(json.dumps(structured_output, ensure_ascii=False), True)
        structured_output["_meta"] = {
            "provider": self._provider,
            "model_name": self._model_name,
            "strategy_id": strategy.id,
            "streamed": True,
            "adapter_model_pass_count": adapter_model_pass_count,
        }
        if root_unwrapped:
            structured_output["_meta"]["schema_root_unwrapped"] = True
        if root_repaired_response is not None:
            structured_output["_meta"]["schema_root_repaired"] = True
        if container_repaired_response is not None:
            structured_output["_meta"]["schema_container_repaired"] = True
        if container_locally_normalized:
            structured_output["_meta"]["schema_container_locally_normalized"] = True
        if deferred_container_issues:
            structured_output["_meta"]["schema_container_repair_deferred"] = True
            structured_output["_meta"]["schema_container_issues"] = deferred_container_issues[:20]
        if self._is_deepseek or self._is_glm or self._is_qwen:
            structured_output["_meta"]["thinking_mode"] = (
                self._thinking_mode or "enabled"
            )
        if usage is not None:
            structured_output["_meta"]["usage"] = usage
        if response_id is not None:
            structured_output["_meta"]["response_id"] = response_id
        structured_output["_meta"]["stream_termination"] = stream_termination
        return structured_output

    def _repair_schema_root_shape(
        self,
        payload: dict[str, Any],
        structured_output: dict[str, Any],
        *,
        output_schema: dict[str, Any] | None,
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        if output_schema is None:
            return structured_output, None
        unwrapped = self._unwrap_schema_root_envelope(
            structured_output,
            output_schema,
        )
        if unwrapped is not None:
            return unwrapped, None
        if not self._should_repair_schema_root(structured_output, output_schema):
            # A recognized root with ordinary missing fields is still a root
            # object. Leave it to the artifact validator instead of spending a
            # provider call on a shape repair.
            return structured_output, None
        issues = self._schema_root_issues(structured_output, output_schema)
        retry_payload = self._root_shape_retry_payload(payload, issues)
        response = self._post_with_retries(retry_payload)
        repaired = self._extract_structured_output(
            response,
            output_schema=output_schema,
        )
        repaired = self._unwrap_schema_root_envelope(repaired, output_schema) or repaired
        remaining = self._schema_root_issues(repaired, output_schema)
        if remaining:
            raise LLMStructuredOutputError(
                "Model returned a valid JSON object with the wrong schema root after "
                "one bounded root-contract repair: "
                + ", ".join(remaining[:20]),
                raw_content=json.dumps(repaired, ensure_ascii=False),
            )
        return repaired, response

    @classmethod
    def _should_repair_schema_root(
        cls,
        value: dict[str, Any],
        output_schema: dict[str, Any],
    ) -> bool:
        """Return true only when the model clearly returned a nested object."""
        properties = output_schema.get("properties")
        if not isinstance(properties, dict):
            return False
        if set(value) & set(properties):
            return False
        keys = {key for key in value if isinstance(key, str)}
        if not keys:
            return True
        # These markers are intentionally shared across script, roadmap,
        # scene, dialogue, character, and state contracts. The adapter should
        # repair any nested fragment consistently, regardless of the caller.
        nested_markers = {
            "scene_number",
            "scene_id",
            "slug",
            "purpose",
            "setting",
            "beat_summary",
            "emotional_shift",
            "emotional_objective",
            "character_actions",
            "turning_point",
            "scene_causality",
            "dialogues",
            "speaker",
            "dialogue",
            "character_name",
            "current_goal",
            "emotional_state",
            "belief_or_attitude",
            "life_status",
            "physical_state",
            "knowledge_changes",
            "knowledge_states",
            "health_conditions",
            "change_cause",
            "change_summary",
            "action_capabilities",
            "active_constraints",
            "lasting_marks",
            "evidence_scene_numbers",
            "episode_number",
            "episode_goal",
            "planned_story_beat",
            "cliffhanger",
        }
        return bool(keys & nested_markers)

    @staticmethod
    def _root_shape_retry_payload(
        payload: dict[str, Any],
        issues: list[str],
    ) -> dict[str, Any]:
        retry_payload = deepcopy(payload)
        instruction = (
            "Your previous JSON was a valid nested fragment, but it was not the "
            "requested top-level schema object. Missing root contract fields: "
            + ", ".join(issues[:20])
            + ". Return the complete requested root object now. Do not return a scene, "
            "character, character-state, dialogue, child, item, or any other nested "
            "schema object. Do not wrap it in data/result/output. Return JSON only."
        )
        messages = retry_payload.get("messages")
        if isinstance(messages, list):
            messages.append({"role": "user", "content": instruction})
        response_input = retry_payload.get("input")
        if isinstance(response_input, list):
            response_input.append(
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": instruction}],
                }
            )
        return retry_payload

    @classmethod
    def _schema_root_issues(
        cls,
        value: dict[str, Any],
        output_schema: dict[str, Any],
    ) -> list[str]:
        properties = output_schema.get("properties")
        if not isinstance(properties, dict):
            return []
        required = output_schema.get("required")
        required_fields = (
            [field for field in required if isinstance(field, str)]
            if isinstance(required, list)
            else []
        )
        issues = [
            f"missing required root field: {field}"
            for field in required_fields
            if field not in value
        ]
        if not (set(value) & set(properties)):
            issues.append("no recognized root fields")
        return issues

    @classmethod
    def _unwrap_schema_root_envelope(
        cls,
        value: dict[str, Any],
        output_schema: dict[str, Any],
    ) -> dict[str, Any] | None:
        if cls._matches_schema_root(value, output_schema):
            return value
        envelope_keys = (
            "draft_master_script",
            "master_script",
            "script",
            "screenplay",
            "episode_script",
            "roadmap",
            "episode_roadmap",
            "data",
            "result",
            "output",
            "response",
        )
        pending: list[tuple[dict[str, Any], int]] = [(value, 0)]
        seen: set[int] = set()
        while pending:
            current, depth = pending.pop(0)
            if depth >= 3 or id(current) in seen:
                continue
            seen.add(id(current))
            for key in envelope_keys:
                nested = current.get(key)
                if not isinstance(nested, dict):
                    continue
                if cls._matches_schema_root(nested, output_schema):
                    return nested
                pending.append((nested, depth + 1))
        return None

    def _repair_schema_container_shape(
        self,
        payload: dict[str, Any],
        structured_output: dict[str, Any],
        *,
        output_schema: dict[str, Any] | None,
    ) -> tuple[dict[str, Any], dict[str, Any] | None, int, bool, list[str]]:
        if output_schema is None:
            return structured_output, None, 0, False, []
        latest_output, locally_normalized = self._normalize_schema_container_shape(
            structured_output,
            output_schema,
            root_schema=output_schema,
        )
        latest_response: dict[str, Any] | None = None
        model_pass_count = 0
        for _attempt in range(2):
            issues = self._schema_container_issues(
                latest_output,
                output_schema,
                root_schema=output_schema,
            )
            if not issues:
                return latest_output, latest_response, model_pass_count, locally_normalized, []
            if self._defer_schema_container_repair:
                logger.info(
                    "Schema container repair deferred to artifact validator issues=%s",
                    ", ".join(issues[:12]),
                )
                return (
                    latest_output,
                    latest_response,
                    model_pass_count,
                    locally_normalized,
                    issues,
                )
            retry_payload = self._container_shape_retry_payload(payload, issues)
            latest_response = self._post_with_retries(retry_payload)
            model_pass_count += 1
            try:
                latest_output = self._extract_structured_output(
                    latest_response,
                    output_schema=output_schema,
                )
            except LLMStructuredOutputError as error:
                # Preserve the last usable parsed root for the caller's
                # artifact-aware repair path instead of replacing its
                # diagnostic with an empty second response.
                if not (error.raw_content or "").strip():
                    error.raw_content = json.dumps(latest_output, ensure_ascii=False)
                setattr(error, "schema_container_issues", issues)
                raise
            latest_output, normalized_this_pass = self._normalize_schema_container_shape(
                latest_output,
                output_schema,
                root_schema=output_schema,
            )
            locally_normalized = locally_normalized or normalized_this_pass
            latest_output = (
                self._unwrap_schema_root_envelope(latest_output, output_schema)
                or latest_output
            )
            if not self._matches_schema_root(latest_output, output_schema):
                raise LLMStructuredOutputError(
                    "Model returned the wrong schema root during bounded container "
                    "repair: "
                    + ", ".join(
                        self._schema_root_issues(latest_output, output_schema)[:20]
                    ),
                    raw_content=json.dumps(latest_output, ensure_ascii=False),
                )
        remaining = self._schema_container_issues(
            latest_output,
            output_schema,
            root_schema=output_schema,
        )
        if remaining:
            raise LLMStructuredOutputError(
                "Model repeatedly encoded schema objects or arrays as scalar values: "
                + ", ".join(remaining[:20]),
                raw_content=json.dumps(latest_output, ensure_ascii=False),
            )
        return latest_output, latest_response, model_pass_count, locally_normalized, []

    @classmethod
    def _normalize_schema_container_shape(
        cls,
        value: Any,
        schema: Any,
        *,
        root_schema: dict[str, Any],
        depth: int = 0,
    ) -> tuple[Any, bool]:
        """Repair unambiguous JSON container drift without another model call."""

        if depth > 12 or not isinstance(schema, dict):
            return value, False
        reference = schema.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/$defs/"):
            definitions = root_schema.get("$defs")
            target = (
                definitions.get(reference.removeprefix("#/$defs/"))
                if isinstance(definitions, dict)
                else None
            )
            return (
                cls._normalize_schema_container_shape(
                    value,
                    target,
                    root_schema=root_schema,
                    depth=depth + 1,
                )
                if isinstance(target, dict)
                else (value, False)
            )

        variants = schema.get("anyOf") or schema.get("oneOf")
        if isinstance(variants, list):
            non_null = [item for item in variants if isinstance(item, dict) and item.get("type") != "null"]
            for variant in variants:
                if isinstance(variant, dict) and cls._schema_accepts_native_value(
                    value, variant, root_schema=root_schema,
                ):
                    return cls._normalize_schema_container_shape(
                        value,
                        variant,
                        root_schema=root_schema,
                        depth=depth + 1,
                    )
            if non_null:
                return cls._normalize_schema_container_shape(
                    value,
                    non_null[0],
                    root_schema=root_schema,
                    depth=depth + 1,
                )
            return value, False

        schema_type = schema.get("type")
        changed = False
        if schema_type == "object" or isinstance(schema.get("properties"), dict):
            if isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict):
                value = value[0]
                changed = True
            if not isinstance(value, dict):
                return value, changed
            properties = schema.get("properties")
            if isinstance(properties, dict):
                for field_name, field_schema in properties.items():
                    if field_name not in value:
                        continue
                    normalized, field_changed = cls._normalize_schema_container_shape(
                        value[field_name],
                        field_schema,
                        root_schema=root_schema,
                        depth=depth + 1,
                    )
                    if field_changed:
                        value[field_name] = normalized
                        changed = True
            return value, changed

        if schema_type == "array":
            item_schema = schema.get("items")
            if isinstance(value, dict) and cls._schema_is_object(item_schema):
                value = [value]
                changed = True
            elif isinstance(value, str) and cls._schema_is_scalar(item_schema):
                if value.strip():
                    value = [value.strip()]
                    changed = True
                else:
                    value = []
                    changed = True
            elif cls._schema_is_scalar(item_schema) and not isinstance(value, list):
                value = [value]
                changed = True
            if not isinstance(value, list):
                return value, changed
            if isinstance(item_schema, dict):
                for index, item in enumerate(value):
                    normalized, item_changed = cls._normalize_schema_container_shape(
                        item,
                        item_schema,
                        root_schema=root_schema,
                        depth=depth + 1,
                    )
                    if item_changed:
                        value[index] = normalized
                        changed = True
            return value, changed
        return value, changed

    @classmethod
    def _schema_accepts_native_value(
        cls, value: Any, schema: dict[str, Any], *,
        root_schema: dict[str, Any] | None = None, depth: int = 0,
    ) -> bool:
        if depth > 12:
            return False
        reference = schema.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/$defs/") and root_schema:
            target = root_schema.get("$defs", {}).get(reference.removeprefix("#/$defs/"))
            if isinstance(target, dict):
                return cls._schema_accepts_native_value(
                    value, target, root_schema=root_schema, depth=depth + 1,
                )
        variants = schema.get("anyOf") or schema.get("oneOf")
        if isinstance(variants, list):
            return any(
                cls._schema_accepts_native_value(
                    value, variant, root_schema=root_schema, depth=depth + 1,
                )
                for variant in variants if isinstance(variant, dict)
            )
        schema_type = schema.get("type")
        if schema_type == "object" or isinstance(schema.get("properties"), dict):
            return isinstance(value, dict)
        if schema_type == "array":
            return isinstance(value, list)
        if schema_type == "string":
            return isinstance(value, str)
        if schema_type == "integer":
            return isinstance(value, int) and not isinstance(value, bool)
        if schema_type == "number":
            return isinstance(value, (int, float)) and not isinstance(value, bool)
        if schema_type == "boolean":
            return isinstance(value, bool)
        if schema_type == "null":
            return value is None
        return True

    @classmethod
    def _schema_is_object(cls, schema: Any) -> bool:
        return isinstance(schema, dict) and (
            schema.get("type") == "object" or isinstance(schema.get("properties"), dict) or "$ref" in schema
        )

    @classmethod
    def _schema_is_scalar(cls, schema: Any) -> bool:
        if not isinstance(schema, dict):
            return False
        if schema.get("$ref") or schema.get("anyOf") or schema.get("oneOf"):
            return False
        return schema.get("type") in {"string", "integer", "number", "boolean"}

    @classmethod
    def _schema_container_issues(
        cls,
        value: Any,
        schema: Any,
        *,
        root_schema: dict[str, Any],
        path: str = "$",
        depth: int = 0,
    ) -> list[str]:
        if depth > 12 or not isinstance(schema, dict):
            return []
        variants = schema.get("anyOf") or schema.get("oneOf")
        if isinstance(variants, list):
            viable: list[list[str]] = []
            for variant in variants:
                if not isinstance(variant, dict):
                    continue
                if cls._schema_accepts_native_value(value, variant, root_schema=root_schema):
                    return cls._schema_container_issues(
                        value,
                        variant,
                        root_schema=root_schema,
                        path=path,
                        depth=depth + 1,
                    )
                if variant.get("type") == "null":
                    continue
                viable.append(
                    cls._schema_container_issues(
                        value,
                        variant,
                        root_schema=root_schema,
                        path=path,
                        depth=depth + 1,
                    )
                )
            return min(viable, key=len, default=[])
        reference = schema.get("$ref")
        prefix = "#/$defs/"
        if isinstance(reference, str) and reference.startswith(prefix):
            definitions = root_schema.get("$defs")
            target = (
                definitions.get(reference[len(prefix):])
                if isinstance(definitions, dict)
                else None
            )
            if isinstance(target, dict):
                return cls._schema_container_issues(
                    value,
                    target,
                    root_schema=root_schema,
                    path=path,
                    depth=depth + 1,
                )
            return []
        schema_type = schema.get("type")
        if schema_type == "object" or isinstance(schema.get("properties"), dict):
            if not isinstance(value, dict):
                return [f"{path}: expected object, got {type(value).__name__}"]
            issues: list[str] = []
            properties = schema.get("properties")
            if isinstance(properties, dict):
                for field_name, field_schema in properties.items():
                    if field_name not in value:
                        continue
                    issues.extend(
                        cls._schema_container_issues(
                            value[field_name],
                            field_schema,
                            root_schema=root_schema,
                            path=f"{path}.{field_name}",
                            depth=depth + 1,
                        )
                    )
            return issues
        if schema_type == "array":
            if not isinstance(value, list):
                return [f"{path}: expected array, got {type(value).__name__}"]
            item_schema = schema.get("items")
            issues = []
            for index, item in enumerate(value):
                issues.extend(
                    cls._schema_container_issues(
                        item,
                        item_schema,
                        root_schema=root_schema,
                        path=f"{path}.{index}",
                        depth=depth + 1,
                    )
                )
            return issues
        return []

    @staticmethod
    def _container_shape_retry_payload(
        payload: dict[str, Any],
        issues: list[str],
    ) -> dict[str, Any]:
        retry_payload = deepcopy(payload)
        instruction = (
            "Your previous response violated the JSON container types at: "
            + ", ".join(issues[:20])
            + ". Regenerate the complete answer from the original request. Every schema "
            "object must be a native JSON object and every schema array must be a native "
            "JSON array. Never place an object or array inside a quoted string. Return "
            "only the complete corrected JSON value."
        )
        messages = retry_payload.get("messages")
        if isinstance(messages, list):
            messages.append({"role": "user", "content": instruction})
        response_input = retry_payload.get("input")
        if isinstance(response_input, list):
            response_input.append(
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": instruction}],
                }
            )
        return retry_payload

    @staticmethod
    def _reasoning_budget_exhausted(error: LLMRequestError) -> bool:
        stream_termination = str(
            getattr(error, "stream_termination", "") or ""
        ).casefold()
        reasoning_characters = getattr(error, "reasoning_characters", 0)
        return (
            error.category == "empty_response"
            and isinstance(reasoning_characters, int)
            and reasoning_characters > 0
            and any(marker in stream_termination for marker in (
                "length",
                "max_output",
                "token",
                "incomplete",
            ))
        )

    @staticmethod
    def _provider_reported_generation_failure(error: LLMRequestError) -> bool:
        termination = str(getattr(error, "stream_termination", "") or "").casefold()
        return bool({"response.failed", "failed"} & set(termination.split(":")))

    def _should_fallback_from_stream(self, error: LLMRequestError) -> bool:
        cause: BaseException | None = error
        seen: set[int] = set()
        while cause is not None and id(cause) not in seen:
            seen.add(id(cause))
            if isinstance(cause, (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)):
                # DNS, TCP/TLS and pool acquisition failed before HTTP began.
                # Switching SSE off cannot repair that connection. Preserve
                # configured connection retries and let the outer route decide.
                return False
            cause = cause.__cause__
        if self._provider_reported_generation_failure(error):
            # A terminal failed response is a provider result, not evidence of
            # broken SSE. Let the configured outer route recover instead of
            # starting another full deadline on this same generation route.
            return False
        # Some compatible gateways fail only on the long-lived SSE path. A
        # bounded non-streaming attempt on the same key changes the transport
        # without changing model, prompt, or screenplay obligations.
        if error.status_code == 524:
            # A 524 can be caused by the gateway's SSE worker rather than the
            # model itself. In the success-first profile, allow the bounded
            # non-stream fallback; the adapter retry count still limits this
            # to a finite number of requests.
            return self._retry_gateway_stream_as_non_stream
        if self._reasoning_budget_exhausted(error):
            # This route exhausted the answer budget on hidden reasoning. A
            # non-streaming repeat uses the same budget and only doubles the
            # wait; let an outer model-route adapter fail over instead.
            return False
        if (
            not self._retry_gateway_stream_as_non_stream
            and (
                error.category == "provider_gateway"
                or (error.status_code is not None and error.status_code >= 500)
            )
        ):
            # A host/upstream outage is not an SSE compatibility problem.
            # Let the outer route failover move to another gateway immediately.
            return False
        if error.category == "transport" and self._retry_gateway_stream_as_non_stream:
            # A gateway may close an SSE response after delivering a partial
            # JSON document. Switch transports once before discarding the
            # otherwise recoverable request.
            return True
        message = str(error).casefold()
        return (
            error.category in {"empty_response", "provider_protocol", "provider_gateway"}
            or error.status_code in {502, 503, 504}
            or "stream did not contain output text" in message
            or any(
                f"non-retryable status {status_code}" in message
                for status_code in (400, 404, 405, 422)
            )
        )

    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys: Sequence[str] | None = None,
    ) -> bool:
        if required_keys is None:
            return bool(output)
        return all(key in output for key in required_keys)

    def get_model_info(self) -> LLMModelInfo:
        return LLMModelInfo(
            provider=self._provider,
            model_name=self._model_name,
            supports_structured_output=True,
            max_context_tokens=self._max_context_tokens,
        )

    def _build_payload(
        self,
        *,
        prompt: str,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if self._wire_api == "responses":
            return self._build_responses_payload(
                prompt=prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        return self._build_chat_payload(
            prompt=prompt,
            strategy=strategy,
            output_schema=output_schema,
        )

    def _build_chat_payload(
        self,
        *,
        prompt: str,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None,
    ) -> dict[str, Any]:
        structured_prompt = self._prompt_with_json_contract(
            prompt,
            output_schema=output_schema,
        )
        payload: dict[str, Any] = {
            "model": self._model_name,
            self._protocol.chat_token_limit_key: strategy.max_tokens,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You generate structured dramatic scripts. When JSON is "
                        "requested, return exactly one valid JSON object with no "
                        "Markdown or explanatory text and follow its field shape exactly."
                    ),
                },
                {"role": "user", "content": structured_prompt},
            ],
        }
        if self._is_deepseek:
            thinking_mode = self._thinking_mode or "enabled"
            payload["thinking"] = {"type": thinking_mode}
            if thinking_mode == "enabled":
                if self._effective_reasoning_effort is not None:
                    payload["reasoning_effort"] = self._effective_reasoning_effort
            else:
                payload["temperature"] = strategy.temperature
                payload["top_p"] = strategy.top_p
        elif self._is_glm or self._is_qwen:
            thinking_mode = self._thinking_mode or "enabled"
            payload["thinking"] = {"type": thinking_mode}
            if thinking_mode == "disabled":
                payload["reasoning_effort"] = "none"
            elif self._effective_reasoning_effort is not None:
                payload["reasoning_effort"] = self._effective_reasoning_effort
            payload["temperature"] = strategy.temperature
            payload["top_p"] = strategy.top_p
        elif self._protocol.family == "openai_reasoning":
            if self._effective_reasoning_effort is not None:
                payload["reasoning_effort"] = self._effective_reasoning_effort
        else:
            payload["temperature"] = strategy.temperature
            payload["top_p"] = strategy.top_p
            if self._protocol.family == "gemini" and self._effective_reasoning_effort is not None:
                payload["reasoning_effort"] = self._effective_reasoning_effort
        response_format_type = self._protocol.chat_response_format_type(
            strict=self._use_strict_schema,
            thinking=payload.get("thinking", {}).get("type"),
        )
        if output_schema and self._send_response_format and response_format_type:
            if response_format_type == "json_schema":
                strict_schema = self._provider_json_schema(output_schema)
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": self._structured_output_name(output_schema),
                        "strict": True,
                        "schema": strict_schema,
                    },
                }
            else:
                payload["response_format"] = {"type": "json_object"}
        return payload

    def _prompt_with_json_contract(
        self,
        prompt: str,
        *,
        output_schema: dict[str, Any] | None,
    ) -> str:
        if output_schema is None:
            return prompt
        # Strict JSON-schema transports receive the complete schema in the
        # request body. Relaxed json_object transports guarantee syntax only,
        # so they need the actual constraints, not an example that drops bounds,
        # enum alternatives and nested fields hidden behind default empty arrays.
        normalized_schema = self._provider_json_schema(output_schema)
        uses_stringified_dynamic_objects = (
            self._wire_api == "responses"
            and self._use_strict_schema
            and not self._supports_strict_json_schema(normalized_schema)
        )
        if (
            self._send_response_format
            and not self._is_deepseek
            and self._use_strict_schema
            and self._supports_strict_json_schema(normalized_schema)
        ):
            return prompt
        contract = compact_json_schema(output_schema)
        properties = output_schema.get("properties")
        root_fields = (
            [name for name in properties if isinstance(name, str)]
            if isinstance(properties, dict)
            else []
        )
        required = output_schema.get("required")
        required_root_fields = (
            [name for name in required if isinstance(name, str)]
            if isinstance(required, list)
            else []
        )
        root_identity = (
            "Top-level root fields: " + ", ".join(root_fields) + ".\n"
            if root_fields
            else ""
        )
        if required_root_fields:
            root_identity += (
                "Required top-level root fields: "
                + ", ".join(required_root_fields)
                + ".\n"
            )
        contract_title = (
            "DEEPSEEK JSON OUTPUT CONTRACT"
            if self._is_deepseek
            else "JSON OUTPUT SHAPE CONTRACT"
        )
        dynamic_object_guidance = (
            "For unbounded dictionary fields represented as strings by the response schema, "
            "return a JSON-encoded object string; the runtime will restore it to a native object.\n"
            if uses_stringified_dynamic_objects
            else ""
        )
        single_scene_storyboard = (
            output_schema.get("title") == "SceneProposal"
            and set(root_fields) == {"design", "shots", "unresolved_questions"}
            and {"design", "shots"}.issubset(required_root_fields)
        )
        root_completeness = (
            "This task's complete root object is one single-scene storyboard proposal: "
            "design, shots, and unresolved_questions. Return the complete proposal for the supplied scene, "
            "not one shot, one design field, or an array item. Do not add an episode or scenes wrapper."
            if single_scene_storyboard else
            "The first and only JSON object must be the complete root object,\n"
            "never one scene, character, state update, episode, dialogue, child, or array item."
        )
        return f"""{prompt}

{contract_title}
The API response format guarantees JSON syntax only. The following JSON Schema defines
the complete response contract, including required nested fields, array bounds, integer
ranges and allowed enum values. Follow all constraints on the first response. Return
story data matching this schema, not the schema itself or placeholder examples.
Objects and arrays must remain native JSON containers: never serialize a
child object or nested collection into a quoted JSON string unless the response schema
explicitly represents an unbounded dictionary as a JSON-encoded string. Do not return the result
inside another wrapper. {root_completeness}
{dynamic_object_guidance}
{root_identity}<json_contract>
{json.dumps(contract, ensure_ascii=False, separators=(',', ':'))}
</json_contract>
Return exactly one json object now."""

    @classmethod
    def _json_shape_example(cls, schema: dict[str, Any]) -> Any:
        definitions = schema.get("$defs")
        definitions = definitions if isinstance(definitions, dict) else {}

        def example(value: Any, stack: tuple[str, ...] = ()) -> Any:
            if not isinstance(value, dict):
                return None
            reference = value.get("$ref")
            prefix = "#/$defs/"
            if isinstance(reference, str) and reference.startswith(prefix):
                name = reference[len(prefix):]
                if name in stack:
                    return {}
                target = definitions.get(name)
                return example(target, (*stack, name))
            const = value.get("const")
            if const is not None:
                return const
            examples = value.get("examples")
            if isinstance(examples, list) and examples:
                return deepcopy(examples[0])
            if "default" in value and value["default"] is not None:
                return value["default"]
            enum = value.get("enum")
            if isinstance(enum, list) and enum:
                return next((item for item in enum if item is not None), enum[0])
            for union_key in ("anyOf", "oneOf"):
                union = value.get(union_key)
                if isinstance(union, list):
                    if any(
                        isinstance(option, dict) and option.get("type") == "null"
                        for option in union
                    ):
                        return None
                    selected = next(
                        (
                            option
                            for option in union
                            if isinstance(option, dict) and option.get("type") != "null"
                        ),
                        union[0] if union else {},
                    )
                    return example(selected, stack)
            value_type = value.get("type")
            if value_type == "object" or isinstance(value.get("properties"), dict):
                properties = value.get("properties")
                if not isinstance(properties, dict):
                    return {}
                return {
                    name: example(property_schema, stack)
                    for name, property_schema in properties.items()
                }
            if value_type == "array":
                minimum_items = value.get("minItems", 1)
                count = (
                    max(1, min(4, minimum_items))
                    if isinstance(minimum_items, int)
                    else 1
                )
                return [example(value.get("items", {}), stack) for _ in range(count)]
            if value_type == "boolean":
                return False
            if value_type == "integer":
                minimum = value.get("minimum")
                return minimum if isinstance(minimum, int) else 0
            if value_type == "number":
                minimum = value.get("minimum")
                return float(minimum) if isinstance(minimum, (int, float)) else 0.0
            pattern = value.get("pattern")
            if isinstance(pattern, str):
                alternatives = re.fullmatch(r"\^\(([^()]+)\)\$", pattern)
                if alternatives is not None:
                    first = alternatives.group(1).split("|", 1)[0]
                    if re.fullmatch(r"[A-Za-z0-9_.:-]+", first):
                        return first
            minimum_length = value.get("minLength", 1)
            count = (
                max(1, min(20, minimum_length))
                if isinstance(minimum_length, int)
                else 1
            )
            return "值" * count

        return example(schema)

    @staticmethod
    def _response_content_is_empty(response_payload: dict[str, Any]) -> bool:
        choices = response_payload.get("choices")
        if isinstance(choices, list):
            if not choices:
                return True
            first = choices[0]
            if not isinstance(first, dict):
                return True
            message = first.get("message")
            if not isinstance(message, dict):
                return True
            if RealLLMAdapter._response_refusal(message):
                return False
            return not bool(RealLLMAdapter._response_text_fragments(message.get("content")))

        if any(key in response_payload for key in ("output", "output_text", "response")):
            if RealLLMAdapter._response_refusal(response_payload):
                return False
            return not bool(RealLLMAdapter._response_text_fragments(response_payload))

        # A 2xx JSON object without any recognized output field is still an
        # empty protocol response and is safe to retry once.
        return True

    @staticmethod
    def _response_text_fragments(value: Any, *, depth: int = 0) -> list[str]:
        if depth > 8:
            return []
        if isinstance(value, str):
            return [value.strip()] if value.strip() else []
        if isinstance(value, list):
            fragments: list[str] = []
            for item in value:
                fragments.extend(
                    RealLLMAdapter._response_text_fragments(item, depth=depth + 1)
                )
            return fragments
        if not isinstance(value, dict):
            return []
        fragments = []
        for key in ("output_text", "text"):
            fragments.extend(
                RealLLMAdapter._response_text_fragments(value.get(key), depth=depth + 1)
            )
        for key in ("content", "output", "response"):
            nested = value.get(key)
            if isinstance(nested, (dict, list)):
                fragments.extend(
                    RealLLMAdapter._response_text_fragments(nested, depth=depth + 1)
                )
        return fragments

    @staticmethod
    def _response_refusal(value: Any, *, depth: int = 0) -> str | None:
        if depth > 8:
            return None
        if isinstance(value, dict):
            refusal = value.get("refusal")
            if isinstance(refusal, str) and refusal.strip():
                return refusal.strip()
            for key in ("content", "output", "response", "message"):
                nested = value.get(key)
                found = RealLLMAdapter._response_refusal(nested, depth=depth + 1)
                if found:
                    return found
        elif isinstance(value, list):
            for item in value:
                found = RealLLMAdapter._response_refusal(item, depth=depth + 1)
                if found:
                    return found
        return None

    @staticmethod
    def _empty_json_retry_payload(
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        retry_payload = deepcopy(payload)
        messages = retry_payload.get("messages")
        if isinstance(messages, list):
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "The previous JSON Output response was empty. Return the "
                        "requested complete JSON object now; no explanation or fence."
                    ),
                }
            )
        response_input = retry_payload.get("input")
        if isinstance(response_input, list):
            response_input.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "The previous structured response was empty. Return the "
                                "requested complete JSON object now; no explanation or fence."
                            ),
                        }
                    ],
                }
            )
        return retry_payload

    def _build_responses_payload(
        self,
        *,
        prompt: str,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None,
    ) -> dict[str, Any]:
        structured_prompt = self._prompt_with_json_contract(
            prompt,
            output_schema=output_schema,
        )
        payload: dict[str, Any] = {
            "model": self._model_name,
            "max_output_tokens": strategy.max_tokens,
            "store": False,
            "input": [
                {
                    "role": "system",
                    # A few OpenAI-compatible Responses gateways only inspect
                    # string-valued message content when validating the
                    # json_object precondition. Keep this as a plain string;
                    # the official Responses API accepts both string and
                    # typed-content forms.
                    "content": (
                        "You generate structured dramatic scripts. "
                        "Follow the supplied JSON schema exactly. "
                        "When JSON object mode is used, return valid json."
                    ),
                },
                {
                    "role": "user",
                    "content": structured_prompt,
                },
            ],
        }
        if self._effective_reasoning_effort is not None:
            payload["reasoning"] = {"effort": self._effective_reasoning_effort}
        if output_schema and self._send_response_format:
            normalized_schema = self._provider_json_schema(output_schema)
            if self._use_strict_schema and self._supports_strict_json_schema(normalized_schema):
                payload["text"] = {
                    "format": {
                        "type": "json_schema",
                        "name": self._structured_output_name(output_schema),
                        "strict": True,
                        "schema": normalized_schema,
                    }
                }
            elif self._use_strict_schema:
                # This gateway rejects Responses ``json_object`` outright and
                # also rejects unbounded ``additionalProperties`` in strict
                # schemas. Encode only those dynamic dictionaries as JSON
                # strings; the response is decoded back to native objects
                # after extraction and before service validation.
                payload["text"] = {
                    "format": {
                        "type": "json_schema",
                        "name": self._structured_output_name(output_schema),
                        "strict": True,
                        "schema": self._stringify_dynamic_objects_for_strict_schema(
                            normalized_schema
                        ),
                    }
                }
            else:
                # OpenAI-compatible gateways reject strict schemas that contain
                # unbounded dictionaries (for example interactive planning's
                # step-specific ``fields`` object). Keep JSON mode so the
                # prompt contract and Pydantic validation still enforce the
                # response shape without sending an impossible schema.
                payload["text"] = {"format": {"type": "json_object"}}
        return payload

    def _provider_json_schema(self, schema: dict[str, Any]) -> dict[str, Any]:
        normalized = self._normalize_strict_json_schema(schema)
        if self._protocol.family != "gemini":
            return normalized

        # The configured Gemini compatibility gateway returned empty dialogue
        # objects for nested $refs. Inline acyclic definitions without weakening
        # field constraints; recursive/unknown references retain native schema.
        definitions = normalized.get("$defs", {})

        def inline(value: Any, stack: tuple[str, ...] = ()) -> Any:
            if isinstance(value, list):
                return [inline(item, stack) for item in value]
            if not isinstance(value, dict):
                return value
            reference = value.get("$ref")
            if isinstance(reference, str):
                prefix = "#/$defs/"
                name = reference[len(prefix):].replace("~1", "/").replace("~0", "~")
                if not reference.startswith(prefix) or name in stack or name not in definitions:
                    raise ValueError("Schema reference cannot be fully inlined.")
                target = inline(definitions[name], (*stack, name))
                return {**target, **inline({key: child for key, child in value.items() if key != "$ref"}, stack)}
            result = {}
            for key, child in value.items():
                if key == "$defs":
                    continue
                if key in {"default", "examples", "enum", "const"}:
                    result[key] = deepcopy(child)
                elif key in {"properties", "patternProperties", "dependentSchemas"}:
                    result[key] = {name: inline(item, stack) for name, item in child.items()}
                else:
                    result[key] = inline(child, stack)
            return result

        try:
            return inline(normalized)
        except ValueError:
            return normalized

    @classmethod
    def _normalize_strict_json_schema(cls, schema: dict[str, Any]) -> dict[str, Any]:
        """Make Pydantic schemas compatible with strict structured-output APIs."""
        normalized = deepcopy(schema)

        # Several OpenAI-compatible gateways select the first definition in
        # ``$defs`` as the response root. Pydantic collection models commonly
        # put the real root at ``properties.children`` and reference the item
        # contract from there. Inline only root collection item references: it
        # removes that ambiguity without expanding every repeated definition in
        # large screenplay schemas.
        definitions = normalized.get("$defs")
        properties = normalized.get("properties")
        if isinstance(definitions, dict) and isinstance(properties, dict):
            for property_schema in properties.values():
                if not isinstance(property_schema, dict):
                    continue
                items = property_schema.get("items")
                if not isinstance(items, dict):
                    continue
                reference = items.get("$ref")
                prefix = "#/$defs/"
                if not isinstance(reference, str) or not reference.startswith(prefix):
                    continue
                definition = definitions.get(reference[len(prefix):])
                if not isinstance(definition, dict):
                    continue
                inlined = deepcopy(definition)
                inlined.update({key: value for key, value in items.items() if key != "$ref"})
                property_schema["items"] = inlined

        def visit(value: Any) -> None:
            if isinstance(value, dict):
                if isinstance(value.get("$ref"), str):
                    # Strict gateways reject Pydantic's default annotation beside
                    # a reference; defaults still belong to the local model.
                    value.pop("default", None)
                properties = value.get("properties")
                if isinstance(properties, dict):
                    value["required"] = list(properties)
                    value["additionalProperties"] = False
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(normalized)
        if "$ref" not in json.dumps(normalized, ensure_ascii=True):
            normalized.pop("$defs", None)
        return normalized

    @staticmethod
    def _supports_strict_json_schema(schema: dict[str, Any]) -> bool:
        """Return whether a schema can be submitted to strict JSON Schema APIs.

        Strict providers require every object to have a closed property set.
        Pydantic represents ``dict[str, Any]`` as ``additionalProperties: true``;
        that is valid JSON Schema but cannot be accepted by the strict response
        format, so callers should use the stringified strict schema or JSON object
        mode, depending on the provider transport.
        """

        def visit(value: Any) -> bool:
            if isinstance(value, dict):
                if value.get("type") == "object":
                    if value.get("additionalProperties") is not False:
                        return False
                    properties = value.get("properties")
                    if not isinstance(properties, dict):
                        return False
                return all(visit(child) for child in value.values())
            if isinstance(value, list):
                return all(visit(child) for child in value)
            return True

        return visit(schema)

    @classmethod
    def _stringify_dynamic_objects_for_strict_schema(
        cls,
        schema: dict[str, Any],
    ) -> dict[str, Any]:
        """Represent unbounded dictionaries as JSON strings for strict gateways."""

        def visit(value: Any) -> Any:
            if isinstance(value, dict):
                if value.get("type") == "object" and value.get("additionalProperties") is not False:
                    return {
                        "type": "string",
                        "description": "JSON-encoded object value",
                    }
                return {key: visit(child) for key, child in value.items()}
            if isinstance(value, list):
                return [visit(child) for child in value]
            return value

        return visit(deepcopy(schema))

    @classmethod
    def _decode_stringified_dynamic_objects(
        cls,
        value: Any,
        *,
        output_schema: dict[str, Any] | None,
    ) -> Any:
        """Restore dynamic dictionary fields encoded as strings by strict JSON schema."""

        if output_schema is None:
            return value
        definitions = output_schema.get("$defs")
        definitions = definitions if isinstance(definitions, dict) else {}

        def visit(current: Any, schema: Any, stack: tuple[str, ...] = ()) -> Any:
            if not isinstance(schema, dict):
                return current
            reference = schema.get("$ref")
            prefix = "#/$defs/"
            if isinstance(reference, str) and reference.startswith(prefix):
                name = reference[len(prefix):]
                if name in stack:
                    return current
                target = definitions.get(name)
                if isinstance(target, dict):
                    return visit(current, target, (*stack, name))
                return current
            if schema.get("type") == "object" and schema.get("additionalProperties") is not False:
                if isinstance(current, str):
                    try:
                        decoded = json.loads(current)
                    except (TypeError, json.JSONDecodeError):
                        return current
                    return decoded if isinstance(decoded, dict) else current
                return current
            if schema.get("type") == "array" and isinstance(current, list):
                return [visit(item, schema.get("items")) for item in current]
            properties = schema.get("properties")
            if isinstance(properties, dict) and isinstance(current, dict):
                return {
                    key: visit(child, properties.get(key))
                    for key, child in current.items()
                }
            return current

        return visit(value, output_schema)

    @staticmethod
    def _structured_output_name(output_schema: dict[str, Any]) -> str:
        title = output_schema.get("title")
        source = title if isinstance(title, str) and title.strip() else "structured_output"
        normalized = re.sub(r"[^a-zA-Z0-9_-]+", "_", source).strip("_").casefold()
        return (normalized or "structured_output")[:64]

    def _route_log_context(self) -> tuple[str, str, str, str]:
        parsed = urlparse(self._base_url)
        gateway = parsed.hostname or self._base_url.split("/", 1)[0] or "unknown"
        return self._provider, self._model_name, gateway, self._wire_api

    def _log_route_started(
        self,
        *,
        transport: str,
        attempt: int,
        payload: dict[str, Any] | None = None,
    ) -> None:
        provider, model, gateway, wire_api = self._route_log_context()
        project_id, episode, stage, agent_run_id = _llm_log_context_fields()
        prompt_chars = 0
        if isinstance(payload, dict):
            messages = payload.get("messages")
            if isinstance(messages, list):
                prompt_chars = sum(
                    len(str(message.get("content") or ""))
                    for message in messages
                    if isinstance(message, dict)
                )
            response_input = payload.get("input")
            if isinstance(response_input, list):
                prompt_chars = max(
                    prompt_chars,
                    sum(
                        len(str(item.get("content") or ""))
                        for item in response_input
                        if isinstance(item, dict)
                    ),
                )
        output_budget = (
            payload.get("max_tokens")
            if isinstance(payload, dict)
            else None
        )
        if output_budget is None and isinstance(payload, dict):
            output_budget = payload.get("max_output_tokens")
        logger.warning(
            "LLM route request started provider=%s model=%s gateway=%s "
            "wire_api=%s transport=%s attempt=%d/%d project_id=%s episode=%s "
            "stage=%s agent_run_id=%s prompt_chars=%d "
            "output_budget=%s reasoning=%s thinking=%s",
            provider,
            model,
            gateway,
            wire_api,
            transport,
            attempt + 1,
            self._max_retries + 1,
            project_id,
            episode,
            stage,
            agent_run_id,
            prompt_chars,
            output_budget if output_budget is not None else "none",
            self._reasoning_effort or "provider_default",
            self._thinking_mode or "provider_default",
        )

    def _log_route_finished(
        self,
        *,
        transport: str,
        attempt: int,
        started: float,
        outcome: str,
        status_code: int | None = None,
        category: str,
        will_retry: bool = False,
        error: Exception | None = None,
        response_payload: Any = None,
        content_chars: int | None = None,
        reasoning_chars: int | None = None,
        finish_reason: str | None = None,
    ) -> None:
        provider, model, gateway, wire_api = self._route_log_context()
        project_id, episode, stage, agent_run_id = _llm_log_context_fields()
        diagnostics = self._response_diagnostics(response_payload)
        if content_chars is None:
            content_chars = diagnostics["content_chars"]
        if reasoning_chars is None:
            reasoning_chars = diagnostics["reasoning_chars"]
        if finish_reason is None:
            finish_reason = diagnostics["finish_reason"]
        error_type = type(error).__name__ if error is not None else "none"
        detail = self._safe_route_log_detail(error)
        logger.warning(
            "LLM route request finished provider=%s model=%s gateway=%s "
            "wire_api=%s transport=%s attempt=%d/%d project_id=%s episode=%s "
            "stage=%s agent_run_id=%s outcome=%s "
            "duration_seconds=%.2f status_code=%s category=%s will_retry=%s "
            "content_chars=%d reasoning_chars=%d finish_reason=%s "
            "error_type=%s detail=%s",
            provider,
            model,
            gateway,
            wire_api,
            transport,
            attempt + 1,
            self._max_retries + 1,
            project_id,
            episode,
            stage,
            agent_run_id,
            outcome,
            time.monotonic() - started,
            status_code if status_code is not None else "none",
            category,
            str(will_retry).lower(),
            content_chars,
            reasoning_chars,
            finish_reason or "none",
            error_type,
            detail,
        )

    @staticmethod
    def _safe_route_log_detail(error: Exception | None) -> str:
        if error is None:
            return "none"
        detail = " ".join(str(error).split()).strip()
        return (detail or type(error).__name__)[:300]

    def _stream_progress(self, started: float, attempt: int, transport: str) -> LLMStreamProgress:
        def emit(state: dict[str, Any]) -> None:
            provider, model, gateway, wire_api = self._route_log_context()
            project, episode, stage, run = _llm_log_context_fields()
            logger.warning(
                "LLM route response progress provider=%s model=%s gateway=%s wire_api=%s "
                "transport=%s attempt=%d project_id=%s episode=%s stage=%s agent_run_id=%s metrics=%s",
                provider, model, gateway, wire_api, transport, attempt + 1,
                project, episode, stage, run, json.dumps(state, separators=(",", ":")),
            )

        return LLMStreamProgress(started, emit)

    def _log_route_output_rejected(
        self,
        *,
        transport: str,
        error: LLMStructuredOutputError,
        response_payload: Any = None,
        content_chars: int | None = None,
        reasoning_chars: int | None = None,
        finish_reason: str | None = None,
    ) -> None:
        capture_planning_error(f"adapter {transport} rejected model={self._model_name}", error)
        provider, model, gateway, wire_api = self._route_log_context()
        project_id, episode, stage, agent_run_id = _llm_log_context_fields()
        diagnostics = self._response_diagnostics(response_payload)
        logger.warning(
            "LLM route output rejected provider=%s model=%s gateway=%s "
            "wire_api=%s transport=%s project_id=%s episode=%s stage=%s "
            "agent_run_id=%s category=%s empty_response=%s "
            "content_chars=%d reasoning_chars=%d finish_reason=%s "
            "stream_termination=%s error_type=%s detail=%s",
            provider,
            model,
            gateway,
            wire_api,
            transport,
            project_id,
            episode,
            stage,
            agent_run_id,
            "empty_response" if error.empty_response else "structured_output",
            str(error.empty_response).lower(),
            diagnostics["content_chars"] if content_chars is None else content_chars,
            diagnostics["reasoning_chars"] if reasoning_chars is None else reasoning_chars,
            finish_reason or diagnostics["finish_reason"] or "none",
            error.stream_termination or "none",
            type(error).__name__,
            self._safe_route_log_detail(error),
        )
        if error.json_error_position is not None:
            # Syntax diagnostics reveal delimiters, never story text or source
            # material. This distinguishes malformed JSON from token exhaustion
            # without requesting another expensive model pass to find the cause.
            position = error.json_error_position
            raw = error.raw_content or ""
            delimiters = re.sub(r'[^\s{}\[\]:,\"]', "x", raw[max(0, position - 60):position + 60])
            cause = error.__cause__
            logger.warning(
                "LLM JSON syntax rejected line=%s column=%s position=%s reason=%s delimiters=%s",
                error.json_error_line, error.json_error_column, position,
                cause.msg if isinstance(cause, json.JSONDecodeError) else "unknown",
                json.dumps(delimiters),
            )

    @staticmethod
    def _annotate_empty_response_diagnostics(
        error: LLMStructuredOutputError,
        response_payload: Any,
    ) -> None:
        """Carry non-stream reasoning exhaustion into failover decisions."""

        if not error.empty_response:
            return
        diagnostics = RealLLMAdapter._response_diagnostics(response_payload)
        reasoning_characters = diagnostics.get("reasoning_chars")
        if isinstance(reasoning_characters, int) and reasoning_characters > 0:
            setattr(error, "reasoning_characters", reasoning_characters)
        finish_reason = diagnostics.get("finish_reason")
        if (
            isinstance(finish_reason, str)
            and finish_reason.strip()
            and not error.stream_termination
        ):
            error.stream_termination = f"finish_reason:{finish_reason.strip().casefold()}"

    @staticmethod
    def _response_diagnostics(response_payload: Any) -> dict[str, Any]:
        diagnostics: dict[str, Any] = {
            "content_chars": 0,
            "reasoning_chars": 0,
            "finish_reason": None,
        }
        if not isinstance(response_payload, dict):
            return diagnostics

        choices = response_payload.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                finish_reason = first.get("finish_reason")
                if isinstance(finish_reason, str) and finish_reason.strip():
                    diagnostics["finish_reason"] = finish_reason.strip().casefold()
                message = first.get("message")
                if isinstance(message, dict):
                    diagnostics["content_chars"] = sum(
                        len(value)
                        for value in RealLLMAdapter._response_text_fragments(
                            message.get("content")
                        )
                    )
                    diagnostics["reasoning_chars"] = sum(
                        len(value)
                        for key in ("reasoning_content", "reasoning")
                        for value in RealLLMAdapter._response_text_fragments(
                            message.get(key)
                        )
                    )
            return diagnostics

        output_value = response_payload.get("output_text")
        if output_value is None:
            output_value = response_payload.get("output")
        if output_value is None:
            output_value = response_payload.get("response")
        diagnostics["content_chars"] = sum(
            len(value)
            for value in RealLLMAdapter._response_text_fragments(output_value)
        )
        status = response_payload.get("status")
        if isinstance(status, str) and status.strip():
            diagnostics["finish_reason"] = status.strip().casefold()
        diagnostics["reasoning_chars"] = RealLLMAdapter._reasoning_text_length(
            response_payload
        )
        return diagnostics

    @staticmethod
    def _reasoning_text_length(value: Any, *, depth: int = 0) -> int:
        if depth > 8:
            return 0
        if isinstance(value, list):
            return sum(
                RealLLMAdapter._reasoning_text_length(item, depth=depth + 1)
                for item in value
            )
        if not isinstance(value, dict):
            return 0
        total = 0
        for key, child in value.items():
            if key in {"reasoning_content", "reasoning_text"}:
                total += sum(
                    len(fragment)
                    for fragment in RealLLMAdapter._response_text_fragments(child)
                )
            elif key == "reasoning" and isinstance(child, str):
                total += len(child.strip())
            else:
                total += RealLLMAdapter._reasoning_text_length(
                    child,
                    depth=depth + 1,
                )
        return total

    @_bounded_llm_request
    def _post_with_retries(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            check_deadline()
            charge_planning_model_request()
            started = time.monotonic()
            progress = self._stream_progress(started, attempt, "non_stream")
            self._log_route_started(
                transport="non_stream",
                attempt=attempt,
                payload=payload,
            )
            try:
                endpoint = (
                    "responses" if self._wire_api == "responses" else "chat/completions"
                )
                with self._client.stream(
                    "POST", f"{self._base_url}/{endpoint}", json=payload,
                    timeout=cap_timeout(self._timeout_seconds),
                ) as response:
                    progress.headers(response.status_code)
                    response.stream = progress.wrap(response.stream)
                    response.read()
                check_deadline()
                response.raise_for_status()
                try:
                    response_payload = response.json()
                except (json.JSONDecodeError, ValueError) as exc:
                    content_type = response.headers.get("content-type", "unknown")
                    error = LLMRequestError(
                        "LLM endpoint returned a non-JSON success response "
                        f"(content-type: {content_type}).",
                        category="provider_protocol",
                        recoverable=True,
                    )
                    self._log_route_finished(
                        transport="non_stream",
                        attempt=attempt,
                        started=started,
                        outcome="failure",
                        status_code=response.status_code,
                        category=error.category,
                        error=error,
                    )
                    raise error from exc
                self._log_route_finished(
                    transport="non_stream",
                    attempt=attempt,
                    started=started,
                    outcome="http_success",
                    status_code=response.status_code,
                    category="success",
                    response_payload=response_payload,
                )
                return response_payload
            except LLMDeadlineExceeded as exc:
                self._log_route_finished(
                    transport="non_stream", attempt=attempt, started=started,
                    outcome="failure", category="deadline", will_retry=False, error=exc,
                )
                raise
            except httpx.TimeoutException as exc:
                last_error = exc
                will_retry = attempt < self._max_retries
                self._log_route_finished(
                    transport="non_stream",
                    attempt=attempt,
                    started=started,
                    outcome="failure",
                    category="timeout",
                    will_retry=will_retry,
                    error=exc,
                )
                if attempt >= self._max_retries:
                    raise LLMRequestError(
                        "LLM request timed out after exhausting retries.",
                        category="timeout",
                        recoverable=True,
                    ) from exc
            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code
                response_detail = self._extract_error_detail(exc.response)
                category = "provider_http" if status_code < 500 else "provider_gateway"
                # A 524 is the upstream gateway's execution deadline. In the
                # success-first script profile, spend the configured bounded
                # retry before giving the route up; a transiently overloaded
                # gateway can still complete the second request.
                gateway_deadline = status_code == 524
                will_retry = (
                    status_code >= 500
                    and attempt < self._max_retries
                )
                self._log_route_finished(
                    transport="non_stream",
                    attempt=attempt,
                    started=started,
                    outcome="failure",
                    status_code=status_code,
                    category=category,
                    will_retry=will_retry,
                    error=LLMRequestError(response_detail, category=category),
                )
                if 400 <= status_code < 500:
                    raise LLMRequestError(
                        "LLM request failed with non-retryable status "
                        f"{status_code}: {response_detail}",
                        status_code=status_code,
                        category="provider_http",
                        recoverable=status_code in {401, 403, 404, 408, 409, 422, 429},
                    ) from exc
                last_error = exc
                if gateway_deadline and will_retry and self._is_deepseek and self._wire_api == "chat_completions":
                    # This HTTP error contains no model output. Spend only the
                    # already-configured remaining retries on SSE, which can
                    # keep a long reasoning response alive at the gateway.
                    # Do not call generate_* here: that would reset retry and
                    # schema-repair budgets or permit a transport fallback loop.
                    return self._retry_gateway_deadline_as_stream(payload, first_attempt=attempt + 1)
                if attempt >= self._max_retries:
                    failure_phrase = (
                        "at the provider gateway deadline"
                        if gateway_deadline
                        else "after retries"
                    )
                    raise LLMRequestError(
                        "LLM request failed with status "
                        f"{status_code} {failure_phrase}: {response_detail}",
                        status_code=status_code,
                        category="provider_gateway",
                        recoverable=True,
                    ) from exc
            except httpx.HTTPError as exc:
                last_error = exc
                will_retry = attempt < self._max_retries
                self._log_route_finished(
                    transport="non_stream",
                    attempt=attempt,
                    started=started,
                    outcome="failure",
                    category="transport",
                    will_retry=will_retry,
                    error=exc,
                )
                if attempt >= self._max_retries:
                    error_detail = str(exc).strip()[:500] or "no error detail"
                    raise LLMRequestError(
                        "LLM request failed after exhausting retries: "
                        f"{type(exc).__name__}: {error_detail}",
                        category="transport",
                        recoverable=True,
                    ) from exc
            finally:
                progress.finish()

        raise LLMRequestError("LLM request failed unexpectedly.") from last_error

    def _retry_gateway_deadline_as_stream(
        self, payload: dict[str, Any], *, first_attempt: int,
    ) -> dict[str, Any]:
        logger.warning(
            "LLM gateway retry selected transport=stream model=%s reason=non_stream_524 "
            "attempt=%d/%d",
            self._model_name, first_attempt + 1, self._max_retries + 1,
        )
        retained_content: list[str] = []
        try:
            text, usage, response_id, termination = self._stream_text(
                payload, on_delta=None, first_attempt=first_attempt,
                retained_content=retained_content,
            )
            if self._stream_has_failure_termination(termination):
                raise LLMStructuredOutputError(
                    "LLM stream terminated without completing the response.",
                    raw_content=text, stream_termination=termination,
                )
        except (LLMRequestError, LLMStructuredOutputError) as error:
            # Preserve the original hard-gateway signal for outer retry gates;
            # a later stream failure must not hide the earlier 524.
            setattr(error, "gateway_deadline", True)
            setattr(error, "non_stream_gateway_retry_attempted", True)
            setattr(error, "stream_fallback_attempted", True)
            if retained_content:
                setattr(error, "raw_content", "".join(retained_content))
                if isinstance(error, LLMRequestError):
                    # An interrupted body belongs to artifact-aware recovery,
                    # not another pooled key or model resubmitting the prompt.
                    error.recoverable = False
            raise
        # Reconstitute the wire envelope, not an accepted artifact. The caller
        # still parses JSON and applies the same schema/container validation.
        return {
            "id": response_id,
            "usage": usage,
            "choices": [{"message": {"role": "assistant", "content": text}, "finish_reason": termination}],
            "_gateway_retry_transport": "stream",
            "_gateway_retry_stream_termination": termination,
        }

    @_bounded_llm_request
    def _stream_text(
        self,
        payload: dict[str, Any],
        *,
        on_delta: Callable[[str, bool], None] | None,
        cancel_event: threading.Event | None = None,
        first_attempt: int = 0,
        retained_content: list[str] | None = None,
    ) -> tuple[str, dict[str, Any] | None, str | None, str | None]:
        endpoint = "responses" if self._wire_api == "responses" else "chat/completions"
        stream_payload = {**payload, "stream": True}
        last_error: Exception | None = None
        for attempt in range(first_attempt, self._max_retries + 1):
            check_deadline()
            if cancel_event is not None and cancel_event.is_set():
                raise _HedgedRequestCancelled()
            charge_planning_model_request()
            started = time.monotonic()
            progress = self._stream_progress(started, attempt, "stream")
            self._log_route_started(
                transport="stream",
                attempt=attempt,
                payload=payload,
            )
            received = False
            preview_started = False
            pending_deltas: list[str] = []
            pending_characters = 0
            reasoning_characters = 0
            last_flush = time.monotonic()
            text_parts: list[str] = []
            usage: dict[str, Any] | None = None
            response_id: str | None = None
            stream_termination: str | None = None
            try:
                with self._client.stream(
                    "POST",
                    f"{self._base_url}/{endpoint}",
                    json=stream_payload,
                    timeout=cap_timeout(self._timeout_seconds),
                ) as response:
                    progress.headers(response.status_code)
                    response.stream = progress.wrap(response.stream)
                    # HTTPX does not preload bodies opened through ``stream``.
                    # Consume only error responses while the stream is still
                    # open so status handling can preserve the provider detail.
                    if response.is_error:
                        response.read()
                    response.raise_for_status()
                    for line in response.iter_lines():
                        check_deadline()
                        if cancel_event is not None and cancel_event.is_set():
                            raise _HedgedRequestCancelled()
                        if line.startswith(":"):
                            progress.comment()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        if not data:
                            continue
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(event, dict):
                            continue
                        event_reasoning_chars = self._stream_event_reasoning_char_count(event)
                        reasoning_characters += event_reasoning_chars
                        delta = self._stream_event_text_delta(event)
                        progress.event(text_chars=len(delta or ""), reasoning_chars=event_reasoning_chars)
                        if delta:
                            received = True
                            text_parts.append(delta)
                            if retained_content is not None:
                                retained_content.append(delta)
                            pending_deltas.append(delta)
                            pending_characters += len(delta)
                            now = time.monotonic()
                            if (
                                on_delta is not None
                                and (pending_characters >= 128 or now - last_flush >= 0.1)
                            ):
                                on_delta("".join(pending_deltas), not preview_started)
                                preview_started = True
                                pending_deltas = []
                                pending_characters = 0
                                last_flush = now
                        event_usage = self._stream_event_usage(event)
                        if event_usage is not None:
                            usage = event_usage
                        event_response_id = self._stream_event_response_id(event)
                        if event_response_id is not None:
                            response_id = event_response_id
                        event_termination = self._stream_event_termination(event)
                        if event_termination is not None:
                            stream_termination = event_termination
                        # Responses terminal events carry final usage; Chat
                        # finish_reason may precede a separate usage chunk.
                        response_state = event.get("response")
                        response_status = str(
                            (response_state.get("status") if isinstance(response_state, dict) else None) or ""
                        ).strip().casefold()
                        event_type = str(event.get("type") or "").strip().casefold()
                        if event_type in {
                            "response.completed", "response.failed",
                            "response.incomplete", "response.cancelled",
                        } or response_status in {"completed", "failed", "incomplete", "cancelled"}:
                            break
                if on_delta is not None and pending_deltas:
                    on_delta("".join(pending_deltas), not preview_started)
                if text_parts:
                    if stream_termination is None:
                        stream_termination = "stream_ended_without_terminal_event"
                    failed_terminal = self._stream_has_failure_termination(stream_termination)
                    self._log_route_finished(
                        transport="stream",
                        attempt=attempt,
                        started=started,
                        outcome="failure" if failed_terminal else "success",
                        status_code=response.status_code,
                        category="provider_protocol" if failed_terminal else "success",
                        content_chars=sum(len(part) for part in text_parts),
                        reasoning_chars=reasoning_characters,
                        finish_reason=stream_termination,
                    )
                    return (
                        "".join(text_parts),
                        usage,
                        response_id,
                        stream_termination,
                    )
                empty_error = LLMRequestError(
                    "LLM stream did not contain output text.",
                    category="empty_response",
                    recoverable=True,
                )
                setattr(empty_error, "stream_termination", stream_termination)
                setattr(empty_error, "reasoning_characters", reasoning_characters)
                if self._provider_reported_generation_failure(empty_error):
                    empty_error.category = "provider_generation"
                    empty_error.args = ("Provider reported a failed generation without output text.",)
                raise empty_error
            except LLMDeadlineExceeded as exc:
                self._log_route_finished(
                    transport="stream", attempt=attempt, started=started,
                    outcome="failure", category="deadline", will_retry=False, error=exc,
                    content_chars=sum(len(part) for part in text_parts),
                    reasoning_chars=reasoning_characters, finish_reason=stream_termination,
                )
                raise
            except _HedgedRequestCancelled:
                self._log_route_finished(
                    transport="stream",
                    attempt=attempt,
                    started=started,
                    outcome="cancelled",
                    category="hedge_cancelled",
                    will_retry=False,
                    content_chars=sum(len(part) for part in text_parts),
                    reasoning_chars=reasoning_characters,
                    finish_reason=stream_termination,
                )
                raise
            except httpx.TimeoutException as exc:
                last_error = exc
                will_retry = not received and attempt < self._max_retries
                self._log_route_finished(
                    transport="stream",
                    attempt=attempt,
                    started=started,
                    outcome="failure",
                    category="timeout",
                    will_retry=will_retry,
                    error=exc,
                    content_chars=sum(len(part) for part in text_parts),
                    reasoning_chars=reasoning_characters,
                    finish_reason=stream_termination,
                )
                if received or attempt >= self._max_retries:
                    raise LLMRequestError(
                        "LLM streaming request timed out after exhausting retries.",
                        category="timeout",
                        recoverable=True,
                    ) from exc
            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code
                response_detail = self._extract_error_detail(exc.response)
                category = "provider_http" if status_code < 500 else "provider_gateway"
                gateway_deadline = status_code == 524
                will_retry = (
                    not received
                    and status_code >= 500
                    and attempt < self._max_retries
                )
                self._log_route_finished(
                    transport="stream",
                    attempt=attempt,
                    started=started,
                    outcome="failure",
                    status_code=status_code,
                    category=category,
                    will_retry=will_retry,
                    error=LLMRequestError(response_detail, category=category),
                    content_chars=sum(len(part) for part in text_parts),
                    reasoning_chars=reasoning_characters,
                    finish_reason=stream_termination,
                )
                if received or 400 <= status_code < 500:
                    raise LLMRequestError(
                        "LLM streaming request failed with non-retryable status "
                        f"{status_code}: {response_detail}",
                        status_code=status_code,
                        category="provider_http",
                        recoverable=status_code in {401, 403, 404, 408, 409, 422, 429},
                    ) from exc
                last_error = exc
                if attempt >= self._max_retries:
                    failure_phrase = (
                        "at the provider gateway deadline"
                        if gateway_deadline
                        else "after retries"
                    )
                    raise LLMRequestError(
                        "LLM streaming request failed with status "
                        f"{status_code} {failure_phrase}: {response_detail}",
                        status_code=status_code,
                        category="provider_gateway",
                        recoverable=True,
                    ) from exc
            except httpx.HTTPError as exc:
                last_error = exc
                will_retry = not received and attempt < self._max_retries
                self._log_route_finished(
                    transport="stream",
                    attempt=attempt,
                    started=started,
                    outcome="failure",
                    category="transport",
                    will_retry=will_retry,
                    error=exc,
                    content_chars=sum(len(part) for part in text_parts),
                    reasoning_chars=reasoning_characters,
                    finish_reason=stream_termination,
                )
                if received or attempt >= self._max_retries:
                    error_detail = str(exc).strip()[:500] or "no error detail"
                    raise LLMRequestError(
                        "LLM streaming request failed after exhausting retries: "
                        f"{type(exc).__name__}: {error_detail}",
                        category="transport",
                        recoverable=True,
                    ) from exc
            except LLMRequestError as exc:
                last_error = exc
                will_retry = (
                    not received and attempt < self._max_retries
                    and not self._reasoning_budget_exhausted(exc)
                    and not self._provider_reported_generation_failure(exc)
                )
                self._log_route_finished(
                    transport="stream",
                    attempt=attempt,
                    started=started,
                    outcome="failure",
                    category=exc.category,
                    will_retry=will_retry,
                    error=exc,
                    content_chars=sum(len(part) for part in text_parts),
                    reasoning_chars=reasoning_characters,
                    finish_reason=stream_termination,
                )
                if not will_retry:
                    raise
            finally:
                progress.finish()

        raise LLMRequestError("LLM streaming request failed unexpectedly.") from last_error

    @staticmethod
    def _stream_event_text_delta(event: dict[str, Any]) -> str:
        if event.get("type") == "response.output_text.delta":
            delta = event.get("delta")
            return delta if isinstance(delta, str) else ""
        choices = event.get("choices")
        if not isinstance(choices, list) or not choices:
            return ""
        choice = choices[0]
        if not isinstance(choice, dict):
            return ""
        delta = choice.get("delta")
        if not isinstance(delta, dict):
            return ""
        content = delta.get("content")
        return content if isinstance(content, str) else ""

    @staticmethod
    def _stream_event_reasoning_char_count(event: dict[str, Any]) -> int:
        event_type = str(event.get("type") or "").strip().casefold()
        if event_type in {
            "response.reasoning_text.delta",
            "response.reasoning_summary_text.delta",
        }:
            delta = event.get("delta")
            return len(delta) if isinstance(delta, str) else 0
        choices = event.get("choices")
        if not isinstance(choices, list) or not choices:
            return 0
        choice = choices[0]
        if not isinstance(choice, dict):
            return 0
        delta = choice.get("delta")
        if not isinstance(delta, dict):
            return 0
        return sum(
            len(value)
            for key in ("reasoning_content", "reasoning")
            for value in [delta.get(key)]
            if isinstance(value, str)
        )

    @staticmethod
    def _stream_event_usage(event: dict[str, Any]) -> dict[str, Any] | None:
        usage = event.get("usage")
        if isinstance(usage, dict):
            return usage
        response = event.get("response")
        if isinstance(response, dict) and isinstance(response.get("usage"), dict):
            return response["usage"]
        return None

    @staticmethod
    def _stream_event_response_id(event: dict[str, Any]) -> str | None:
        response = event.get("response")
        candidates = [
            event.get("id"),
            response.get("id") if isinstance(response, dict) else None,
        ]
        return next(
            (
                candidate.strip()
                for candidate in candidates
                if isinstance(candidate, str) and candidate.strip()
            ),
            None,
        )

    @staticmethod
    def _stream_has_failure_termination(termination: str | None) -> bool:
        return termination not in {None, "completed", "stream_ended_without_terminal_event"}

    @staticmethod
    def _stream_event_termination(event: dict[str, Any]) -> str | None:
        event_type = str(event.get("type") or "").strip().casefold()
        response = event.get("response")
        response = response if isinstance(response, dict) else {}
        status = str(response.get("status") or "").strip().casefold()
        incomplete = response.get("incomplete_details")
        incomplete = incomplete if isinstance(incomplete, dict) else {}
        reason = str(incomplete.get("reason") or "").strip().casefold()
        if event_type in {"response.incomplete", "response.failed", "response.cancelled"} or status in {
            "incomplete",
            "failed",
            "cancelled",
        }:
            return ":".join(
                value
                for value in (event_type or "response", status, reason)
                if value
            )[:160]
        choices = event.get("choices")
        if isinstance(choices, list):
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                finish_reason = str(choice.get("finish_reason") or "").strip().casefold()
                if finish_reason == "stop":
                    return "completed"
                if finish_reason and finish_reason != "stop":
                    return f"finish_reason:{finish_reason}"[:160]
        if event_type == "response.completed" or status == "completed":
            return "completed"
        return None

    @staticmethod
    def _extract_error_detail(response: httpx.Response) -> str:
        """Return a bounded provider error message without exposing request headers."""
        try:
            payload = response.json()
        except httpx.ResponseNotRead:
            return "provider returned an unread streaming error response"
        except (json.JSONDecodeError, ValueError):
            try:
                text = response.text.strip()
            except httpx.ResponseNotRead:
                return "provider returned an unread streaming error response"
            if not text:
                return "provider returned no error detail"
            content_type = response.headers.get("content-type", "").casefold()
            normalized = text.lstrip().casefold()
            if (
                "text/html" in content_type
                or normalized.startswith("<!doctype html")
                or normalized.startswith("<html")
            ):
                return "provider gateway returned an HTML error page"
            return " ".join(text.split())[:500]

        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict) and isinstance(error.get("message"), str):
                return error["message"].strip()[:500]
            for key in ("detail", "message"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()[:500]
        return "provider returned an unrecognized error payload"

    def _extract_text_content(self, response_payload: dict[str, Any]) -> str:
        if self._wire_api == "responses":
            return self._extract_responses_text(response_payload)
        message = self._extract_message(response_payload)
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            text_segments = [
                part.get("text", "").strip()
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ]
            combined = "\n".join(segment for segment in text_segments if segment)
            if combined:
                return combined
        raise LLMStructuredOutputError("Model response did not contain readable text content.")

    def _extract_structured_output(
        self,
        response_payload: dict[str, Any],
        *,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self._wire_api == "responses":
            return self._parse_json_content(
                self._extract_responses_text(response_payload),
                output_schema=output_schema,
            )
        message = self._extract_message(response_payload)

        parsed = message.get("parsed")
        if isinstance(parsed, dict):
            capture_planning_candidate(f"adapter parsed JSON model={self._model_name}", parsed)
            if output_schema is None and _LLM_LOCAL_OUTPUT_SCHEMA.get() is not None:
                return self._parse_json_content(json.dumps(parsed, ensure_ascii=False))
            return parsed
        if isinstance(parsed, list):
            collection_field = self._single_root_collection_field(output_schema)
            if collection_field is not None:
                return {collection_field: parsed}
        if isinstance(parsed, str) and parsed.strip():
            return self._parse_json_content(parsed, output_schema=output_schema)

        content = message.get("content")
        if isinstance(content, dict):
            capture_planning_candidate(f"adapter parsed JSON model={self._model_name}", content)
            if output_schema is None and _LLM_LOCAL_OUTPUT_SCHEMA.get() is not None:
                return self._parse_json_content(json.dumps(content, ensure_ascii=False))
            return content
        if isinstance(content, str):
            return self._parse_json_content(content, output_schema=output_schema)
        if isinstance(content, list):
            combined = "\n".join(
                part.get("text", "").strip()
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ).strip()
            if combined:
                return self._parse_json_content(combined, output_schema=output_schema)

        raise LLMStructuredOutputError(
            "Model response did not contain valid JSON structured output."
        )

    @staticmethod
    def _extract_responses_text(response_payload: dict[str, Any]) -> str:
        refusal = RealLLMAdapter._response_refusal(response_payload)
        if refusal:
            raise LLMStructuredOutputError(
                "Responses payload contained a model refusal.",
                raw_content=refusal,
                refusal=refusal,
            )
        # Providers commonly include both a convenience ``output_text`` and
        # the full ``output`` array. Prefer the convenience field so the same
        # JSON is never concatenated twice before parsing.
        direct_segments = RealLLMAdapter._response_text_fragments(
            response_payload.get("output_text")
        )
        if direct_segments:
            return "\n".join(direct_segments)
        output_value: Any = response_payload.get("output")
        if output_value is None and isinstance(response_payload.get("response"), dict):
            output_value = response_payload["response"]
        text_segments = RealLLMAdapter._response_text_fragments(output_value)
        if text_segments:
            return "\n".join(text_segments)
        if "output" not in response_payload and "output_text" not in response_payload:
            raise LLMStructuredOutputError(
                "Responses payload is missing output items.",
                empty_response=True,
            )
        raise LLMStructuredOutputError(
            "Responses payload did not contain output text.",
            empty_response=True,
        )

    def _extract_message(self, response_payload: dict[str, Any]) -> dict[str, Any]:
        choices = response_payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise LLMStructuredOutputError("Model response is missing choices.")
        first_choice = choices[0]
        if not isinstance(first_choice, dict):
            raise LLMStructuredOutputError("Model response choice has an invalid shape.")
        message = first_choice.get("message")
        if not isinstance(message, dict):
            raise LLMStructuredOutputError("Model response is missing a message payload.")
        return message

    def _parse_json_content(
        self,
        content: str,
        *,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        # Preserve each actual reply before parsing or route fallback can
        # replace it. No recorder means this is a no-op for other workflows.
        capture_planning_candidate(f"adapter raw JSON model={self._model_name}", content)
        # Native planning deliberately omits the provider response format, but
        # must not recover a nested title/scene as the requested root. Keep this
        # opt-in local contract separate from ordinary schema repair behavior.
        local_schema = _LLM_LOCAL_OUTPUT_SCHEMA.get() if output_schema is None else None
        if local_schema is not None:
            output_schema = local_schema
        normalized_content = content.strip().lstrip("\ufeff")
        initial_json_error: json.JSONDecodeError | None = None
        parsed: Any = None
        for candidate in self._json_content_candidates(normalized_content):
            try:
                parsed = json.loads(candidate)
            except json.JSONDecodeError as exc:
                if initial_json_error is None:
                    initial_json_error = exc
                locally_repaired = self._remove_json_trailing_commas(candidate)
                if locally_repaired != candidate:
                    try:
                        parsed = json.loads(locally_repaired)
                    except json.JSONDecodeError:
                        parsed = None
                if parsed is None:
                    closed_suffix = self._close_truncated_json_containers(
                        locally_repaired
                    )
                    if closed_suffix != locally_repaired:
                        try:
                            parsed = json.loads(closed_suffix)
                        except json.JSONDecodeError:
                            parsed = None
                if (
                    parsed is None
                    and local_schema is None
                    and self._single_root_collection_field(output_schema)
                ):
                    parsed = self._extract_embedded_json_array(locally_repaired)
                if parsed is None:
                    parsed = self._extract_embedded_json_object(
                        locally_repaired,
                        output_schema=output_schema,
                    )
                if parsed is None and candidate[:1] in "[{":
                    # Some compatible gateways ignore JSON mode and emit a
                    # Python-literal dict/list (single quotes, True/False,
                    # None). Accept it only through the safe literal parser;
                    # never use eval or execute model text.
                    try:
                        parsed = ast.literal_eval(candidate)
                    except (SyntaxError, ValueError, TypeError, MemoryError, RecursionError):
                        parsed = None
                if parsed is None:
                    parsed = self._extract_embedded_python_literal(
                        locally_repaired,
                        output_schema=output_schema,
                    )
                if (
                    isinstance(parsed, list)
                    and self._single_root_collection_field(output_schema) is None
                ):
                    parsed = None
            if parsed is not None:
                break
        if parsed is None:
            if initial_json_error is None:
                initial_json_error = json.JSONDecodeError(
                    "empty JSON candidate",
                    normalized_content,
                    0,
                )
            raise LLMStructuredOutputError(
                "Model returned invalid JSON content.",
                raw_content=content,
                json_error_line=initial_json_error.lineno,
                json_error_column=initial_json_error.colno,
                json_error_position=initial_json_error.pos,
            ) from initial_json_error
        for _ in range(3):
            if not isinstance(parsed, str) or not parsed.strip().startswith(("{", "[")):
                break
            try:
                parsed = json.loads(parsed.strip())
            except json.JSONDecodeError:
                break
        # Providers occasionally obey the outer JSON contract while serializing
        # nested objects again as strings (for example, an array of quoted JSON
        # episode plans). Decode those containers once at the shared boundary so
        # every structured pipeline receives native dictionaries/lists.
        parsed = self._decode_nested_json_containers(parsed)
        if isinstance(parsed, list) and local_schema is None:
            collection_field = self._single_root_collection_field(output_schema)
            if collection_field is not None:
                parsed = {collection_field: parsed}
        if not isinstance(parsed, dict):
            raise LLMStructuredOutputError(
                "Model returned invalid JSON content.",
                raw_content=content,
                json_error_line=(initial_json_error.lineno if initial_json_error else None),
                json_error_column=(initial_json_error.colno if initial_json_error else None),
                json_error_position=(initial_json_error.pos if initial_json_error else None),
            )
        if local_schema is not None and not self._matches_schema_root(parsed, local_schema):
            raise LLMStructuredOutputError(
                "Model returned JSON that does not match the requested native root: "
                + ", ".join(self._schema_root_issues(parsed, local_schema)[:20]),
                raw_content=content,
            )
        return parsed

    @staticmethod
    def _json_content_candidates(content: str) -> list[str]:
        """Return bounded JSON candidates from provider wrappers and Markdown fences.

        GLM-compatible gateways sometimes return a short explanation before a fenced
        JSON object, or append a sentence after it. Keep the original candidate first,
        then try each fenced block and the text beginning at its first JSON delimiter.
        The schema-aware embedded-object recovery remains the final authority.
        """
        normalized = content.strip().lstrip("\ufeff")
        candidates: list[str] = [normalized]
        for match in re.finditer(
            r"```(?:json|javascript|js)?\s*(.*?)\s*```",
            normalized,
            flags=re.IGNORECASE | re.DOTALL,
        ):
            fenced = match.group(1).strip()
            if fenced and fenced not in candidates:
                candidates.append(fenced)
        first_delimiter = min(
            (index for index in (normalized.find("{"), normalized.find("[") ) if index >= 0),
            default=-1,
        )
        if first_delimiter > 0:
            suffix = normalized[first_delimiter:].strip()
            if suffix and suffix not in candidates:
                candidates.append(suffix)
        return candidates

    @classmethod
    def _decode_nested_json_containers(cls, value: Any, *, depth: int = 0) -> Any:
        if depth > 4:
            return value
        if isinstance(value, dict):
            return {
                key: cls._decode_nested_json_containers(item, depth=depth + 1)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [
                cls._decode_nested_json_containers(item, depth=depth + 1)
                for item in value
            ]
        if not isinstance(value, str):
            return value

        text = value.strip().lstrip("\ufeff")
        if not text or text[0] not in "[{`'\"":
            return value
        candidates = [text]
        fenced = re.fullmatch(
            r"```(?:json)?\s*(.*?)\s*```",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if fenced is not None:
            candidates.insert(0, fenced.group(1).strip())
        for candidate in candidates:
            parsed: Any = None
            try:
                parsed = json.loads(candidate)
            except (json.JSONDecodeError, TypeError):
                repaired = cls._remove_json_trailing_commas(candidate)
                if repaired != candidate:
                    try:
                        parsed = json.loads(repaired)
                    except json.JSONDecodeError:
                        parsed = None
            if parsed is None and candidate[:1] in "[{":
                try:
                    parsed = ast.literal_eval(candidate)
                except (SyntaxError, ValueError, TypeError, MemoryError, RecursionError):
                    parsed = None
            if parsed is None and candidate[:1] in "[{":
                parsed = (
                    cls._extract_embedded_json_array(candidate)
                    if candidate.startswith("[")
                    else cls._extract_embedded_json_object(candidate)
                )
            if isinstance(parsed, str) and parsed.strip().startswith(("{", "[")):
                try:
                    parsed = json.loads(parsed.strip())
                except json.JSONDecodeError:
                    parsed = None
            if isinstance(parsed, (dict, list)):
                return cls._decode_nested_json_containers(parsed, depth=depth + 1)
        return value

    @staticmethod
    def _single_root_collection_field(
        output_schema: dict[str, Any] | None,
    ) -> str | None:
        if not isinstance(output_schema, dict):
            return None
        properties = output_schema.get("properties")
        if not isinstance(properties, dict) or len(properties) != 1:
            return None
        field_name, field_schema = next(iter(properties.items()))
        if isinstance(field_schema, dict) and field_schema.get("type") == "array":
            return field_name
        return None

    @staticmethod
    def _remove_json_trailing_commas(content: str) -> str:
        """Remove commas before closing containers without touching JSON strings."""
        output: list[str] = []
        in_string = False
        escaped = False
        for character in content:
            if in_string:
                output.append(character)
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == '"':
                    in_string = False
                continue
            if character == '"':
                in_string = True
                output.append(character)
                continue
            if character in "]}":
                index = len(output) - 1
                while index >= 0 and output[index].isspace():
                    index -= 1
                if index >= 0 and output[index] == ",":
                    del output[index]
            output.append(character)
        return "".join(output)

    @staticmethod
    def _close_truncated_json_containers(content: str) -> str:
        """Close only an otherwise complete JSON suffix.

        A gateway may end an SSE response after the last value but before the
        final array/object delimiters. This repair never closes an unfinished
        string, drops a field, or invents a value, so later schema validation
        remains authoritative.
        """

        stack: list[str] = []
        in_string = False
        escaped = False
        for character in content:
            if in_string:
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == '"':
                    in_string = False
                continue
            if character == '"':
                in_string = True
            elif character == "{":
                stack.append("}")
            elif character == "[":
                stack.append("]")
            elif character in "}]":
                if not stack or stack[-1] != character:
                    return content
                stack.pop()
        stripped = content.rstrip()
        if (
            in_string
            or not stack
            or not stripped
            or stripped[-1] in {",", ":"}
        ):
            return content
        return stripped + "".join(reversed(stack))

    @staticmethod
    def _extract_embedded_json_object(
        content: str,
        *,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Recover only an object that can be the requested schema root.

        When a response is truncated, nested scene/state objects may still be
        individually valid JSON. Selecting the largest object without checking
        the root contract turns those fragments into false successes.
        """
        decoder = json.JSONDecoder()
        candidates: list[tuple[int, dict[str, Any]]] = []
        for index, character in enumerate(content):
            if character != "{":
                continue
            try:
                parsed, end_index = decoder.raw_decode(content, index)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                if output_schema is not None and not RealLLMAdapter._matches_schema_root(
                    parsed,
                    output_schema,
                ):
                    continue
                candidates.append((end_index - index, parsed))
        if not candidates:
            return None
        return max(candidates, key=lambda candidate: candidate[0])[1]

    @staticmethod
    def _matches_schema_root(
        value: dict[str, Any],
        output_schema: dict[str, Any],
    ) -> bool:
        """Check root identity without performing full Pydantic validation."""
        properties = output_schema.get("properties")
        required = output_schema.get("required")
        if not isinstance(properties, dict):
            return True
        required_fields = (
            {field for field in required if isinstance(field, str)}
            if isinstance(required, list)
            else set()
        )
        if required_fields and not required_fields.issubset(value):
            return False
        root_keys = set(value) & set(properties)
        if not root_keys:
            return False
        return bool(root_keys)

    @staticmethod
    def _extract_embedded_json_array(content: str) -> list[Any] | None:
        """Recover a complete top-level collection wrapped in commentary."""
        decoder = json.JSONDecoder()
        candidates: list[tuple[int, list[Any]]] = []
        for index, character in enumerate(content):
            if character != "[":
                continue
            try:
                parsed, end_index = decoder.raw_decode(content, index)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, list):
                candidates.append((end_index - index, parsed))
        if not candidates:
            return None
        return max(candidates, key=lambda candidate: candidate[0])[1]

    @staticmethod
    def _extract_embedded_python_literal(
        content: str,
        *,
        output_schema: dict[str, Any] | None = None,
    ) -> Any:
        """Recover a Python-literal object/list surrounded by model prose.

        ``ast.literal_eval`` only accepts an exact expression. Gateways that
        prepend "Here is the JSON" or append a note therefore need bounded
        delimiter recovery before the safe literal parser can be used.
        """
        candidates: list[tuple[int, Any]] = []
        starts = [index for index, char in enumerate(content) if char in "[{]"]
        attempts = 0
        for start in starts:
            closing = "]" if content[start] == "[" else "}"
            for end in range(len(content) - 1, start, -1):
                if content[end] != closing:
                    continue
                attempts += 1
                if attempts > 500:
                    break
                try:
                    parsed = ast.literal_eval(content[start : end + 1])
                except (SyntaxError, ValueError, TypeError, MemoryError, RecursionError):
                    continue
                if isinstance(parsed, dict):
                    if output_schema is not None and not RealLLMAdapter._matches_schema_root(
                        parsed, output_schema
                    ):
                        continue
                elif not isinstance(parsed, list):
                    continue
                elif RealLLMAdapter._single_root_collection_field(output_schema) is None:
                    continue
                candidates.append((end - start, parsed))
            if attempts > 500:
                break
        if not candidates:
            return None
        return max(candidates, key=lambda candidate: candidate[0])[1]


class AdaptiveTransportState:
    """Shared DeepSeek transport health for one model/gateway route."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.consecutive_reasoning_length_failures = 0
        self.prefer_non_stream_until = 0.0


class AdaptiveTransportLLMAdapter(LLMAdapter):
    """Prefer ordinary JSON transport after repeated reasoning-only SSE exhaustion."""

    def __init__(
        self,
        *,
        adapter: LLMAdapter,
        failure_threshold: int = 2,
        cooldown_seconds: float = 900.0,
        state: AdaptiveTransportState | None = None,
    ) -> None:
        self._adapter = adapter
        self._failure_threshold = max(1, int(failure_threshold))
        self._cooldown_seconds = max(1.0, float(cooldown_seconds))
        self._state = state or AdaptiveTransportState()
        self._base_url = self._nested_route_attribute("_base_url")
        self._wire_api = self._nested_route_attribute("_wire_api")
        for name in (
            "_reasoning_effort",
            "_thinking_mode",
            "_use_strict_schema",
            "_retry_empty_response",
            "_defer_schema_container_repair",
            "_retry_gateway_stream_as_non_stream",
        ):
            setattr(self, name, self._nested_route_attribute(name, preserve_type=True))

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        return self._adapter.generate_text(prompt, strategy=strategy)

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._adapter.generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
    ) -> dict[str, Any]:
        return self._generate_adaptively(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
            on_delta=on_delta,
            cancel_event=None,
        )

    def generate_structured_output_stream_cancellable(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
        cancel_event: threading.Event,
    ) -> dict[str, Any]:
        return self._generate_adaptively(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
            on_delta=on_delta,
            cancel_event=cancel_event,
        )

    def _generate_adaptively(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None,
        on_delta: Callable[[str, bool], None] | None,
        cancel_event: threading.Event | None,
    ) -> dict[str, Any]:
        if cancel_event is not None and cancel_event.is_set():
            raise _HedgedRequestCancelled()
        if self._non_stream_preferred():
            return self._generate_non_stream(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
                cancel_event=cancel_event,
                reason="reasoning_length_circuit",
            )
        try:
            if cancel_event is None:
                result = self._adapter.generate_structured_output_stream(
                    prompt,
                    strategy=strategy,
                    output_schema=output_schema,
                    on_delta=on_delta,
                )
            else:
                result = self._adapter.generate_structured_output_stream_cancellable(
                    prompt,
                    strategy=strategy,
                    output_schema=output_schema,
                    on_delta=on_delta,
                    cancel_event=cancel_event,
                )
        except LLMRequestError as error:
            if cancel_event is not None and cancel_event.is_set():
                raise _HedgedRequestCancelled() from error
            if not self._is_reasoning_length_exhaustion(error):
                self._record_non_matching_stream_outcome()
                raise
            should_prefer_non_stream = self._record_reasoning_length_failure()
            # A hedged route already has an equivalent request running on the
            # other gateway. Do not let the losing child silently append a
            # second transport and turn one outer attempt into three long
            # inferences. The shared state still teaches the next request to
            # start non-streaming when repeated reasoning exhaustion warrants
            # it.
            if cancel_event is not None:
                setattr(error, "hedged_route_transport_budget_exhausted", True)
                raise
            if not should_prefer_non_stream:
                raise
            return self._generate_non_stream(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
                cancel_event=cancel_event,
                reason="repeated_reasoning_length",
                stream_error=error,
            )
        except LLMStructuredOutputError as error:
            if cancel_event is not None and cancel_event.is_set():
                raise _HedgedRequestCancelled() from error
            self._record_non_matching_stream_outcome()
            raise
        self._record_stream_success()
        return result

    def _generate_non_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None,
        on_delta: Callable[[str, bool], None] | None,
        cancel_event: threading.Event | None,
        reason: str,
        stream_error: LLMRequestError | None = None,
    ) -> dict[str, Any]:
        if cancel_event is not None and cancel_event.is_set():
            raise _HedgedRequestCancelled()
        try:
            result = self._adapter.generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        except (LLMRequestError, LLMStructuredOutputError) as error:
            setattr(error, "adaptive_transport_attempted", True)
            if isinstance(error, LLMRequestError):
                setattr(error, "stream_fallback_attempted", True)
            if stream_error is not None:
                setattr(
                    error,
                    "adaptive_stream_failure",
                    str(stream_error)[:500],
                )
            raise
        if cancel_event is not None and cancel_event.is_set():
            raise _HedgedRequestCancelled()
        metadata = result.setdefault("_meta", {})
        actual_transport = "non_stream"
        if isinstance(metadata, dict):
            if metadata.get("gateway_retry_transport") == "stream":
                actual_transport = "stream"
                reason = "non_stream_gateway_524_retry"
                # SSE just recovered the route that motivated this preference.
                # Do not force subsequent requests back onto its 524 path.
                with self._state.lock:
                    self._state.prefer_non_stream_until = 0.0
                    self._state.consecutive_reasoning_length_failures = 0
            metadata.update({
                "adaptive_transport": actual_transport,
                "adaptive_transport_reason": reason,
                "adaptive_transport_reasoning_profile_preserved": True,
            })
        if on_delta is not None:
            preview = {key: value for key, value in result.items() if key != "_meta"}
            on_delta(json.dumps(preview, ensure_ascii=False), True)
        logger.warning(
            "LLM adaptive transport selected transport=%s model=%s reason=%s "
            "cooldown_seconds=%.0f",
            actual_transport,
            self.get_model_info().model_name,
            reason,
            self._cooldown_seconds,
        )
        return result

    @staticmethod
    def _is_reasoning_length_exhaustion(error: Exception) -> bool:
        termination = str(getattr(error, "stream_termination", "") or "").casefold()
        reasoning_characters = getattr(error, "reasoning_characters", 0)
        empty_response = (
            isinstance(error, LLMRequestError)
            and error.category == "empty_response"
        ) or (
            isinstance(error, LLMStructuredOutputError)
            and error.empty_response
        )
        return (
            empty_response
            and isinstance(reasoning_characters, int)
            and reasoning_characters > 0
            and any(marker in termination for marker in (
                "length",
                "max_output",
                "token",
                "incomplete",
            ))
        )

    def _record_reasoning_length_failure(self) -> bool:
        with self._state.lock:
            self._state.consecutive_reasoning_length_failures += 1
            if (
                self._state.consecutive_reasoning_length_failures
                < self._failure_threshold
            ):
                return False
            self._state.prefer_non_stream_until = (
                time.monotonic() + self._cooldown_seconds
            )
            return True

    def _record_stream_success(self) -> None:
        with self._state.lock:
            self._state.consecutive_reasoning_length_failures = 0

    def _record_non_matching_stream_outcome(self) -> None:
        with self._state.lock:
            if time.monotonic() >= self._state.prefer_non_stream_until:
                self._state.consecutive_reasoning_length_failures = 0

    def _non_stream_preferred(self) -> bool:
        with self._state.lock:
            if time.monotonic() < self._state.prefer_non_stream_until:
                return True
            if self._state.prefer_non_stream_until:
                self._state.prefer_non_stream_until = 0.0
                self._state.consecutive_reasoning_length_failures = 0
            return False

    def _nested_route_attribute(self, name: str, *, preserve_type: bool = False) -> Any:
        direct = getattr(self._adapter, name, "")
        if direct or isinstance(direct, bool):
            return direct if preserve_type else str(direct)
        pooled = getattr(self._adapter, "_adapters", ())
        if pooled:
            value = getattr(pooled[0], name, "")
            return value if preserve_type else str(value)
        return None if preserve_type else ""

    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys: Sequence[str] | None = None,
    ) -> bool:
        return self._adapter.validate_output(output, required_keys=required_keys)

    def get_model_info(self) -> LLMModelInfo:
        return self._adapter.get_model_info()


class ModelFailoverCircuitState:
    """Shared primary-route circuit state across role-specific adapters."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.primary_failure_count = 0
        self.primary_circuit_open_until = 0.0
        self.primary_hedge_win_streak = 0


class ModelFailoverLLMAdapter(LLMAdapter):
    """Use a secondary model only when the preferred model cannot complete.

    Each child adapter receives the original semantic prompt and JSON schema,
    so Chat Completions and Responses transports can render their own native
    request format without leaking provider-specific envelopes across models.
    """

    def __init__(
        self,
        *,
        primary: LLMAdapter,
        fallback: LLMAdapter,
        circuit_failure_threshold: int = 2,
        circuit_cooldown_seconds: float = 60.0,
        hedge_delay_seconds: float | None = None,
        circuit_state: ModelFailoverCircuitState | None = None,
        failover_on_request_deadline: bool = False,
    ) -> None:
        self._primary = primary
        self._fallback = fallback
        self._circuit_failure_threshold = max(1, int(circuit_failure_threshold))
        self._circuit_cooldown_seconds = max(1.0, float(circuit_cooldown_seconds))
        self._hedge_delay_seconds = (
            max(0.01, float(hedge_delay_seconds))
            if hedge_delay_seconds is not None
            else None
        )
        self._circuit_state = circuit_state or ModelFailoverCircuitState()
        self._failover_on_request_deadline = failover_on_request_deadline

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        primary_error: Exception
        circuit_open = self._primary_circuit_is_open()
        try:
            if circuit_open:
                raise self._circuit_open_error()
            result = self._primary.generate_text(prompt, strategy=strategy)
            self._record_primary_success()
            return result
        except (LLMStructuredOutputError, MissingLLMConfigurationError) as error:
            primary_error = error
            self._record_primary_failure(error)
        except LLMRequestError as error:
            if not self._should_fail_over(error):
                raise
            primary_error = error
            self._record_primary_failure(error)
        self._log_failover(primary_error)
        try:
            return self._fallback.generate_text(prompt, strategy=strategy)
        except LLMRequestError as fallback_error:
            raise self._combined_failure(primary_error, fallback_error) from fallback_error

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._generate_structured(
            primary_call=lambda: self._primary.generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            ),
            fallback_call=lambda: self._fallback.generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            ),
        )

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
    ) -> dict[str, Any]:
        if (
            self._hedge_delay_seconds is not None
            and not self._primary_circuit_is_open()
        ):
            return self._generate_structured_output_stream_hedged(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
            )
        return self._generate_structured(
            primary_call=lambda: self._primary.generate_structured_output_stream(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
            ),
            fallback_call=lambda: self._fallback.generate_structured_output_stream(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
            ),
        )

    def generate_structured_output_stream_cancellable(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
        cancel_event: threading.Event,
    ) -> dict[str, Any]:
        """Propagate client cancellation through failover and hedge routes."""

        _raise_if_cancelled(cancel_event)

        def call_child(adapter: LLMAdapter) -> dict[str, Any]:
            _raise_if_cancelled(cancel_event)
            result = adapter.generate_structured_output_stream_cancellable(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
                cancel_event=cancel_event,
            )
            _raise_if_cancelled(cancel_event)
            return result

        if (
            self._hedge_delay_seconds is not None
            and not self._primary_circuit_is_open()
        ):
            return self._generate_structured_output_stream_hedged(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
                cancel_event=cancel_event,
            )
        return self._generate_structured(
            primary_call=lambda: call_child(self._primary),
            fallback_call=lambda: call_child(self._fallback),
        )

    def _generate_structured_output_stream_hedged(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None,
        on_delta: Callable[[str, bool], None] | None,
        cancel_event: threading.Event | None = None,
    ) -> dict[str, Any]:
        """Race an equivalent route only while the primary has no visible output."""

        hedge_delay_seconds = self._effective_hedge_delay_seconds()
        completion_queue: Queue[
            tuple[str, dict[str, Any] | None, Exception | None]
        ] = Queue()
        primary_cancel = threading.Event()
        fallback_cancel = threading.Event()
        primary_output_seen = threading.Event()
        winner_selected = threading.Event()
        preview_lock = threading.Lock()
        fallback_started = False
        hedge_started = False
        errors: dict[str, Exception] = {}

        def primary_delta(delta: str, reset: bool) -> None:
            if delta:
                primary_output_seen.set()
            with preview_lock:
                if winner_selected.is_set():
                    raise _HedgedRequestCancelled()
                if on_delta is not None:
                    on_delta(delta, reset)

        def fallback_delta(_delta: str, _reset: bool) -> None:
            if winner_selected.is_set():
                raise _HedgedRequestCancelled()

        def run_route(
            route_name: str,
            adapter: LLMAdapter,
            cancel_event: threading.Event,
            delta_callback: Callable[[str, bool], None],
        ) -> None:
            try:
                result = adapter.generate_structured_output_stream_cancellable(
                    prompt,
                    strategy=strategy,
                    output_schema=output_schema,
                    on_delta=delta_callback,
                    cancel_event=cancel_event,
                )
            except Exception as error:  # noqa: BLE001 - carried back to request thread
                completion_queue.put((route_name, None, error))
            else:
                completion_queue.put((route_name, result, None))

        def start_route(
            route_name: str,
            adapter: LLMAdapter,
            cancel_event: threading.Event,
            delta_callback: Callable[[str, bool], None],
        ) -> None:
            route_context = copy_context()
            threading.Thread(
                target=lambda: route_context.run(
                    run_route,
                    route_name,
                    adapter,
                    cancel_event,
                    delta_callback,
                ),
                name=f"llm-{route_name}-route",
                daemon=True,
            ).start()

        def select_result(
            route_name: str,
            result: dict[str, Any],
        ) -> dict[str, Any]:
            with preview_lock:
                winner_selected.set()
                if route_name == "primary":
                    fallback_cancel.set()
                else:
                    primary_cancel.set()
                    if on_delta is not None:
                        preview = {
                            key: value for key, value in result.items() if key != "_meta"
                        }
                        on_delta(json.dumps(preview, ensure_ascii=False), True)
            metadata = result.setdefault("_meta", {})
            if isinstance(metadata, dict) and hedge_started:
                metadata.update({
                    "model_hedge_started": True,
                    "model_hedge_winner": route_name,
                    "model_hedge_delay_seconds": hedge_delay_seconds,
                })
                if route_name == "fallback":
                    metadata["model_hedge_used"] = True
            if route_name == "primary":
                self._record_primary_success()
            if hedge_started:
                self._record_hedge_outcome(route_name)
                logger.warning(
                    "LLM route hedge winner selected winner=%s delay_seconds=%.2f",
                    route_name,
                    hedge_delay_seconds,
                )
            return result

        def start_fallback(*, as_hedge: bool, primary_error: Exception | None) -> None:
            nonlocal fallback_started, hedge_started
            _raise_if_cancelled(cancel_event)
            if fallback_started:
                return
            fallback_started = True
            hedge_started = as_hedge
            if as_hedge:
                from_provider, from_model, from_gateway, _ = self._route_log_identity(
                    self._primary
                )
                to_provider, to_model, to_gateway, _ = self._route_log_identity(
                    self._fallback
                )
                logger.warning(
                    "LLM route slow-request hedge started from_provider=%s "
                    "from_model=%s from_gateway=%s to_provider=%s to_model=%s "
                    "to_gateway=%s delay_seconds=%.2f",
                    from_provider,
                    from_model,
                    from_gateway,
                    to_provider,
                    to_model,
                    to_gateway,
                    hedge_delay_seconds,
                )
            elif primary_error is not None:
                self._log_failover(primary_error)
            start_route(
                "fallback",
                self._fallback,
                fallback_cancel,
                fallback_delta,
            )

        def next_completion(timeout: float | None = None) -> tuple[
            str,
            dict[str, Any] | None,
            Exception | None,
        ]:
            deadline = None if timeout is None else time.monotonic() + timeout
            while True:
                check_deadline()
                _raise_if_cancelled(cancel_event)
                wait_seconds = 0.1
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise Empty
                    wait_seconds = min(wait_seconds, remaining)
                try:
                    return completion_queue.get(timeout=wait_seconds)
                except Empty:
                    continue

        try:
            _raise_if_cancelled(cancel_event)
            start_route("primary", self._primary, primary_cancel, primary_delta)
            try:
                first_completion = next_completion(hedge_delay_seconds)
            except Empty:
                if not primary_output_seen.is_set():
                    start_fallback(as_hedge=True, primary_error=None)
                first_completion = next_completion()

            pending_completion = first_completion
            while True:
                _raise_if_cancelled(cancel_event)
                route_name, result, error = pending_completion
                if (
                    isinstance(error, LLMRequestError)
                    and error.category == "deadline"
                    and (route_name != "primary" or not self._should_fail_over(error))
                ):
                    primary_cancel.set()
                    fallback_cancel.set()
                    raise error
                if result is not None:
                    if route_name == "fallback" and not hedge_started:
                        primary_error = errors.get("primary")
                        if primary_error is not None:
                            result = self._annotate_fallback_result(
                                result,
                                primary_error=primary_error,
                                circuit_open=False,
                            )
                    return select_result(route_name, result)
                if error is not None and not isinstance(error, _HedgedRequestCancelled):
                    errors[route_name] = error
                if route_name == "primary" and error is not None:
                    if isinstance(error, PlanningCallBudgetExceeded) and fallback_started:
                        # The fallback can win the last reservation while the
                        # primary is still opening its account-scoped session.
                        # Preserve that already-paid route; do not start another.
                        if "fallback" in errors:
                            raise errors["fallback"]
                        pending_completion = next_completion()
                        continue
                    if isinstance(error, LLMRequestError) and not self._should_fail_over(error):
                        fallback_cancel.set()
                        raise error
                    if not isinstance(
                        error,
                        (LLMRequestError, LLMStructuredOutputError, MissingLLMConfigurationError),
                    ):
                        fallback_cancel.set()
                        raise error
                    self._record_primary_failure(error)
                    start_fallback(as_hedge=False, primary_error=error)
                if len(errors) >= 2:
                    primary_error = errors["primary"]
                    fallback_error = errors["fallback"]
                    if isinstance(fallback_error, LLMRequestError):
                        if isinstance(primary_error, LLMStructuredOutputError):
                            setattr(
                                primary_error,
                                "fallback_request_failure",
                                self._bounded_reason(fallback_error),
                            )
                            raise primary_error from fallback_error
                        raise self._combined_failure(
                            primary_error,
                            fallback_error,
                        ) from fallback_error
                    raise fallback_error
                pending_completion = next_completion()
        except (LLMRequestCancelledError, LLMDeadlineExceeded):
            primary_cancel.set()
            fallback_cancel.set()
            raise

    def _generate_structured(
        self,
        *,
        primary_call: Callable[[], dict[str, Any]],
        fallback_call: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        primary_error: Exception
        circuit_open = self._primary_circuit_is_open()
        try:
            if circuit_open:
                raise self._circuit_open_error()
            result = primary_call()
            self._record_primary_success()
            return result
        except (LLMStructuredOutputError, MissingLLMConfigurationError) as error:
            primary_error = error
            failover_reason = self._bounded_reason(error)
            self._record_primary_failure(error)
        except LLMRequestError as error:
            if not self._should_fail_over(error):
                raise
            primary_error = error
            failover_reason = self._bounded_reason(error)
            self._record_primary_failure(error)
        if circuit_open:
            failover_reason = self._bounded_reason(primary_error)

        self._log_failover(primary_error)

        try:
            result = fallback_call()
        except LLMRequestError as fallback_error:
            if fallback_error.category == "deadline":
                raise
            if isinstance(primary_error, LLMStructuredOutputError):
                setattr(
                    primary_error,
                    "fallback_request_failure",
                    self._bounded_reason(fallback_error),
                )
                raise primary_error from fallback_error
            raise self._combined_failure(
                primary_error,
                fallback_error,
            ) from fallback_error
        return self._annotate_fallback_result(
            result,
            primary_error=primary_error,
            circuit_open=circuit_open,
            failover_reason=failover_reason,
        )

    def _annotate_fallback_result(
        self,
        result: dict[str, Any],
        *,
        primary_error: Exception,
        circuit_open: bool,
        failover_reason: str | None = None,
    ) -> dict[str, Any]:
        metadata = result.setdefault("_meta", {})
        if isinstance(metadata, dict):
            primary_info = self._primary.get_model_info()
            fallback_info = self._fallback.get_model_info()
            metadata.update({
                "model_failover_used": True,
                "model_failover_reason": (
                    failover_reason or self._bounded_reason(primary_error)
                ),
                "primary_model_provider": primary_info.provider,
                "primary_model_name": primary_info.model_name,
                "fallback_model_provider": fallback_info.provider,
                "fallback_model_name": fallback_info.model_name,
            })
            if circuit_open:
                metadata["primary_circuit_open"] = True
        return result

    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys: Sequence[str] | None = None,
    ) -> bool:
        return self._primary.validate_output(
            output,
            required_keys=required_keys,
        ) or self._fallback.validate_output(
            output,
            required_keys=required_keys,
        )

    def get_model_info(self) -> LLMModelInfo:
        """Describe the preferred route; per-result metadata records failover."""

        return self._primary.get_model_info()

    @staticmethod
    def _bounded_reason(error: Exception) -> str:
        detail = str(error).strip() or type(error).__name__
        return f"{type(error).__name__}: {detail}"[:500]

    @classmethod
    def _route_log_identity(cls, adapter: LLMAdapter) -> tuple[str, str, str, str]:
        info = adapter.get_model_info()
        base_url = getattr(adapter, "_base_url", "")
        wire_api = getattr(adapter, "_wire_api", "")
        pooled_adapters = getattr(adapter, "_adapters", ())
        if pooled_adapters:
            first = pooled_adapters[0]
            base_url = base_url or getattr(first, "_base_url", "")
            wire_api = wire_api or getattr(first, "_wire_api", "")
        primary = getattr(adapter, "_primary", None)
        if primary is not None and not base_url:
            _, _, base_url, nested_wire_api = cls._route_log_identity(primary)
            wire_api = wire_api or nested_wire_api
            return info.provider, info.model_name, base_url, wire_api or "unknown"
        parsed = urlparse(str(base_url))
        gateway = parsed.hostname or str(base_url).split("/", 1)[0] or "unknown"
        return info.provider, info.model_name, gateway, wire_api or "unknown"

    def _log_failover(self, error: Exception) -> None:
        project_id, episode, stage, agent_run_id = _llm_log_context_fields()
        from_provider, from_model, from_gateway, from_wire_api = (
            self._route_log_identity(self._primary)
        )
        to_provider, to_model, to_gateway, to_wire_api = self._route_log_identity(
            self._fallback
        )
        logger.warning(
            "LLM route failover selected from_provider=%s from_model=%s "
            "from_gateway=%s from_wire_api=%s to_provider=%s to_model=%s "
            "to_gateway=%s to_wire_api=%s reason_type=%s category=%s "
            "status_code=%s project_id=%s episode=%s stage=%s agent_run_id=%s "
            "detail=%s",
            from_provider,
            from_model,
            from_gateway,
            from_wire_api,
            to_provider,
            to_model,
            to_gateway,
            to_wire_api,
            type(error).__name__,
            getattr(error, "category", "structured_output"),
            getattr(error, "status_code", None) or "none",
            project_id,
            episode,
            stage,
            agent_run_id,
            RealLLMAdapter._safe_route_log_detail(error),
        )

    def _should_fail_over(self, error: LLMRequestError) -> bool:
        if error.category == "deadline" and self._failover_on_request_deadline:
            # The primary's request scope has unwound. An earlier workflow
            # deadline must still stop the chain before starting another model.
            if getattr(error, "deadline_scope", None) != "request":
                return False
            try:
                check_deadline()
            except LLMDeadlineExceeded as parent_error:
                raise deadline_request_error(parent_error) from parent_error
            return True
        return is_recoverable_llm_request_error(error)

    def _primary_circuit_is_open(self) -> bool:
        with self._circuit_state.lock:
            return time.monotonic() < self._circuit_state.primary_circuit_open_until

    def _record_primary_success(self) -> None:
        with self._circuit_state.lock:
            self._circuit_state.primary_failure_count = 0
            self._circuit_state.primary_circuit_open_until = 0.0

    def _record_primary_failure(self, error: Exception) -> None:
        if not self._counts_for_circuit(error):
            return
        with self._circuit_state.lock:
            self._circuit_state.primary_hedge_win_streak = 0
            self._circuit_state.primary_failure_count += 1
            if (
                self._circuit_state.primary_failure_count
                >= self._circuit_failure_threshold
            ):
                self._circuit_state.primary_circuit_open_until = (
                    time.monotonic() + self._circuit_cooldown_seconds
                )

    def _effective_hedge_delay_seconds(self) -> float:
        configured = self._hedge_delay_seconds or 0.01
        with self._circuit_state.lock:
            # High-reasoning DeepSeek frequently produces no visible content
            # before completing. When the primary repeatedly wins the race,
            # widen the next hedge window instead of duplicating every healthy
            # request. Two consecutive primary wins add one base interval.
            multiplier = min(
                3,
                1 + self._circuit_state.primary_hedge_win_streak // 2,
            )
        return configured * multiplier

    def _record_hedge_outcome(self, route_name: str) -> None:
        with self._circuit_state.lock:
            if route_name == "primary":
                self._circuit_state.primary_hedge_win_streak = min(
                    6,
                    self._circuit_state.primary_hedge_win_streak + 1,
                )
            else:
                self._circuit_state.primary_hedge_win_streak = 0

    def _counts_for_circuit(self, error: Exception) -> bool:
        if isinstance(error, MissingLLMConfigurationError):
            return True
        if isinstance(error, LLMRequestError):
            if error.category == "circuit_open":
                return False
            return self._should_fail_over(error)
        if isinstance(error, LLMStructuredOutputError):
            # Empty and interrupted streams are route health failures. A
            # normal schema/JSON mistake should still get another chance.
            return bool(error.empty_response or error.stream_termination)
        return False

    def _circuit_open_error(self) -> LLMRequestError:
        with self._circuit_state.lock:
            failures = self._circuit_state.primary_failure_count
            remaining = max(
                0.0,
                self._circuit_state.primary_circuit_open_until - time.monotonic(),
            )
        return LLMRequestError(
            "Primary model route is temporarily bypassed after "
            f"{failures} transient failures; retrying it in {remaining:.0f}s.",
            category="circuit_open",
            recoverable=True,
        )

    @classmethod
    def _combined_failure(
        cls,
        primary_error: Exception,
        fallback_error: LLMRequestError,
    ) -> LLMRequestError:
        if fallback_error.category == "deadline":
            return fallback_error
        primary = cls._bounded_reason(primary_error)
        fallback = cls._bounded_reason(fallback_error)
        combined = LLMRequestError(
            "All configured model routes failed. "
            f"Primary: {primary}; fallback: {fallback}",
            status_code=(
                fallback_error.status_code
                or getattr(primary_error, "status_code", None)
            ),
            category="failover_exhausted",
            recoverable=True,
        )
        if any(
            getattr(error, "gateway_deadline", False)
            or getattr(error, "status_code", None) == 524
            for error in (primary_error, fallback_error)
        ):
            # Preserve the hard-deadline signal even when a later fallback
            # has a different status code. The browser must not resubmit the
            # whole long request after any route already reached 524.
            setattr(combined, "gateway_deadline", True)
        setattr(
            combined,
            "route_failure_categories",
            (
                getattr(primary_error, "category", "structured_output"),
                getattr(fallback_error, "category", "unknown"),
            ),
        )
        if any(
            AdaptiveTransportLLMAdapter._is_reasoning_length_exhaustion(error)
            or bool(getattr(error, "reasoning_length_exhausted", False))
            for error in (primary_error, fallback_error)
        ):
            setattr(combined, "reasoning_length_exhausted", True)
        return combined


class PooledLLMAdapter(LLMAdapter):
    """Round-robin, per-key bounded adapter for independent script jobs.

    The adapter deliberately keeps the existing ``LLMAdapter`` contract. It
    does not know about episodes or story planning; callers decide which
    requests are safe to run concurrently.
    """

    def __init__(
        self,
        *,
        provider: str,
        model_name: str,
        api_keys: Sequence[str],
        base_url: str,
        timeout_seconds: int = 60,
        request_deadline_seconds: float | None = None,
        max_retries: int = 2,
        wire_api: str = "chat_completions",
        reasoning_effort: str | None = None,
        thinking_mode: str | None = None,
        use_strict_schema: bool = True,
        send_response_format: bool = True,
        retry_empty_response: bool = True,
        defer_schema_container_repair: bool = False,
        retry_gateway_stream_as_non_stream: bool = True,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        normalized_keys = tuple(key.strip() for key in api_keys if key.strip())
        if not normalized_keys:
            raise MissingLLMConfigurationError(
                "At least one numbered script LLM API key is required."
            )
        if not base_url.strip():
            raise MissingLLMConfigurationError(
                "LLM_BASE_URL is required for pooled script generation."
            )
        self._adapters = tuple(
            RealLLMAdapter(
                provider=provider,
                model_name=model_name,
                api_key=key,
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
                transport=transport,
            )
            for key in normalized_keys
        )
        self._condition = threading.Condition()
        self._request_deadline_seconds = self._adapters[0]._request_deadline_seconds
        self._active = [0 for _ in self._adapters]
        self._next_index = 0

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        return self._invoke(
            lambda adapter: adapter.generate_text(prompt, strategy=strategy)
        )

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._invoke(
            lambda adapter: adapter.generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
    ) -> dict[str, Any]:
        return self._invoke(
            lambda adapter: adapter.generate_structured_output_stream(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
            )
        )

    def generate_structured_output_stream_cancellable(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
        cancel_event: threading.Event,
    ) -> dict[str, Any]:
        def operation(adapter: LLMAdapter) -> dict[str, Any]:
            if cancel_event.is_set():
                raise _HedgedRequestCancelled()
            return adapter.generate_structured_output_stream_cancellable(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
                cancel_event=cancel_event,
            )

        return self._invoke(operation)

    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys: Sequence[str] | None = None,
    ) -> bool:
        return self._adapters[0].validate_output(
            output,
            required_keys=required_keys,
        )

    def get_model_info(self) -> LLMModelInfo:
        return self._adapters[0].get_model_info()

    @_bounded_llm_request
    def _invoke(self, operation: Any) -> Any:
        attempted: set[int] = set()
        last_error: Exception | None = None
        while len(attempted) < len(self._adapters):
            index = self._acquire_slot(attempted)
            attempted.add(index)
            try:
                result = operation(self._adapters[index])
                if isinstance(result, dict):
                    metadata = result.setdefault("_meta", {})
                    if isinstance(metadata, dict):
                        metadata["key_slot"] = index + 1
                        metadata["pool_key_attempt_count"] = len(attempted)
                        if len(attempted) > 1:
                            metadata["pool_key_failover_used"] = True
                return result
            except LLMStructuredOutputError as exc:
                last_error = exc
                if (
                    not self._should_rotate_structured_error(exc)
                    or len(attempted) >= 2
                ):
                    setattr(exc, "pool_key_attempt_count", len(attempted))
                    raise
            except LLMRequestError as exc:
                last_error = exc
                max_key_attempts = self._max_key_attempts_for_request_error(exc)
                if (
                    not self._should_fail_over(exc)
                    or len(attempted) >= max_key_attempts
                ):
                    setattr(exc, "pool_key_attempt_count", len(attempted))
                    raise
            finally:
                self._release_slot(index)

        if last_error is not None:
            setattr(last_error, "pool_key_attempt_count", len(attempted))
            raise last_error
        raise LLMRequestError("Pooled LLM generation failed without an error.")

    @staticmethod
    def _should_fail_over(error: LLMRequestError) -> bool:
        return is_recoverable_llm_request_error(error, for_key_rotation=True)

    def _max_key_attempts_for_request_error(
        self,
        error: LLMRequestError,
    ) -> int:
        """Bound host-level outages while preserving key-specific failover.

        Authentication and rate-limit responses can genuinely differ by key.
        Gateway, transport, protocol, and timeout failures normally affect the
        shared provider host, so one backup key is enough to test that route.
        """

        if AdaptiveTransportLLMAdapter._is_reasoning_length_exhaustion(error):
            # Output-budget exhaustion is a model/transport behavior, not an
            # API-key health signal. Rotating keys would repeat the same long
            # failed inference before the adaptive transport can react.
            return 1
        if (
            error.category in {
                "provider_gateway",
                "provider_protocol",
                "transport",
                "timeout",
                "empty_response",
            }
            or (error.status_code is not None and error.status_code >= 500)
        ):
            return min(2, len(self._adapters))
        return len(self._adapters)

    @staticmethod
    def _should_rotate_structured_error(error: LLMStructuredOutputError) -> bool:
        """Rotate keys only when the provider produced no usable payload.

        Invalid non-empty JSON needs artifact-aware repair. Repeating it across
        every key would multiply cost without changing the semantic prompt.
        """
        if (error.raw_content or "").strip():
            return False
        message = str(error).casefold()
        return any(
            marker in message
            for marker in (
                "empty",
                "invalid json content",
                "missing choices",
                "missing a message payload",
                "did not contain readable",
                "did not contain output text",
                "missing output items",
                "did not contain valid json structured output",
            )
        )

    def _acquire_slot(self, attempted: set[int]) -> int:
        with self._condition:
            while True:
                check_deadline()
                candidates = [
                    index
                    for index in range(len(self._adapters))
                    if index not in attempted
                ]
                if not candidates:
                    raise LLMRequestError("No unused pooled LLM key is available.")
                idle = [index for index in candidates if self._active[index] == 0]
                if not idle:
                    self._condition.wait(timeout=remaining_deadline_seconds())
                    continue
                minimum_active = min(self._active[index] for index in idle)
                available = [
                    index for index in idle
                    if self._active[index] == minimum_active
                ]
                index = next(
                    (candidate for candidate in available
                     if candidate >= self._next_index),
                    available[0],
                )
                self._next_index = (index + 1) % len(self._adapters)
                self._active[index] += 1
                return index

    def _release_slot(self, index: int) -> None:
        with self._condition:
            self._active[index] -= 1
            self._condition.notify_all()


class MockLLMAdapter(LLMAdapter):
    def __init__(
        self,
        *,
        provider: str = "mock",
        model_name: str = "mock-script-generator",
    ) -> None:
        self._provider = provider
        self._model_name = model_name

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        trimmed_prompt = prompt.strip().replace("\n", " ")
        return (
            f"[{self._provider}:{self._model_name}] "
            f"{strategy.name} -> {trimmed_prompt[:180]}"
        )

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        schema = output_schema or strategy.output_schema
        properties = schema.get("properties", {}) if isinstance(schema, dict) else {}
        from app.modules.script_engine.mock_planning import planning_mock_output

        planning_output = planning_mock_output(prompt, schema)
        fingerprint = hashlib.sha1(
            f"{strategy.id}|{prompt}".encode("utf-8")
        ).hexdigest()[:8]
        structured_output: dict[str, Any] = planning_output if planning_output is not None else {
            key: f"mock_{key}_{fingerprint}" for key in properties.keys()
        }
        if not structured_output:
            structured_output = {
                "draft_summary": self.generate_text(prompt, strategy=strategy)
            }

        structured_output["_meta"] = {
            "provider": self._provider,
            "model_name": self._model_name,
            "strategy_id": strategy.id,
            "prompt_fingerprint": fingerprint,
        }
        return structured_output

    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys: Sequence[str] | None = None,
    ) -> bool:
        if required_keys is None:
            return bool(output)
        return all(key in output for key in required_keys)

    def get_model_info(self) -> LLMModelInfo:
        return LLMModelInfo(
            provider=self._provider,
            model_name=self._model_name,
            supports_structured_output=True,
            max_context_tokens=128_000,
        )


class FailingLLMAdapter(LLMAdapter):
    def __init__(self, error: Exception) -> None:
        self._error = error

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        raise self._error

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        raise self._error

    def validate_output(
        self,
        output: dict[str, Any],
        *,
        required_keys: Sequence[str] | None = None,
    ) -> bool:
        return False

    def get_model_info(self) -> LLMModelInfo:
        return LLMModelInfo(
            provider="unconfigured",
            model_name="unconfigured",
            supports_structured_output=False,
            max_context_tokens=128_000,
        )
