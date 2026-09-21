"""Reserve both visible reasoning and the complete screenplay in one Quick POST."""
import json
import threading
import time

import pytest

import app.main
from app.modules.quick_script.engine import QuickEngineError, QuickScriptEngine
from app.modules.quick_script.failures import classify_failure
from app.modules.quick_script.repository import QuickRepository
from app.modules.quick_script.service import QuickService
from app.modules.script_engine.copilot_progress import CopilotProgress, bind_copilot_progress
from app.modules.script_engine.llm_adapter import LLMRequestError, LLMStructuredOutputError
from app.modules.script_engine.models import GenerationStrategy
from tests.quick_script_fixtures import make_state, make_llm_draft, add_episode, make_overseas_state, make_overseas_llm_draft
from tests.test_quick_script_engine import FakeAdapter
from tests.test_quick_script_resilience import make_adapter, sse_response, quick_engine
from tests.test_quick_script_service import make_test_service, act
from tests.test_llm_adapter import build_strategy


@pytest.mark.parametrize("language", ["zh", "en"])
@pytest.mark.parametrize("headroom", [8_191, 8_192, 12_288, 16_384, 24_000])
def test_draft_headroom_uses_full_prefix_and_never_crosses_verified_budget(language, headroom):
    state = make_state() if language == "zh" else make_overseas_state()
    add_episode(state)
    output = make_llm_draft(2, 2) if language == "zh" else make_overseas_llm_draft(2, 2)
    first = FakeAdapter(output)
    reference = quick_engine(first).generate_episode(state, 2)
    upper_bound = reference.call.input_upper_bound_tokens
    before = state.model_dump(mode="json")
    adapter = FakeAdapter(output)
    engine = QuickScriptEngine(planning_adapter=adapter, script_adapter=adapter,
                               verified_context_tokens=upper_bound + headroom)
    if headroom < 8_192:
        with pytest.raises(QuickEngineError) as failure:
            engine.generate_episode(state, 2)
        assert failure.value.code == "quick_context_limit"
        assert adapter.calls == []
    else:
        result = engine.generate_episode(state, 2)
        assert result.call.physical_requests == len(adapter.calls) == 1
        assert result.call.output_reserve_tokens == min(16_384, headroom)
        assert result.call.input_upper_bound_tokens == upper_bound
        assert result.call.input_upper_bound_tokens + result.call.output_reserve_tokens <= engine.verified_context_tokens
        assert adapter.calls[0]["prompt"] == first.calls[0]["prompt"]
        assert adapter.calls[0]["strategy"].max_tokens == min(16_384, headroom)
    assert state.model_dump(mode="json") == before


def test_draft_also_respects_model_context_cap():
    state = make_state()
    adapter = FakeAdapter(make_llm_draft())
    reference = quick_engine(adapter).generate_episode(state, 1)
    model_cap = reference.call.input_upper_bound_tokens + 9_000
    class SmallerContext(FakeAdapter):
        def get_model_info(self):
            return super().get_model_info().model_copy(update={"max_context_tokens": model_cap})
    bounded = SmallerContext(make_llm_draft())
    result = quick_engine(bounded).generate_episode(state, 1)
    assert result.call.output_reserve_tokens == 9_000
    assert result.call.input_upper_bound_tokens + result.call.output_reserve_tokens == model_cap


@pytest.mark.parametrize("effort", ["low", "high"])
def test_actual_deepseek_protocol_keeps_streaming_thinking_and_restores_shared_adapter(effort):
    calls, events = [], []
    def handler(request):
        calls.append(json.loads(request.content))
        return sse_response(make_llm_draft())
    adapter = make_adapter(handler)
    try:
        observer = CopilotProgress(events.append, threading.Event())
        with bind_copilot_progress(observer):
            result = quick_engine(adapter, draft_reasoning_effort=effort).generate_episode(make_state(), 1)
            observer.flush_text()
        adapter.generate_structured_output_stream("unrelated standard request",
            strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=None, on_delta=None)
        assert result.call.physical_requests == 1
        assert [row["reasoning_effort"] for row in calls] == [effort, "high"]
        assert calls[0]["max_tokens"] == 16_384
        assert all(row["stream"] and row["thinking"] == {"type": "enabled"} for row in calls)
        assert any(event["type"] == "model_thinking" for event in events)
        assert adapter._effective_reasoning_effort == "high"
    finally:
        adapter._client.close()


def exhausted_response():
    import httpx
    events = [{"choices": [{"delta": {"reasoning_content": "PRIVATE_REASONING" * 20}, "finish_reason": "length"}]}]
    return httpx.Response(200, headers={"content-type": "text/event-stream"},
        text="".join(f"data: {json.dumps(event)}\n\n" for event in events) + "data: [DONE]\n\n")


def test_typed_exhaustion_stops_after_one_post_and_restores_effort():
    calls = []
    def handler(request):
        calls.append(json.loads(request.content))
        return exhausted_response()
    adapter = make_adapter(handler)
    try:
        with pytest.raises(QuickEngineError) as failure:
            quick_engine(adapter).generate_episode(make_state(), 1)
        assert failure.value.code == "quick_reasoning_output_exhausted"
        assert failure.value.call.physical_requests == len(calls) == 1
        assert failure.value.call.output_reserve_tokens == 16_384
        assert failure.value.diagnostics["category"] == "empty_response"
        assert "PRIVATE_REASONING" not in json.dumps(failure.value.diagnostics)
        assert adapter._request_reasoning_effort() == "high"
    finally:
        adapter._client.close()


@pytest.mark.parametrize("kind,termination,reasoning,raw,refusal,expected", [
    ("request", "finish_reason:length", 100, None, None, True),
    ("structured", "max_output_tokens", 100, "", None, True),
    ("request", "finish_reason:stop", 100, None, None, False),
    ("request", "finish_reason:length", 0, None, None, False),
    ("request", "finish_reason:length", 100, '{"title":', None, False),
    ("structured", "finish_reason:length", 100, "", "refused", False),
    ("request", "failed:max_output_tokens", 100, None, None, False),
])
def test_classification_requires_typed_reasoning_only_ceiling(kind, termination, reasoning, raw, refusal, expected):
    if kind == "request":
        error = LLMRequestError("PRIVATE_MESSAGE token_limit length", category="empty_response")
        error.stream_termination, error.raw_content, error.refusal = termination, raw, refusal
    else:
        error = LLMStructuredOutputError("PRIVATE_MESSAGE", empty_response=True, stream_termination=termination,
                                         raw_content=raw, refusal=refusal)
    error.reasoning_characters = reasoning
    wrapper = RuntimeError("PRIVATE_WRAPPER")
    wrapper.__cause__ = error
    code, message, diagnostics = classify_failure(wrapper, elapsed_ms=100, physical_requests=1)
    assert (code == "quick_reasoning_output_exhausted") == expected
    assert "PRIVATE" not in message + json.dumps(diagnostics)


def test_draft_deadline_still_stops_at_480_with_expanded_reserve(monkeypatch):
    clock, calls = [1000.0], []
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(time, "perf_counter", lambda: clock[0])
    def handler(request):
        calls.append(json.loads(request.content))
        assert request.extensions["timeout"]["read"] == 480
        clock[0] += 481
        return sse_response(make_llm_draft())
    adapter = make_adapter(handler)
    try:
        with pytest.raises(QuickEngineError) as failure:
            quick_engine(adapter).generate_episode(make_state(), 1)
        assert failure.value.code == "quick_model_timeout"
        assert failure.value.call.physical_requests == len(calls) == 1
        assert calls[0]["max_tokens"] == 16_384 and calls[0]["reasoning_effort"] == "low"
    finally:
        adapter._client.close()


def test_manual_resume_preserves_plan_and_generates_only_missing_episode():
    service, _, runtime = make_test_service()
    act(service, "setup", {"settings": {"episode_count": 2, "target_total_characters": 2000}})
    act(service, "draft_synopsis")
    act(service, "confirm_synopsis")
    act(service, "draft_plan")
    confirmed = act(service, "confirm_plan")
    calls = []
    def handler(request):
        calls.append(json.loads(request.content))
        return exhausted_response() if len(calls) == 1 else sse_response(make_llm_draft())
    adapter = make_adapter(handler)
    service = QuickService(QuickRepository(runtime), quick_engine(adapter))
    try:
        failed = act(service, "advance")
        receipt = failed.state.operation_records[-1]
        assert receipt["error_code"] == "quick_reasoning_output_exhausted"
        assert failed.state.next_step == "draft" and not failed.state.episodes
        act(service, "advance", operation_id=receipt["operation_id"], revision=0)
        assert len(calls) == 1
        act(service, "resume")
        assert len(calls) == 1
        restored = act(service, "advance")
        assert restored.state.plan.model_dump() == confirmed.state.plan.model_dump()
        assert restored.state.plan_confirmed and len(restored.state.episodes) == 1
        assert restored.state.next_step == "review" and len(calls) == 2
        assert all(call.physical_requests == 1 for call in restored.state.model_calls[-2:])
    finally:
        adapter._client.close()
        runtime.engine.dispose()


@pytest.mark.parametrize("effort", ["none", "disabled", "", "unexpected"])
def test_invalid_draft_effort_is_rejected_before_request(effort):
    adapter = FakeAdapter()
    with pytest.raises(QuickEngineError) as failure:
        quick_engine(adapter, draft_reasoning_effort=effort)
    assert failure.value.code == "quick_model_configuration"
    assert not adapter.calls
