from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from typing import Any, Sequence

import httpx

from app.modules.script_engine.models import GenerationStrategy, LLMModelInfo


class MissingLLMConfigurationError(ValueError):
    """Raised when the runtime LLM configuration is incomplete."""


class LLMStructuredOutputError(ValueError):
    """Raised when a model response cannot be parsed into valid structured output."""


class LLMRequestError(RuntimeError):
    """Raised when a real model request fails after retries."""


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
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_key.strip():
            raise MissingLLMConfigurationError("LLM_API_KEY must not be empty.")
        if not base_url.strip():
            raise MissingLLMConfigurationError("LLM_BASE_URL must not be empty.")

        self._provider = provider
        self._model_name = model_name
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._max_context_tokens = max_context_tokens
        self._client = httpx.Client(
            timeout=timeout_seconds,
            transport=transport,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        payload = self._build_chat_payload(
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
        payload = self._build_chat_payload(
            prompt=prompt,
            strategy=strategy,
            output_schema=output_schema,
        )

        last_error: Exception | None = None
        for _attempt in range(self._max_retries + 1):
            response_payload = self._post_with_retries(payload)
            try:
                structured_output = self._extract_structured_output(response_payload)
            except LLMStructuredOutputError as exc:
                last_error = exc
                continue

            structured_output["_meta"] = {
                "provider": self._provider,
                "model_name": self._model_name,
                "strategy_id": strategy.id,
            }
            usage = response_payload.get("usage")
            if isinstance(usage, dict):
                structured_output["_meta"]["usage"] = usage
            response_id = response_payload.get("id")
            if isinstance(response_id, str) and response_id.strip():
                structured_output["_meta"]["response_id"] = response_id.strip()
            return structured_output

        if last_error is not None:
            raise last_error
        raise LLMStructuredOutputError("Structured output generation failed unexpectedly.")

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

    def _build_chat_payload(
        self,
        *,
        prompt: str,
        strategy: GenerationStrategy,
        output_schema: dict[str, Any] | None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self._model_name,
            "temperature": strategy.temperature,
            "top_p": strategy.top_p,
            "max_tokens": strategy.max_tokens,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You generate structured dramatic short-form scripts. "
                        "Follow the supplied JSON schema exactly."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        }
        if output_schema:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "draft_master_script",
                    "strict": True,
                    "schema": output_schema,
                },
            }
        return payload

    def _post_with_retries(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            try:
                response = self._client.post(
                    f"{self._base_url}/chat/completions",
                    json=payload,
                )
                response.raise_for_status()
                return response.json()
            except httpx.TimeoutException as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    raise LLMRequestError(
                        "LLM request timed out after exhausting retries."
                    ) from exc
            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code
                if 400 <= status_code < 500:
                    raise LLMRequestError(
                        f"LLM request failed with non-retryable status {status_code}."
                    ) from exc
                last_error = exc
                if attempt >= self._max_retries:
                    raise LLMRequestError(
                        f"LLM request failed with status {status_code} after retries."
                    ) from exc
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    raise LLMRequestError(
                        "LLM request failed after exhausting retries."
                    ) from exc

        raise LLMRequestError("LLM request failed unexpectedly.") from last_error

    def _extract_text_content(self, response_payload: dict[str, Any]) -> str:
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

    def _extract_structured_output(self, response_payload: dict[str, Any]) -> dict[str, Any]:
        message = self._extract_message(response_payload)

        parsed = message.get("parsed")
        if isinstance(parsed, dict):
            return parsed

        content = message.get("content")
        if isinstance(content, str):
            return self._parse_json_content(content)
        if isinstance(content, list):
            combined = "\n".join(
                part.get("text", "").strip()
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ).strip()
            if combined:
                return self._parse_json_content(combined)

        raise LLMStructuredOutputError(
            "Model response did not contain valid JSON structured output."
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

    def _parse_json_content(self, content: str) -> dict[str, Any]:
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMStructuredOutputError("Model returned invalid JSON content.") from exc
        if not isinstance(parsed, dict):
            raise LLMStructuredOutputError("Model returned JSON that is not an object.")
        return parsed


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
