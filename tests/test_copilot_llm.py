"""Copilot protocol checks use only deterministic in-process HTTP mocks."""

import json
import threading
import time

import httpx
import pytest

from app.modules.script_engine.copilot_progress import (
    MAX_SUMMARY_CHARACTERS,
    MAX_THINKING_CHARACTERS,
    CopilotProgress,
    CopilotRequestCancelled,
    bind_copilot_progress,
    copilot_deepseek_thinking_event,
    copilot_summary_event,
    suppress_copilot_summaries,
)
from app.modules.script_engine.llm_adapter import (
    AdaptiveTransportLLMAdapter, AdaptiveTransportState, LLMRequestError, RealLLMAdapter,
    MockLLMAdapter, ModelFailoverLLMAdapter,
    bind_deepseek_full_episode_stream,
)
from app.modules.script_engine.models import GenerationStrategy
from tests.test_llm_adapter import build_openai_compatible_response, build_responses_api_response, build_strategy

SCHEMA = {"type": "object", "properties": {"title": {"type": "string"}}}


def stream_response(*events):
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, text="".join(
        f"data: {json.dumps(event)}\n\n" for event in events
    ))


def successful_events():
    return [
        {"type": "response.output_text.delta", "delta": '{"title":"story"}'},
        {"type": "response.completed", "response": {"status": "completed"}},
    ]


def adapter(handler, *, wire_api="responses"):
    return RealLLMAdapter(
        provider="openai_compatible", model_name="script-model", api_key="mock-only",
        base_url="https://model.invalid/v1", wire_api=wire_api,
        reasoning_effort="high", max_retries=0, transport=httpx.MockTransport(handler),
    )


def generate(client):
    return client.generate_structured_output(
        "PRIVATE_PROMPT", strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=SCHEMA,
    )


def test_opt_in_streams_only_public_summary_and_emits_real_stages(caplog):
    requests, events = [], []

    def handler(request):
        requests.append(json.loads(request.content))
        return stream_response(
            {"type": "response.reasoning_text.delta", "delta": "PRIVATE_RAW_REASONING"},
            {"choices": [{"delta": {"reasoning_content": "PRIVATE_CHAT_REASONING", "reasoning": "PRIVATE_AMBIGUOUS"}}]},
            {"type": "response.reasoning_summary_text.delta", "delta": "公开摘要"},
            *successful_events(),
        )

    observer = CopilotProgress(events.append, threading.Event())
    with bind_copilot_progress(observer):
        result = generate(adapter(handler))
    assert result["title"] == "story"
    assert len(requests) == 1
    assert requests[0]["stream"] is True
    assert requests[0]["reasoning"] == {"effort": "high", "summary": "auto"}
    assert [event["stage"] for event in events if event["type"] == "progress"] == [
        "requesting", "thinking", "writing", "validating",
    ]
    assert [event["delta"] for event in events if event["type"] == "reasoning_summary"] == ["公开摘要"]
    visible = json.dumps(events, ensure_ascii=False) + caplog.text
    for private in ("PRIVATE_PROMPT", "PRIVATE_RAW_REASONING", "PRIVATE_CHAT_REASONING", "PRIVATE_AMBIGUOUS", '"title"'):
        assert private not in visible


def test_no_observer_preserves_nonstream_payload_and_single_request():
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=build_responses_api_response('{"title":"story"}'))

    assert generate(adapter(handler))["title"] == "story"
    assert len(requests) == 1
    assert "stream" not in requests[0]
    assert requests[0]["reasoning"] == {"effort": "high"}


def test_summary_is_optional_when_provider_only_streams_output():
    events = []
    with bind_copilot_progress(CopilotProgress(events.append, threading.Event())):
        assert generate(adapter(lambda _: stream_response(*successful_events())))["title"] == "story"
    assert not any(event["type"] == "reasoning_summary" for event in events)
    assert [event["stage"] for event in events] == ["requesting", "writing", "validating"]


def test_chat_raw_reasoning_is_activity_only_and_never_requests_summary():
    events, requests = [], []

    def handler(request):
        requests.append(json.loads(request.content))
        return stream_response(
            {"choices": [{"delta": {"reasoning_content": "PRIVATE_CHAT"}}]},
            {"choices": [{"delta": {"content": '{"title":"story"}'}, "finish_reason": "stop"}]},
        )

    with bind_copilot_progress(CopilotProgress(events.append, threading.Event())):
        assert generate(adapter(handler, wire_api="chat_completions"))["title"] == "story"
    assert "summary" not in json.dumps(requests)
    assert "PRIVATE_CHAT" not in json.dumps(events)
    assert any(event.get("stage") == "thinking" for event in events)
    assert not any(event["type"] == "reasoning_summary" for event in events)


@pytest.mark.parametrize("status_code", [400, 422])
def test_rejected_summary_is_removed_once_and_stays_disabled_for_request(status_code):
    requests = []

    def handler(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if payload.get("reasoning", {}).get("summary"):
            return httpx.Response(status_code, json={"error": {"message": "Unsupported parameter: reasoning.summary"}})
        return stream_response(*successful_events())

    client = adapter(handler)
    with bind_copilot_progress(CopilotProgress(lambda _: None, threading.Event())):
        assert generate(client)["title"] == "story"
        assert generate(client)["title"] == "story"
    assert len(requests) == 3  # One rejected request, two explicitly requested operations.
    assert requests[0]["reasoning"]["summary"] == "auto"
    assert all(item["reasoning"] == {"effort": "high"} for item in requests[1:])
    assert all(item["stream"] is True for item in requests)


@pytest.mark.parametrize("status_code,detail", [
    (400, "Invalid schema"), (422, "Invalid input"), (401, "Unsupported reasoning.summary"),
    (503, "Unsupported reasoning.summary"),
])
def test_unrelated_errors_do_not_enable_summary_compatibility_retry(status_code, detail):
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(status_code, json={"error": {"message": detail}})

    client = adapter(handler)
    # The assertion concerns the bounded wire operation, independent of existing
    # higher-level stream/JSON gateway fallback policy.
    with bind_copilot_progress(CopilotProgress(lambda _: None, threading.Event())):
        payload = client._build_payload(prompt="private", strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=SCHEMA)
        with pytest.raises(LLMRequestError):
            client._stream_text(payload, on_delta=None)
    assert len(requests) == 1


def test_summary_limit_is_a_contiguous_prefix_and_never_persisted_in_result():
    events = []
    text = "公开模型摘要" * 3_000
    with bind_copilot_progress(CopilotProgress(events.append, threading.Event())):
        result = generate(adapter(lambda _: stream_response(
            {"type": "response.reasoning_summary_text.delta", "delta": text}, *successful_events(),
        )))
    chunks = [event["delta"] for event in events if event["type"] == "reasoning_summary"]
    assert "".join(chunks) == text[:MAX_SUMMARY_CHARACTERS]
    assert all(len(chunk) <= 512 for chunk in chunks)
    assert "公开模型摘要" not in json.dumps(result, ensure_ascii=False)


def test_suppressed_hedge_subtree_neither_requests_nor_forwards_summary():
    events, requests = [], []

    def handler(request):
        requests.append(json.loads(request.content))
        return stream_response(
            {"type": "response.reasoning_summary_text.delta", "delta": "LOSING_ROUTE_SUMMARY"}, *successful_events(),
        )

    with bind_copilot_progress(CopilotProgress(events.append, threading.Event())), suppress_copilot_summaries():
        assert generate(adapter(handler))["title"] == "story"
    assert "summary" not in requests[0]["reasoning"]
    assert not any(event["type"] == "reasoning_summary" for event in events)


def test_disconnected_request_does_not_send_model_request_or_repair():
    requests = []
    cancel = threading.Event()
    cancel.set()
    with bind_copilot_progress(CopilotProgress(lambda _: None, cancel)):
        with pytest.raises(CopilotRequestCancelled):
            generate(adapter(lambda request: requests.append(request)))
    assert requests == []


def test_disconnect_during_summary_stops_before_remaining_content_and_repair():
    cancel = threading.Event()
    requests = []

    def handler(request):
        requests.append(request)
        return stream_response(
            {"type": "response.reasoning_summary_text.delta", "delta": "公开" * 100}, *successful_events(),
        )

    def on_event(event):
        if event["type"] == "reasoning_summary":
            cancel.set()

    with bind_copilot_progress(CopilotProgress(on_event, cancel)):
        with pytest.raises(CopilotRequestCancelled):
            generate(adapter(handler))
    assert len(requests) == 1


def test_untrusted_unknown_summary_event_types_are_ignored():
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    with bind_copilot_progress(observer):
        for event in [
            {"type": "response.reasoning_text.delta", "delta": "private"},
            {"type": "response.output_text.delta", "delta": "private JSON"},
            {"type": "response.reasoning_summary_text.done", "text": "private final"},
            {"type": "response.reasoning_summary_text.delta", "delta": {"nested": "private"}},
        ]:
            copilot_summary_event(event)
        observer.flush_summary()
    assert events == []


def test_copilot_respects_adaptive_explicit_nonstream_recovery():
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json=build_responses_api_response('{"title":"story"}'))

    state = AdaptiveTransportState()
    state.prefer_non_stream_until = time.monotonic() + 60
    client = AdaptiveTransportLLMAdapter(adapter=adapter(handler), state=state)
    with bind_copilot_progress(CopilotProgress(lambda _: None, threading.Event())):
        result = client.generate_structured_output_stream(
            "PRIVATE", strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=SCHEMA,
        )
    assert result["title"] == "story"
    assert len(requests) == 1
    assert not requests[0].get("stream")


def test_copilot_and_full_episode_preferences_do_not_repeat_stream_fallback():
    requests = []

    def handler(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if payload.get("stream"):
            return httpx.Response(524, text="mock gateway timeout")
        return httpx.Response(200, json=build_openai_compatible_response('{"title":"story"}'))

    client = RealLLMAdapter(
        provider="openai_compatible", model_name="deepseek-v4-pro", api_key="mock-only",
        base_url="https://model.invalid/v1", max_retries=0, transport=httpx.MockTransport(handler),
    )
    with bind_copilot_progress(CopilotProgress(lambda _: None, threading.Event())), bind_deepseek_full_episode_stream():
        assert generate(client)["title"] == "story"
    assert [bool(item.get("stream")) for item in requests] == [True, False]


def test_gateway_rejecting_new_summary_only_reasoning_object_can_downgrade():
    requests = []

    def handler(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if payload.get("reasoning"):
            return httpx.Response(400, json={"error": {"message": "Unknown parameter: reasoning"}})
        return stream_response(*successful_events())

    client = RealLLMAdapter(
        provider="openai_compatible", model_name="script-model", api_key="mock-only",
        base_url="https://model.invalid/v1", wire_api="responses", max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    with bind_copilot_progress(CopilotProgress(lambda _: None, threading.Event())):
        assert generate(client)["title"] == "story"
    assert len(requests) == 2
    assert requests[0]["reasoning"] == {"summary": "auto"}
    assert "reasoning" not in requests[1]


def deepseek_adapter(handler, **overrides):
    settings = dict(
        provider="openai_compatible", model_name="deepseek-v4-1-flash-260910", api_key="mock-only",
        base_url="https://model.invalid/v1", wire_api="chat_completions", max_retries=0,
        transport=httpx.MockTransport(handler),
    )
    return RealLLMAdapter(**{**settings, **overrides})


def chat_thinking(text):
    return {"choices": [{"delta": {"reasoning_content": text}}]}


def chat_result():
    return {"choices": [{"delta": {"content": '{"title":"story"}'}, "finish_reason": "stop"}]}


@pytest.mark.parametrize("model_name", ["deepseek-v4-1-flash-260910", "deepseek-v4.1-flash", "deepseek-v4-pro"])
def test_deepseek_client_thinking_field_streams_without_changing_structured_result(model_name, caplog):
    events, requests = [], []

    class FragmentedStream(httpx.SyncByteStream):
        def __iter__(self):
            source = "".join(f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in [
                chat_thinking("先核对人物目标。"), chat_thinking("再整理冲突。"),
                {"choices": [{"delta": {"reasoning": "UNSUPPORTED_AMBIGUOUS"}}]},
                {"choices": [{"message": {"reasoning_content": "UNSUPPORTED_FINAL"}}]},
                {"type": "response.reasoning_text.delta", "delta": "UNSUPPORTED_RESPONSES"},
                chat_result(),
            ]).encode()
            for offset in range(0, len(source), 7):
                yield source[offset:offset + 7]

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, stream=FragmentedStream(), headers={"content-type": "text/event-stream"})

    with bind_copilot_progress(CopilotProgress(events.append, threading.Event())):
        result = generate(deepseek_adapter(handler, model_name=model_name))
    assert result["title"] == "story"
    assert len(requests) == 1 and requests[0]["stream"] is True
    assert requests[0]["thinking"] == {"type": "enabled"}
    assert "".join(event["delta"] for event in events if event["type"] == "model_thinking") == "先核对人物目标。再整理冲突。"
    assert not any(event["type"] == "reasoning_summary" for event in events)
    assert "先核对" not in json.dumps(result, ensure_ascii=False) + caplog.text
    assert "UNSUPPORTED" not in json.dumps(events)


def test_copilot_enables_deepseek_thinking_only_for_interactive_request():
    requests, events = [], []

    def handler(request):
        payload = json.loads(request.content)
        requests.append(payload)
        if payload.get("stream"):
            return stream_response(chat_thinking("可见思考"), chat_result())
        return httpx.Response(200, json=build_openai_compatible_response('{"title":"story"}'))

    client = deepseek_adapter(handler, thinking_mode="disabled", reasoning_effort="none")
    assert generate(client)["title"] == "story"
    with bind_copilot_progress(CopilotProgress(events.append, threading.Event())):
        assert generate(client)["title"] == "story"
    assert generate(client)["title"] == "story"
    for ordinary in (requests[0], requests[2]):
        assert ordinary["thinking"] == {"type": "disabled"}
        assert "reasoning_effort" not in ordinary
        assert "temperature" in ordinary and "stream" not in ordinary
    assert requests[1]["thinking"] == {"type": "enabled"}
    assert requests[1]["reasoning_effort"] == "low"
    assert "temperature" not in requests[1]
    assert any(event["type"] == "model_thinking" for event in events)


def test_deepseek_responses_does_not_forward_chat_or_private_reasoning():
    events = []
    with bind_copilot_progress(CopilotProgress(events.append, threading.Event())):
        assert generate(deepseek_adapter(lambda _: stream_response(
            chat_thinking("WRONG_WIRE_FIELD"),
            {"type": "response.reasoning_text.delta", "delta": "PRIVATE_RESPONSES"},
            {"type": "response.reasoning_summary_text.delta", "delta": "公开摘要"},
            *successful_events(),
        ), wire_api="responses"))["title"] == "story"
    assert not any(event["type"] == "model_thinking" for event in events)
    assert [event["delta"] for event in events if event["type"] == "reasoning_summary"] == ["公开摘要"]


def test_thinking_is_bounded_and_split_into_transport_chunks():
    events = []
    source = "可见模型思考" * 3_000
    with bind_copilot_progress(CopilotProgress(events.append, threading.Event())):
        result = generate(deepseek_adapter(lambda _: stream_response(chat_thinking(source), chat_result())))
    chunks = [event["delta"] for event in events if event["type"] == "model_thinking"]
    assert "".join(chunks) == source[:MAX_THINKING_CHARACTERS]
    assert all(len(chunk) <= 512 for chunk in chunks)
    assert result["title"] == "story"


def test_disconnect_during_deepseek_thinking_stops_before_result_and_repair():
    events, requests = [], []
    cancel = threading.Event()

    def handler(request):
        requests.append(request)
        return stream_response(chat_thinking("思考" * 100), chat_result())

    def on_event(event):
        events.append(event)
        if event["type"] == "model_thinking":
            cancel.set()

    with bind_copilot_progress(CopilotProgress(on_event, cancel)):
        with pytest.raises(CopilotRequestCancelled):
            generate(deepseek_adapter(handler))
    assert len(requests) == 1
    assert not any(event.get("stage") in {"writing", "validating"} for event in events)


def test_disconnect_before_thinking_flush_does_not_publish_buffered_text():
    events = []
    cancel = threading.Event()
    observer = CopilotProgress(events.append, cancel)
    with bind_copilot_progress(observer):
        copilot_deepseek_thinking_event(chat_thinking("等待合并的小片段"))
        cancel.set()
        with pytest.raises(CopilotRequestCancelled):
            observer.flush_text()
    assert events == []


def test_invalid_deepseek_thinking_shapes_do_not_become_text():
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    with bind_copilot_progress(observer):
        for event in [
            {"choices": None}, {"choices": []}, {"choices": ["not an object"]},
            {"choices": [{"delta": "not an object"}]}, chat_thinking({"nested": "unknown"}),
            {"choices": [{"delta": {"reasoning": "ambiguous"}}]},
        ]:
            copilot_deepseek_thinking_event(event)
        observer.flush_text()
    assert events == []


def test_deepseek_retry_and_next_pass_keep_thinking_segments_separate():
    events, requests = [], []

    class InterruptedStream(httpx.SyncByteStream):
        def __iter__(self):
            yield f"data: {json.dumps(chat_thinking('第一轮'))}\n\n".encode()
            raise httpx.ReadTimeout("mock timeout")

    def handler(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(200, stream=InterruptedStream(), headers={"content-type": "text/event-stream"})
        return stream_response(chat_thinking("重试" if len(requests) == 2 else "下一次处理"), chat_result())

    with bind_copilot_progress(CopilotProgress(events.append, threading.Event())):
        client = deepseek_adapter(handler, max_retries=1)
        assert generate(client)["title"] == "story"
        assert generate(client)["title"] == "story"
    assert len(requests) == 3
    assert "".join(event["delta"] for event in events if event["type"] == "model_thinking") == "第一轮\n\n重试\n\n下一次处理"


def test_hedged_deepseek_routes_never_mix_winning_or_losing_thinking():
    events = []
    primary_cancelled = threading.Event()

    class SlowPrimary(MockLLMAdapter):
        def generate_structured_output_stream_cancellable(self, *args, cancel_event, **kwargs):
            copilot_deepseek_thinking_event(chat_thinking("LOSING_ROUTE" * 10))
            assert cancel_event.wait(1)
            primary_cancelled.set()
            return {"title": "too late"}

    class FastFallback(MockLLMAdapter):
        def generate_structured_output_stream_cancellable(self, *args, **kwargs):
            copilot_deepseek_thinking_event(chat_thinking("WINNING_ROUTE" * 10))
            return {"title": "fallback", "_meta": {}}

    client = ModelFailoverLLMAdapter(
        primary=SlowPrimary(model_name="deepseek-v4-1-flash-260910"),
        fallback=FastFallback(model_name="deepseek-v4-1-flash-260910"), hedge_delay_seconds=0.02,
    )
    observer = CopilotProgress(events.append, threading.Event())
    with bind_copilot_progress(observer):
        result = client.generate_structured_output_stream(
            "PRIVATE", strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=SCHEMA,
        )
        observer.flush_text()
    assert result["title"] == "fallback"
    assert primary_cancelled.wait(1)
    assert not any(event["type"] in {"model_thinking", "reasoning_summary"} for event in events)
