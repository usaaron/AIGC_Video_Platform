"""Bounded draft recovery shared by generation and optional postprocessing."""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
import logging
import re
import threading

from pydantic import ValidationError

from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine import draft_contract
from app.modules.script_engine.draft_contract import InvalidDraftMasterScriptOutputError
from app.modules.script_engine.llm_adapter import (
    LLMAdapter,
    LLMRequestCancelledError,
    LLMRequestError,
    LLMStructuredOutputError,
    bind_llm_log_context,
    is_recoverable_llm_request_error,
)
from app.modules.script_engine.models import GenerationStrategy


logger = logging.getLogger(__name__)


def generate_postprocess_output(
    *,
    adapter: LLMAdapter,
    prompt: str,
    strategy: GenerationStrategy,
    output_schema: dict[str, object] | None,
    phase: str,
    progress_callback: Callable[[str, dict[str, object]], None] | None,
    single_non_stream_attempt: bool = False,
) -> dict[str, object]:
    """Recover one malformed post-process response without discarding the draft."""

    if single_non_stream_attempt:
        with bind_llm_log_context(stage=f"episode_script.{phase}"):
            return adapter.generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )

    def on_delta(delta: str, reset: bool) -> None:
        if progress_callback is not None:
            progress_callback("draft_delta", {"delta": delta, "reset": reset, "phase": phase})

    try:
        with bind_llm_log_context(stage=f"episode_script.{phase}"):
            return adapter.generate_structured_output_stream(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=on_delta,
            )
    except (LLMStructuredOutputError, LLMRequestError) as first_error:
        if not _should_retry_postprocess_stream(first_error):
            raise
        if isinstance(first_error, LLMStructuredOutputError):
            logger.warning(
                "Post-process structured stream failed; retrying non-streaming "
                "phase=%s raw_chars=%d",
                phase,
                len(first_error.raw_content or ""),
            )
        else:
            logger.warning(
                "Post-process stream transport failed; retrying non-streaming "
                "phase=%s category=%s status=%s",
                phase,
                first_error.category,
                first_error.status_code,
            )
    recovery_prompt = f"""{prompt}

The previous post-processing transport returned empty, short, truncated, or non-JSON
content. Return only the complete JSON object required by the supplied schema. Do not
include analysis, Markdown fences, status text, or an explanation."""
    try:
        with bind_llm_log_context(stage=f"episode_script.{phase}.recovery"):
            return adapter.generate_structured_output(
                recovery_prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
    except LLMStructuredOutputError as final_error:
        if structured_output_error_is_transient(final_error):
            raise LLMRequestError(
                "正文后处理响应为空或被截断；可从当前集重新尝试。",
                category="empty_response",
                recoverable=True,
            ) from final_error
        raise


def _should_retry_postprocess_stream(error: LLMStructuredOutputError | LLMRequestError) -> bool:
    if isinstance(error, LLMStructuredOutputError):
        return not (
            getattr(error, "stream_fallback_attempted", False)
            or error.empty_response_retry_attempted
        )
    if not is_recoverable_llm_request_error(error):
        return False
    route_failure_categories = tuple(
        str(value)
        for value in getattr(error, "route_failure_categories", ())
        if value
    )
    stream_termination = str(
        getattr(error, "stream_termination", "") or ""
    ).casefold()
    # Once the adapter has exhausted both gateways, repeating the same
    # repair over non-streaming transport only adds another 2-3 minutes
    # and cannot recover a response-budget exhaustion. Let the outer
    # current-episode retry rotate the whole request instead.
    return not (
        error.category
        in {"failover_exhausted", "script_generation_routes_exhausted"}
        or getattr(error, "stream_fallback_attempted", False)
        or (
            error.category == "empty_response"
            and any(
                marker in stream_termination
                for marker in ("length", "max_output", "max_tokens", "incomplete")
            )
        )
        or (
            route_failure_categories
            and all(
                category in {"empty_response", "provider_gateway", "timeout", "transport"}
                for category in route_failure_categories
            )
        )
    )


def _raise_if_cancelled(cancel_event: threading.Event | None) -> None:
    if cancel_event is not None and cancel_event.is_set():
        raise LLMRequestCancelledError()


def _validated_draft(
    output: dict[str, object],
    normalize: Callable[[dict[str, object]], dict[str, object]],
) -> tuple[dict[str, object], dict[str, object]]:
    normalized = normalize(output)
    body = draft_contract.without_metadata(normalized)
    LLMGeneratedDraftMasterScript.model_validate(body)
    return normalized, body


def run_valid_draft_postprocess_stage(
    *,
    output: dict[str, object],
    phase: str,
    operation: Callable[[dict[str, object]], dict[str, object]],
    normalize: Callable[[dict[str, object]], dict[str, object]],
    cancel_event: threading.Event | None = None,
) -> dict[str, object]:
    """Run an optional stage against an isolated, contract-valid checkpoint."""
    _raise_if_cancelled(cancel_event)
    checkpoint, checkpoint_body = _validated_draft(deepcopy(output), normalize)
    _raise_if_cancelled(cancel_event)
    try:
        candidate = operation(deepcopy(checkpoint))
        _raise_if_cancelled(cancel_event)
        candidate, candidate_body = _validated_draft(
            draft_contract.unwrap_response_envelope(candidate), normalize,
        )
        _raise_if_cancelled(cancel_event)
        if candidate_body == checkpoint_body:
            draft_contract.merge_output_metadata(source=candidate, target=output)
            return output
        return candidate
    except (
        LLMRequestError,
        LLMStructuredOutputError,
        InvalidDraftMasterScriptOutputError,
        ValidationError,
    ) as error:
        if isinstance(error, LLMRequestError) and not is_recoverable_llm_request_error(error):
            raise
        # A cancellation arriving with a recoverable failure still stops the stage.
        _raise_if_cancelled(cancel_event)
        return preserve_valid_draft_after_postprocess_failure(checkpoint, phase=phase, error=error)


def preserve_valid_draft_after_postprocess_failure(
    output: dict[str, object],
    *,
    phase: str,
    error: Exception,
) -> dict[str, object]:
    """Keep a contract-valid draft when an optional enhancement transport fails."""

    preserved = deepcopy(output)
    metadata = preserved.setdefault("_meta", {})
    if isinstance(metadata, dict):
        phases = metadata.setdefault("deferred_postprocess_phases", [])
        if isinstance(phases, list) and phase not in phases:
            phases.append(phase)
        diagnostic = failure_diagnostic(phase=phase, error=error)
        diagnostics = metadata.setdefault("deferred_postprocess_diagnostics", [])
        if isinstance(diagnostics, list):
            diagnostics.append(diagnostic)
        metadata["postprocess_failure_preserved_valid_draft"] = True
    return preserved


def failure_diagnostic(*, phase: str, error: Exception) -> str:
    if isinstance(error, LLMStructuredOutputError):
        return structured_failure_diagnostic(phase=phase, error=error)
    if isinstance(error, LLMRequestError):
        return request_failure_diagnostic(phase=phase, error=error)
    return f"{phase}(error_type={type(error).__name__}; error={str(error)[:600]})"


def request_failure_diagnostic(
    *,
    phase: str,
    error: LLMRequestError,
) -> str:
    status = error.status_code if error.status_code is not None else "none"
    category = re.sub(r"[^a-zA-Z0-9_.-]+", "_", error.category)[:80]
    return f"{phase}: request_category={category or 'unknown'}; status={status}"


def structured_failure_diagnostic(
    *,
    phase: str,
    error: LLMStructuredOutputError,
) -> str:
    raw_content = (error.raw_content or "").strip()
    diagnostics = (
        f"{phase}(error={str(error).strip() or type(error).__name__},"
        f" raw_chars={len(raw_content)})"
    )
    json_position = (
        f"json_error=line:{error.json_error_line},column:{error.json_error_column},"
        f"position:{error.json_error_position}"
        if error.json_error_line is not None
        else None
    )
    termination = (
        f"stream_termination={error.stream_termination}"
        if error.stream_termination
        else None
    )
    details = "; ".join(
        value for value in (json_position, termination) if value
    )
    return f"{diagnostics[:-1]}; {details})" if details else diagnostics


def structured_output_error_is_transient(
    error: LLMStructuredOutputError,
) -> bool:
    """Distinguish provider transport exhaustion from semantic bad JSON."""

    if error.empty_response or error.empty_response_retry_attempted:
        return True
    raw_content = (error.raw_content or "").strip()
    termination = str(error.stream_termination or "").casefold()
    if raw_content:
        # A non-empty malformed body still has useful material for the
        # bounded JSON repair path. Only an actual broken stream marker,
        # rather than a normal token-limit diagnostic, should bypass it.
        return any(
            marker in termination
            for marker in ("ended_without_terminal_event", "unexpected_eof")
        )
    return any(
        marker in termination
        for marker in (
            "length",
            "max_output",
            "max_tokens",
            "token_limit",
            "incomplete",
            "truncated",
            "ended_without_terminal_event",
            "unexpected_eof",
        )
    )


def is_reasoning_length_exhaustion(error: Exception) -> bool:
    if bool(getattr(error, "reasoning_length_exhausted", False)):
        return True
    termination = str(
        getattr(error, "stream_termination", "") or ""
    ).casefold()
    reasoning_characters = getattr(error, "reasoning_characters", 0)
    empty_response = (
        isinstance(error, LLMRequestError)
        and error.category in {"empty_response", "failover_exhausted"}
    ) or (
        isinstance(error, LLMStructuredOutputError)
        and error.empty_response
    )
    return (
        empty_response
        and isinstance(reasoning_characters, int)
        and reasoning_characters > 0
        and any(
            marker in termination
            for marker in ("length", "max_output", "max_tokens", "token")
        )
    )


def exception_chain_has_transient_llm_failure(
    error: Exception,
) -> bool:
    current: BaseException | None = error
    visited: set[int] = set()
    for _ in range(8):
        if current is None or id(current) in visited:
            break
        visited.add(id(current))
        if isinstance(current, LLMRequestError):
            return is_recoverable_llm_request_error(current)
        if isinstance(current, LLMStructuredOutputError):
            return structured_output_error_is_transient(current)
        current = current.__cause__ or current.__context__
    return False
