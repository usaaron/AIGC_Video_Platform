"""Copilot transport contracts, using isolated routers and mock services only."""

import asyncio
from contextvars import ContextVar, copy_context
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import queue
import threading
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import Depends, FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel
import pytest

from app.api.routes import script_generation, story_projects
from app.api import copilot_stream
from app.account_context import AccountContextError, account_schema, current_schema, storage_scope
from app.dependencies import get_script_generation_service, get_story_planning_service
from app.host_integration import HostRequestContext, RequestObservationMiddleware, authorize_host_request
from app.modules.script_engine.author_conflict_models import AuthorConflictReview
from app.modules.script_engine.copilot_progress import (
    check_copilot_cancelled,
    copilot_deepseek_thinking_event,
    copilot_request_started,
    copilot_stage,
    copilot_summary_event,
    current_copilot_progress,
)
from app.modules.script_engine import llm_deadline
from app.modules.script_engine.llm_adapter import LLMRequestError, MockLLMAdapter
from app.modules.script_engine.long_story_models import (
    EpisodePlanGenerationItem,
    StoryBible,
    StoryInspirationChatOutput,
    StoryPlanNode,
    StorySynopsisDraftOutput,
)
from app.modules.script_engine.models import (
    ScriptDraftModificationResult,
    ScriptGenerationDraftRequest,
)
from test_script_generation_service import seed_dependencies


PROJECT_ID = "story_project.copilot_fixture"
BIBLE_ID = "story_bible.copilot_fixture"
NODE_ID = "story_plan.copilot_fixture"
STRATEGY_ID = "strategy.copilot_fixture"
NOW = datetime(2026, 9, 20, tzinfo=timezone.utc)
ROUTE_NAMES = ["inspiration", "synopsis", "bible", "node", "roadmap", "script"]


@dataclass
class RouteCase:
    url: str
    payload: dict
    result: BaseModel
    method: str


@pytest.fixture(scope="module")
def source_run():
    # The fixture builder uses in-memory repositories and an explicit mock LLM.
    service, content_spec_id = seed_dependencies(llm_adapter=MockLLMAdapter())
    return service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en",
        desired_scene_count=3,
    ))


@pytest.fixture
def cases(request):
    common = {"story_project_id": PROJECT_ID, "generation_strategy_id": STRATEGY_ID}
    bible = StoryBible(
        story_bible_id=BIBLE_ID, story_project_id=PROJECT_ID,
        content_spec_id="content_spec.copilot_fixture",
        core_premise="记者追查母亲失踪的原因并寻找失散的姐姐。",
        series_goal="记者与姐姐取得失踪案证据，让无辜者能够回家。",
        theme="信任与真相",
        central_conflict="姐姐拒绝说出当年的事实，记者逐步验证每条线索。",
        ending_direction="记者公开调查结果，姐姐摆脱被操控的关系。",
        character_refs=["character.reporter"],
        story_lines=[{
            "story_line_id": "storyline.truth", "title": "失踪的真相",
            "story_line_type": "main", "premise": "记者追查封存多年的失踪案件。",
            "planned_resolution": "姐姐交出完整证据并重新获得自由。",
            "character_refs": ["character.reporter"],
        }],
        created_at=NOW,
    )
    node = StoryPlanNode(
        node_id=NODE_ID, story_project_id=PROJECT_ID, story_bible_id=BIBLE_ID,
        story_bible_version=1, title="寻找原始凭证", narrative_purpose="验证账本记录的真实性。",
        synopsis="记者寻找账本的原始凭证，在保护证人的同时取得可以核对的证据。",
        entry_state="记者刚刚取得来源不明的旧账本。",
        central_conflict="公开账本可能让提供线索的证人陷入危险。",
        turning_points=["记者找到保存原始凭证的保险箱。"],
        emotional_direction="从急于公开转为克制取证。",
        exit_state="记者取得原始凭证并安全转移证人。", created_at=NOW,
    )
    roadmap = EpisodePlanGenerationItem(
        episode_number=1, episode_goal="验证旧账本的来源。",
        entry_state="主角刚取得一份来源不明的旧账本。",
        central_conflict="公开账本会立刻暴露证人。",
        protagonist_decision="主角决定先保护证人再验证账本。",
        reveal="账本的时间戳曾被人改写。", emotional_movement="从急于公开转为克制取证。",
        exit_state="主角取得下一步可验证的资金入口。",
        cliffhanger="资金入口出现主角熟悉的签名。",
        character_refs=["character.reporter"], story_line_refs=["storyline.truth"],
    )
    planning_root = f"/story-projects/{PROJECT_ID}"
    result = {
        "inspiration": RouteCase(
            f"{planning_root}/story-bibles/inspiration-chat", common.copy(),
            StoryInspirationChatOutput(assistant_message="创作方向已经明确。", brief={}, ready_to_generate=True),
            "generate_story_inspiration_turn",
        ),
        "synopsis": RouteCase(
            f"{planning_root}/story-bibles/synopsis-draft", common.copy(),
            StorySynopsisDraftOutput(text="记者调查失踪案件并帮助姐姐重新获得自由。", review={"status": "complete", "issues": []}),
            "generate_story_synopsis_draft",
        ),
        "bible": RouteCase(
            f"{planning_root}/story-bibles/{BIBLE_ID}/modify",
            {**common, "story_bible_id": BIBLE_ID, "story_bible_version": 1, "instruction": "增强角色动机。"},
            bible, "modify_story_bible",
        ),
        "node": RouteCase(
            f"{planning_root}/plan-nodes/{NODE_ID}/modify",
            {**common, "node_id": NODE_ID, "node_version": 1, "instruction": "增强行动回报。"},
            node, "modify_story_plan_node",
        ),
        "roadmap": RouteCase(
            f"{planning_root}/plan-nodes/{NODE_ID}/episode-plans/1/modify",
            {**common, "source_node_id": NODE_ID, "source_node_version": 1,
             "episode_number": 1, "instruction": "增强行动回报。", "current_plan": roadmap.model_dump(mode="json")},
            roadmap, "modify_episode_plan_item",
        ),
    }
    # Avoid even mock episode generation in cases unrelated to script DTOs.
    if getattr(request.node, "callspec", None) and request.node.callspec.params.get("route_name") == "script":
        source = request.getfixturevalue("source_run")
        instruction = "Increase the visible cost of the protagonist's decision."
        result["script"] = RouteCase(
            "/script-generation/modify-draft",
            {"source_generation_run": source.model_dump(mode="json"),
             "source_draft_master_script": source.draft_master_script.model_dump(mode="json"),
             "instruction": instruction},
            ScriptDraftModificationResult(source_draft_master_script_id=source.draft_master_script.id,
                                          instruction=instruction, candidate_generation_run=source),
            "modify_draft",
        )
    return result


def stub_app(case: RouteCase, operation: Mock) -> FastAPI:
    app = FastAPI()
    app.include_router(story_projects.router)
    app.include_router(script_generation.router)
    stub = SimpleNamespace(**{case.method: operation})
    app.dependency_overrides[get_story_planning_service] = lambda: stub
    app.dependency_overrides[get_script_generation_service] = lambda: stub
    return app


def parse_events(response):
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["x-accel-buffering"] == "no"
    assert response.headers["cache-control"] == "no-cache, no-transform"
    return decode_frames(response.text)


def decode_frames(body: str):
    frames = [frame for frame in body.split("\n\n") if frame.startswith("id: ")]
    ids = [int(frame.splitlines()[0].removeprefix("id: ")) for frame in frames]
    assert ids == list(range(1, len(ids) + 1))
    return [json.loads(line.removeprefix("data: ")) for frame in frames
            for line in frame.splitlines() if line.startswith("data: ")]


@pytest.mark.anyio
@pytest.mark.parametrize("route_name", ROUTE_NAMES)
async def test_stream_keeps_json_envelope_and_invokes_service_once(cases, route_name):
    case = cases[route_name]
    operation = Mock(return_value=case.result)
    app = stub_app(case, operation)
    original = deepcopy(case.payload)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        normal = await client.post(case.url, json=case.payload)
        assert normal.status_code == 200, normal.text
        assert operation.call_count == 1
        streamed = await client.post(case.url, json=case.payload, headers={"Accept": "text/event-stream"})
    assert operation.call_count == 2
    assert case.payload == original
    events = parse_events(streamed)
    assert [event["type"] for event in events] == ["progress", "progress", "result"]
    assert events[0]["stage"] == "context"
    assert events[1]["stage"] == "validating"
    assert events[-1]["data"] == normal.json()
    assert "data" in events[-1]["data"]
    if route_name == "script":
        candidate = events[-1]["data"]["data"]["candidate_generation_run"]
        assert candidate["llm_raw_output"] == {}
        assert candidate["prompt_build_result"]["prompt_text"] == "Prompt omitted from product result."


@pytest.mark.anyio
@pytest.mark.parametrize("route_name", ROUTE_NAMES[:-1])
@pytest.mark.parametrize("accept", ["application/json", "text/event-stream"])
async def test_path_mismatch_stays_http_conflict_without_invoking_service(cases, route_name, accept):
    case = cases[route_name]
    operation = Mock(return_value=case.result)
    async with AsyncClient(transport=ASGITransport(app=stub_app(case, operation)), base_url="http://test") as client:
        response = await client.post(case.url.replace(PROJECT_ID, "story_project.other"),
                                     json=case.payload, headers={"Accept": accept})
    assert response.status_code == 409, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert "detail" in response.json()
    operation.assert_not_called()


@pytest.mark.anyio
@pytest.mark.parametrize(("route_name", "source", "replacement"), [
    ("bible", BIBLE_ID, "story_bible.other"),
    ("node", NODE_ID, "story_plan.other"),
    ("roadmap", NODE_ID, "story_plan.other"),
    ("roadmap", "/episode-plans/1/", "/episode-plans/2/"),
])
async def test_stream_rejects_each_artifact_path_identity(cases, route_name, source, replacement):
    case = cases[route_name]
    operation = Mock(return_value=case.result)
    async with AsyncClient(transport=ASGITransport(app=stub_app(case, operation)), base_url="http://test") as client:
        response = await client.post(case.url.replace(source, replacement), json=case.payload,
                                     headers={"Accept": "text/event-stream"})
    assert response.status_code == 409, response.text
    operation.assert_not_called()


@pytest.mark.anyio
@pytest.mark.parametrize("route_name", ["script"])
async def test_author_conflict_review_is_a_terminal_result_without_candidate(cases, route_name):
    case = cases[route_name]
    review = AuthorConflictReview(
        review_id="review.copilot_fixture", source_fingerprint="a" * 64,
        instruction=case.payload["instruction"], user_goal="让主角承担更明显的行动代价。",
        source_story_bible_version=1,
        conflicts=[{
            "source_ref": "source_draft_master_script.synopsis",
            "established_fact": "主角决定独自调查旧案。", "requested_change": "主角接受对方协助。",
            "impact": "需要交代合作如何服务原有调查目标。",
        }],
        options=[{
            "option_id": "option.bridge", "kind": "bridge", "title": "为调查建立有限合作",
            "plan": "明确合作只服务于核验现有证据。", "impact": "调整本集动作与对白并保留调查目标。",
        }],
    )
    result = ScriptDraftModificationResult(
        source_draft_master_script_id=case.result.source_draft_master_script_id,
        instruction=case.payload["instruction"], conflict_review=review,
    )
    operation = Mock(return_value=result)
    async with AsyncClient(transport=ASGITransport(app=stub_app(case, operation)), base_url="http://test") as client:
        response = await client.post(case.url, json=case.payload, headers={"Accept": "text/event-stream"})
    events = parse_events(response)
    assert events[-1]["type"] == "result"
    assert events[-1]["data"]["data"]["candidate_generation_run"] is None
    assert events[-1]["data"]["data"]["conflict_review"] == review.model_dump(mode="json")
    assert not any(event["type"] == "error" for event in events)
    operation.assert_called_once()


@pytest.mark.anyio
async def test_closing_stream_cancels_worker_before_further_work():
    release = threading.Event()
    stopped = threading.Event()
    observers = []
    later_work = Mock()

    def operation():
        try:
            observers.append(current_copilot_progress())
            assert release.wait(2), "test did not release worker"
            check_copilot_cancelled()
            later_work()
            return {"data": "late result must never arrive"}
        finally:
            stopped.set()

    response = copilot_stream.copilot_stream_response(operation)
    iterator = response.body_iterator
    try:
        first = await anext(iterator)
        assert decode_frames(first)[0]["stage"] == "context"
        await iterator.aclose()
        release.set()
        assert await asyncio.to_thread(stopped.wait, 2), "cancelled worker did not stop"
        assert observers[0].cancel.is_set()
        later_work.assert_not_called()
        with pytest.raises(StopAsyncIteration):
            await anext(iterator)
    finally:
        release.set()
        await iterator.aclose()


@pytest.mark.anyio
async def test_expired_deadline_cannot_publish_success(cases, monkeypatch):
    case = cases["synopsis"]
    now = [0.0]
    monkeypatch.setattr(llm_deadline, "time", SimpleNamespace(monotonic=lambda: now[0]))
    monkeypatch.setattr(copilot_stream, "COPILOT_DEADLINE_SECONDS", 1.0)

    def exceed_budget(_payload):
        # Simulate a synchronous operation returning after its request budget.
        now[0] = 2.0
        return case.result

    operation = Mock(side_effect=exceed_budget)
    async with AsyncClient(transport=ASGITransport(app=stub_app(case, operation)), base_url="http://test") as client:
        response = await client.post(case.url, json=case.payload, headers={"Accept": "text/event-stream"})
    events = parse_events(response)
    assert not any(event["type"] == "result" for event in events)
    assert events[-1]["type"] == "error"
    assert events[-1]["status"] == 503
    assert events[-1]["failure_class"] == "time_budget_exhausted"
    assert events[-1]["error_type"] == "deadline"
    assert events[-1]["retryable"] is False
    operation.assert_called_once()


@pytest.mark.anyio
@pytest.mark.parametrize("terminal_type", ["result", "error"])
@pytest.mark.parametrize("text_type", ["reasoning_summary", "model_thinking"])
async def test_slow_reader_keeps_bounded_summary_prefix_and_terminal(monkeypatch, terminal_type, text_type):
    capacity = 3
    monkeypatch.setattr(copilot_stream, "COPILOT_QUEUE_SIZE", capacity)
    release_burst = threading.Event()
    burst_ready = threading.Event()
    release_tail = threading.Event()
    chunks = [f"{number:02d}:" + "摘要" * 30 + "。" for number in range(8)]
    assert all(len(chunk) == 64 for chunk in chunks)
    source_summary = "".join(chunks)

    def emit_text(chunk):
        if text_type == "model_thinking":
            copilot_deepseek_thinking_event({"choices": [{"delta": {"reasoning_content": chunk}}]})
        else:
            copilot_summary_event({"type": "response.reasoning_summary_text.delta", "delta": chunk})

    def operation():
        assert release_burst.wait(2), "test did not start producer"
        for chunk in chunks[:-1]:
            emit_text(chunk)
        burst_ready.set()
        assert release_tail.wait(2), "test did not resume producer"
        # Once a middle fragment was dropped, later summaries must not splice
        # unrelated fragments onto the retained prefix even after queue drainage.
        emit_text(chunks[-1])
        if terminal_type == "error":
            raise HTTPException(409, "请重新确认当前修改来源。")
        return {"data": {"candidate": "complete"}}

    operation_mock = Mock(side_effect=operation)
    iterator = copilot_stream.copilot_stream_response(operation_mock).body_iterator
    frames = []
    try:
        frames.append(await anext(iterator))
        release_burst.set()
        assert await asyncio.to_thread(burst_ready.wait, 2), "producer did not finish bounded burst"
        for _ in range(capacity):
            frames.append(await anext(iterator))
        release_tail.set()
        async for frame in iterator:
            frames.append(frame)
    finally:
        release_burst.set()
        release_tail.set()
        await iterator.aclose()
    events = decode_frames("".join(frames))
    summaries = [event["delta"] for event in events if event["type"] == text_type]
    assert len(summaries) <= capacity
    assert "".join(summaries) == source_summary[:capacity * 64]
    terminal_events = [event for event in events if event["type"] in {"result", "error"}]
    assert len(terminal_events) == 1
    assert events[-1]["type"] == terminal_type
    if terminal_type == "result":
        assert events[-1]["data"] == {"data": {"candidate": "complete"}}
    else:
        assert events[-1]["status"] == 409
    operation_mock.assert_called_once()


@pytest.mark.anyio
async def test_terminal_enqueued_after_empty_read_is_not_lost(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    workers = []
    raced = []

    class CompletionRaceQueue(queue.Queue):
        def get_nowait(self):
            try:
                return super().get_nowait()
            except queue.Empty:
                if self.maxsize == 1 and not raced:
                    raced.append(True)
                    assert started.wait(2), "worker did not reach the operation"
                    # Return the already-observed Empty only after the worker
                    # enqueues its terminal and marks itself finished. This
                    # forces the exact scheduling gap that used to drop it.
                    release.set()
                    workers[0].join(timeout=2)
                    assert not workers[0].is_alive(), "worker did not finish"
                raise

    monkeypatch.setattr(copilot_stream, "queue", SimpleNamespace(
        Queue=CompletionRaceQueue, Empty=queue.Empty, Full=queue.Full,
    ))

    def operation():
        workers.append(threading.current_thread())
        started.set()
        assert release.wait(2), "empty-queue observation did not release worker"
        return {"data": {"candidate": "completed during empty read"}}

    operation_mock = Mock(side_effect=operation)
    iterator = copilot_stream.copilot_stream_response(operation_mock).body_iterator
    try:
        frames = [frame async for frame in iterator]
    finally:
        release.set()
        await iterator.aclose()
    events = decode_frames("".join(frames))
    assert raced == [True]
    terminals = [event for event in events if event["type"] in {"result", "error"}]
    assert terminals == [{"type": "result", "data": {"data": {"candidate": "completed during empty read"}}}]
    assert events[-1] == terminals[0]
    operation_mock.assert_called_once()


@pytest.mark.anyio
async def test_yield_dependency_remains_alive_until_terminal_frame_is_sent(cases):
    case = cases["synopsis"]
    lifecycle = []

    def operation(_payload):
        assert lifecycle == ["opened"]
        lifecycle.append("operation")
        return case.result

    operation_mock = Mock(side_effect=operation)
    app = stub_app(case, operation_mock)

    async def dependency():
        lifecycle.append("opened")
        try:
            yield SimpleNamespace(**{case.method: operation_mock})
        finally:
            lifecycle.append("closed")

    app.dependency_overrides[get_story_planning_service] = dependency

    async def track_delivery(scope, receive, send):
        async def tracked_send(message):
            if message["type"] == "http.response.body" and b'"type": "result"' in message.get("body", b""):
                assert lifecycle == ["opened", "operation"]
                lifecycle.append("terminal_sent")
            await send(message)
        await app(scope, receive, tracked_send)

    async with AsyncClient(transport=ASGITransport(app=track_delivery), base_url="http://test") as client:
        response = await client.post(case.url, json=case.payload, headers={"Accept": "text/event-stream"})
    assert parse_events(response)[-1]["type"] == "result"
    assert lifecycle == ["opened", "operation", "terminal_sent", "closed"]
    operation_mock.assert_called_once()


@pytest.mark.anyio
async def test_host_storage_scope_survives_stream_then_revokes_copied_worker_context(cases):
    case = cases["synopsis"]
    expected_schema = account_schema("tenant.fixture", "actor.fixture")
    scopes = []
    worker_contexts = []

    def operation(_payload):
        scope = storage_scope.get()
        assert scope is not None and scope.active is True
        assert current_schema() == expected_schema
        scopes.append(scope)
        worker_contexts.append(copy_context())
        copilot_stage("writing")
        assert current_schema() == expected_schema
        assert scope.active is True
        return case.result

    operation_mock = Mock(side_effect=operation)
    app = FastAPI(dependencies=[Depends(authorize_host_request)])
    app.state.require_host_context = False
    app.add_middleware(RequestObservationMiddleware)
    app.include_router(story_projects.router)
    app.dependency_overrides[get_story_planning_service] = lambda: SimpleNamespace(
        **{case.method: operation_mock}
    )

    async def authorize(_request):
        return HostRequestContext(
            tenant_id="tenant.fixture", actor_id="actor.fixture", project_id=PROJECT_ID,
            permissions=frozenset({"project.write"}), request_id="request.copilot_fixture",
        )

    app.state.host_authorizer = authorize
    terminal_sent = []

    async def track_delivery(scope, receive, send):
        async def tracked_send(message):
            if message["type"] == "http.response.body" and b'"type": "result"' in message.get("body", b""):
                assert scopes[0].active is True
                assert current_schema() == expected_schema
                terminal_sent.append(True)
            await send(message)
        await app(scope, receive, tracked_send)

    async with AsyncClient(transport=ASGITransport(app=track_delivery), base_url="http://test") as client:
        response = await client.post(case.url, json=case.payload, headers={"Accept": "text/event-stream"})
    assert parse_events(response)[-1]["type"] == "result"
    assert terminal_sent == [True]
    assert scopes[0].active is False
    assert storage_scope.get() is None
    with pytest.raises(AccountContextError, match="ended"):
        worker_contexts[0].run(current_schema)
    operation_mock.assert_called_once()


@pytest.mark.anyio
@pytest.mark.parametrize("accept", ["application/json", "text/event-stream;q=0", "text/event-stream;q=invalid"])
async def test_json_negotiation_does_not_enable_stream(cases, accept):
    case = cases["synopsis"]
    operation = Mock(return_value=case.result)
    async with AsyncClient(transport=ASGITransport(app=stub_app(case, operation)), base_url="http://test") as client:
        response = await client.post(case.url, json=case.payload, headers={"Accept": accept})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["data"] == case.result.model_dump(mode="json")
    operation.assert_called_once()


@pytest.mark.anyio
async def test_stream_preserves_safe_http_failure_metadata(cases):
    case = cases["synopsis"]
    operation = Mock(side_effect=HTTPException(429, "请求较多，请稍后重试。", headers={
        "x-GENERATION-Retryable": "true", "X-Generation-Failure-Class": "upstream",
        "X-Generation-Error-Type": "rate_limit", "Authorization": "PRIVATE_HEADER",
    }))
    async with AsyncClient(transport=ASGITransport(app=stub_app(case, operation)), base_url="http://test") as client:
        response = await client.post(case.url, json=case.payload, headers={"Accept": "text/event-stream"})
    events = parse_events(response)
    assert events[-1] == {"type": "error", "message": "请求较多，请稍后重试。", "status": 429,
                          "retryable": True, "failure_class": "upstream", "error_type": "rate_limit"}
    assert not any(event["type"] == "result" for event in events)
    assert "PRIVATE_HEADER" not in response.text
    operation.assert_called_once()


@pytest.mark.anyio
@pytest.mark.parametrize("error", [RuntimeError("PRIVATE_EXCEPTION_BODY"),
                                  HTTPException(422, {"prompt": "PRIVATE_EXCEPTION_BODY"})])
async def test_unmapped_or_structured_errors_do_not_expose_provider_details(cases, error):
    case = cases["synopsis"]
    operation = Mock(side_effect=error)
    async with AsyncClient(transport=ASGITransport(app=stub_app(case, operation)), base_url="http://test") as client:
        response = await client.post(case.url, json=case.payload, headers={"Accept": "text/event-stream"})
    events = parse_events(response)
    assert events[-1]["type"] == "error"
    assert events[-1]["status"] == (error.status_code if isinstance(error, HTTPException) else 500)
    assert "PRIVATE_EXCEPTION_BODY" not in response.text
    operation.assert_called_once()


@pytest.mark.anyio
async def test_route_error_mapping_matches_json_failure(cases):
    case = cases["inspiration"]
    operation = Mock(side_effect=LLMRequestError("PRIVATE_PROVIDER_BODY", status_code=429))
    async with AsyncClient(transport=ASGITransport(app=stub_app(case, operation)), base_url="http://test") as client:
        normal = await client.post(case.url, json=case.payload)
        streamed = await client.post(case.url, json=case.payload, headers={"Accept": "text/event-stream"})
    event = parse_events(streamed)[-1]
    assert normal.status_code == event["status"] == 429
    assert normal.json()["detail"] == event["message"]
    assert event["failure_class"] == normal.headers["x-generation-failure-class"]
    assert event["error_type"] == normal.headers["x-generation-error-type"]
    assert event["retryable"] == (normal.headers["x-generation-retryable"] == "true")
    assert "PRIVATE_PROVIDER_BODY" not in streamed.text
    assert operation.call_count == 2


@pytest.mark.anyio
async def test_worker_keeps_request_context_and_emits_only_public_summary(cases):
    case = cases["synopsis"]
    account_context = ContextVar("copilot_test_account", default=None)
    seen_accounts = []

    def generate(_payload):
        seen_accounts.append(account_context.get())
        assert current_copilot_progress() is not None
        copilot_request_started()
        copilot_stage("thinking")
        copilot_summary_event({"type": "response.reasoning_text.delta", "delta": "PRIVATE_REASONING"})
        copilot_summary_event({"choices": [{"delta": {"reasoning_content": "PRIVATE_REASONING"}}]})
        copilot_summary_event({"type": "response.output_text.delta", "delta": "PRIVATE_OUTPUT_JSON"})
        copilot_summary_event({"type": "response.reasoning_summary_text.delta", "delta": "先核对角色目标，再组织新的情节。"})
        copilot_stage("writing")
        return case.result

    operation = Mock(side_effect=generate)
    app = stub_app(case, operation)

    @app.middleware("http")
    async def bind_account(request, call_next):
        token = account_context.set(request.headers["x-test-account"])
        try:
            return await call_next(request)
        finally:
            account_context.reset(token)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(case.url, json=case.payload,
                                     headers={"Accept": "text/event-stream", "x-test-account": "account.fixture"})
    events = parse_events(response)
    assert seen_accounts == ["account.fixture"]
    assert account_context.get() is None
    assert current_copilot_progress() is None
    assert [event["stage"] for event in events if event["type"] == "progress"] == [
        "context", "requesting", "thinking", "writing", "validating",
    ]
    summary = "".join(event["delta"] for event in events if event["type"] == "reasoning_summary")
    assert summary == "先核对角色目标，再组织新的情节。"
    assert "PRIVATE_REASONING" not in response.text
    assert "PRIVATE_OUTPUT_JSON" not in response.text
    assert events[-1]["data"]["data"] == case.result.model_dump(mode="json")
    operation.assert_called_once()
