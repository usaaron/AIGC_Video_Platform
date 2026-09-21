"""Quick has its own bounded wait; standard roles and retries stay unchanged."""
from concurrent.futures import ThreadPoolExecutor
import json
import threading
import time

import httpx
import pytest

from app.main import create_app
from app.modules.quick_script.engine import QuickEngineError, QuickScriptEngine
from app.modules.quick_script.models import QuickPlanContent
from app.modules.quick_script.repository import QuickRepository
from app.modules.quick_script.service import QuickService
from app.modules.script_engine.llm_adapter import LLMRequestError, RealLLMAdapter, ModelFailoverLLMAdapter
from app.modules.script_engine.llm_deadline import remaining_deadline_seconds
from app.modules.script_engine.models import GenerationStrategy
from tests.quick_script_fixtures import make_state, make_llm_draft, add_episode
from tests.test_quick_script_engine import passed
from tests.test_llm_adapter import build_strategy
from tests.test_quick_script_service import make_test_service, act, PROJECT_ID


SYNOPSIS = "调查员带着原始档案核对签名，在证人帮助下找到真实保管人，公开证据并保护证人的安全。"


def make_adapter(handler):
    return RealLLMAdapter(provider="openai_compatible", model_name="deepseek-v4.1-flash", api_key="PRIVATE_KEY",
        base_url="https://quick.invalid/v1", wire_api="chat_completions", timeout_seconds=600,
        request_deadline_seconds=120, max_retries=3, reasoning_effort="high", thinking_mode="enabled",
        transport=httpx.MockTransport(handler))


def sse_response(value):
    events = [
        {"choices": [{"delta": {"reasoning_content": "核对已确认的故事目标与人物。"}}]},
        {"choices": [{"delta": {"content": json.dumps(value, ensure_ascii=False)}}]},
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
    ]
    return httpx.Response(200, headers={"content-type": "text/event-stream"},
        text="".join(f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in events) + "data: [DONE]\n\n")


def quick_engine(adapter, **kwargs):
    return QuickScriptEngine(planning_adapter=adapter, script_adapter=adapter, verified_context_tokens=250_000, **kwargs)


@pytest.mark.parametrize("duration,success", [(121, True), (479, True), (481, False)])
def test_quick_wait_passes_original_120_cap_but_stops_at_480_with_one_request(monkeypatch, duration, success):
    clock = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(time, "perf_counter", lambda: clock[0])
    calls = []
    def handler(request):
        calls.append(json.loads(request.content))
        assert request.extensions["timeout"]["read"] == 480
        clock[0] += duration
        return sse_response({"synopsis": SYNOPSIS})
    adapter = make_adapter(handler)
    try:
        if success:
            result = quick_engine(adapter).draft_synopsis(make_state())
            assert result.synopsis == SYNOPSIS
            assert result.call.physical_requests == 1
        else:
            with pytest.raises(QuickEngineError) as failure:
                quick_engine(adapter).draft_synopsis(make_state())
            assert failure.value.code == "quick_model_timeout"
            assert failure.value.call.physical_requests == 1
            assert failure.value.diagnostics == {"error_type": "DeadlineExceeded", "category": "deadline",
                "deadline_scope": "request", "elapsed_ms": 481_000, "physical_requests": 1}
        assert len(calls) == 1
        assert calls[0]["stream"] is True
        assert adapter._request_deadline_seconds == 120
        assert remaining_deadline_seconds() is None
    finally:
        adapter._client.close()


def test_quick_override_is_restored_and_standard_still_times_out_at_120(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    read_limits = []
    def handler(request):
        read_limits.append(request.extensions["timeout"]["read"])
        clock[0] += 121
        return sse_response({"synopsis": SYNOPSIS})
    adapter = make_adapter(handler)
    try:
        quick_engine(adapter).draft_synopsis(make_state())
        with pytest.raises(LLMRequestError) as error:
            adapter.generate_structured_output_stream("标准流程", strategy=GenerationStrategy.model_validate(build_strategy()),
                output_schema=None, on_delta=None)
        assert error.value.category == "deadline"
        assert error.value.deadline_scope == "request"
        quick_engine(adapter).draft_synopsis(make_state())
        assert read_limits == [480, 120, 480]
    finally:
        adapter._client.close()


def test_concurrent_standard_request_keeps_original_deadline_and_effort_on_same_adapter():
    barrier = threading.Barrier(2)
    observed = []
    plan = {key: value for key, value in make_state().plan.model_dump(mode="json").items() if key in QuickPlanContent.model_fields}
    def handler(request):
        payload = json.loads(request.content)
        observed.append({"read": request.extensions["timeout"]["read"], "effort": payload["reasoning_effort"],
            "thinking": payload["thinking"], "stream": payload["stream"], "model": payload["model"]})
        barrier.wait(timeout=5)
        return sse_response(plan)
    adapter = make_adapter(handler)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            quick = pool.submit(quick_engine(adapter).draft_plan, make_state())
            standard = pool.submit(adapter.generate_structured_output_stream, "标准流程",
                strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=None, on_delta=None)
            assert quick.result(timeout=10).plan.episodes
            assert standard.result(timeout=10)["episodes"]
        assert len(observed) == 2
        quick_call = next(item for item in observed if item["effort"] == "low")
        standard_call = next(item for item in observed if item["effort"] == "high")
        assert 479 < quick_call["read"] <= 480
        assert 119 < standard_call["read"] <= 120
        assert all(item["thinking"] == {"type": "enabled"} and item["stream"] is True for item in observed)
        assert {item["model"] for item in observed} == {"deepseek-v4.1-flash"}
        assert adapter._effective_reasoning_effort == "high"
        assert adapter._request_deadline_seconds == 120
    finally:
        adapter._client.close()


@pytest.mark.parametrize("status,code,category", [
    (524, "quick_model_timeout", "provider_gateway"), (504, "quick_model_timeout", "provider_gateway"),
    (401, "quick_model_configuration", "provider_http"), (429, "quick_model_busy", "provider_http"),
    (503, "quick_model_upstream", "provider_gateway"),
])
def test_failed_single_http_request_has_safe_diagnostics_and_no_hidden_fallback(status, code, category):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"message": "PRIVATE_KEY private author synopsis https://internal.example"}})
    adapter = make_adapter(handler)
    try:
        with pytest.raises(QuickEngineError) as failure:
            quick_engine(adapter).draft_synopsis(make_state())
        assert failure.value.code == code
        diagnostics = failure.value.diagnostics
        assert diagnostics["http_status"] == status
        assert diagnostics["category"] == category
        assert diagnostics["physical_requests"] == 1
        assert len(calls) == 1
        serialized = json.dumps(diagnostics)
        assert "PRIVATE_KEY" not in serialized and "synopsis" not in serialized and "https" not in serialized
    finally:
        adapter._client.close()


@pytest.mark.parametrize("error_type,code,category", [(httpx.ReadTimeout, "quick_model_timeout", "timeout"),
                                                       (httpx.ReadError, "quick_model_connection", "transport")])
def test_raw_transport_exception_under_request_budget_is_classified(error_type, code, category):
    calls = []
    def handler(request):
        calls.append(request)
        raise error_type("PRIVATE_KEY author story", request=request)
    adapter = make_adapter(handler)
    try:
        with pytest.raises(QuickEngineError) as failure:
            quick_engine(adapter).draft_synopsis(make_state())
        assert failure.value.code == code
        assert failure.value.diagnostics["category"] == category
        assert failure.value.diagnostics["physical_requests"] == 1
        assert len(calls) == 1
    finally:
        adapter._client.close()


def test_deadline_receipt_and_manual_recovery_keep_confirmed_synopsis(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(time, "perf_counter", lambda: clock[0])
    service, _, runtime = make_test_service()
    act(service, "setup", {"settings": {"episode_count": 2, "target_total_characters": 2000}})
    act(service, "confirm_synopsis", {"synopsis": SYNOPSIS})
    plan = {key: value for key, value in make_state().plan.model_dump(mode="json").items() if key in QuickPlanContent.model_fields}
    calls = []
    def handler(request):
        calls.append(json.loads(request.content))
        clock[0] += 481 if len(calls) == 1 else 130
        return sse_response(plan)
    adapter = make_adapter(handler)
    service = QuickService(QuickRepository(runtime), quick_engine(adapter))
    try:
        failed = act(service, "draft_plan")
        assert failed.state.status == "blocked"
        assert failed.state.next_step == "plan"
        assert failed.state.synopsis == SYNOPSIS and failed.state.synopsis_confirmed
        receipt = failed.state.operation_records[-1]
        assert receipt["error_code"] == "quick_model_timeout"
        assert receipt["diagnostics"]["deadline_scope"] == "request"
        assert receipt["diagnostics"]["physical_requests"] == 1
        operation_id = receipt["operation_id"]
        act(service, "draft_plan", operation_id=operation_id, revision=0)
        assert len(calls) == 1
        # New request IDs are authorized only by explicit resume/continue.
        recovered = act(service, "resume")
        assert recovered.state.synopsis == SYNOPSIS and recovered.state.synopsis_confirmed
        assert not recovered.state.plan_confirmed
        result = act(service, "draft_plan")
        assert result.state.plan is not None and result.state.status == "idle"
        assert result.state.synopsis == SYNOPSIS
        assert len(calls) == 2
        assert [call.stage for call in result.state.model_calls] == ["plan", "plan"]
        assert all(call.physical_requests == 1 for call in result.state.model_calls)
        assert calls[0]["reasoning_effort"] == calls[1]["reasoning_effort"] == "low"
    finally:
        adapter._client.close()
        runtime.engine.dispose()


def test_other_quick_stages_keep_their_configured_effort():
    observed = []
    def handler(request):
        observed.append(json.loads(request.content))
        return sse_response({"synopsis": SYNOPSIS})
    adapter = make_adapter(handler)
    try:
        quick_engine(adapter).draft_synopsis(make_state())
        assert observed[0]["reasoning_effort"] == "high"
        assert observed[0]["thinking"] == {"type": "enabled"}
    finally:
        adapter._client.close()


@pytest.mark.parametrize("stage", ["draft", "review"])
def test_quick_draft_and_review_use_bounded_effort_without_changing_shared_role(stage):
    plan = {key: value for key, value in make_state().plan.model_dump(mode="json").items() if key in QuickPlanContent.model_fields}
    observed = []
    def handler(request):
        observed.append(json.loads(request.content))
        return sse_response(plan if len(observed) == 1 else make_llm_draft() if stage == "draft" else passed())
    adapter = make_adapter(handler)
    try:
        engine = quick_engine(adapter)
        state = make_state()
        engine.draft_plan(state)
        if stage == "draft":
            engine.generate_episode(state, 1)
        else:
            add_episode(state, status="drafted")
            engine.review_episode(state, 1)
        assert [call["reasoning_effort"] for call in observed] == ["low", "low"]
        assert observed[-1]["max_tokens"] == 16_384
        assert all(call["thinking"] == {"type": "enabled"} for call in observed)
        assert adapter._request_reasoning_effort() == "high"
    finally:
        adapter._client.close()


def test_600_second_operation_budget_caps_preflight_plus_single_request(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    requests = []
    def handler(request):
        requests.append(request)
        assert request.extensions["timeout"]["read"] == 450
        clock[0] += 451
        return sse_response({"synopsis": SYNOPSIS})
    adapter = make_adapter(handler)
    class DelayedAdapter:
        def get_model_info(self):
            return adapter.get_model_info()

        def generate_structured_output_stream(self, *args, **kwargs):
            clock[0] += 150
            return adapter.generate_structured_output_stream(*args, **kwargs)
    try:
        with pytest.raises(QuickEngineError) as failure:
            quick_engine(DelayedAdapter()).draft_synopsis(make_state())
        assert failure.value.code == "quick_model_timeout"
        assert failure.value.diagnostics["deadline_scope"] == "quick_operation"
        assert failure.value.call.physical_requests == 1
        assert len(requests) == 1
        assert remaining_deadline_seconds() is None
    finally:
        adapter._client.close()


def test_production_style_failover_retains_primary_deadline_when_budget_blocks_fallback(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: clock[0])
    calls = []
    def primary_handler(request):
        calls.append("primary")
        clock[0] += 481
        return sse_response({"synopsis": SYNOPSIS})
    def fallback_handler(request):
        calls.append("fallback")
        return sse_response({"synopsis": SYNOPSIS})
    primary, fallback = make_adapter(primary_handler), make_adapter(fallback_handler)
    adapter = ModelFailoverLLMAdapter(primary=primary, fallback=fallback, failover_on_request_deadline=True)
    try:
        with pytest.raises(QuickEngineError) as failure:
            quick_engine(adapter).draft_synopsis(make_state())
        assert failure.value.code == "quick_model_timeout"
        assert failure.value.diagnostics["category"] == "deadline"
        assert failure.value.diagnostics["deadline_scope"] == "request"
        assert failure.value.call.physical_requests == 1
        assert calls == ["primary"]
    finally:
        primary._client.close()
        fallback._client.close()
