"""A bounded Quick check must return its verdict alongside streamed thinking."""
import json
import threading

import pytest
import app.main

from app.modules.quick_script.engine import QuickEngineError, QuickScriptEngine
from app.modules.script_engine.copilot_progress import CopilotProgress, bind_copilot_progress
from tests.quick_script_fixtures import add_episode, make_state
from tests.test_quick_script_engine import FakeAdapter, passed
from tests.test_quick_script_resilience import make_adapter, quick_engine, sse_response
from tests.test_quick_draft_budget import exhausted_response


def review_state(stage):
    state = make_state()
    add_episode(state, 1)
    if stage == "final_review":
        add_episode(state, 2)
    elif stage == "recheck":
        state.episodes[0].repair_count = 1
    return state


def invoke(engine, state, stage):
    return engine.review_final(state) if stage == "final_review" else engine.review_episode(state, 1)


@pytest.mark.parametrize("stage", ["review", "recheck", "final_review"])
@pytest.mark.parametrize("headroom", [7_999, 8_000, 10_000, 16_384, 24_000])
def test_review_budget_retains_whole_prompt_and_respects_context(stage, headroom):
    state = review_state(stage)
    before = state.model_dump(mode="json")
    reference_adapter = FakeAdapter(passed())
    reference = invoke(quick_engine(reference_adapter), state, stage)
    bound = reference.call.input_upper_bound_tokens
    adapter = FakeAdapter(passed())
    runtime = QuickScriptEngine(planning_adapter=adapter, script_adapter=adapter,
                                verified_context_tokens=bound + headroom)
    if headroom < 8_000:
        with pytest.raises(QuickEngineError) as failure:
            invoke(runtime, state, stage)
        assert failure.value.code == "quick_context_limit" and not adapter.calls
    else:
        result = invoke(runtime, state, stage)
        assert result.call.physical_requests == len(adapter.calls) == 1
        assert result.call.output_reserve_tokens == min(16_384, headroom)
        assert result.call.input_upper_bound_tokens + result.call.output_reserve_tokens <= bound + headroom
        assert adapter.calls[0]["prompt"] == reference_adapter.calls[0]["prompt"]
    assert state.model_dump(mode="json") == before


@pytest.mark.parametrize("stage", ["review", "recheck", "final_review"])
@pytest.mark.parametrize("effort", ["low", "high"])
def test_actual_transport_keeps_thinking_and_scope_does_not_leak(stage, effort):
    calls, events = [], []
    def handler(request):
        calls.append(json.loads(request.content))
        return sse_response(passed())
    adapter = make_adapter(handler)
    original = adapter._request_reasoning_effort()
    try:
        observer = CopilotProgress(events.append, threading.Event())
        with bind_copilot_progress(observer):
            result = invoke(quick_engine(adapter, review_reasoning_effort=effort), review_state(stage), stage)
            observer.flush_text()
        assert result.call.physical_requests == len(calls) == 1
        assert calls[0]["reasoning_effort"] == effort and calls[0]["thinking"] == {"type": "enabled"}
        assert calls[0]["max_tokens"] == 16_384
        assert any(event["type"] == "model_thinking" for event in events)
        assert adapter._request_reasoning_effort() == original
    finally:
        adapter._client.close()


def test_recheck_exhaustion_preserves_repaired_body_without_retry():
    calls = []
    def handler(request):
        calls.append(json.loads(request.content))
        return exhausted_response()
    adapter = make_adapter(handler)
    state = review_state("recheck")
    before = state.model_dump(mode="json")
    try:
        with pytest.raises(QuickEngineError) as failure:
            invoke(quick_engine(adapter), state, "recheck")
        assert failure.value.code == "quick_reasoning_output_exhausted"
        assert failure.value.call.physical_requests == len(calls) == 1
        assert state.model_dump(mode="json") == before
    finally:
        adapter._client.close()


@pytest.mark.parametrize("effort", ["none", "", "disabled"])
def test_invalid_review_effort_fails_before_request(effort):
    adapter = FakeAdapter()
    with pytest.raises(QuickEngineError) as failure:
        quick_engine(adapter, review_reasoning_effort=effort)
    assert failure.value.code == "quick_model_configuration" and not adapter.calls
