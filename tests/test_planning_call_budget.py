"""Offline requests only: retries and model fallback share a durable allowance."""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.script_engine.llm_adapter import (
    LLMRequestError, ModelFailoverLLMAdapter, RealLLMAdapter,
)
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.planning_call_budget import (
    PlanningCallBudgetExceeded, charge_planning_model_request, planning_call_budget_scope,
)
from tests.test_llm_adapter import build_openai_compatible_response, build_strategy


@pytest.fixture
def runtime(tmp_path):
    result = create_database_runtime(f"sqlite:///{tmp_path}/budget.db")
    SQLModel.metadata.create_all(result.engine)
    yield result
    result.engine.dispose()


def binding(runtime, **overrides):
    return {
        "database_runtime": runtime, "operation_id": "decompose-operation",
        "project_id": "budget-project", "parent_node_id": "budget-parent",
        "parent_node_version": 1, "input_fingerprint": "a" * 64,
        **overrides,
    }


def real_adapter(handler, *, model="script-model", retries=0):
    return RealLLMAdapter(
        provider="openai_compatible", model_name=model, api_key="offline-key",
        base_url="https://offline.invalid/v1", max_retries=retries,
        transport=httpx.MockTransport(handler),
    )


def sse_response():
    event = {"choices": [{"delta": {"content": '{"title":"preserved"}'}, "finish_reason": "stop"}]}
    return httpx.Response(200, text=f"data: {json.dumps(event)}\n\ndata: [DONE]\n\n",
                         headers={"content-type": "text/event-stream"})


@pytest.mark.parametrize("durable", [True, False])
def test_repeated_http_contexts_keep_four_request_allowance(runtime, durable):
    settings = binding(runtime if durable else None, operation_id=str(uuid4()))
    for _ in range(2):
        with planning_call_budget_scope(**settings):
            charge_planning_model_request()
            charge_planning_model_request()
    with planning_call_budget_scope(**settings), pytest.raises(PlanningCallBudgetExceeded) as failure:
        charge_planning_model_request()
    assert (failure.value.used, failure.value.limit) == (4, 4)
    assert not isinstance(failure.value, LLMRequestError)


def test_implicit_operation_identity_is_stable_and_server_source_binding_isolated(runtime):
    settings = binding(runtime, operation_id=None, limit=1)
    with planning_call_budget_scope(**settings) as first:
        charge_planning_model_request()
    with planning_call_budget_scope(**settings) as resumed, pytest.raises(PlanningCallBudgetExceeded):
        assert resumed.operation_id == first.operation_id
        charge_planning_model_request()
    for change in [{"parent_node_version": 2}, {"input_fingerprint": "b" * 64},
                   {"project_id": "other-project"}, {"parent_node_id": "other-parent"}]:
        with planning_call_budget_scope(**(settings | change)):
            charge_planning_model_request()


def test_concurrent_contexts_cannot_reserve_more_than_four_posts(runtime):
    settings = binding(runtime)

    def reserve(_):
        with planning_call_budget_scope(**settings):
            try:
                charge_planning_model_request()
                return True
            except PlanningCallBudgetExceeded:
                return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(reserve, range(16)))
    assert results.count(True) == 4
    assert results.count(False) == 12


def test_copied_contexts_share_allowance_and_nested_scope_cannot_reset_it(runtime):
    settings = binding(runtime)
    with planning_call_budget_scope(**settings) as outer:
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = [pool.submit(copy_context().run, charge_planning_model_request) for _ in range(4)]
            for job in jobs:
                job.result()
        with planning_call_budget_scope(**settings) as inner, pytest.raises(PlanningCallBudgetExceeded):
            assert inner is outer
            charge_planning_model_request()
        with pytest.raises(RuntimeError, match="Nested planning operations"):
            with planning_call_budget_scope(**(settings | {"operation_id": "new-id"})):
                pass


def test_schema_repairs_share_actual_stream_and_nonstream_post_budget(runtime):
    requests = []

    def handler(request):
        streamed = json.loads(request.content).get("stream", False)
        requests.append(streamed)
        return sse_response() if streamed else httpx.Response(
            200, json=build_openai_compatible_response('{"title":"preserved"}'),
        )

    adapter = real_adapter(handler)
    strategy = GenerationStrategy.model_validate(build_strategy())
    with planning_call_budget_scope(**binding(runtime)):
        for streamed in [True, False, True, False]:
            call = adapter.generate_structured_output_stream if streamed else adapter.generate_structured_output
            assert call("Offline repair", strategy=strategy)["title"] == "preserved"
        with pytest.raises(PlanningCallBudgetExceeded):
            adapter.generate_structured_output_stream("Fifth repair", strategy=strategy)
    assert requests == [True, False, True, False]


def test_same_route_retries_and_model_fallback_exhaust_shared_persistent_limit(runtime):
    requests = []

    def handler(request):
        requests.append(json.loads(request.content)["model"])
        return httpx.Response(503, json={"error": {"message": "offline gateway failure"}})

    adapter = ModelFailoverLLMAdapter(
        primary=real_adapter(handler, model="primary", retries=1),
        fallback=real_adapter(handler, model="fallback", retries=1),
    )
    strategy = GenerationStrategy.model_validate(build_strategy())
    with pytest.raises(PlanningCallBudgetExceeded) as first_failure:
        with planning_call_budget_scope(**binding(runtime)):
            adapter.generate_structured_output("Offline request", strategy=strategy)
    assert isinstance(first_failure.value.__cause__, LLMRequestError)
    # A new HTTP request must not reset four already spent physical attempts.
    with planning_call_budget_scope(**binding(runtime)), pytest.raises(PlanningCallBudgetExceeded):
        adapter.generate_structured_output("Offline request", strategy=strategy)
    assert requests == ["primary", "primary", "fallback", "fallback"]


def test_hedged_worker_inherits_budget_without_discarding_inflight_valid_reply(runtime):
    requests = []

    def handler(request):
        requests.append(json.loads(request.content)["model"])
        time.sleep(0.06)
        return sse_response()

    adapter = ModelFailoverLLMAdapter(
        primary=real_adapter(handler, model="primary"),
        fallback=real_adapter(handler, model="fallback"), hedge_delay_seconds=0.01,
    )
    strategy = GenerationStrategy.model_validate(build_strategy())
    with planning_call_budget_scope(**binding(runtime, limit=1)):
        result = adapter.generate_structured_output_stream("Offline hedge", strategy=strategy)
    assert result["title"] == "preserved"
    assert requests == ["primary"]


def test_decomposition_api_budget_exhaustion_is_explicitly_not_retryable():
    from app.api.routes.story_projects import decompose_story_plan_node
    from app.modules.script_engine.long_story_models import StoryPlanNodeDecompositionRequest

    payload = StoryPlanNodeDecompositionRequest(
        story_project_id="budget-project", parent_node_id="budget-parent",
        parent_node_version=1, generation_strategy_id="budget-strategy",
        operation_id="decompose-operation",
    )

    def fail(_):
        raise PlanningCallBudgetExceeded(operation_id=payload.operation_id, used=4, limit=4)

    with pytest.raises(HTTPException) as failure:
        decompose_story_plan_node("budget-project", "budget-parent", payload,
                                  SimpleNamespace(decompose_story_plan_node=fail))
    assert failure.value.status_code == 422
    assert failure.value.headers == {
        "X-Generation-Retryable": "false",
        "X-Generation-Failure-Class": "planning_call_budget_exhausted",
        "X-Generation-Error-Type": "planning_call_budget_exhausted",
    }
    assert "不会自动重复生成" in failure.value.detail


def test_service_nested_repair_preserves_failed_replies_and_repeated_http_spends_zero(runtime):
    from sqlmodel import select
    from app.document_repository import ModuleDocumentRecord
    from app.modules.script_engine.long_story_models import StoryPlanExpansionStatus, StoryPlanNodeDecompositionRequest
    from app.modules.script_engine.planning_attempts import ATTEMPT_NAMESPACE, PlanningAttemptRepository
    from app.modules.script_engine.story_planning_service import StoryPlanningService
    from tests.test_story_planning_service import (
        MutableActiveLineageLongStoryService, build_active_lineage_story_bible,
        build_active_lineage_story_node, build_strategy as planning_strategy,
    )

    source = build_active_lineage_story_node(
        node_id="story_plan.budget.integration", version=1, start_episode=1, end_episode=48,
        expansion_status=StoryPlanExpansionStatus.expanded,
    )
    long_story = MutableActiveLineageLongStoryService(
        source, source.model_copy(update={"version": 2}), build_active_lineage_story_bible(),
    )
    repository = PlanningAttemptRepository(runtime)
    long_story.planning_attempt_repository = lambda: repository
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        content = json.dumps({"children": [{
            "title": f"失败原稿{len(calls)}", "synopsis": "主角查账并救出证人，但此回复仍缺少必需剧情字段。",
            "unit_story_beats": ["主角核验账本。", "证人受到威胁。", "主角转移证人。", "证人提交原始凭证。"],
        }]}, ensure_ascii=False)
        if calls[-1].get("stream"):
            event = {"choices": [{"delta": {"content": content}, "finish_reason": "stop"}]}
            return httpx.Response(200, text=f"data: {json.dumps(event)}\n\ndata: [DONE]\n\n")
        return httpx.Response(200, json=build_openai_compatible_response(content))

    adapter = real_adapter(handler)
    strategy = planning_strategy()
    service = object.__new__(StoryPlanningService)
    service._long_story_service = long_story
    service._generation_strategy_repository = SimpleNamespace(get=lambda _: strategy)
    service._content_spec_for_story_bible = lambda _: SimpleNamespace()
    service._knowledge_context = lambda **_: ""
    service._llm_adapter = adapter
    service._story_architect_llm_adapter = adapter
    service._story_architect_recovery_llm_adapter = adapter
    payload = StoryPlanNodeDecompositionRequest(
        story_project_id=source.story_project_id, parent_node_id=source.node_id,
        parent_node_version=source.version, generation_strategy_id=strategy.id,
        requested_child_count=6, operation_id="integration.operation",
    )
    for _ in range(2):
        with pytest.raises(PlanningCallBudgetExceeded):
            service.decompose_story_plan_node(payload)
        assert len(calls) == 4
        assert long_story.saved_nodes == []
        assert long_story.latest == source
    with runtime.session() as session:
        records = [row.payload for row in session.exec(select(ModuleDocumentRecord).where(
            ModuleDocumentRecord.namespace == ATTEMPT_NAMESPACE,
        )).all()]
    evidence = json.dumps(records, ensure_ascii=False)
    for index in range(1, 5):
        assert f"失败原稿{index}" in evidence
    assert "offline-key" not in evidence
    assert not any(item["kind"] == "completed" for item in records)
    assert len({item["attempt_id"] for item in records}) == 2
