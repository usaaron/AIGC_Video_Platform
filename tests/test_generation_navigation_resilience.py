"""Accepted generation survives navigation; timeout cleanup fences late workers."""
import asyncio
from contextvars import copy_context
import json
import threading
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.account_context import AccountContextError, current_schema, storage_scope
from app.api import copilot_stream
from app.api.routes.quick_script import get_quick_script_service
from app.database import create_database_runtime
from app.dependencies import get_long_story_service, get_story_planning_service
from app.host_integration import HostRequestContext
from app.main import create_app
from app.modules.quick_script.models import QuickActionRequest
from app.modules.script_engine.copilot_progress import check_copilot_cancelled, copilot_deepseek_thinking_event
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from test_quick_script_service import PROJECT_ID, act, make_test_service


def _authorized_app(service):
    async def authorize(_request):
        return HostRequestContext(tenant_id="resilience.org", actor_id="one", project_id=PROJECT_ID,
                                  request_id="request.resilience", permissions={"project.write", "project.read"})
    app = create_app(host_authorizer=authorize, require_host_context=False)
    app.dependency_overrides[get_quick_script_service] = lambda: service
    return app


async def _request(app, payload, started, release, *, disconnect=True, send_error=False):
    first = True
    disconnected = asyncio.Event()
    frames = []

    async def receive():
        nonlocal first
        if first:
            first = False
            return {"type": "http.request", "body": json.dumps(payload).encode(), "more_body": False}
        assert await asyncio.to_thread(started.wait, 3)
        if disconnect:
            disconnected.set()
            return {"type": "http.disconnect"}
        await asyncio.Event().wait()

    async def send(message):
        if message["type"] == "http.response.body":
            frames.append(message.get("body", b""))
            if send_error:
                assert await asyncio.to_thread(started.wait, 3)
                disconnected.set()
                raise OSError("viewer left")

    async def finish_after_viewer_leaves():
        await disconnected.wait()
        # Old cancellation released the request scope before this worker write.
        await asyncio.sleep(0.1)
        release.set()

    helper = asyncio.create_task(finish_after_viewer_leaves()) if release is not None else None
    path = f"/story-projects/{PROJECT_ID}/quick-script/actions"
    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4" if send_error else "2.0"},
             "http_version": "1.1", "method": "POST", "scheme": "http", "path": path,
             "raw_path": path.encode(), "query_string": b"", "headers": [(b"content-type", b"application/json"),
             (b"accept", b"text/event-stream")], "client": ("test", 1), "server": ("test", 80), "root_path": ""}
    try:
        try:
            await asyncio.wait_for(app(scope, receive, send), 8)
        except Exception:
            if not send_error:
                raise
        if helper is not None:
            await helper
    finally:
        if helper is not None:
            helper.cancel()
    return b"".join(frames).decode()


@pytest.mark.parametrize("send_error", [False, True])
def test_navigation_finishes_in_original_scope_and_replays_without_model(tmp_path, send_error):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'navigation.db'}")
    service, engine, _ = make_test_service(runtime)
    setup = act(service, "setup")
    original = engine.draft_synopsis
    started, release = threading.Event(), threading.Event()
    observed = {}

    def model(state):
        observed["scope"] = storage_scope.get()
        observed["context"] = copy_context()
        started.set()
        assert release.wait(4)
        assert observed["scope"].active
        assert current_schema()
        check_copilot_cancelled()
        return original(state)

    engine.draft_synopsis = model
    request = QuickActionRequest(action="draft_synopsis", operation_id="operation.navigation",
                                 expected_revision=setup.state.revision)
    try:
        asyncio.run(_request(_authorized_app(service), request.model_dump(mode="json"), started, release,
                             disconnect=not send_error, send_error=send_error))
        saved = service.get(PROJECT_ID).state
        assert saved.synopsis and saved.active_operation is None
        assert engine.calls == ["synopsis"]
        assert service.action(PROJECT_ID, request).state == saved
        assert engine.calls == ["synopsis"]
        assert not observed["scope"].active
        with pytest.raises(AccountContextError):
            observed["context"].run(current_schema)
    finally:
        release.set()
        runtime.engine.dispose()


def test_timeout_releases_durable_owner_and_prevents_late_save(tmp_path, monkeypatch):
    monkeypatch.setattr(copilot_stream, "COPILOT_DEADLINE_SECONDS", 0.03)
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'timeout.db'}")
    service, engine, _ = make_test_service(runtime)
    setup = act(service, "setup")
    original = engine.draft_synopsis
    started, release, worker_done = threading.Event(), threading.Event(), threading.Event()
    observed = {}

    def model(state):
        observed["scope"] = storage_scope.get()
        started.set()
        try:
            assert release.wait(7)
            return original(state)  # Simulates a transport that ignored cancellation.
        finally:
            worker_done.set()

    engine.draft_synopsis = model
    request = QuickActionRequest(action="draft_synopsis", operation_id="operation.timeout",
                                 expected_revision=setup.state.revision)
    try:
        body = asyncio.run(_request(_authorized_app(service), request.model_dump(mode="json"), started, None,
                                     disconnect=False))
        assert '"error_type": "deadline"' in body
        saved = service.get(PROJECT_ID).state
        assert saved.status == "blocked" and saved.active_operation is None and not saved.synopsis
        assert saved.operation_records[-1]["error_code"] == "quick_operation_timeout"
        assert not observed["scope"].active
        release.set()
        assert worker_done.wait(3)
        # A stale finish is fenced by operation identity even on SQLite.
        with pytest.raises(LongStoryPersistenceConflictError):
            service._finish(PROJECT_ID, request, "unused", "synopsis", None, RuntimeError())
        assert service.get(PROJECT_ID).state == saved
        resumed = act(service, "resume")
        assert resumed.state.status == "idle" and resumed.state.next_step == "synopsis"
    finally:
        release.set()
        runtime.engine.dispose()


def test_active_reconnect_is_observation_and_never_a_second_model_request(tmp_path):
    service, engine, runtime = make_test_service(create_database_runtime(f"sqlite:///{tmp_path / 'reconnect.db'}"))
    setup = act(service, "setup")
    request = QuickActionRequest(action="draft_synopsis", operation_id="operation.reconnect", expected_revision=setup.state.revision)
    original = engine.draft_synopsis

    def model(state):
        replay = service.action(PROJECT_ID, request)
        assert replay.state.active_operation["operation_id"] == request.operation_id
        assert replay.state.status == "busy"
        with pytest.raises(LongStoryPersistenceConflictError, match="同一操作"):
            service.action(PROJECT_ID, request.model_copy(update={"payload": {"instruction": "不同内容"}}))
        return original(state)

    engine.draft_synopsis = model
    try:
        assert service.action(PROJECT_ID, request).state.synopsis
        assert engine.calls == ["synopsis"]
    finally:
        runtime.engine.dispose()


def test_initial_bible_stream_emits_provider_text_and_safe_request_diagnostics():
    from tests.test_story_storage_postgres_cas import PostgresStoryStorageCASTest
    from app.modules.script_engine.long_story_models import StoryBible
    candidate = PostgresStoryStorageCASTest.candidate()
    result = StoryBible(**candidate.model_dump(), story_bible_id="bible.fixture",
                       story_project_id=PROJECT_ID, content_spec_id="spec.fixture")
    calls = []

    def generate(payload):
        calls.append(payload)
        copilot_deepseek_thinking_event({"choices": [{"delta": {"reasoning_content": "先检查人物目标，再整理关系。"}}]})
        return result

    app = _authorized_app(None)
    app.dependency_overrides[get_story_planning_service] = lambda: SimpleNamespace(generate_story_bible_draft=generate)
    app.dependency_overrides[get_long_story_service] = lambda: SimpleNamespace(
        get_project=lambda _: SimpleNamespace(revision=2), get_workspace_snapshot=lambda _: SimpleNamespace(revision=3))
    with TestClient(app) as client:
        response = client.post(f"/story-projects/{PROJECT_ID}/story-bibles/draft",
            json={"story_project_id": PROJECT_ID, "generation_strategy_id": "strategy.fixture"},
            headers={"Accept": "text/event-stream"})
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
    assert len(calls) == 1 and events[-1]["type"] == "result"
    assert events[-1]["data"]["data"]["story_bible_id"] == result.story_bible_id
    assert "先检查人物目标，再整理关系。" in "".join(e.get("delta", "") for e in events)
    assert all(e["request_id"] == "request.resilience" for e in events)
    assert response.headers["x-request-id"] == "request.resilience"


def test_roadmap_receipt_failure_recovers_checkpoint_without_regeneration(tmp_path, monkeypatch):
    from sqlmodel import SQLModel
    from app.modules.agent_runtime.episode_roadmap import EpisodeRoadmapAgent
    from app.modules.agent_runtime.service import AgentRunService, AgentRunPersistenceUnavailableError
    from test_agent_runtime import _FakeRoadmapService, _roadmap_item, _roadmap_request

    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'roadmap-recovery.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    items = [_roadmap_item(with_scene_plan=True)]
    planning = _FakeRoadmapService(draft=items[0], chunk=items)
    store = AgentRunService(runtime)
    agent = EpisodeRoadmapAgent(planning_service=planning, run_service=store)
    request = _roadmap_request().model_copy(update={"agent_request_id": "agent-request.receipt-recovery"})
    original_save = store.save_record
    failures = []

    def fail_first_receipt(record, **kwargs):
        if record.status.value == "completed" and not failures:
            failures.append(True)
            raise RuntimeError("one injected database acknowledgement failure")
        return original_save(record, **kwargs)

    monkeypatch.setattr(store, "save_record", fail_first_receipt)
    try:
        with pytest.raises(AgentRunPersistenceUnavailableError):
            agent.run_chunk(request)
        assert store.list_runs()[0].status.value == "failed"
        assert planning.chunk_calls == 1
        recovered = agent.run_chunk(request)
        replayed = agent.run_chunk(request)
        assert recovered.items == replayed.items == items
        assert recovered.run.run_id == replayed.run.run_id
        assert recovered.run.attempt_count == 2
        assert planning.chunk_calls == 1
    finally:
        runtime.engine.dispose()


@pytest.mark.parametrize(("kind", "expected_code"), [
    ("timeout", "quick_model_timeout"), ("rate_limit", "quick_model_busy"),
    ("authentication", "quick_model_configuration"), ("partial", "quick_output_invalid"),
    ("malformed", "quick_output_invalid"),
])
def test_quick_failures_are_bounded_classified_and_do_not_leak_provider_text(kind, expected_code):
    from app.modules.quick_script.engine import QuickEngineError
    from app.modules.script_engine.llm_adapter import LLMRequestError, LLMStructuredOutputError
    from app.modules.script_engine.planning_call_budget import charge_planning_model_request
    from test_quick_script_engine import FakeAdapter, engine
    from tests.quick_script_fixtures import make_state

    adapter = FakeAdapter({"synopsis": 123})
    calls = []
    original = adapter.generate_structured_output_stream
    failures = {
        "timeout": LLMRequestError("PRIVATE_PROVIDER_TEXT", category="timeout"),
        "rate_limit": LLMRequestError("PRIVATE_PROVIDER_TEXT", status_code=429),
        "authentication": LLMRequestError("PRIVATE_PROVIDER_TEXT", status_code=401),
        "partial": LLMStructuredOutputError("PRIVATE_PROVIDER_TEXT"),
    }

    def request(*args, **kwargs):
        calls.append(1)
        if kind == "malformed":
            return original(*args, **kwargs)
        charge_planning_model_request()
        raise failures[kind]

    adapter.generate_structured_output_stream = request
    state = make_state()
    before = state.model_dump(mode="json")
    with pytest.raises(QuickEngineError) as caught:
        engine(adapter).draft_synopsis(state)
    assert caught.value.code == expected_code
    assert caught.value.call.physical_requests == 1
    assert calls == [1] and state.model_dump(mode="json") == before
    assert "PRIVATE_PROVIDER_TEXT" not in str(caught.value)
