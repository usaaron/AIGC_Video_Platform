"""A roadmap edit gets one answer-only repair after actual reasoning exhaustion."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import json
import threading
from types import SimpleNamespace

import httpx
import pytest

import app.modules.agent_runtime  # Initialize the established service import order.
from app.modules.script_engine.llm_adapter import (
    LLMRequestError, LLMStructuredOutputError, RealLLMAdapter, bind_deepseek_output_recovery,
    is_reasoning_output_exhaustion,
)
from app.modules.script_engine.llm_deadline import deadline_scope, remaining_deadline_seconds
from app.modules.script_engine.long_story_models import EpisodePlanGenerationItem, EpisodePlanItemModificationRequest
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.story_planning_service import StoryPlanningInputError
from tests.test_llm_adapter import build_strategy
from tests.test_full_modification_transport import response_for
from tests.test_story_planning_service import (
    FixedStoryBibleAdapter, build_active_lineage_episode_item,
    build_episode_item_generation_service, episode_item_request,
)


def exhausted(**changes):
    error = LLMRequestError("LLM stream did not contain output text.", category="empty_response")
    error.stream_termination = "finish_reason:length"
    error.reasoning_characters = 36949
    for key, value in changes.items():
        setattr(error, key, value)
    return error


def real_route(handler):
    return RealLLMAdapter(
        provider="openai_compatible", model_name="deepseek-v4-pro", api_key="test-only",
        base_url="https://recovery.test/v1", max_retries=0,
        thinking_mode="enabled", reasoning_effort="high", retry_empty_response=False,
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.parametrize("stream", [False, True])
def test_actual_wire_and_metadata_use_recovery_only_inside_scope(stream, caplog):
    seen = []
    def handler(request):
        payload = json.loads(request.content)
        seen.append(payload)
        return response_for(payload)
    adapter = real_route(handler)
    strategy = GenerationStrategy.model_validate(build_strategy())
    invoke = adapter.generate_structured_output_stream if stream else adapter.generate_structured_output
    first = invoke("Return valid JSON.", strategy=strategy)
    with bind_deepseek_output_recovery():
        repaired = invoke("Return valid JSON.", strategy=strategy)
    after = invoke("Return valid JSON.", strategy=strategy)
    assert [p["thinking"]["type"] for p in seen] == ["enabled", "disabled", "enabled"]
    assert "reasoning_effort" not in seen[1]
    assert [r["_meta"]["thinking_mode"] for r in (first, repaired, after)] == ["enabled", "disabled", "enabled"]
    assert len({p["model"] for p in seen}) == 1
    assert {p["max_tokens"] for p in seen} == {strategy.max_tokens}
    assert "thinking=disabled" in caplog.text and "reasoning=none" in caplog.text


def test_scope_isolated_between_threads_and_reset_after_exception():
    barrier = threading.Barrier(2)
    seen = {}
    def handler(request):
        payload = json.loads(request.content)
        seen[payload["messages"][-1]["content"]] = payload["thinking"]["type"]
        return response_for(payload)
    adapter = real_route(handler)
    strategy = GenerationStrategy.model_validate(build_strategy())
    def scoped():
        with bind_deepseek_output_recovery():
            barrier.wait(timeout=5)
            adapter.generate_structured_output("repair", strategy=strategy)
    def ordinary():
        barrier.wait(timeout=5)
        adapter.generate_structured_output("other-user", strategy=strategy)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(scoped), pool.submit(ordinary)]
        for future in futures:
            future.result(timeout=10)
    with pytest.raises(RuntimeError):
        with bind_deepseek_output_recovery():
            raise RuntimeError("cancel")
    adapter.generate_structured_output("after-error", strategy=strategy)
    assert seen == {"repair": "disabled", "other-user": "enabled", "after-error": "enabled"}


def revision_case(outcomes, *, model="deepseek-v4-pro"):
    payloads, remaining = [], []
    wire_adapter = real_route(lambda _request: pytest.fail("Offline service test must not call a provider."))
    class Adapter(FixedStoryBibleAdapter):
        def get_model_info(self):
            return super().get_model_info().model_copy(update={"model_name": model})
        def generate_structured_output(self, prompt, *, strategy, output_schema=None):
            payloads.append(wire_adapter._build_chat_payload(prompt=prompt, strategy=strategy, output_schema=output_schema))
            remaining.append(remaining_deadline_seconds())
            outcome = outcomes[min(len(payloads)-1, len(outcomes)-1)]
            if callable(outcome):
                outcome = outcome()
            if isinstance(outcome, Exception):
                raise outcome
            return deepcopy(outcome)
    service, node = build_episode_item_generation_service(Adapter())
    current = EpisodePlanGenerationItem.model_validate(build_active_lineage_episode_item())
    request = EpisodePlanItemModificationRequest(
        **episode_item_request(node).model_dump(), current_plan=current,
        revision_mode="rewrite", instruction="重写梗概并同步场景蓝图。",
    )
    return service, request, payloads, remaining


def test_actual_stream_failure_qualifies_and_service_recovers_once_with_same_contract_budget():
    def handler(_request):
        event = {"choices": [{"delta": {"reasoning_content": "规划" * 20}, "finish_reason": "length"}]}
        return httpx.Response(200, text=f"data: {json.dumps(event)}\n\ndata: [DONE]\n\n", headers={"content-type": "text/event-stream"})
    with pytest.raises(LLMRequestError) as caught:
        real_route(handler).generate_structured_output_stream("Plan.", strategy=GenerationStrategy.model_validate(build_strategy()))
    assert is_reasoning_output_exhaustion(caught.value)
    service, request, calls, remaining = revision_case([caught.value, build_active_lineage_episode_item()])
    before = request.model_dump()
    with deadline_scope(250, scope="parent_test"):
        result = service.modify_episode_plan_item(request)
    assert result.episode_number == request.episode_number
    assert request.model_dump() == before
    assert len(calls) == 2
    assert [p["thinking"]["type"] for p in calls] == ["enabled", "disabled"]
    assert calls[0]["model"] == calls[1]["model"]
    assert calls[0]["max_tokens"] == calls[1]["max_tokens"]
    assert 0 < remaining[1] <= remaining[0] <= 250
    assert "AUTHORITATIVE JSON SCHEMA" in calls[1]["messages"][-1]["content"]


@pytest.mark.parametrize("changes", [
    {"category": "transport"}, {"category": "deadline"}, {"reasoning_characters": 0},
    {"refusal": True}, {"raw_content": "partial answer"},
    {"stream_termination": "incomplete"}, {"stream_termination": "content_filter:length"},
    {"stream_termination": "response.failed:length"},
])
def test_unrelated_failures_do_not_trigger_another_request(changes):
    error = exhausted(**changes)
    service, request, calls, _ = revision_case([error])
    with pytest.raises(LLMRequestError) as caught:
        service.modify_episode_plan_item(request)
    assert caught.value is error and len(calls) == 1


def test_different_model_does_not_get_recovery():
    error = exhausted()
    service, request, calls, _ = revision_case([error], model="gemini-3.6-flash")
    with pytest.raises(LLMRequestError):
        service.modify_episode_plan_item(request)
    assert len(calls) == 1


def test_later_scene_completion_failure_does_not_regenerate_existing_candidate():
    service, request, calls, _ = revision_case([build_active_lineage_episode_item()])
    error = exhausted()
    def failed_completion(*_args, **_kwargs):
        raise error
    service._complete_episode_scene_execution_plan = failed_completion
    with pytest.raises(LLMRequestError) as caught:
        service.modify_episode_plan_item(request)
    assert caught.value is error and len(calls) == 1


@pytest.mark.parametrize("second", [exhausted(), {"episode_number": 1}])
def test_recovery_still_validates_and_never_adds_a_third_attempt(second):
    service, request, calls, _ = revision_case([exhausted(), second])
    with pytest.raises((LLMRequestError, StoryPlanningInputError)):
        service.modify_episode_plan_item(request)
    assert len(calls) == 2


def nonstream_exhaustion_response(**message_overrides):
    return httpx.Response(200, json={"choices": [{
        "message": {"role": "assistant", "content": "", "reasoning_content": "R" * 37525, **message_overrides},
        "finish_reason": "length",
    }]})


@pytest.mark.parametrize("gateway_failure_first", [False, True])
def test_nonstream_metadata_survives_and_only_actual_exhaustion_triggers_output_recovery(gateway_failure_first):
    transports = []
    def handler(request):
        payload = json.loads(request.content)
        transports.append(bool(payload.get("stream")))
        if payload.get("stream"):
            return httpx.Response(500, json={"error": {"message": "Temporary gateway failure"}})
        return nonstream_exhaustion_response()
    adapter = real_route(handler)
    invoke = adapter.generate_structured_output_stream if gateway_failure_first else adapter.generate_structured_output
    with pytest.raises(LLMStructuredOutputError) as caught:
        invoke("Return JSON.", strategy=GenerationStrategy.model_validate(build_strategy()))
    error = caught.value
    assert transports == ([True, False] if gateway_failure_first else [False])
    assert error.empty_response is True and not error.raw_content
    assert error.reasoning_characters == 37525
    assert error.stream_termination == "finish_reason:length"
    assert is_reasoning_output_exhaustion(error)
    if gateway_failure_first:
        assert error.stream_fallback_attempted is True
        assert error.stream_failure_status_code == 500
    service, request, calls, _ = revision_case([error, build_active_lineage_episode_item()])
    assert service.modify_episode_plan_item(request).episode_number == 1
    assert len(calls) == 2
    assert [p["thinking"]["type"] for p in calls] == ["enabled", "disabled"]
    assert calls[0]["max_tokens"] == calls[1]["max_tokens"]  # No high-thinking 16000-token retry.


@pytest.mark.parametrize("message_overrides", [
    {"refusal": "Cannot comply."}, {"content": "not JSON at all"},
    {"reasoning_content": ""},
])
def test_nonstream_refusal_partial_content_or_no_reasoning_are_not_exhaustion(message_overrides):
    adapter = real_route(lambda _request: nonstream_exhaustion_response(**message_overrides))
    with pytest.raises(LLMStructuredOutputError) as caught:
        adapter.generate_structured_output("Return JSON.", strategy=GenerationStrategy.model_validate(build_strategy()))
    assert not is_reasoning_output_exhaustion(caught.value)


@pytest.mark.anyio
@pytest.mark.parametrize("deadline_exit", ["return", "error"])
async def test_cumulative_revision_deadline_reaches_http_as_503_without_another_attempt(monkeypatch, deadline_exit):
    from fastapi import FastAPI
    from app.api.routes.story_projects import router
    from app.dependencies import get_story_planning_service
    from app.modules.script_engine import llm_deadline

    clock = [1000.0]
    monkeypatch.setattr(llm_deadline, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    first = LLMStructuredOutputError("No JSON.", empty_response=True, raw_content="", stream_termination="finish_reason:length")
    first.reasoning_characters = 37525
    def spent_first_attempt():
        clock[0] += 212
        return first
    def spent_recovery():
        clock[0] += 89
        if deadline_exit == "error":
            raise LLMRequestError("Provider request reached its deadline.", category="deadline", recoverable=False)
        return build_active_lineage_episode_item()
    service, request, calls, remaining = revision_case([spent_first_attempt, spent_recovery])
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_story_planning_service] = lambda: service
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post(
            f"/story-projects/{request.story_project_id}/plan-nodes/{request.source_node_id}/episode-plans/{request.episode_number}/modify",
            json=request.model_dump(mode="json"),
        )
    assert response.status_code == 503, response.text
    assert "已保存" in response.json()["detail"]
    assert "DeadlineExceeded" not in response.text
    assert len(calls) == 2 and remaining == [300, 88]
    assert [p["thinking"]["type"] for p in calls] == ["enabled", "disabled"]
