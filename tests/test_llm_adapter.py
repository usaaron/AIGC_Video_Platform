import json
import logging
import threading
import time
from copy import deepcopy

import httpx
import pytest

from app.modules.master_script.models import LLMGeneratedDraftMasterScript, LLMContinuityRepairPatch
from app.modules.script_engine.llm_adapter import (
    AdaptiveTransportLLMAdapter,
    AdaptiveTransportState,
    LLMRequestCancelledError,
    LLMRequestError,
    LLMStructuredOutputError,
    MockLLMAdapter,
    MissingLLMConfigurationError,
    ModelFailoverLLMAdapter,
    ModelFailoverCircuitState,
    PooledLLMAdapter,
    RealLLMAdapter,
    bind_llm_log_context,
)
from app.modules.script_engine.long_story_models import (
    StoryBibleInteractiveStepOutput,
    StoryPlanNodeDecompositionOutput,
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


def build_responses_api_response(content: str) -> dict:
    return {
        "id": "resp_test",
        "usage": {
            "input_tokens": 80,
            "output_tokens": 20,
            "total_tokens": 100,
        },
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": content}],
            }
        ],
    }


def test_route_diagnostics_log_gateway_timing_without_prompt_or_secret(
    caplog: pytest.LogCaptureFixture,
) -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"Logged"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="route-secret-key",
        base_url="https://openrouter.icu/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    caplog.set_level(
        logging.WARNING,
        logger="app.modules.script_engine.llm_adapter",
    )

    result = adapter.generate_structured_output(
        "PRIVATE STORY PROMPT",
        strategy=strategy,
    )

    assert result["title"] == "Logged"
    logs = caplog.text
    assert "LLM route request started" in logs
    assert "LLM route request finished" in logs
    assert "gateway=openrouter.icu" in logs
    assert "model=glm-5.2" in logs
    assert "transport=non_stream" in logs
    assert "status_code=200" in logs
    assert "duration_seconds=" in logs
    assert "content_chars=18" in logs
    assert "route-secret-key" not in logs
    assert "PRIVATE STORY PROMPT" not in logs


def test_route_diagnostics_identify_reasoning_only_empty_response(
    caplog: pytest.LogCaptureFixture,
) -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    reasoning = "先完成内部推理，但没有来得及输出最终 JSON。"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "reasoning_content": reasoning,
                        },
                        "finish_reason": "length",
                    }
                ]
            },
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://tokenadvent.com/v1",
        max_retries=0,
        retry_empty_response=False,
        transport=httpx.MockTransport(handler),
    )
    caplog.set_level(
        logging.WARNING,
        logger="app.modules.script_engine.llm_adapter",
    )

    with pytest.raises(LLMStructuredOutputError) as exc_info:
        adapter.generate_structured_output(
            "Return one JSON object.",
            strategy=strategy,
        )

    assert exc_info.value.empty_response is True
    assert getattr(exc_info.value, "reasoning_characters", 0) == len(reasoning)
    assert exc_info.value.stream_termination == "finish_reason:length"
    logs = caplog.text
    assert "gateway=tokenadvent.com" in logs
    assert "content_chars=0" in logs
    assert f"reasoning_chars={len(reasoning)}" in logs
    assert "finish_reason=length" in logs
    assert "LLM route output rejected" in logs
    assert "category=empty_response" in logs


def test_route_diagnostics_log_timeout_category(
    caplog: pytest.LogCaptureFixture,
) -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("upstream read timed out", request=request)

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://rehdasu.cn",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    caplog.set_level(
        logging.WARNING,
        logger="app.modules.script_engine.llm_adapter",
    )

    with pytest.raises(LLMRequestError):
        adapter.generate_structured_output(
            "Return one JSON object.",
            strategy=strategy,
        )

    logs = caplog.text
    assert "gateway=rehdasu.cn" in logs
    assert "outcome=failure" in logs
    assert "category=timeout" in logs
    assert "will_retry=false" in logs


def test_provider_gateway_deadline_uses_bounded_same_route_retries() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            524,
            json={"error": {"message": "provider gateway deadline"}},
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="gpt-screenplay-editor",
        api_key="secret-key",
        base_url="https://rehdasu.cn/v1",
        max_retries=3,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMRequestError, match="provider gateway deadline") as exc_info:
        adapter.generate_structured_output(
            "Return one JSON object.",
            strategy=strategy,
        )

    # max_retries=3 permits the initial request plus three bounded retries.
    assert request_count == 4
    assert exc_info.value.status_code == 524
    assert exc_info.value.category == "provider_gateway"


def test_route_diagnostics_log_failover_gateway_pair(
    caplog: pytest.LogCaptureFixture,
) -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    primary = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="primary-secret",
        base_url="https://primary.test/v1",
        max_retries=0,
        retry_empty_response=False,
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json={"choices": []})
        ),
    )
    fallback = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="fallback-secret",
        base_url="https://fallback.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                json=build_openai_compatible_response('{"title":"Recovered"}'),
            )
        ),
    )
    adapter = ModelFailoverLLMAdapter(primary=primary, fallback=fallback)
    caplog.set_level(
        logging.WARNING,
        logger="app.modules.script_engine.llm_adapter",
    )

    result = adapter.generate_structured_output(
        "Return one JSON object.",
        strategy=strategy,
    )

    assert result["title"] == "Recovered"
    logs = caplog.text
    assert "LLM route failover selected" in logs
    assert "from_gateway=primary.test" in logs
    assert "to_gateway=fallback.test" in logs
    assert "primary-secret" not in logs
    assert "fallback-secret" not in logs


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


def test_real_llm_adapter_supports_responses_wire_api() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        payload = json.loads(request.content.decode("utf-8"))
        assert "messages" not in payload
        assert payload["reasoning"] == {"effort": "medium"}
        assert payload["text"]["format"]["type"] == "json_schema"
        assert payload["text"]["format"]["schema"]["required"] == ["title"]
        return httpx.Response(
            200,
            json=build_responses_api_response('{"title":"Responses Title"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="kimi-k3",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        reasoning_effort="medium",
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Responses Title"
    assert result["_meta"]["response_id"] == "resp_test"
    assert result["_meta"]["usage"]["total_tokens"] == 100


def test_responses_empty_payload_gets_one_bounded_protocol_retry() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        if request_count == 1:
            return httpx.Response(200, json={"id": "resp_empty", "output": []})
        return httpx.Response(
            200,
            json=build_responses_api_response('{"title":"Recovered"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Recovered"
    assert request_count == 2


def test_responses_dynamic_object_schema_uses_stringified_strict_mode() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["text"]["format"]["type"] == "json_schema"
        fields_schema = payload["text"]["format"]["schema"]["$defs"][
            "StoryBibleInteractiveCandidate"
        ]["properties"]["fields"]
        assert fields_schema["type"] == "string"
        assert "JSON-encoded" in payload["input"][-1]["content"]
        return httpx.Response(
            200,
            json=build_responses_api_response(
                '{"step":"premise","question":"选择故事核心？",'
                '"candidates":[{"candidate_id":"a","title":"甲",'
                '"summary":"方案甲","fields":"{\\"premise\\":\\"x\\"}"},'
                '{"candidate_id":"b","title":"乙",'
                '"summary":"方案乙","fields":"{\\"premise\\":\\"y\\"}"},'
                '{"candidate_id":"c","title":"丙",'
                '"summary":"方案丙","fields":"{\\"premise\\":\\"z\\"}"},'
                '{"candidate_id":"d","title":"丁",'
                '"summary":"方案丁","fields":"{\\"premise\\":\\"w\\"}"}]}',
            ),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="gpt-5.6-sol",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        reasoning_effort="high",
        transport=httpx.MockTransport(handler),
    )

    schema = StoryBibleInteractiveStepOutput.model_json_schema()
    result = adapter.generate_structured_output(
        "Return four interactive planning candidates.",
        strategy=strategy,
        output_schema=schema,
    )

    assert len(result["candidates"]) == 4
    assert result["candidates"][0]["fields"] == {"premise": "x"}


def test_responses_nested_wrapper_text_is_extractable() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "response": {
                    "output": [
                        {"content": [{"type": "output_text", "text": '{"title":"Nested"}'}]}
                    ]
                }
            },
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Nested"


def test_responses_prefers_convenience_output_text_without_duplicate_parsing() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "output_text": '{"title":"Direct"}',
                "output": [
                    {"content": [{"type": "output_text", "text": '{"title":"Direct"}'}]}
                ],
            },
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Direct"


def test_responses_refusal_is_not_retried_as_an_empty_payload() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            200,
            json={
                "output": [
                    {"content": [{"type": "refusal", "refusal": "内容不可用"}]}
                ]
            },
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError, match="refusal") as raised:
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        )

    assert raised.value.refusal == "内容不可用"
    assert request_count == 1


def test_json_parser_accepts_safe_python_literal_object_from_gateway() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=build_openai_compatible_response(
                "模型说明：\n{'title': '兼容标题', 'enabled': True}"
            ),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "enabled": {"type": "boolean"},
            },
        },
    )

    assert result["title"] == "兼容标题"
    assert result["enabled"] is True


def test_real_llm_adapter_streams_responses_output_deltas() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_deltas: list[tuple[str, bool]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["stream"] is True
        events = [
            {"type": "response.created", "response": {"id": "resp_stream"}},
            {"type": "response.output_text.delta", "delta": '{"title":'},
            {"type": "response.output_text.delta", "delta": '"流式标题"}'},
            {
                "type": "response.completed",
                "response": {
                    "id": "resp_stream",
                    "usage": {"input_tokens": 10, "output_tokens": 6},
                },
            },
        ]
        body = "".join(
            f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            for event in events
        ) + "data: [DONE]\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output_stream(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        on_delta=lambda delta, reset: seen_deltas.append((delta, reset)),
    )

    assert result["title"] == "流式标题"
    assert result["_meta"]["streamed"] is True
    assert result["_meta"]["response_id"] == "resp_stream"
    assert result["_meta"]["usage"]["output_tokens"] == 6
    assert seen_deltas == [('{"title":"流式标题"}', True)]


@pytest.mark.parametrize("wire_api", ["responses", "chat_completions"])
def test_stream_stops_at_provider_terminal_without_waiting_for_socket_close(wire_api):
    strategy = GenerationStrategy.model_validate(build_strategy())
    closed = []
    calls = []
    seen = []
    if wire_api == "responses":
        expected_usage = {"input_tokens": 10, "output_tokens": 6}
        events = [
            {"type": "response.output_text.delta", "delta": '{"title":"Ready"}'},
            {"type": "response.completed", "response": {
                "id": "resp_terminal", "usage": {"input_tokens": 10, "output_tokens": 6},
            }},
        ]
    else:
        expected_usage = {"prompt_tokens": 10, "completion_tokens": 6}
        events = [
            {"id": "chat_terminal", "choices": [{"delta": {"content": '{"title":"Ready"}'}, "finish_reason": None}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 6}},
            "[DONE]",
        ]

    class KeepOpenStream(httpx.SyncByteStream):
        def __iter__(self):
            for event in events:
                data = event if isinstance(event, str) else json.dumps(event)
                yield f"data: {data}\n\n".encode()
            raise AssertionError("Read beyond terminal into a connection kept open by the gateway")

        def close(self):
            closed.append(True)

    def handler(request):
        calls.append(request)
        return httpx.Response(200, stream=KeepOpenStream(), headers={"content-type": "text/event-stream"})

    adapter = RealLLMAdapter(
        provider="openai_compatible", model_name="script-model", api_key="test-key",
        base_url="https://example.test/v1", wire_api=wire_api, max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    result = adapter.generate_structured_output_stream(
        "Return JSON.", strategy=strategy,
        on_delta=lambda delta, reset: seen.append((delta, reset)),
    )
    assert result["title"] == "Ready"
    assert result["_meta"]["response_id"] == ("resp_terminal" if wire_api == "responses" else "chat_terminal")
    assert result["_meta"]["usage"] == expected_usage
    assert result["_meta"]["stream_termination"] == "completed"
    assert seen == [('{"title":"Ready"}', True)]
    assert closed == [True]
    assert len(calls) == 1


@pytest.mark.parametrize("status", ["failed", "incomplete", "cancelled"])
def test_failed_terminal_never_accepts_parseable_json_or_reads_past_terminal(status, caplog):
    strategy = GenerationStrategy.model_validate(build_strategy())
    closed = []
    calls = []

    class FailedStream(httpx.SyncByteStream):
        def __iter__(self):
            yield b'data: {"type":"response.output_text.delta","delta":"{\\"title\\":\\"Partial\\"}"}\n\n'
            event = {"type": f"response.{status}", "response": {"status": status}}
            yield f"data: {json.dumps(event)}\n\n".encode()
            raise AssertionError("Read past failed terminal event")

        def close(self):
            closed.append(True)

    def handler(request):
        calls.append(request)
        return httpx.Response(200, stream=FailedStream(), headers={"content-type": "text/event-stream"})

    adapter = RealLLMAdapter(
        provider="openai_compatible", model_name="script-model", api_key="test-key",
        base_url="https://example.test/v1", wire_api="responses", max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    caplog.set_level(logging.WARNING, logger="app.modules.script_engine.llm_adapter")
    with pytest.raises(LLMStructuredOutputError) as raised:
        adapter.generate_structured_output_stream("Return JSON.", strategy=strategy)
    assert json.loads(raised.value.raw_content) == {"title": "Partial"}
    assert raised.value.stream_termination == f"response.{status}:{status}"
    assert "outcome=success" not in caplog.text
    assert closed == [True]
    assert len(calls) == 1


def test_streaming_structured_error_records_json_position_and_incomplete_reason() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(_request: httpx.Request) -> httpx.Response:
        events = [
            {"type": "response.output_text.delta", "delta": '{\n  "title": ,\n  "scenes": []'},
            {
                "type": "response.incomplete",
                "response": {
                    "id": "resp_incomplete",
                    "status": "incomplete",
                    "incomplete_details": {"reason": "max_output_tokens"},
                },
            },
        ]
        body = "".join(
            f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            for event in events
        ) + "data: [DONE]\n\n"
        return httpx.Response(
            200,
            text=body,
            headers={"content-type": "text/event-stream"},
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError) as exc_info:
        adapter.generate_structured_output_stream(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "scenes": {"type": "array"},
                },
                "required": ["title", "scenes"],
            },
        )

    error = exc_info.value
    assert error.json_error_line == 2
    assert error.json_error_column == 12
    assert error.stream_termination == (
        "response.incomplete:incomplete:max_output_tokens"
    )


def test_streaming_structured_error_records_missing_terminal_event() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(_request: httpx.Request) -> httpx.Response:
        event = {
            "type": "response.output_text.delta",
            "delta": '{"title":',
        }
        body = f"data: {json.dumps(event)}\n\ndata: [DONE]\n\n"
        return httpx.Response(
            200,
            text=body,
            headers={"content-type": "text/event-stream"},
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError) as exc_info:
        adapter.generate_structured_output_stream(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {"title": {"type": "string"}},
                "required": ["title"],
            },
        )

    assert (
        exc_info.value.stream_termination
        == "stream_ended_without_terminal_event"
    )


def test_json_object_responses_transport_receives_native_shape_contract() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["text"]["format"] == {"type": "json_object"}
        prompt = payload["input"][1]["content"]
        assert "JSON OUTPUT SHAPE CONTRACT" in prompt
        assert '"children":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"}}}}' in prompt
        return httpx.Response(
            200,
            json=build_responses_api_response(
                '{"children":[{"title":"第一阶段"}]}'
            ),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        use_strict_schema=False,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a roadmap envelope.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {
                "children": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"title": {"type": "string"}},
                    },
                }
            },
            "required": ["children"],
        },
    )

    assert result["children"][0]["title"] == "第一阶段"


def test_real_llm_adapter_falls_back_when_gateway_rejects_streaming() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_deltas: list[tuple[str, bool]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        if payload.get("stream") is True:
            return httpx.Response(400, json={"error": {"message": "stream unsupported"}})
        return httpx.Response(
            200,
            json=build_responses_api_response('{"title":"同步回退"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="compatible-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output_stream(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        on_delta=lambda delta, reset: seen_deltas.append((delta, reset)),
    )

    assert result["title"] == "同步回退"
    assert result["_meta"]["stream_fallback"] is True
    assert seen_deltas == [('{"title": "同步回退"}', True)]


@pytest.mark.parametrize("error_type", [httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout])
def test_connection_failure_keeps_configured_retries_without_nonstream_replay(error_type, monkeypatch):
    monkeypatch.setattr(time, "sleep", lambda _: None)
    requests = []
    def handler(request):
        requests.append(json.loads(request.content).get("stream"))
        raise error_type("connection unavailable", request=request)
    adapter = RealLLMAdapter(provider="openai_compatible", model_name="compatible-model",
        api_key="secret-key", base_url="https://example.test/v1", wire_api="responses",
        max_retries=1, transport=httpx.MockTransport(handler))
    with pytest.raises(LLMRequestError) as failure:
        adapter.generate_structured_output_stream("Return a structured draft.",
            strategy=GenerationStrategy.model_validate(build_strategy()), output_schema={"type":"object"})
    assert isinstance(failure.value.__cause__, error_type)
    assert requests == [True, True]


def test_connection_failure_allows_configured_outer_route_to_recover():
    requests=[]
    def unavailable(request):
        requests.append(("primary", json.loads(request.content).get("stream")))
        raise httpx.ConnectError("DNS unavailable", request=request)
    def available(request):
        requests.append(("fallback", json.loads(request.content).get("stream")))
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"{\\"title\\":\\"可用线路\\"}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            headers={"content-type":"text/event-stream"})
    def route(handler, host):
        return RealLLMAdapter(provider="openai_compatible", model_name="compatible-model", api_key="secret-key",
            base_url=f"https://{host}.test/v1", max_retries=0, transport=httpx.MockTransport(handler))
    adapter=ModelFailoverLLMAdapter(primary=route(unavailable,"primary"),fallback=route(available,"fallback"))
    result=adapter.generate_structured_output_stream("Return a structured draft.",
        strategy=GenerationStrategy.model_validate(build_strategy()),output_schema={"type":"object"})
    assert result["title"] == "可用线路"
    assert requests == [("primary", True), ("fallback", True)]


def test_real_llm_adapter_does_not_repeat_a_timed_out_stream_as_non_streaming() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        payload = json.loads(request.content.decode("utf-8"))
        if payload.get("stream") is True:
            raise httpx.ReadTimeout("timed out", request=request)
        return httpx.Response(
            200,
            json=build_responses_api_response('{"title":"不应执行的同步回退"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="compatible-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMRequestError, match="timed out"):
        adapter.generate_structured_output_stream(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        )

    assert request_count == 1


@pytest.mark.parametrize("event_type", ["response.failed", None])
def test_explicit_provider_failure_skips_same_route_retries_and_uses_configured_fallback(event_type) -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        requests.append(payload.get("stream"))
        event = {"response": {"status": "failed"}}
        if event_type:
            event["type"] = event_type
        return httpx.Response(200, text="data: " + json.dumps(event) + "\n\n",
                              headers={"content-type": "text/event-stream"})

    primary = RealLLMAdapter(
        provider="openai_compatible", model_name="failed-planning-model", api_key="test-key",
        base_url="https://example.test/v1", wire_api="responses", max_retries=3,
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(LLMRequestError, match="Provider reported a failed generation") as caught:
        primary.generate_structured_output_stream("Return complete JSON.", strategy=strategy)
    assert requests == [True]
    assert caught.value.category == "provider_generation"
    assert caught.value.recoverable is True

    fallback_calls = []

    class CompleteFallback(MockLLMAdapter):
        def generate_structured_output_stream(self, *args, **kwargs):
            fallback_calls.append(1)
            return {"title": "完整备用结果", "_meta": {}}

    requests.clear()
    routed = ModelFailoverLLMAdapter(primary=primary, fallback=CompleteFallback())
    result = routed.generate_structured_output_stream("Return complete JSON.", strategy=strategy)
    assert result["title"] == "完整备用结果"
    assert requests == [True]
    assert fallback_calls == [1]


def test_real_llm_adapter_supports_json_object_mode() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["response_format"] == {"type": "json_object"}
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"JSON Object Title"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="kimi-k3",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="chat_completions",
        use_strict_schema=False,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a JSON object matching the supplied schema.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "JSON Object Title"


@pytest.mark.parametrize("model", ["deepseek-v4-flash", "deepseek-reasoner"])
def test_deepseek_uses_chat_json_contract_and_explicit_thinking(model: str) -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    schema = {
        "$defs": {
            "Child": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "title": {"type": "string"},
                },
                "required": ["id", "title"],
            }
        },
        "type": "object",
        "properties": {
            "children": {
                "type": "array",
                "minItems": 2,
                "items": {"$ref": "#/$defs/Child"},
            }
        },
        "required": ["children"],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload.get("response_format") == (
            {"type": "json_object"} if model == "deepseek-v4-flash" else None
        )
        assert payload["thinking"] == {"type": "enabled"}
        assert payload["reasoning_effort"] == "high"
        assert "temperature" not in payload
        assert "top_p" not in payload
        prompt = payload["messages"][1]["content"]
        assert "DEEPSEEK JSON OUTPUT CONTRACT" in prompt
        assert '"children":{"type":"array","minItems":2,"items":{"$ref":"#/$defs/Child"}}' in prompt
        return httpx.Response(
            200,
            json=build_openai_compatible_response(
                '{"children":[{"id":"one","title":"一"},'
                '{"id":"two","title":"二"}]}'
            ),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name=model,
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="chat_completions",
        reasoning_effort="high",
        thinking_mode="enabled",
        use_strict_schema=True,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Generate the requested story plan.",
        strategy=strategy,
        output_schema=schema,
    )

    assert adapter._wire_api == "chat_completions"
    assert adapter._use_strict_schema is False
    assert len(result["children"]) == 2
    assert result["_meta"]["thinking_mode"] == "enabled"


def test_glm_chat_uses_native_json_object_and_explicit_thinking_toggle() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["thinking"] == {"type": "disabled"}
        assert payload["response_format"] == {"type": "json_object"}
        assert payload["reasoning_effort"] == "none"
        assert payload["temperature"] == strategy.temperature
        assert payload["top_p"] == strategy.top_p
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"GLM路线图"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="chat_completions",
        thinking_mode="disabled",
        use_strict_schema=True,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return the episode roadmap JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert adapter._is_glm is True
    assert adapter._use_strict_schema is False
    assert result["title"] == "GLM路线图"
    assert result["_meta"]["thinking_mode"] == "disabled"


def test_qwen_chat_uses_compatible_thinking_transport() -> None:
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="qwen3.8-max",
        api_key="test-key",
        base_url="https://qwen.example/v1",
        wire_api="chat_completions",
        reasoning_effort="high",
        thinking_mode="enabled",
        send_response_format=False,
    )

    payload = adapter._build_chat_payload(
        prompt="Market path: cn_mainland\nReturn JSON.",
        strategy=GenerationStrategy.model_validate(build_strategy()),
        output_schema={"type": "object", "properties": {"answer": {"type": "string"}}},
    )

    assert payload["model"] == "qwen3.8-max"
    assert payload["thinking"] == {"type": "enabled"}
    assert payload["reasoning_effort"] == "high"
    assert payload["temperature"] == 0.7
    assert "response_format" not in payload


def test_qwen_disabled_thinking_forces_reasoning_off() -> None:
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="qwen3.8-max",
        api_key="test-key",
        base_url="https://qwen.example/v1",
        wire_api="chat_completions",
        reasoning_effort="low",
        thinking_mode="disabled",
        send_response_format=False,
    )

    payload = adapter._build_chat_payload(
        prompt="Market path: cn_mainland\nReturn JSON.",
        strategy=GenerationStrategy.model_validate(build_strategy()),
        output_schema=None,
    )

    assert payload["thinking"] == {"type": "disabled"}
    assert payload["reasoning_effort"] == "none"


def test_deepseek_story_tree_shape_uses_native_objects_and_valid_semantic_examples() -> None:
    shape = RealLLMAdapter._json_shape_example(
        StoryPlanNodeDecompositionOutput.model_json_schema()
    )

    assert len(shape["children"]) == 2
    assert all(isinstance(child, dict) for child in shape["children"])
    first = shape["children"][0]
    assert first["recommended_next_step"] == "episode_ready"
    assert first["planned_start_episode"] == 1
    assert first["planned_end_episode"] == 8
    assert len(first["unit_story_beats"]) == 4
    assert first["unit_resolution"]
    assert first["handoff_pressure"]


def test_deepseek_accepts_string_wrapped_parsed_object_from_compatible_gateway() -> None:
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
    )
    content = json.dumps(
        json.dumps({"children": [{"title": "第一阶段"}]}, ensure_ascii=False),
        ensure_ascii=False,
    )

    parsed = adapter._extract_structured_output(
        {"choices": [{"message": {"parsed": content}}]},
        output_schema=StoryPlanNodeDecompositionOutput.model_json_schema(),
    )

    assert parsed == {"children": [{"title": "第一阶段"}]}


def test_deepseek_non_thinking_repair_keeps_sampling_controls() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["thinking"] == {"type": "disabled"}
        assert payload["temperature"] == strategy.temperature
        assert payload["top_p"] == strategy.top_p
        assert "reasoning_effort" not in payload
        assert payload["response_format"] == {"type": "json_object"}
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"已修复"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
        thinking_mode="disabled",
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Repair this JSON object.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "已修复"
    assert result["_meta"]["thinking_mode"] == "disabled"


def test_deepseek_retries_one_documented_empty_json_response() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(request.content.decode("utf-8")))
        content = "" if len(payloads) == 1 else '{"title":"第二次成功"}'
        return httpx.Response(200, json=build_openai_compatible_response(content))

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return the story JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "第二次成功"
    assert len(payloads) == 2
    assert "previous JSON Output response was empty" in payloads[1]["messages"][-1]["content"]


def test_compatible_adapter_does_not_repeat_an_empty_structured_response() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(200, json=build_openai_compatible_response(""))

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError) as error:
        adapter.generate_structured_output(
            "Return the Episode roadmap JSON.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {"episode_plans": {"type": "array", "items": {}}},
            },
        )

    assert error.value.raw_content == ""
    assert len(payloads) == 1


def test_responses_adapter_can_disable_its_internal_empty_response_retry() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(request.content.decode("utf-8")))
        return httpx.Response(200, json={"id": "empty", "output": []})

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        retry_empty_response=False,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError):
        adapter.generate_structured_output(
            "Return one episode roadmap JSON object.",
            strategy=strategy,
            output_schema=None,
        )

    assert len(payloads) == 1


def test_real_llm_adapter_decodes_nested_structured_containers() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="planning-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json=build_openai_compatible_response(
                    r'''{"episode_plans":["{\"episode_number\":1,\"episode_goal\":\"推进\"}", "{'episode_number': 2, 'episode_goal': '反转'}"]}'''
                ),
            )
        ),
    )

    result = adapter.generate_structured_output(
        "Return the Episode roadmap JSON.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {"episode_plans": {"type": "array", "items": {}}},
        },
    )

    assert result["episode_plans"] == [
        {"episode_number": 1, "episode_goal": "推进"},
        {"episode_number": 2, "episode_goal": "反转"},
    ]


def test_real_llm_adapter_decodes_string_items_in_top_level_collection() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="planning-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json=build_openai_compatible_response(
                    r'''["{\"title\":\"第一阶段\"}", "{'title': '第二阶段'}"]'''
                ),
            )
        ),
    )

    result = adapter.generate_structured_output(
        "Return child stages.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {"children": {"type": "array", "items": {}}},
        },
    )

    assert result["children"] == [{"title": "第一阶段"}, {"title": "第二阶段"}]


def test_responses_adapter_regenerates_non_native_schema_containers() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    requests: list[dict] = []
    schema = {
        "title": "EpisodePlanBatchGenerationOutput",
        "$defs": {
            "Episode": {
                "type": "object",
                "properties": {
                    "episode_number": {"type": "integer"},
                    "episode_goal": {"type": "string"},
                },
                "required": ["episode_number", "episode_goal"],
            }
        },
        "type": "object",
        "properties": {
            "episode_plans": {
                "type": "array",
                "items": {"$ref": "#/$defs/Episode"},
            }
        },
        "required": ["episode_plans"],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(json.loads(request.content.decode("utf-8")))
        content = (
            '{"episode_plans":["第1集计划","第2集计划"]}'
            if len(requests) == 1
            else '{"episode_plans":[{"episode_number":1,"episode_goal":"推进"},'
            '{"episode_number":2,"episode_goal":"反转"}]}'
        )
        return httpx.Response(200, json=build_responses_api_response(content))

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    result = adapter.generate_structured_output(
        "Return the Episode roadmap.",
        strategy=strategy,
        output_schema=schema,
    )

    assert [item["episode_number"] for item in result["episode_plans"]] == [1, 2]
    assert len(requests) == 2
    response_format = requests[0]["text"]["format"]
    assert response_format["name"] == "episodeplanbatchgenerationoutput"
    assert "$defs" not in response_format["schema"]
    retry_text = requests[1]["input"][-1]["content"][0]["text"]
    assert "Never place an object or array inside a quoted string" in retry_text


def test_container_repair_rejects_nested_fragment_response() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "scenes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"scene_number": {"type": "integer"}},
                    "required": ["scene_number"],
                },
            },
        },
        "required": ["title", "scenes"],
    }

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        content = (
            '{"title":"正文","scenes":"错误数组"}'
            if request_count == 1
            else '{"scene_number":1,"slug":"错误降级片段"}'
        )
        return httpx.Response(200, json=build_openai_compatible_response(content))

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        use_strict_schema=False,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError, match="wrong schema root"):
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema=schema,
        )

    assert request_count == 2


def test_deepseek_script_route_defers_unambiguous_container_repair() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "scenes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"scene_number": {"type": "integer"}},
                    "required": ["scene_number"],
                },
            },
        },
        "required": ["title", "scenes"],
    }

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            200,
            json=build_openai_compatible_response(
                '{"title":"正文","scenes":"待正文合同修复"}'
            ),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
        use_strict_schema=False,
        defer_schema_container_repair=True,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema=schema,
    )

    assert request_count == 1
    assert result["title"] == "正文"
    assert result["_meta"]["schema_container_repair_deferred"] is True
    assert result["_meta"]["schema_container_issues"] == [
        "$.scenes: expected array, got str"
    ]


def test_adapter_normalizes_scalar_array_without_model_round_trip() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0
    schema = {
        "type": "object",
        "properties": {
            "children": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["children"],
    }

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"children":"阶段一"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        use_strict_schema=False,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return child stages.",
        strategy=strategy,
        output_schema=schema,
    )

    assert request_count == 1
    assert result["children"] == ["阶段一"]
    assert result["_meta"]["schema_container_locally_normalized"] is True


@pytest.mark.parametrize("streaming", [False, True])
def test_valid_nullable_continuity_patch_does_not_trigger_model_repair(streaming) -> None:
    schema = LLMContinuityRepairPatch.model_json_schema()
    payload = {"scenes": [], "continuation_hook": None}
    LLMContinuityRepairPatch.model_validate(payload)
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        assert request_count == 1, "A valid null patch must not be regenerated."
        if json.loads(request.content).get("stream"):
            event = json.dumps({"type": "response.output_text.delta", "delta": json.dumps(payload)})
            return httpx.Response(200, text=f"data: {event}\n\ndata: [DONE]\n\n",
                                  headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json=build_responses_api_response(json.dumps(payload)))

    adapter = RealLLMAdapter(
        provider="openai_compatible", model_name="script-model", api_key="secret-key",
        base_url="https://example.test/v1", wire_api="responses", max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    kwargs = {"strategy": GenerationStrategy.model_validate(build_strategy()), "output_schema": schema}
    if streaming:
        result = adapter.generate_structured_output_stream("Repair only the listed conflicts.", **kwargs,
                                                          on_delta=lambda delta, reset: None)
    else:
        result = adapter.generate_structured_output("Repair only the listed conflicts.", **kwargs)
    assert result["continuation_hook"] is None
    assert result["scenes"] == []
    assert request_count == 1


def test_nullable_array_stays_null_in_container_normalization() -> None:
    schema = {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]}
    assert RealLLMAdapter._normalize_schema_container_shape(None, schema, root_schema=schema) == (None, False)
    assert RealLLMAdapter._schema_container_issues(None, schema, root_schema=schema) == []


def test_streaming_adapter_regenerates_non_native_schema_containers() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0
    deltas: list[tuple[str, bool]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        payload = json.loads(request.content.decode("utf-8"))
        if payload.get("stream"):
            body = (
                'data: {"type":"response.output_text.delta","delta":"{\\"children\\":[\\"阶段一\\",\\"阶段二\\"]}"}\n\n'
                "data: [DONE]\n\n"
            )
            return httpx.Response(
                200,
                text=body,
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            json=build_responses_api_response(
                '{"children":[{"title":"阶段一"},{"title":"阶段二"}]}'
            ),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    result = adapter.generate_structured_output_stream(
        "Return child stages.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {
                "children": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"title": {"type": "string"}},
                    },
                }
            },
        },
        on_delta=lambda delta, reset: deltas.append((delta, reset)),
    )

    assert result["children"] == [{"title": "阶段一"}, {"title": "阶段二"}]
    assert request_count == 2
    assert deltas[-1][1] is True


def test_deepseek_stream_ignores_reasoning_content() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_deltas: list[tuple[str, bool]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        assert payload["stream"] is True
        events = [
            {"choices": [{"delta": {"reasoning_content": "internal reasoning"}}]},
            {"choices": [{"delta": {"content": '{"title":'}}]},
            {"choices": [{"delta": {"content": '"流式正文"}'}}]},
        ]
        body = "".join(f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in events)
        body += "data: [DONE]\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
        thinking_mode="enabled",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output_stream(
        "Return the story JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        on_delta=lambda delta, reset: seen_deltas.append((delta, reset)),
    )

    assert result["title"] == "流式正文"
    assert seen_deltas == [('{"title":"流式正文"}', True)]


def test_streaming_adapter_reads_provider_error_and_retries_502() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        if request_count == 1:
            return httpx.Response(
                502,
                json={"error": {"message": "temporary upstream failure"}},
            )
        return httpx.Response(
            200,
            text='data: {"choices":[{"delta":{"content":"{\\"title\\":\\"恢复成功\\"}"}}]}\n\n'
            "data: [DONE]\n\n",
            headers={"content-type": "text/event-stream"},
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=1,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output_stream(
        "Return the script JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "恢复成功"
    assert request_count == 2


def test_streaming_adapter_changes_to_non_streaming_after_gateway_502() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_stream_modes: list[bool] = []
    seen_deltas: list[tuple[str, bool]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        streaming = payload.get("stream") is True
        seen_stream_modes.append(streaming)
        if streaming:
            return httpx.Response(
                502,
                json={"error": {"message": "SSE route temporarily unavailable"}},
            )
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"非流式恢复成功"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output_stream(
        "Return the script JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        on_delta=lambda delta, reset: seen_deltas.append((delta, reset)),
    )

    assert result["title"] == "非流式恢复成功"
    assert result["_meta"]["stream_fallback"] is True
    assert seen_stream_modes == [True, False]
    assert seen_deltas == [('{"title": "非流式恢复成功"}', True)]


def test_script_route_skips_same_gateway_after_upstream_502() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            502,
            json={"error": {"message": "Upstream access forbidden"}},
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
        retry_gateway_stream_as_non_stream=False,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMRequestError, match="Upstream access forbidden") as exc_info:
        adapter.generate_structured_output_stream(
            "Return the script JSON.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {"title": {"type": "string"}},
            },
        )

    assert request_count == 1
    assert not getattr(exc_info.value, "stream_fallback_attempted", False)


def test_reasoning_only_length_stream_fails_over_without_same_route_repeat() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    primary_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal primary_calls
        primary_calls += 1
        payload = json.loads(request.content.decode("utf-8"))
        assert payload.get("stream") is True
        events = [
            {"choices": [{"delta": {"reasoning_content": "持续推理却没有输出正文"}}]},
            {"choices": [{"delta": {}, "finish_reason": "length"}]},
        ]
        body = "".join(
            f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            for event in events
        ) + "data: [DONE]\n\n"
        return httpx.Response(
            200,
            text=body,
            headers={"content-type": "text/event-stream"},
        )

    primary = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="primary-key",
        base_url="https://primary.test/v1",
        thinking_mode="disabled",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    adapter = ModelFailoverLLMAdapter(
        primary=primary,
        fallback=MockLLMAdapter(model_name="deepseek-v4-flash"),
        circuit_failure_threshold=1,
    )

    result = adapter.generate_structured_output_stream(
        "Return the screenplay JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert primary_calls == 1
    assert result["_meta"]["model_failover_used"] is True
    assert result["_meta"]["fallback_model_name"] == "deepseek-v4-flash"


def test_deepseek_adaptive_transport_prefers_non_stream_after_repeated_reasoning_length() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_stream_modes: list[bool] = []
    seen_reasoning: list[tuple[str | None, str | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        streaming = payload.get("stream") is True
        seen_stream_modes.append(streaming)
        seen_reasoning.append((
            payload.get("reasoning_effort"),
            (payload.get("thinking") or {}).get("type"),
        ))
        if streaming:
            events = [
                {"choices": [{"delta": {"reasoning_content": "持续高强度推理"}}]},
                {"choices": [{"delta": {}, "finish_reason": "length"}]},
            ]
            body = "".join(
                f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                for event in events
            ) + "data: [DONE]\n\n"
            return httpx.Response(
                200,
                text=body,
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"非流式正文"}'),
        )

    route = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://adaptive-deepseek.test/v1",
        reasoning_effort="high",
        thinking_mode="enabled",
        retry_gateway_stream_as_non_stream=False,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    adapter = AdaptiveTransportLLMAdapter(
        adapter=route,
        failure_threshold=2,
        cooldown_seconds=900,
    )
    schema = {"type": "object", "properties": {"title": {"type": "string"}}}

    with pytest.raises(LLMRequestError, match="did not contain output text"):
        adapter.generate_structured_output_stream(
            "Return the screenplay JSON.",
            strategy=strategy,
            output_schema=schema,
        )
    second = adapter.generate_structured_output_stream(
        "Return the screenplay JSON.",
        strategy=strategy,
        output_schema=schema,
    )
    third = adapter.generate_structured_output_stream(
        "Return the next screenplay JSON.",
        strategy=strategy,
        output_schema=schema,
    )

    assert second["title"] == "非流式正文"
    assert second["_meta"]["adaptive_transport"] == "non_stream"
    assert second["_meta"]["adaptive_transport_reason"] == (
        "repeated_reasoning_length"
    )
    assert third["_meta"]["adaptive_transport_reason"] == (
        "reasoning_length_circuit"
    )
    assert seen_stream_modes == [True, True, False, False]
    assert seen_reasoning == [("high", "enabled")] * 4


def test_deepseek_hedged_child_does_not_append_a_non_stream_request() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_stream_modes: list[bool] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        streaming = payload.get("stream") is True
        seen_stream_modes.append(streaming)
        if streaming:
            events = [
                {"choices": [{"delta": {"reasoning_content": "持续高强度推理"}}]},
                {"choices": [{"delta": {}, "finish_reason": "length"}]},
            ]
            return httpx.Response(
                200,
                text="".join(
                    f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                    for event in events
                )
                + "data: [DONE]\n\n",
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"非流式恢复"}'),
        )

    adapter = AdaptiveTransportLLMAdapter(
        adapter=RealLLMAdapter(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
            api_key="secret-key",
            base_url="https://bounded-hedge.test/v1",
            reasoning_effort="high",
            thinking_mode="enabled",
            retry_gateway_stream_as_non_stream=False,
            max_retries=0,
            transport=httpx.MockTransport(handler),
        ),
        failure_threshold=1,
        cooldown_seconds=900,
    )
    schema = {"type": "object", "properties": {"title": {"type": "string"}}}

    with pytest.raises(LLMRequestError) as exc_info:
        adapter.generate_structured_output_stream_cancellable(
            "Return the screenplay JSON.",
            strategy=strategy,
            output_schema=schema,
            on_delta=None,
            cancel_event=threading.Event(),
        )

    assert getattr(
        exc_info.value,
        "hedged_route_transport_budget_exhausted",
        False,
    ) is True
    assert seen_stream_modes == [True]
    recovered = adapter.generate_structured_output_stream(
        "Return the screenplay JSON.",
        strategy=strategy,
        output_schema=schema,
    )
    assert recovered["title"] == "非流式恢复"
    assert seen_stream_modes == [True, False]


def test_deepseek_adaptive_transport_state_is_shared_across_script_roles() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_stream_modes: list[bool] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        streaming = payload.get("stream") is True
        seen_stream_modes.append(streaming)
        if streaming:
            events = [
                {"choices": [{"delta": {"reasoning_content": "持续高强度推理"}}]},
                {"choices": [{"delta": {}, "finish_reason": "length"}]},
            ]
            body = "".join(
                f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                for event in events
            ) + "data: [DONE]\n\n"
            return httpx.Response(
                200,
                text=body,
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"共享状态恢复"}'),
        )

    shared_state = AdaptiveTransportState()

    def role_adapter() -> AdaptiveTransportLLMAdapter:
        return AdaptiveTransportLLMAdapter(
            adapter=RealLLMAdapter(
                provider="openai_compatible",
                model_name="deepseek-v4-flash",
                api_key="role-key",
                base_url="https://shared-deepseek.test/v1",
                reasoning_effort="high",
                thinking_mode="enabled",
                retry_gateway_stream_as_non_stream=False,
                max_retries=0,
                transport=httpx.MockTransport(handler),
            ),
            failure_threshold=2,
            cooldown_seconds=900,
            state=shared_state,
        )

    draft_role = role_adapter()
    repair_role = role_adapter()
    schema = {"type": "object", "properties": {"title": {"type": "string"}}}

    with pytest.raises(LLMRequestError, match="did not contain output text"):
        draft_role.generate_structured_output_stream(
            "Return the screenplay JSON.",
            strategy=strategy,
            output_schema=schema,
        )
    recovered = repair_role.generate_structured_output_stream(
        "Repair the screenplay JSON.",
        strategy=strategy,
        output_schema=schema,
    )

    assert recovered["title"] == "共享状态恢复"
    assert recovered["_meta"]["adaptive_transport_reason"] == (
        "repeated_reasoning_length"
    )
    assert seen_stream_modes == [True, True, False]


def test_pooled_keys_do_not_repeat_model_level_reasoning_budget_exhaustion() -> None:
    request_count = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        events = [
            {"choices": [{"delta": {"reasoning_content": "持续推理"}}]},
            {"choices": [{"delta": {}, "finish_reason": "length"}]},
        ]
        return httpx.Response(
            200,
            text="".join(
                f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                for event in events
            ) + "data: [DONE]\n\n",
            headers={"content-type": "text/event-stream"},
        )

    adapter = PooledLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_keys=("key-one", "key-two"),
        base_url="https://pooled-adaptive.test/v1",
        reasoning_effort="high",
        thinking_mode="enabled",
        retry_gateway_stream_as_non_stream=False,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMRequestError) as exc_info:
        adapter.generate_structured_output_stream(
            "Return the screenplay JSON.",
            strategy=GenerationStrategy.model_validate(build_strategy()),
            output_schema={
                "type": "object",
                "properties": {"title": {"type": "string"}},
            },
        )

    assert request_count == 1
    assert getattr(exc_info.value, "pool_key_attempt_count") == 1


@pytest.mark.parametrize("max_retries", [0, 1, 3])
def test_reasoning_only_responses_budget_exhaustion_skips_nonstream_repeat(max_retries: int) -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        payload = json.loads(request.content.decode("utf-8"))
        assert payload.get("stream") is True
        events = [
            {
                "type": "response.reasoning_text.delta",
                "delta": "持续推理但没有生成结构化正文",
            },
            {
                "type": "response.incomplete",
                "response": {
                    "status": "incomplete",
                    "incomplete_details": {"reason": "max_output_tokens"},
                },
            },
        ]
        body = "".join(
            f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            for event in events
        ) + "data: [DONE]\n\n"
        return httpx.Response(
            200,
            text=body,
            headers={"content-type": "text/event-stream"},
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=max_retries,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMRequestError, match="did not contain output text"):
        adapter.generate_structured_output_stream(
            "Return the story-tree JSON.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {"children": {"type": "array"}},
            },
        )

    assert request_count == 1


def test_streaming_adapter_reports_502_detail_without_response_not_read() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                502,
                json={"error": {"message": "upstream model unavailable"}},
            )
        ),
    )

    with pytest.raises(
        LLMRequestError,
        match="status 502 after retries: upstream model unavailable",
    ) as exc_info:
        adapter.generate_structured_output_stream(
            "Return the script JSON.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {"title": {"type": "string"}},
            },
        )

    assert getattr(exc_info.value, "stream_fallback_attempted") is True


def test_streaming_provider_gateway_deadline_uses_bounded_transport_retries() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            524,
            json={"error": {"message": "provider gateway deadline"}},
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="gpt-screenplay-editor",
        api_key="secret-key",
        base_url="https://rehdasu.cn/v1",
        max_retries=3,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMRequestError, match="provider gateway deadline"):
        adapter.generate_structured_output_stream(
            "Return one JSON object.",
            strategy=strategy,
        )

    # The stream gets four bounded attempts, then the success-first transport
    # fallback gets four non-stream attempts on the same route.
    assert request_count == 8


def test_streaming_adapter_sanitizes_html_gateway_error_page() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                502,
                text="<!DOCTYPE html><html><head><title>502 Bad gateway</title></head></html>",
                headers={"content-type": "text/html; charset=UTF-8"},
            )
        ),
    )

    with pytest.raises(LLMRequestError) as exc_info:
        adapter.generate_structured_output_stream(
            "Return the script JSON.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {"title": {"type": "string"}},
            },
        )

    message = str(exc_info.value)
    assert "provider gateway returned an HTML error page" in message
    assert "DOCTYPE" not in message
    assert "<html" not in message


def test_streaming_pool_fails_over_to_second_key_after_502() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    authorization_headers: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        authorization = request.headers.get("authorization", "")
        authorization_headers.append(authorization)
        if authorization == "Bearer first-key":
            return httpx.Response(
                502,
                json={"error": {"message": "first route unavailable"}},
            )
        return httpx.Response(
            200,
            text='data: {"choices":[{"delta":{"content":"{\\"title\\":\\"第二通道成功\\"}"}}]}\n\n'
            "data: [DONE]\n\n",
            headers={"content-type": "text/event-stream"},
        )

    adapter = PooledLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_keys=("first-key", "second-key"),
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output_stream(
        "Return the script JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "第二通道成功"
    assert authorization_headers == [
        "Bearer first-key",
        "Bearer first-key",
        "Bearer second-key",
    ]


def test_pooled_adapter_bounds_gateway_outage_to_one_backup_key() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_authorizations: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_authorizations.append(request.headers["Authorization"])
        return httpx.Response(
            502,
            json={"error": {"message": "shared gateway unavailable"}},
        )

    adapter = PooledLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_keys=["script-key-1", "script-key-2", "script-key-3", "script-key-4"],
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMRequestError) as exc_info:
        adapter.generate_structured_output(
            "Return the script JSON.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        )

    assert seen_authorizations == ["Bearer script-key-1", "Bearer script-key-2"]
    assert getattr(exc_info.value, "pool_key_attempt_count") == 2


def test_model_failover_rebuilds_deepseek_chat_as_glm_responses_request() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    requests: list[tuple[str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        requests.append((str(request.url), payload))
        if request.url.host == "deepseek.test":
            return httpx.Response(
                502,
                json={"error": {"message": "deepseek route unavailable"}},
            )
        body = (
            'data: {"type":"response.output_text.delta","delta":"{\\"title\\":\\"GLM保底正文\\"}"}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(
            200,
            text=body,
            headers={"content-type": "text/event-stream"},
        )

    transport = httpx.MockTransport(handler)
    primary = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="deepseek-key",
        base_url="https://deepseek.test/v1",
        wire_api="chat_completions",
        thinking_mode="disabled",
        max_retries=0,
        transport=transport,
    )
    fallback = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="glm-key",
        base_url="https://glm.test/v1",
        wire_api="responses",
        reasoning_effort="high",
        use_strict_schema=False,
        max_retries=0,
        transport=transport,
    )
    adapter = ModelFailoverLLMAdapter(primary=primary, fallback=fallback)
    deltas: list[tuple[str, bool]] = []

    result = adapter.generate_structured_output_stream(
        "Return the screenplay JSON.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {"title": {"type": "string"}},
            "required": ["title"],
        },
        on_delta=lambda delta, reset: deltas.append((delta, reset)),
    )

    assert result["title"] == "GLM保底正文"
    assert result["_meta"]["model_failover_used"] is True
    assert result["_meta"]["primary_model_name"] == "deepseek-v4-flash"
    assert result["_meta"]["fallback_model_name"] == "glm-5.2"
    assert "status 502" in result["_meta"]["model_failover_reason"]
    assert len(requests) == 3
    primary_url, primary_payload = requests[0]
    primary_sync_url, primary_sync_payload = requests[1]
    fallback_url, fallback_payload = requests[2]
    assert primary_url.endswith("/v1/chat/completions")
    assert primary_payload["response_format"] == {"type": "json_object"}
    assert primary_payload["stream"] is True
    assert "messages" in primary_payload
    assert primary_sync_url.endswith("/v1/chat/completions")
    assert "stream" not in primary_sync_payload
    assert primary_sync_payload["response_format"] == {"type": "json_object"}
    assert fallback_url.endswith("/v1/responses")
    assert fallback_payload["text"]["format"] == {"type": "json_object"}
    assert "input" in fallback_payload
    assert "messages" not in fallback_payload
    assert "JSON OUTPUT SHAPE CONTRACT" in fallback_payload["input"][1]["content"]
    assert deltas[-1] == ('{"title":"GLM保底正文"}', True)


def test_model_failover_uses_fallback_after_invalid_primary_json() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    primary = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="deepseek-key",
        base_url="https://deepseek.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                json=build_openai_compatible_response("not-json"),
            )
        ),
    )
    fallback = MockLLMAdapter(provider="mock", model_name="glm-5.2")
    adapter = ModelFailoverLLMAdapter(primary=primary, fallback=fallback)

    result = adapter.generate_structured_output(
        "Return the screenplay JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["_meta"]["model_failover_used"] is True
    assert result["_meta"]["fallback_model_name"] == "glm-5.2"
    assert "LLMStructuredOutputError" in result["_meta"]["model_failover_reason"]


def test_same_model_hedge_uses_fast_complete_fallback_and_cancels_primary() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    primary_cancelled = threading.Event()
    fallback_called = threading.Event()
    deltas: list[tuple[str, bool]] = []

    class SlowPrimary(MockLLMAdapter):
        def generate_structured_output_stream_cancellable(
            self,
            prompt,
            *,
            strategy,
            output_schema=None,
            on_delta=None,
            cancel_event,
        ):
            del prompt, strategy, output_schema, on_delta
            assert cancel_event.wait(timeout=1.0)
            primary_cancelled.set()
            return {"title": "Primary completed too late", "_meta": {}}

    class FastFallback(MockLLMAdapter):
        def generate_structured_output_stream_cancellable(
            self,
            prompt,
            *,
            strategy,
            output_schema=None,
            on_delta=None,
            cancel_event,
        ):
            del prompt, strategy, output_schema, on_delta, cancel_event
            fallback_called.set()
            return {"title": "Fallback winner", "_meta": {}}

    adapter = ModelFailoverLLMAdapter(
        primary=SlowPrimary(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
        ),
        fallback=FastFallback(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
        ),
        hedge_delay_seconds=0.02,
    )

    started = time.monotonic()
    result = adapter.generate_structured_output_stream(
        "Return complete screenplay JSON.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {"title": {"type": "string"}},
            "required": ["title"],
        },
        on_delta=lambda delta, reset: deltas.append((delta, reset)),
    )

    assert time.monotonic() - started < 0.5
    assert result["title"] == "Fallback winner"
    assert result["_meta"]["model_hedge_used"] is True
    assert result["_meta"]["model_hedge_winner"] == "fallback"
    assert fallback_called.is_set()
    assert primary_cancelled.wait(timeout=0.5)
    assert len(deltas) == 1
    assert deltas[0][1] is True
    assert json.loads(deltas[0][0])["title"] == "Fallback winner"


def test_model_failover_propagates_external_stream_cancellation() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    cancel_event = threading.Event()
    started = threading.Event()
    errors: list[BaseException] = []

    class CancellationAwareAdapter(MockLLMAdapter):
        def generate_structured_output_stream_cancellable(
            self,
            prompt,
            *,
            strategy,
            output_schema=None,
            on_delta=None,
            cancel_event,
        ):
            del prompt, strategy, output_schema, on_delta
            started.set()
            assert cancel_event.wait(timeout=1.0)
            raise LLMRequestCancelledError()

    adapter = ModelFailoverLLMAdapter(
        primary=CancellationAwareAdapter(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
        ),
        fallback=MockLLMAdapter(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
        ),
    )

    def run() -> None:
        try:
            adapter.generate_structured_output_stream_cancellable(
                "Return JSON.",
                strategy=strategy,
                output_schema={"type": "object"},
                cancel_event=cancel_event,
            )
        except BaseException as error:  # noqa: BLE001 - assert propagation below
            errors.append(error)

    worker = threading.Thread(target=run)
    worker.start()
    assert started.wait(timeout=1.0)
    cancel_event.set()
    worker.join(timeout=1.0)

    assert not worker.is_alive()
    assert len(errors) == 1
    assert isinstance(errors[0], LLMRequestCancelledError)


def test_hedged_model_failover_stops_waiting_when_client_cancels() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    cancel_event = threading.Event()
    started = threading.Event()
    started_count = 0
    started_lock = threading.Lock()
    child_cancelled = threading.Event()
    child_cancelled_count = 0
    child_cancelled_lock = threading.Lock()
    errors: list[BaseException] = []

    class BlockingAdapter(MockLLMAdapter):
        def generate_structured_output_stream_cancellable(
            self,
            prompt,
            *,
            strategy,
            output_schema=None,
            on_delta=None,
            cancel_event,
        ):
            del prompt, strategy, output_schema, on_delta
            nonlocal started_count
            nonlocal child_cancelled_count
            with started_lock:
                started_count += 1
                if started_count == 2:
                    started.set()
            assert cancel_event.wait(timeout=2.0)
            with child_cancelled_lock:
                child_cancelled_count += 1
                if child_cancelled_count == 2:
                    child_cancelled.set()
            raise LLMRequestCancelledError()

    adapter = ModelFailoverLLMAdapter(
        primary=BlockingAdapter(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
        ),
        fallback=BlockingAdapter(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
        ),
        hedge_delay_seconds=0.01,
    )

    def run() -> None:
        try:
            adapter.generate_structured_output_stream_cancellable(
                "Return JSON.",
                strategy=strategy,
                output_schema={"type": "object"},
                cancel_event=cancel_event,
            )
        except BaseException as error:  # noqa: BLE001 - assert propagation below
            errors.append(error)

    worker = threading.Thread(target=run)
    worker.start()
    assert started.wait(timeout=1.0)
    cancel_event.set()
    worker.join(timeout=1.0)

    assert not worker.is_alive()
    assert len(errors) == 1
    assert isinstance(errors[0], LLMRequestCancelledError)
    assert child_cancelled.wait(timeout=1.0)


def test_hedged_route_threads_preserve_generation_log_context(
    caplog: pytest.LogCaptureFixture,
) -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def stream_response(title: str, delay: float):
        def handler(_request: httpx.Request) -> httpx.Response:
            if delay:
                time.sleep(delay)
            body = (
                "data: "
                + json.dumps({
                    "choices": [{
                        "delta": {"content": json.dumps({"title": title})},
                        "finish_reason": "stop",
                    }]
                })
                + "\n\ndata: [DONE]\n\n"
            )
            return httpx.Response(
                200,
                text=body,
                headers={"content-type": "text/event-stream"},
            )

        return handler

    def route(host: str, title: str, delay: float) -> RealLLMAdapter:
        return RealLLMAdapter(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
            api_key="route-key",
            base_url=f"https://{host}/v1",
            max_retries=0,
            transport=httpx.MockTransport(stream_response(title, delay)),
        )

    adapter = ModelFailoverLLMAdapter(
        primary=route("primary-context.test", "primary", 0.08),
        fallback=route("fallback-context.test", "fallback", 0.0),
        hedge_delay_seconds=0.01,
    )
    caplog.set_level(logging.WARNING)

    with bind_llm_log_context(
        project_id="project.context",
        episode=42,
        stage="episode_script.body_expansion",
        agent_run_id="agent-run.context",
    ):
        result = adapter.generate_structured_output_stream(
            "Return JSON.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {"title": {"type": "string"}},
                "required": ["title"],
            },
        )

    assert result["title"] == "fallback"
    route_logs = [
        record.getMessage()
        for record in caplog.records
        if "LLM route request started" in record.getMessage()
    ]
    assert len(route_logs) == 2
    assert all("project_id=project.context" in message for message in route_logs)
    assert all("episode=42" in message for message in route_logs)
    assert all("stage=episode_script.body_expansion" in message for message in route_logs)
    assert all("agent_run_id=agent-run.context" in message for message in route_logs)


def test_same_model_hedge_does_not_start_after_primary_output_is_visible() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    fallback_call_count = 0
    deltas: list[tuple[str, bool]] = []

    class StreamingPrimary(MockLLMAdapter):
        def generate_structured_output_stream_cancellable(
            self,
            prompt,
            *,
            strategy,
            output_schema=None,
            on_delta=None,
            cancel_event,
        ):
            del prompt, strategy, output_schema, cancel_event
            assert on_delta is not None
            on_delta('{"title":', True)
            time.sleep(0.04)
            on_delta('"Primary winner"}', False)
            return {"title": "Primary winner", "_meta": {}}

    class UnusedFallback(MockLLMAdapter):
        def generate_structured_output_stream_cancellable(
            self,
            prompt,
            *,
            strategy,
            output_schema=None,
            on_delta=None,
            cancel_event,
        ):
            nonlocal fallback_call_count
            del prompt, strategy, output_schema, on_delta, cancel_event
            fallback_call_count += 1
            return {"title": "Unexpected fallback", "_meta": {}}

    adapter = ModelFailoverLLMAdapter(
        primary=StreamingPrimary(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
        ),
        fallback=UnusedFallback(
            provider="openai_compatible",
            model_name="deepseek-v4-flash",
        ),
        hedge_delay_seconds=0.01,
    )

    result = adapter.generate_structured_output_stream(
        "Return complete screenplay JSON.",
        strategy=strategy,
        on_delta=lambda delta, reset: deltas.append((delta, reset)),
    )

    assert result["title"] == "Primary winner"
    assert fallback_call_count == 0
    assert deltas == [('{"title":', True), ('"Primary winner"}', False)]
    assert "model_hedge_started" not in result["_meta"]


def test_healthy_primary_wins_adaptively_delay_the_next_hedge() -> None:
    state = ModelFailoverCircuitState()
    adapter = ModelFailoverLLMAdapter(
        primary=MockLLMAdapter(model_name="deepseek-v4-flash"),
        fallback=MockLLMAdapter(model_name="deepseek-v4-flash"),
        hedge_delay_seconds=10.0,
        circuit_state=state,
    )

    assert adapter._effective_hedge_delay_seconds() == 10.0
    adapter._record_hedge_outcome("primary")
    assert adapter._effective_hedge_delay_seconds() == 10.0
    adapter._record_hedge_outcome("primary")
    assert adapter._effective_hedge_delay_seconds() == 20.0
    adapter._record_hedge_outcome("primary")
    adapter._record_hedge_outcome("primary")
    assert adapter._effective_hedge_delay_seconds() == 30.0
    adapter._record_hedge_outcome("fallback")
    assert adapter._effective_hedge_delay_seconds() == 10.0


def test_model_failover_circuit_bypasses_route_after_empty_response() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    primary_calls = 0
    fallback_calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal primary_calls
        primary_calls += 1
        return httpx.Response(200, json={"choices": []})

    class CountingFallbackAdapter(MockLLMAdapter):
        def generate_structured_output(self, *args, **kwargs):
            nonlocal fallback_calls
            fallback_calls += 1
            return super().generate_structured_output(*args, **kwargs)

    primary = RealLLMAdapter(
        provider="openai_compatible",
        model_name="unstable-planning-model",
        api_key="primary-key",
        base_url="https://primary.test/v1",
        max_retries=0,
        retry_empty_response=False,
        transport=httpx.MockTransport(handler),
    )
    adapter = ModelFailoverLLMAdapter(
        primary=primary,
        fallback=CountingFallbackAdapter(model_name="healthy-fallback"),
        circuit_failure_threshold=1,
        circuit_cooldown_seconds=120,
    )

    first = adapter.generate_structured_output(
        "Return the episode roadmap JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )
    second = adapter.generate_structured_output(
        "Return the next episode roadmap JSON.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert primary_calls == 1
    assert fallback_calls == 2
    assert first["_meta"]["model_failover_used"] is True
    assert second["_meta"]["primary_circuit_open"] is True
    assert "temporarily bypassed" in second["_meta"]["model_failover_reason"]


def test_model_failover_does_not_open_circuit_for_ordinary_invalid_json() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    primary_calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal primary_calls
        primary_calls += 1
        return httpx.Response(
            200,
            json=build_openai_compatible_response("not-json"),
        )

    adapter = ModelFailoverLLMAdapter(
        primary=RealLLMAdapter(
            provider="openai_compatible",
            model_name="planning-model",
            api_key="primary-key",
            base_url="https://primary.test/v1",
            max_retries=0,
            transport=httpx.MockTransport(handler),
        ),
        fallback=MockLLMAdapter(model_name="healthy-fallback"),
        circuit_failure_threshold=1,
        circuit_cooldown_seconds=120,
    )

    for _ in range(2):
        adapter.generate_structured_output(
            "Return the episode roadmap JSON.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {"title": {"type": "string"}},
            },
        )

    assert primary_calls == 2


def test_model_failover_does_not_hide_a_non_retryable_400() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    fallback_calls = 0

    class CountingFallbackAdapter(MockLLMAdapter):
        def generate_structured_output(self, *args, **kwargs):
            nonlocal fallback_calls
            fallback_calls += 1
            return super().generate_structured_output(*args, **kwargs)

    primary = RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4-flash",
        api_key="deepseek-key",
        base_url="https://deepseek.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                400,
                json={"error": {"message": "invalid user request"}},
            )
        ),
    )
    adapter = ModelFailoverLLMAdapter(
        primary=primary,
        fallback=CountingFallbackAdapter(model_name="glm-5.2"),
    )

    with pytest.raises(LLMRequestError, match="non-retryable status 400"):
        adapter.generate_structured_output(
            "Return the screenplay JSON.",
            strategy=strategy,
            output_schema={
                "type": "object",
                "properties": {"title": {"type": "string"}},
            },
        )

    assert fallback_calls == 0


def test_real_llm_adapter_supports_prompt_only_structured_output() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        payload = json.loads(request.content.decode("utf-8"))
        assert "response_format" not in payload
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"Prompt Only Title"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="kimi-k3",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="chat_completions",
        use_strict_schema=False,
        send_response_format=False,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a JSON object matching the schema included in this prompt.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Prompt Only Title"


def test_real_llm_adapter_accepts_json_code_fence_from_responses_gateway() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test",
        wire_api="responses",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                json=build_responses_api_response(
                    '```json\n{"title":"Fenced Responses Title"}\n```'
                ),
            )
        ),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Fenced Responses Title"


def test_real_llm_adapter_extracts_json_wrapped_in_commentary() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test",
        wire_api="responses",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                json=build_responses_api_response(
                    'I have prepared the script.\n```json\n{"title":"Recovered Wrapped Title"}\n'
                ),
            )
        ),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Recovered Wrapped Title"


def test_real_llm_adapter_extracts_fenced_json_after_trailing_commentary() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test",
        wire_api="responses",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                json=build_responses_api_response(
                    "结果如下：\n```json\n{\"title\":\"带说明的正文\"}\n```\n已完成。"
                ),
            )
        ),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "带说明的正文"


def test_real_llm_adapter_closes_a_complete_truncated_root_suffix() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            200,
            json=build_responses_api_response(
                '{"title":"截断正文","scenes":[{"scene_number":1,"slug":"开场"}]'
            ),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "scenes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "scene_number": {"type": "integer"},
                            "slug": {"type": "string"},
                        },
                    },
                },
            },
            "required": ["title", "scenes"],
        },
    )

    assert request_count == 1
    assert {key: value for key, value in result.items() if key != "_meta"} == {
        "title": "截断正文",
        "scenes": [{"scene_number": 1, "slug": "开场"}],
    }


def test_real_llm_adapter_does_not_close_an_unfinished_json_string() -> None:
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=0,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json=build_responses_api_response(
                    '{"title":"正文在字符串中间截断'
                ),
            )
        ),
    )

    with pytest.raises(LLMStructuredOutputError, match="invalid JSON content"):
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=GenerationStrategy.model_validate(build_strategy()),
            output_schema={
                "type": "object",
                "properties": {"title": {"type": "string"}},
                "required": ["title"],
            },
        )


def test_real_llm_adapter_repairs_nested_fragment_to_schema_root_once() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    requests: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        requests.append(payload)
        content = (
            '{"scene_number":1,"slug":"开场","purpose":"建立冲突"}'
            if len(requests) == 1
            else '{"title":"完整正文","scenes":[{"scene_number":1,"slug":"开场"}]}'
        )
        return httpx.Response(200, json=build_openai_compatible_response(content))

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        use_strict_schema=False,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "scenes": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["title", "scenes"],
        },
    )

    assert result["title"] == "完整正文"
    assert result["_meta"]["schema_root_repaired"] is True
    assert result["_meta"]["adapter_model_pass_count"] == 2
    assert len(requests) == 2
    retry_text = requests[1]["messages"][-1]["content"]
    assert "valid nested fragment" in retry_text
    assert "complete requested root object" in retry_text


def test_real_llm_adapter_unwraps_complete_schema_root_without_retry() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            200,
            json=build_openai_compatible_response(
                '{"data":{"draft_master_script":{"title":"已包装正文",'
                '"scenes":[]}}}'
            ),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        use_strict_schema=False,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "scenes": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["title", "scenes"],
        },
    )

    assert result["title"] == "已包装正文"
    assert result["_meta"]["schema_root_unwrapped"] is True
    assert result["_meta"]["adapter_model_pass_count"] == 1
    assert request_count == 1


def test_real_llm_adapter_leaves_partial_root_for_artifact_validation() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"字段不完整正文"}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        use_strict_schema=False,
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "scenes": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["title", "scenes"],
        },
    )

    assert result["title"] == "字段不完整正文"
    assert request_count == 1


def test_real_llm_adapter_repairs_trailing_json_commas_locally() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test",
        wire_api="responses",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                json=build_responses_api_response(
                    '{"children":[{"title":"保留,}字符串",},],}'
                ),
            )
        ),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object"},
    )

    assert result["children"] == [{"title": "保留,}字符串"}]


def test_real_llm_adapter_reports_non_json_success_response() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test",
        max_retries=0,
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                text="<html>not an API response</html>",
                headers={"content-type": "text/html"},
            )
        ),
    )

    with pytest.raises(LLMRequestError, match="non-JSON success response"):
        adapter.generate_text("Return text.", strategy=strategy)


def test_pooled_adapter_rotates_script_keys() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_authorizations: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_authorizations.append(request.headers["Authorization"])
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"Pooled Title"}'),
        )

    adapter = PooledLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_keys=["script-key-1", "script-key-2", "script-key-3"],
        base_url="https://example.test/v1",
        transport=httpx.MockTransport(handler),
    )

    results = [
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        )
        for _ in range(3)
    ]

    assert [item["_meta"]["key_slot"] for item in results] == [1, 2, 3]
    assert set(seen_authorizations) == {
        "Bearer script-key-1",
        "Bearer script-key-2",
        "Bearer script-key-3",
    }


def test_pooled_adapter_does_not_multiply_structured_output_failures() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(
            200,
            json=build_openai_compatible_response("not-json"),
        )

    adapter = PooledLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_keys=["script-key-1", "script-key-2", "script-key-3"],
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError):
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
        )

    assert request_count == 1


def test_pooled_adapter_uses_one_backup_key_for_empty_structured_output() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_authorizations: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        authorization = request.headers["Authorization"]
        seen_authorizations.append(authorization)
        content = "" if authorization == "Bearer script-key-1" else '{"title":"恢复"}'
        return httpx.Response(
            200,
            json=build_openai_compatible_response(content),
        )

    adapter = PooledLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_keys=["script-key-1", "script-key-2", "script-key-3"],
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "恢复"
    assert result["_meta"]["key_slot"] == 2
    assert result["_meta"]["pool_key_attempt_count"] == 2
    assert result["_meta"]["pool_key_failover_used"] is True
    assert seen_authorizations == ["Bearer script-key-1", "Bearer script-key-2"]


def test_pooled_adapter_bounds_persistently_empty_output_to_two_keys() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(200, json=build_openai_compatible_response(""))

    adapter = PooledLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_keys=["script-key-1", "script-key-2", "script-key-3"],
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError) as exc_info:
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        )

    assert request_count == 2
    assert getattr(exc_info.value, "pool_key_attempt_count") == 2


@pytest.mark.parametrize("wire_api", ["chat_completions", "responses"])
def test_script_strict_request_schema_removes_reference_default_without_mutating_source(
    wire_api: str,
) -> None:
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api=wire_api,
        transport=httpx.MockTransport(lambda _: pytest.fail("No HTTP request expected")),
    )
    source_schema = LLMGeneratedDraftMasterScript.model_json_schema()
    original_schema = deepcopy(source_schema)
    assert source_schema["properties"]["ending_mode"] == {
        "$ref": "#/$defs/EndingMode", "default": "serial_hook",
    }

    payload = adapter._build_payload(
        prompt="Return an overseas episode.",
        strategy=GenerationStrategy.model_validate(build_strategy()),
        output_schema=source_schema,
    )
    output_format = (
        payload["text"]["format"]
        if wire_api == "responses"
        else payload["response_format"]["json_schema"]
    )
    assert output_format["strict"] is True
    provider_schema = output_format["schema"]

    def check_references(value: object) -> None:
        if isinstance(value, dict):
            if isinstance(value.get("$ref"), str):
                assert "default" not in value
            for child in value.values():
                check_references(child)
        elif isinstance(value, list):
            for child in value:
                check_references(child)

    check_references(provider_schema)
    assert provider_schema["properties"]["ending_mode"] == {"$ref": "#/$defs/EndingMode"}
    assert provider_schema["$defs"]["EndingMode"] == source_schema["$defs"]["EndingMode"]
    assert "ending_mode" in provider_schema["required"]
    assert source_schema == original_schema
    assert LLMGeneratedDraftMasterScript.model_fields["ending_mode"].default == "serial_hook"


def test_strict_schema_reference_default_cleanup_preserves_business_properties() -> None:
    source_schema = {
        "type": "object",
        "$defs": {"Ending": {"type": "string", "enum": ["closed"]}},
        "properties": {
            "$ref": {"type": "string"},
            "default": {"type": "string", "default": "preserved"},
            "nested": {
                "type": "object",
                "properties": {
                    "ending": {"$ref": "#/$defs/Ending", "default": "closed"},
                },
            },
        },
    }
    original_schema = deepcopy(source_schema)

    normalized = RealLLMAdapter._normalize_strict_json_schema(source_schema)

    assert normalized["properties"]["default"] == {"type": "string", "default": "preserved"}
    assert normalized["properties"]["$ref"] == {"type": "string"}
    assert normalized["properties"]["nested"]["properties"]["ending"] == {"$ref": "#/$defs/Ending"}
    assert source_schema == original_schema


def test_real_llm_adapter_normalizes_nested_schema_for_strict_output() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        schema = payload["response_format"]["json_schema"]["schema"]
        assert schema["required"] == ["scene"]
        assert schema["additionalProperties"] is False
        assert schema["$defs"]["Scene"]["required"] == ["title", "cliffhanger"]
        assert schema["$defs"]["Scene"]["additionalProperties"] is False
        assert schema["properties"]["scene"]["$ref"] == "#/$defs/Scene"
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"scene":{"title":"Reveal"}}'),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        transport=httpx.MockTransport(handler),
    )
    source_schema = {
        "$defs": {
            "Scene": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "cliffhanger": {"type": "boolean", "default": False},
                },
                "required": ["title"],
            }
        },
        "type": "object",
        "properties": {"scene": {"$ref": "#/$defs/Scene"}},
        "required": [],
    }

    adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema=source_schema,
    )

    assert source_schema["required"] == []
    assert source_schema["$defs"]["Scene"]["required"] == ["title"]


def test_real_llm_adapter_inlines_root_collection_item_schema() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        schema = payload["response_format"]["json_schema"]["schema"]
        items = schema["properties"]["children"]["items"]
        assert "$ref" not in items
        assert items["properties"]["title"]["type"] == "string"
        assert items["required"] == ["title"]
        return httpx.Response(
            200,
            json=build_openai_compatible_response(
                '{"children":[{"title":"第一阶段"},{"title":"第二阶段"}]}'
            ),
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="planning-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        transport=httpx.MockTransport(handler),
    )
    result = adapter.generate_structured_output(
        "Return child stages.",
        strategy=strategy,
        output_schema={
            "$defs": {
                "Child": {
                    "type": "object",
                    "properties": {"title": {"type": "string"}},
                    "required": ["title"],
                }
            },
            "type": "object",
            "properties": {
                "children": {
                    "type": "array",
                    "items": {"$ref": "#/$defs/Child"},
                }
            },
            "required": ["children"],
        },
    )

    assert len(result["children"]) == 2


def test_gemini_body_patch_schema_expands_nested_dialogue_references() -> None:
    from app.modules.master_script.models import LLMMainlandBodyRepairPatch

    adapter = RealLLMAdapter(provider="openai_compatible", model_name="gemini-3.6-flash",
                             api_key="test", base_url="https://example.test/v1")
    source = LLMMainlandBodyRepairPatch.model_json_schema()
    original = deepcopy(source)
    payload = adapter._build_payload(prompt="Repair the fixture.",
        strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=source)
    schema = payload["response_format"]["json_schema"]["schema"]
    dialogue = schema["properties"]["scenes"]["items"]["properties"]["dialogues"]["items"]
    assert set(dialogue["required"]) == {"character_name", "chinese_character_name", "intent", "text", "chinese_translation"}
    assert dialogue["properties"]["text"]["maxLength"] == 280
    assert "$defs" not in schema
    assert source == original


def test_gemini_schema_preserves_recursive_refs_and_business_property_names() -> None:
    adapter = RealLLMAdapter(provider="openai_compatible", model_name="gemini-3.6-flash",
                             api_key="test", base_url="https://example.test/v1")
    properties = {"$defs": {"type": "string"}, "$ref": {"type": "string"},
                  "default": {"type": "object", "default": {"$ref": "literal-data"}}}
    source = {"type": "object", "properties": properties}
    result = adapter._provider_json_schema(source)
    assert result["properties"]["$defs"] == properties["$defs"]
    assert result["properties"]["$ref"] == properties["$ref"]
    assert result["properties"]["default"]["default"] == {"$ref": "literal-data"}
    recursive = {"type": "object", "properties": {"root": {"$ref": "#/$defs/Node"}},
                 "$defs": {"Node": {"type": "object", "properties": {"next": {"$ref": "#/$defs/Node"}}}}}
    assert adapter._provider_json_schema(recursive) == adapter._normalize_strict_json_schema(recursive)


def test_real_llm_adapter_wraps_top_level_array_for_single_collection_schema() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="planning-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        use_strict_schema=False,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json=build_openai_compatible_response(
                    '结果如下：\n[{"title":"第一阶段"},{"title":"第二阶段"}]\n以上。'
                ),
            )
        ),
    )
    result = adapter.generate_structured_output(
        "Return child stages.",
        strategy=strategy,
        output_schema={
            "type": "object",
            "properties": {
                "children": {
                    "type": "array",
                    "items": {"type": "object"},
                }
            },
            "required": ["children"],
        },
    )

    assert result["children"][0]["title"] == "第一阶段"


def test_real_llm_adapter_does_not_regenerate_invalid_json_output() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(200, json=build_openai_compatible_response("not-json"))

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=1,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError) as error:
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        )

    assert request_count == 1
    assert error.value.raw_content == "not-json"


def test_real_llm_adapter_does_not_restart_a_malformed_stream() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    request_count = 0
    seen_deltas: list[tuple[str, bool]] = []

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        body = (
            'data: {"type":"response.output_text.delta","delta":"visible draft text"}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="glm-5.2",
        api_key="secret-key",
        base_url="https://example.test/v1",
        wire_api="responses",
        max_retries=2,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMStructuredOutputError) as error:
        adapter.generate_structured_output_stream(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
            on_delta=lambda delta, reset: seen_deltas.append((delta, reset)),
        )

    assert request_count == 1
    assert seen_deltas == [("visible draft text", True)]
    assert error.value.raw_content == "visible draft text"


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


def test_real_llm_adapter_reports_network_error_detail_after_retries() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("provider connection closed", request=request)

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(
        LLMRequestError,
        match="ConnectError: provider connection closed",
    ):
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
        )


def test_real_llm_adapter_exposes_safe_provider_error_detail() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"error": {"message": "Unsupported request parameter: temperature"}},
        )

    adapter = RealLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_key="secret-key",
        base_url="https://example.test/v1",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMRequestError, match="Unsupported request parameter: temperature"):
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object"},
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


def test_pooled_adapter_rotates_after_incomplete_chunked_transport() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    seen_authorizations: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        authorization = request.headers["Authorization"]
        seen_authorizations.append(authorization)
        if authorization == "Bearer script-key-1":
            raise httpx.RemoteProtocolError(
                "peer closed connection without sending complete message body "
                "(incomplete chunked read)"
            )
        return httpx.Response(
            200,
            json=build_openai_compatible_response('{"title":"Recovered"}'),
        )

    adapter = PooledLLMAdapter(
        provider="openai_compatible",
        model_name="script-model",
        api_keys=["script-key-1", "script-key-2"],
        base_url="https://example.test/v1",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )

    result = adapter.generate_structured_output(
        "Return a structured draft.",
        strategy=strategy,
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "Recovered"
    assert result["_meta"]["pool_key_failover_used"] is True
    assert seen_authorizations == ["Bearer script-key-1", "Bearer script-key-2"]


def test_model_failover_preserves_both_transport_failures() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())

    def adapter_for(model_name: str, detail: str) -> RealLLMAdapter:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.RemoteProtocolError(detail)

        return RealLLMAdapter(
            provider="openai_compatible",
            model_name=model_name,
            api_key=f"{model_name}-key",
            base_url=f"https://{model_name}.test/v1",
            max_retries=0,
            transport=httpx.MockTransport(handler),
        )

    adapter = ModelFailoverLLMAdapter(
        primary=adapter_for("primary-model", "primary peer closed"),
        fallback=adapter_for("fallback-model", "fallback incomplete chunked read"),
    )

    with pytest.raises(LLMRequestError) as exc_info:
        adapter.generate_structured_output(
            "Return a structured draft.",
            strategy=strategy,
            output_schema={"type": "object"},
        )

    assert exc_info.value.category == "failover_exhausted"
    assert exc_info.value.recoverable is True
    assert getattr(exc_info.value, "route_failure_categories") == (
        "transport",
        "transport",
    )
    assert "primary peer closed" in str(exc_info.value)
    assert "fallback incomplete chunked read" in str(exc_info.value)


def test_model_failover_preserves_hard_deadline_for_retry_classification() -> None:
    primary_error = LLMRequestError(
        "primary reached provider gateway deadline",
        status_code=524,
        category="provider_gateway",
        recoverable=True,
    )
    fallback_error = LLMRequestError(
        "fallback unavailable",
        status_code=502,
        category="provider_gateway",
        recoverable=True,
    )

    combined = ModelFailoverLLMAdapter._combined_failure(
        primary_error,
        fallback_error,
    )

    assert combined.status_code == 502
    assert getattr(combined, "gateway_deadline") is True


def test_model_failover_circuit_state_is_shared_across_script_roles() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    primary_calls = 0
    shared_state = ModelFailoverCircuitState()

    def role_adapter() -> ModelFailoverLLMAdapter:
        primary = MockLLMAdapter(model_name="deepseek-v4-flash")

        def fail_primary(*args, **kwargs):
            nonlocal primary_calls
            primary_calls += 1
            raise LLMRequestError(
                "gateway returned status 502",
                status_code=502,
                category="provider_gateway",
                recoverable=True,
            )

        primary.generate_structured_output = fail_primary
        return ModelFailoverLLMAdapter(
            primary=primary,
            fallback=MockLLMAdapter(model_name="deepseek-v4-flash"),
            circuit_failure_threshold=1,
            circuit_cooldown_seconds=180,
            circuit_state=shared_state,
        )

    draft_role = role_adapter()
    repair_role = role_adapter()
    schema = {"type": "object"}

    first = draft_role.generate_structured_output(
        "Draft screenplay.",
        strategy=strategy,
        output_schema=schema,
    )
    second = repair_role.generate_structured_output(
        "Repair screenplay.",
        strategy=strategy,
        output_schema=schema,
    )

    assert primary_calls == 1
    assert first["_meta"]["model_failover_used"] is True
    assert second["_meta"]["primary_circuit_open"] is True


def test_model_failover_preserves_primary_structure_error_when_fallback_transport_fails() -> None:
    strategy = GenerationStrategy.model_validate(build_strategy())
    primary = MockLLMAdapter(model_name="primary-model")
    fallback = MockLLMAdapter(model_name="fallback-model")
    primary_error = LLMStructuredOutputError(
        "Model encoded episode plan objects as strings."
    )

    def fail_primary(*args, **kwargs):
        raise primary_error

    def fail_fallback(*args, **kwargs):
        raise LLMRequestError(
            "Provider returned non-JSON success response (content-type text/html).",
            status_code=200,
            category="invalid_success_response",
            recoverable=True,
        )

    primary.generate_structured_output = fail_primary
    fallback.generate_structured_output = fail_fallback
    adapter = ModelFailoverLLMAdapter(primary=primary, fallback=fallback)

    with pytest.raises(LLMStructuredOutputError) as exc_info:
        adapter.generate_structured_output(
            "Return episode plans.",
            strategy=strategy,
            output_schema={"type": "object"},
        )

    assert exc_info.value is primary_error
    assert "text/html" in exc_info.value.fallback_request_failure
