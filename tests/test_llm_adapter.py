import json

import httpx
import pytest

from app.modules.script_engine.llm_adapter import (
    LLMRequestError,
    LLMStructuredOutputError,
    MockLLMAdapter,
    MissingLLMConfigurationError,
    RealLLMAdapter,
)
from app.modules.script_engine.models import GenerationStrategy


def build_strategy() -> dict:
    return {
        "id": "strategy.tiktok.master_script.v1",
        "name": "TikTok Master Script Strategy",
        "target_platform": "tiktok",
        "target_content_type": "ai_comic_drama",
        "applicable_tags": ["genre.romance"],
        "model_provider": "openai_compatible",
        "model_name": "script-model",
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 4000,
        "workflow_steps": [
            {
                "step_order": 1,
                "name": "story_planning",
                "description": "Build the initial story plan.",
                "prompt_id": "prompt.story_planning.v1",
            }
        ],
        "prompt_ids": ["prompt.story_planning.v1"],
        "qc_enabled": True,
        "self_check_enabled": True,
        "human_review_required": False,
        "output_schema": {
            "type": "object",
            "properties": {"title": {"type": "string"}},
        },
        "version": "v1",
        "status": "active",
    }


def build_openai_compatible_response(content: str) -> dict:
    return {
        "id": "chatcmpl_test",
        "usage": {
            "prompt_tokens": 120,
            "completion_tokens": 240,
            "total_tokens": 360,
        },
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,
                },
                "finish_reason": "stop",
            }
        ],
    }


def test_mock_llm_adapter_returns_text() -> None:
    adapter = MockLLMAdapter()
    strategy = GenerationStrategy.model_validate(build_strategy())
    result = adapter.generate_text("Create a strong opening hook.", strategy=strategy)
    assert "Create a strong opening hook." in result


def test_mock_llm_adapter_returns_structured_output() -> None:
    adapter = MockLLMAdapter()
    strategy = GenerationStrategy.model_validate(build_strategy())
    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
    )
    assert "title" in result
    assert "prompt_fingerprint" in result["_meta"]
    assert adapter.validate_output(result, required_keys=["title", "_meta"]) is True


def test_real_llm_adapter_returns_structured_output_from_mock_http() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer secret-key"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["response_format"]["type"] == "json_schema"
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"Real Title"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Real Title"
    assert result["_meta"]["provider"] == "openai_compatible"
    assert result["_meta"]["usage"]["total_tokens"] == 360


def test_real_llm_adapter_retries_invalid_json_output() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    responses = iter(
        [
            build_openai_compatible_response("not-json"),
            build_openai_compatible_response('{"title":"Recovered Title"}'),
        ]
    )

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=next(responses))

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=1,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Recovered Title"


def test_real_llm_adapter_raises_for_invalid_json_after_retries() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=build_openai_compatible_response("not-json"))

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=1,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError, match="invalid JSON"):
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        )


def test_real_llm_adapter_raises_when_api_key_is_missing() -> None:
    with pytest.raises(MissingLLMConfigurationError, match="API_KEY"):
        RealLLMAdapter(
            provider="openai_compatible",
            model_name="script-model",
            api_key="",
            base_url="https://example.test/v1",
        )


def test_real_llm_adapter_retries_timeouts() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise httpx.ReadTimeout("timed out", request=request)
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"Recovered After Timeout"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=1,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert attempts["count"] == 2
    assert result["title"] == "Recovered After Timeout"


def test_real_llm_adapter_raises_after_timeout_retries_are_exhausted() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=1,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMRequestError, match="timed out"):
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        )


def test_real_llm_adapter_exposes_model_info_contract() -> None:
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="validator-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json=build_openai_compatible_response('{"title":"Valid"}'),
            )
        ),
    )
    assert adapter.validate_output({"title": "x"}, required_keys=["title"]) is True
    assert adapter.get_model_info().model_name == "validator-model"
