"""A gateway transport change must consume, not extend, the existing retries."""
from __future__ import annotations

import json
import time

import httpx
import pytest

from app.modules.script_engine.llm_adapter import (
    AdaptiveTransportLLMAdapter, AdaptiveTransportState, LLMRequestError,
    LLMStructuredOutputError, RealLLMAdapter, PooledLLMAdapter,
)
from app.modules.script_engine.models import GenerationStrategy


@pytest.fixture
def strategy() -> GenerationStrategy:
    return GenerationStrategy.model_validate({
        "id": "strategy.shortdrama.gateway", "name": "Short drama",
        "target_platform": "hongguo", "target_content_type": "ai_comic_drama",
        "applicable_tags": ["genre.suspense"], "model_provider": "openai_compatible",
        "model_name": "deepseek-v4-pro", "temperature": 0.7, "top_p": 0.9,
        "max_tokens": 32000, "workflow_steps": [{"step_order": 1, "name": "script",
        "description": "Revise the episode", "prompt_id": "prompt.script"}],
        "prompt_ids": ["prompt.script"], "qc_enabled": True, "self_check_enabled": True,
        "human_review_required": False, "output_schema": {"type": "object"},
        "version": "v1", "status": "active",
    })


def route(handler, *, retries=1, model="deepseek-v4-pro", wire_api="chat_completions"):
    return RealLLMAdapter(provider="openai_compatible", model_name=model, api_key="test-secret",
        base_url="https://gateway.invalid/v1", reasoning_effort="medium", thinking_mode="enabled",
        timeout_seconds=600, request_deadline_seconds=600, max_retries=retries, wire_api=wire_api,
        transport=httpx.MockTransport(handler))


def gateway(status=524):
    return httpx.Response(status, text="<!doctype html><html><title>Gateway time-out</title></html>",
                          headers={"content-type": "text/html"})


def stream(content='{"title":"完整正文"}', *, finish="stop"):
    events = [
        {"id": "same-route-stream", "choices": [{"delta": {"reasoning_content": "照常推理"}}]},
        {"choices": [{"delta": {"content": content}}]},
    ]
    if finish is not None:
        events.append({"choices": [{"delta": {}, "finish_reason": finish}]})
    events.append({"choices": [], "usage": {"prompt_tokens": 400, "completion_tokens": 600, "total_tokens": 1000}})
    return httpx.Response(200, text="".join(f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in events) + "data: [DONE]\n\n",
                          headers={"content-type": "text/event-stream"})


def ordinary():
    return httpx.Response(200, json={"choices": [{"message": {"content": '{"title":"普通成功"}'}, "finish_reason": "stop"}]})


def test_direct_full_episode_call_uses_remaining_retry_as_stream_without_changing_profile(strategy, caplog):
    requests = []
    def handler(request):
        requests.append(request)
        return gateway() if len(requests) == 1 else stream()
    adapter = route(handler)
    schema = {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}
    result = adapter.generate_structured_output("Keep every approved scene.", strategy=strategy, output_schema=schema)
    assert result["title"] == "完整正文"
    assert len(requests) == 2
    first, second = [json.loads(request.content) for request in requests]
    assert first.get("stream") is not True and second.pop("stream") is True
    assert first == second  # prompt, model, budget, reasoning, thinking and schema are unchanged.
    assert first["model"] == "deepseek-v4-pro"
    assert adapter._reasoning_effort == "medium"
    assert first["reasoning_effort"] == adapter._effective_reasoning_effort
    assert first["thinking"] == {"type": "enabled"}
    assert requests[0].url == requests[1].url
    assert requests[0].headers["authorization"] == requests[1].headers["authorization"]
    assert result["_meta"]["gateway_retry_transport"] == "stream"
    assert result["_meta"]["gateway_retry_status_code"] == 524
    assert result["_meta"]["usage"]["total_tokens"] == 1000
    assert result["_meta"]["response_id"] == "same-route-stream"
    assert adapter._max_retries == 1 and adapter._timeout_seconds == 600
    assert adapter._request_deadline_seconds == 600
    assert "reason=non_stream_524 attempt=2/2" in caplog.text


@pytest.mark.parametrize("retries,expected", [(0,[False]), (1,[False,True]), (3,[False,True,True,True])])
def test_failure_consumes_only_configured_attempts_and_cannot_ping_pong(strategy, retries, expected):
    modes=[]
    def handler(request):
        modes.append(json.loads(request.content).get("stream") is True)
        return gateway()
    with pytest.raises(LLMRequestError) as failure:
        route(handler, retries=retries).generate_structured_output("Episode", strategy=strategy)
    assert modes == expected
    assert failure.value.status_code == 524
    if retries:
        assert failure.value.gateway_deadline is True
        assert failure.value.non_stream_gateway_retry_attempted is True
        assert failure.value.stream_fallback_attempted is True


@pytest.mark.parametrize("status", [400,401,429,500,502,503])
def test_other_statuses_keep_existing_transport_and_retry_behavior(strategy, status):
    modes=[]
    def handler(request):
        modes.append(json.loads(request.content).get("stream") is True)
        return gateway(status)
    with pytest.raises(LLMRequestError):
        route(handler).generate_structured_output("Episode", strategy=strategy)
    assert modes == ([False] if status<500 else [False,False])


@pytest.mark.parametrize("model,wire", [("gpt-test","chat_completions"),("deepseek-v4-pro","responses")])
def test_unproven_model_or_wire_protocol_does_not_change(strategy, model, wire):
    modes=[]
    def handler(request):
        modes.append(json.loads(request.content).get("stream") is True)
        return gateway()
    with pytest.raises(LLMRequestError):
        route(handler, model=model, wire_api=wire).generate_structured_output("Episode", strategy=strategy)
    assert modes == [False,False]


def test_non_stream_success_does_not_add_a_model_call(strategy):
    requests=[]
    def handler(request):
        requests.append(json.loads(request.content))
        return ordinary()
    assert route(handler).generate_structured_output("Episode", strategy=strategy)["title"] == "普通成功"
    assert len(requests)==1 and requests[0].get("stream") is not True


@pytest.mark.parametrize("content,finish", [('{"title":"未完成"}',"length"), ('{"title":',None), ('{"title":',"stop")])
def test_retry_never_accepts_incomplete_or_malformed_output_or_spends_another_attempt(strategy, content, finish):
    modes=[]
    def handler(request):
        modes.append(json.loads(request.content).get("stream") is True)
        return gateway() if len(modes)==1 else stream(content,finish=finish)
    with pytest.raises(LLMStructuredOutputError) as failure:
        route(handler,retries=3).generate_structured_output("Episode",strategy=strategy)
    assert modes==[False,True]
    assert failure.value.raw_content == content
    assert failure.value.gateway_deadline is True


def test_transport_failure_after_a_body_delta_is_not_replayed(strategy):
    modes=[]
    class Interrupted(httpx.SyncByteStream):
        def __iter__(self):
            yield b'data: {"choices":[{"delta":{"content":"{\\"title\\":\\"partial"}}]}\n\n'
            raise httpx.RemoteProtocolError("peer closed after partial output")
    def handler(request):
        modes.append(json.loads(request.content).get("stream") is True)
        return gateway() if len(modes)==1 else httpx.Response(200,stream=Interrupted(),headers={"content-type":"text/event-stream"})
    with pytest.raises(LLMRequestError) as failure:
        route(handler,retries=3).generate_structured_output("Episode",strategy=strategy)
    assert modes==[False,True]
    assert failure.value.category == "transport"
    assert failure.value.gateway_deadline is True
    assert failure.value.raw_content == '{"title":"partial'
    assert failure.value.recoverable is False
    assert failure.value.stream_fallback_attempted is True


def test_successful_sse_retry_clears_only_the_adaptive_preference_and_reports_actual_transport(strategy):
    modes=[]
    def handler(request):
        modes.append(json.loads(request.content).get("stream") is True)
        return gateway() if len(modes)==1 else stream()
    state=AdaptiveTransportState()
    state.prefer_non_stream_until=time.monotonic()+900
    state.consecutive_reasoning_length_failures=1
    adapter=AdaptiveTransportLLMAdapter(adapter=route(handler),state=state)
    deltas=[]
    result=adapter.generate_structured_output_stream("Episode",strategy=strategy,on_delta=lambda text,reset:deltas.append((text,reset)))
    assert modes == [False,True]
    assert result['_meta']['adaptive_transport']=='stream'
    assert result['_meta']['adaptive_transport_reason']=='non_stream_gateway_524_retry'
    assert state.prefer_non_stream_until==0 and state.consecutive_reasoning_length_failures==0
    assert len(deltas)==1 and deltas[0][1] is True
    assert json.loads(deltas[0][0])=={'title':'完整正文'}
    adapter.generate_structured_output_stream("Next episode",strategy=strategy)
    assert modes==[False,True,True]


def test_switch_retains_elapsed_time_in_the_original_deadline(strategy,monkeypatch):
    clock=[1000.0]
    monkeypatch.setattr('app.modules.script_engine.llm_deadline.time.monotonic',lambda:clock[0])
    requests=[]
    def handler(request):
        requests.append(request)
        if len(requests)==1:
            clock[0]+=126
            return gateway()
        # No new 600-second window: the second transport has only 474 seconds.
        assert request.extensions['timeout']['read']==474
        clock[0]+=475
        return stream()
    adapter=route(handler)
    with pytest.raises(LLMRequestError) as failure:
        adapter.generate_structured_output("Episode",strategy=strategy)
    assert len(requests)==2
    assert failure.value.category=='deadline'
    assert failure.value.recoverable is False


def test_partial_retry_body_cannot_rotate_to_another_pooled_key(strategy):
    requests=[]
    class Interrupted(httpx.SyncByteStream):
        def __iter__(self):
            event={"choices":[{"delta":{"content":'{"title":"partial'}}]}
            yield f"data: {json.dumps(event)}\n\n".encode()
            raise httpx.RemoteProtocolError("peer closed after body delta")
    def handler(request):
        requests.append(request)
        return gateway() if len(requests)==1 else httpx.Response(200,stream=Interrupted(),headers={"content-type":"text/event-stream"})
    adapter=PooledLLMAdapter(provider="openai_compatible",model_name="deepseek-v4-pro",api_keys=["key-one","key-two"],
        base_url="https://gateway.invalid/v1",reasoning_effort="medium",thinking_mode="enabled",max_retries=1,
        transport=httpx.MockTransport(handler))
    with pytest.raises(LLMRequestError) as failure:
        adapter.generate_structured_output("Episode",strategy=strategy)
    assert len(requests)==2
    assert requests[0].headers['authorization']==requests[1].headers['authorization']
    assert failure.value.raw_content=='{"title":"partial'
    assert failure.value.pool_key_attempt_count==1
    assert failure.value.stream_fallback_attempted is True
