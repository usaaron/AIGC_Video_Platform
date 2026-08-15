from __future__ import annotations

import ast
import hashlib
import json
import re
import threading
import time
from abc import ABC, abstractmethod
from copy import deepcopy
from typing import Any, Callable, Sequence

import httpx

from app.modules.script_engine.models import GenerationStrategy, LLMModelInfo


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
        max_retries: int = 2,
        max_context_tokens: int = 128_000,
        wire_api: str = "chat_completions",
        reasoning_effort: str | None = None,
        thinking_mode: str | None = None,
        use_strict_schema: bool = True,
        send_response_format: bool = True,
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
            "low",
            "medium",
            "high",
            "max",
            "xhigh",
        }:
            raise MissingLLMConfigurationError(
                "LLM_REASONING_EFFORT must be low, medium, high, max or xhigh."
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
        self._is_deepseek = "deepseek" in f"{provider} {model_name}".casefold()
        if self._is_deepseek:
            # DeepSeek V4 exposes structured generation through the OpenAI
            # Chat Completions interface. Its JSON mode accepts json_object,
            # not OpenAI's provider-specific strict json_schema envelope.
            normalized_wire_api = "chat_completions"
            use_strict_schema = False
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._max_context_tokens = max_context_tokens
        self._wire_api = normalized_wire_api
        self._reasoning_effort = normalized_reasoning_effort
        self._thinking_mode = normalized_thinking_mode
        self._use_strict_schema = use_strict_schema
        self._send_response_format = send_response_format
        self._client = httpx.Client(
            timeout=timeout_seconds,
            transport=transport,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

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
        except LLMStructuredOutputError:
            if (
                self._wire_api != "responses"
                and not self._is_deepseek
            ) or not self._response_content_is_empty(response_payload):
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
                raise
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
        if self._is_deepseek:
            structured_output["_meta"]["thinking_mode"] = (
                self._thinking_mode or "enabled"
            )
        usage = response_payload.get("usage")
        if isinstance(usage, dict):
            structured_output["_meta"]["usage"] = usage
        response_id = response_payload.get("id")
        if isinstance(response_id, str) and response_id.strip():
            structured_output["_meta"]["response_id"] = response_id.strip()
        return structured_output

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None = None,
        on_delta: Callable[[str, bool], None] | None = None,
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
            )
        except LLMRequestError as error:
            if not self._should_fallback_from_stream(error):
                raise
            try:
                fallback = self.generate_structured_output(
                    prompt,
                    strategy=strategy,
                    output_schema=output_schema,
                )
            except LLMRequestError as fallback_error:
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

        try:
            structured_output = self._parse_json_content(
                text,
                output_schema=output_schema,
            )
        except LLMStructuredOutputError as error:
            error.stream_termination = stream_termination
            raise
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
        if self._is_deepseek:
            structured_output["_meta"]["thinking_mode"] = (
                self._thinking_mode or "enabled"
            )
        if usage is not None:
            structured_output["_meta"]["usage"] = usage
        if response_id is not None:
            structured_output["_meta"]["response_id"] = response_id
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
    ) -> tuple[dict[str, Any], dict[str, Any] | None, int]:
        if output_schema is None:
            return structured_output, None, 0
        latest_output = structured_output
        latest_response: dict[str, Any] | None = None
        model_pass_count = 0
        for _attempt in range(2):
            issues = self._schema_container_issues(
                latest_output,
                output_schema,
                root_schema=output_schema,
            )
            if not issues:
                return latest_output, latest_response, model_pass_count
            retry_payload = self._container_shape_retry_payload(payload, issues)
            latest_response = self._post_with_retries(retry_payload)
            model_pass_count += 1
            latest_output = self._extract_structured_output(
                latest_response,
                output_schema=output_schema,
            )
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
        return latest_output, latest_response, model_pass_count

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
    def _should_fallback_from_stream(error: LLMRequestError) -> bool:
        # Some compatible gateways fail only on the long-lived SSE path. A
        # bounded non-streaming attempt on the same key changes the transport
        # without changing model, prompt, or screenplay obligations.
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
            "max_tokens": strategy.max_tokens,
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
                if self._reasoning_effort is not None:
                    payload["reasoning_effort"] = (
                        "max"
                        if self._reasoning_effort in {"max", "xhigh"}
                        else self._reasoning_effort
                    )
            else:
                payload["temperature"] = strategy.temperature
                payload["top_p"] = strategy.top_p
        else:
            payload["temperature"] = strategy.temperature
            payload["top_p"] = strategy.top_p
        supports_response_format = not (
            self._is_deepseek
            and payload.get("thinking") == {"type": "enabled"}
        )
        if output_schema and self._send_response_format and supports_response_format:
            if self._use_strict_schema:
                strict_schema = self._normalize_strict_json_schema(output_schema)
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
        # Strict JSON-schema transports already receive the complete schema in
        # the request body. json_object transports guarantee syntax only, so
        # every model needs the compact native-container shape in its prompt.
        if not self._is_deepseek and self._use_strict_schema:
            return prompt
        shape = self._json_shape_example(output_schema)
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
        return f"""{prompt}

{contract_title}
The API response format guarantees JSON syntax only. The following compact example
defines the complete field shape you must return. Replace placeholder values with the
requested story data, preserve exact technical enum/ID values, and do not omit required
nested fields. Objects and arrays must remain native JSON containers: never serialize a
child object or nested collection into a quoted JSON string. Do not return this example
inside another wrapper. The first and only JSON object must be the complete root object,
never one scene, character, state update, episode, dialogue, child, or array item.
{root_identity}<json_shape>
{json.dumps(shape, ensure_ascii=False, separators=(',', ':'))}
</json_shape>
Return exactly one JSON object now."""

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
            "input": [
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "You generate structured dramatic scripts. "
                                "Follow the supplied JSON schema exactly."
                            ),
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": structured_prompt}],
                },
            ],
        }
        if self._reasoning_effort is not None:
            payload["reasoning"] = {"effort": self._reasoning_effort}
        if output_schema and self._send_response_format:
            if self._use_strict_schema:
                payload["text"] = {
                    "format": {
                        "type": "json_schema",
                        "name": self._structured_output_name(output_schema),
                        "strict": True,
                        "schema": self._normalize_strict_json_schema(output_schema),
                    }
                }
            else:
                payload["text"] = {"format": {"type": "json_object"}}
        return payload

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
    def _structured_output_name(output_schema: dict[str, Any]) -> str:
        title = output_schema.get("title")
        source = title if isinstance(title, str) and title.strip() else "structured_output"
        normalized = re.sub(r"[^a-zA-Z0-9_-]+", "_", source).strip("_").casefold()
        return (normalized or "structured_output")[:64]

    def _post_with_retries(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                endpoint = (
                    "responses" if self._wire_api == "responses" else "chat/completions"
                )
                response = self._client.post(f"{self._base_url}/{endpoint}", json=payload)
                response.raise_for_status()
                try:
                    return response.json()
                except (json.JSONDecodeError, ValueError) as exc:
                    content_type = response.headers.get("content-type", "unknown")
                    raise LLMRequestError(
                        "LLM endpoint returned a non-JSON success response "
                        f"(content-type: {content_type}).",
                        category="provider_protocol",
                        recoverable=True,
                    ) from exc
            except httpx.TimeoutException as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    raise LLMRequestError(
                        "LLM request timed out after exhausting retries.",
                        category="timeout",
                        recoverable=True,
                    ) from exc
            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code
                response_detail = self._extract_error_detail(exc.response)
                if 400 <= status_code < 500:
                    raise LLMRequestError(
                        "LLM request failed with non-retryable status "
                        f"{status_code}: {response_detail}",
                        status_code=status_code,
                        category="provider_http",
                        recoverable=status_code in {401, 403, 404, 408, 409, 422, 429},
                    ) from exc
                last_error = exc
                if attempt >= self._max_retries:
                    raise LLMRequestError(
                        "LLM request failed with status "
                        f"{status_code} after retries: {response_detail}",
                        status_code=status_code,
                        category="provider_gateway",
                        recoverable=True,
                    ) from exc
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    error_detail = str(exc).strip()[:500] or "no error detail"
                    raise LLMRequestError(
                        "LLM request failed after exhausting retries: "
                        f"{type(exc).__name__}: {error_detail}",
                        category="transport",
                        recoverable=True,
                    ) from exc

        raise LLMRequestError("LLM request failed unexpectedly.") from last_error

    def _stream_text(
        self,
        payload: dict[str, Any],
        *,
        on_delta: Callable[[str, bool], None] | None,
    ) -> tuple[str, dict[str, Any] | None, str | None, str | None]:
        endpoint = "responses" if self._wire_api == "responses" else "chat/completions"
        stream_payload = {**payload, "stream": True}
        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            received = False
            preview_started = False
            pending_deltas: list[str] = []
            pending_characters = 0
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
                ) as response:
                    # HTTPX does not preload bodies opened through ``stream``.
                    # Consume only error responses while the stream is still
                    # open so status handling can preserve the provider detail.
                    if response.is_error:
                        response.read()
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(event, dict):
                            continue
                        delta = self._stream_event_text_delta(event)
                        if delta:
                            received = True
                            text_parts.append(delta)
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
                if on_delta is not None and pending_deltas:
                    on_delta("".join(pending_deltas), not preview_started)
                if text_parts:
                    if stream_termination is None:
                        stream_termination = "stream_ended_without_terminal_event"
                    return (
                        "".join(text_parts),
                        usage,
                        response_id,
                        stream_termination,
                    )
                raise LLMRequestError(
                    "LLM stream did not contain output text.",
                    category="empty_response",
                    recoverable=True,
                )
            except httpx.TimeoutException as exc:
                last_error = exc
                if received or attempt >= self._max_retries:
                    raise LLMRequestError(
                        "LLM streaming request timed out after exhausting retries.",
                        category="timeout",
                        recoverable=True,
                    ) from exc
            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code
                response_detail = self._extract_error_detail(exc.response)
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
                    raise LLMRequestError(
                        "LLM streaming request failed with status "
                        f"{status_code} after retries: {response_detail}",
                        status_code=status_code,
                        category="provider_gateway",
                        recoverable=True,
                    ) from exc
            except httpx.HTTPError as exc:
                last_error = exc
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
                if received or attempt >= self._max_retries:
                    raise

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
    def _stream_event_termination(event: dict[str, Any]) -> str | None:
        event_type = str(event.get("type") or "").strip().casefold()
        response = event.get("response")
        response = response if isinstance(response, dict) else {}
        status = str(response.get("status") or "").strip().casefold()
        incomplete = response.get("incomplete_details")
        incomplete = incomplete if isinstance(incomplete, dict) else {}
        reason = str(incomplete.get("reason") or "").strip().casefold()
        if event_type in {"response.incomplete", "response.failed"} or status in {
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
            return parsed
        if isinstance(parsed, list):
            collection_field = self._single_root_collection_field(output_schema)
            if collection_field is not None:
                return {collection_field: parsed}
        if isinstance(parsed, str) and parsed.strip():
            return self._parse_json_content(parsed, output_schema=output_schema)

        content = message.get("content")
        if isinstance(content, dict):
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
                if parsed is None and self._single_root_collection_field(output_schema):
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
        if isinstance(parsed, list):
            collection_field = self._single_root_collection_field(output_schema)
            if collection_field is not None:
                return {collection_field: parsed}
        if not isinstance(parsed, dict):
            raise LLMStructuredOutputError(
                "Model returned invalid JSON content.",
                raw_content=content,
                json_error_line=(initial_json_error.lineno if initial_json_error else None),
                json_error_column=(initial_json_error.colno if initial_json_error else None),
                json_error_position=(initial_json_error.pos if initial_json_error else None),
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


class ModelFailoverLLMAdapter(LLMAdapter):
    """Use a secondary model only when the preferred model cannot complete.

    Each child adapter receives the original semantic prompt and JSON schema,
    so Chat Completions and Responses transports can render their own native
    request format without leaking provider-specific envelopes across models.
    """

    def __init__(self, *, primary: LLMAdapter, fallback: LLMAdapter) -> None:
        self._primary = primary
        self._fallback = fallback

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        primary_error: Exception
        try:
            return self._primary.generate_text(prompt, strategy=strategy)
        except (LLMStructuredOutputError, MissingLLMConfigurationError) as error:
            primary_error = error
        except LLMRequestError as error:
            if not self._should_fail_over(error):
                raise
            primary_error = error
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

    def _generate_structured(
        self,
        *,
        primary_call: Callable[[], dict[str, Any]],
        fallback_call: Callable[[], dict[str, Any]],
    ) -> dict[str, Any]:
        primary_error: Exception
        try:
            return primary_call()
        except (LLMStructuredOutputError, MissingLLMConfigurationError) as error:
            primary_error = error
            failover_reason = self._bounded_reason(error)
        except LLMRequestError as error:
            if not self._should_fail_over(error):
                raise
            primary_error = error
            failover_reason = self._bounded_reason(error)

        try:
            result = fallback_call()
        except LLMRequestError as fallback_error:
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
        metadata = result.setdefault("_meta", {})
        if isinstance(metadata, dict):
            primary_info = self._primary.get_model_info()
            fallback_info = self._fallback.get_model_info()
            metadata.update({
                "model_failover_used": True,
                "model_failover_reason": failover_reason,
                "primary_model_provider": primary_info.provider,
                "primary_model_name": primary_info.model_name,
                "fallback_model_provider": fallback_info.provider,
                "fallback_model_name": fallback_info.model_name,
            })
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

    @staticmethod
    def _should_fail_over(error: LLMRequestError) -> bool:
        return is_recoverable_llm_request_error(error)

    @classmethod
    def _combined_failure(
        cls,
        primary_error: Exception,
        fallback_error: LLMRequestError,
    ) -> LLMRequestError:
        primary = cls._bounded_reason(primary_error)
        fallback = cls._bounded_reason(fallback_error)
        return LLMRequestError(
            "All configured model routes failed. "
            f"Primary: {primary}; fallback: {fallback}",
            status_code=(
                fallback_error.status_code
                or getattr(primary_error, "status_code", None)
            ),
            category="failover_exhausted",
            recoverable=True,
        )


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
        max_retries: int = 2,
        wire_api: str = "chat_completions",
        reasoning_effort: str | None = None,
        thinking_mode: str | None = None,
        use_strict_schema: bool = True,
        send_response_format: bool = True,
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
                max_retries=max_retries,
                wire_api=wire_api,
                reasoning_effort=reasoning_effort,
                thinking_mode=thinking_mode,
                use_strict_schema=use_strict_schema,
                send_response_format=send_response_format,
                transport=transport,
            )
            for key in normalized_keys
        )
        self._condition = threading.Condition()
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
                candidates = [
                    index
                    for index in range(len(self._adapters))
                    if index not in attempted
                ]
                if not candidates:
                    raise LLMRequestError("No unused pooled LLM key is available.")
                idle = [index for index in candidates if self._active[index] == 0]
                if not idle:
                    self._condition.wait()
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
        fingerprint = hashlib.sha1(
            f"{strategy.id}|{prompt}".encode("utf-8")
        ).hexdigest()[:8]
        structured_output: dict[str, Any] = {
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
