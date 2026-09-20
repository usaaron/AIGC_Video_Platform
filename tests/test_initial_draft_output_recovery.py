"""Use the existing compact recovery once after a real reasoning-only ceiling."""
from copy import deepcopy
import json
import threading
from types import SimpleNamespace

import httpx
import pytest

import app.modules.agent_runtime
from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.llm_adapter import LLMRequestError, LLMStructuredOutputError, RealLLMAdapter
from app.modules.script_engine import llm_deadline
from app.modules.script_engine.models import GenerationStrategy
from tests.test_llm_adapter import build_strategy
from tests.test_script_generation_service import StubRealScriptAdapter


ORIGINAL = "原请求：只写已批准的第三集，保持人物、四场次序及结尾义务。"
COMPACT = "批准资料紧凑写作包：第三集人物、四场次序、正文引用与结尾义务全部保持。"


def strategy_and_body():
    strategy = GenerationStrategy.model_validate({**build_strategy(), "max_tokens": 32000})
    raw = StubRealScriptAdapter().generate_structured_output("Approved screenplay.", strategy=strategy)
    raw.pop("_meta", None)
    body = LLMGeneratedDraftMasterScript.model_validate(raw).model_dump(mode="json")
    return strategy, body


def sse(*, content="", reasoning="", finish="stop"):
    event = {"choices": [{"delta": {"content": content, "reasoning_content": reasoning}, "finish_reason": finish}]}
    return httpx.Response(200, text=f"data: {json.dumps(event)}\n\ndata: [DONE]\n\n", headers={"content-type": "text/event-stream"})


def route(handler, *, retries=0, model="deepseek-v4-1-flash-260910"):
    return RealLLMAdapter(
        provider="openai_compatible", model_name=model, api_key="test-only",
        base_url="https://body-recovery.test/v1", timeout_seconds=600,
        max_retries=retries, thinking_mode="enabled", reasoning_effort="high",
        retry_empty_response=False, retry_gateway_stream_as_non_stream=False,
        transport=httpx.MockTransport(handler),
    )


def initial_service(primary, fallback):
    service = object.__new__(ScriptGenerationService)
    service._llm_adapter = primary
    service._initial_fallback_llm_adapter = fallback
    service._json_repair_llm_adapter = fallback
    service._repair_llm_adapter = fallback
    service._initial_generation_timeout_seconds = 900
    return service


def generate(service, strategy):
    return service._generate_initial_draft_output(
        prompt=ORIGINAL, compact_recovery_prompt=COMPACT, strategy=strategy,
        progress_callback=None, cancel_event=threading.Event(),
    )


@pytest.mark.parametrize("gateway_retry", [False, True])
def test_real_reasoning_only_sse_uses_same_existing_compact_recovery_and_keeps_transport_retry_disabled(gateway_retry):
    strategy, body = strategy_and_body()
    original_body = deepcopy(body)
    calls = []
    def first(request):
        calls.append(("initial", json.loads(request.content)))
        return sse(reasoning="R" * 90000, finish="length")
    fallback_calls = []
    def recovery(request):
        payload = json.loads(request.content)
        calls.append(("recovery", payload))
        fallback_calls.append(payload)
        if gateway_retry and len(fallback_calls) == 1:
            return httpx.Response(524, json={"error": {"message": "Gateway deadline"}})
        content = json.dumps(body, ensure_ascii=False)
        return sse(content=content) if payload.get("stream") else httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})
    primary, fallback = route(first), route(recovery, retries=int(gateway_retry))
    service = initial_service(primary, fallback)
    result = generate(service, strategy)
    assert [entry[0] for entry in calls] == (["initial", "recovery", "recovery"] if gateway_retry else ["initial", "recovery"])
    assert [entry[1]["thinking"]["type"] for entry in calls] == ["enabled"] + ["disabled"] * len(fallback_calls)
    assert {payload["model"] for _, payload in calls} == {primary.get_model_info().model_name}
    assert {payload["max_tokens"] for _, payload in calls} == {32000}
    for _, payload in calls:
        schema = payload["messages"][-1]["content"].split("<json_contract>\n", 1)[1].split("\n</json_contract>", 1)[0]
        assert json.loads(schema)["required"]
    assert all(COMPACT in p["messages"][-1]["content"] for p in fallback_calls)
    assert all(p.get("response_format") == calls[0][1].get("response_format") for p in fallback_calls)
    assert result["_meta"]["initial_generation_model_pass_count"] == 2
    assert result["_meta"]["initial_generation_output_recovery_used"] is True
    assert result["_meta"]["thinking_mode"] == "disabled"
    draft_payload = {key: value for key, value in result.items() if key != "_meta"}
    assert LLMGeneratedDraftMasterScript.model_validate(draft_payload).scenes == LLMGeneratedDraftMasterScript.model_validate(body).scenes
    assert body == original_body and strategy.max_tokens == 32000
    assert fallback._build_chat_payload(prompt="unrelated next request", strategy=strategy, output_schema=None)["thinking"]["type"] == "enabled"


@pytest.mark.parametrize("initial_failure", ["network", "partial"])
def test_network_and_partially_written_screenplay_keep_existing_high_thinking_repair(initial_failure):
    strategy, body = strategy_and_body()
    seen = []
    def first(_request):
        if initial_failure == "network":
            return httpx.Response(500, json={"error": {"message": "Gateway unavailable"}})
        return sse(content='{"title":"Unfinished screenplay', reasoning="R" * 500, finish="length")
    def recovery(request):
        payload = json.loads(request.content)
        seen.append(payload)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(body)}, "finish_reason": "stop"}]})
    result = generate(initial_service(route(first), route(recovery)), strategy)
    assert len(seen) == 1 and seen[0]["thinking"]["type"] == "enabled"
    assert "initial_generation_output_recovery_used" not in result["_meta"]


def test_refusal_does_not_enable_output_recovery_or_add_a_fallback():
    strategy, _ = strategy_and_body()
    class Refused:
        def generate_structured_output_stream_cancellable(self, *args, **kwargs):
            raise LLMStructuredOutputError("Refused", empty_response=True, refusal="Refused", stream_termination="length")
    fallback = route(lambda _request: pytest.fail("A refusal must not invoke compact output recovery."))
    with pytest.raises(LLMRequestError):
        generate(initial_service(Refused(), fallback), strategy)


def test_failed_output_recovery_stops_and_resets_thinking_without_another_model_call():
    strategy, _ = strategy_and_body()
    calls = []
    primary = route(lambda _request: sse(reasoning="R" * 1000, finish="length"))
    def recovery(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "", "reasoning_content": "R" * 1000}, "finish_reason": "length"}]})
    fallback = route(recovery)
    with pytest.raises(LLMRequestError):
        generate(initial_service(primary, fallback), strategy)
    assert len(calls) == 1 and calls[0]["thinking"]["type"] == "disabled"
    assert fallback._build_chat_payload(prompt="after failure", strategy=strategy, output_schema=None)["thinking"]["type"] == "enabled"


def test_compact_output_recovery_keeps_original_cumulative_deadline(monkeypatch):
    strategy, body = strategy_and_body()
    clock = [1000.0]
    monkeypatch.setattr(llm_deadline, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    remaining = []
    def first(_request):
        remaining.append(llm_deadline.remaining_deadline_seconds())
        clock[0] += 257
        return sse(reasoning="R" * 1000, finish="length")
    def recovery(_request):
        remaining.append(llm_deadline.remaining_deadline_seconds())
        clock[0] += 244
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(body)}, "finish_reason": "stop"}]})
    service = initial_service(route(first), route(recovery))
    with llm_deadline.deadline_scope(500, scope="parent_workflow"):
        with pytest.raises(LLMRequestError) as caught:
            generate(service, strategy)
        assert caught.value.category == "deadline" and caught.value.deadline_scope == "parent_workflow"
        assert remaining == [500, 243]
        # Restore the test clock before the parent context exits; the assertion
        # above already observed the real expiration through the service.
        clock[0] = 1499
