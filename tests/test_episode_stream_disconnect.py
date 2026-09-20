"""Request cancellation closes the owned run before shared storage revocation."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import threading

import httpx
import pytest
from sqlmodel import SQLModel

import app.modules.agent_runtime
from app.account_context import AccountContextError, account_schema, current_schema, storage_scope
from app.database import create_database_runtime
from app.dependencies import get_episode_script_agent
from app.host_integration import HostRequestContext
from app.main import create_app
from app.modules.agent_runtime.models import AgentRunPolicy, AgentRunStatus, AgentToolKind
from app.modules.agent_runtime.repository import AgentRunPersistenceConflictError, AgentRunRepository
from app.modules.agent_runtime.service import AgentRunService
from app.modules.agent_runtime.stream_lifecycle import EpisodeStreamLifecycle, start_stream_session
from app.modules.script_engine.llm_adapter import LLMRequestCancelledError, RealLLMAdapter
from app.modules.script_engine.llm_cancellation import bind_llm_cancellation
from tests.test_llm_adapter import build_strategy
from app.modules.script_engine.models import GenerationStrategy


POLICY = AgentRunPolicy(max_steps=2, max_model_tool_calls=2, allowed_tools={"draft", "repair"})


@pytest.fixture
def store(tmp_path):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'runs.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    yield AgentRunService(runtime, instance_id="worker.one")
    runtime.engine.dispose()


def start(store, key="request.test", **kwargs):
    return store.start_session(agent_name="episode_script", subject_ref="episode.9", policy=POLICY,
        request_key=key, input_fingerprint="a" * 64, **kwargs)


@pytest.mark.parametrize("end_mode", ["disconnect", "send_error", "late_worker"])
def test_real_asgi_end_cancels_owned_run_in_original_scope(store, end_mode):
    started, release, finished = threading.Event(), threading.Event(), threading.Event()
    captured = {}
    class MockAgent:
        def run(self, payload, *, progress_callback=None, cancel_event=None):
            captured["schema"] = current_schema()
            captured["scope"] = storage_scope.get()
            result = start_stream_session(store, lambda: start(store))
            captured["run"] = result.record
            session = result.session
            def work():
                started.set()
                if end_mode == "late_worker":
                    release.wait(5)
                    try:
                        current_schema()
                    except AccountContextError:
                        captured["late_scope_denied"] = True
                else:
                    assert cancel_event.wait(5)
                raise LLMRequestCancelledError()
            try:
                session.call_tool("draft", kind=AgentToolKind.model, operation=work)
            except Exception as error:
                try:
                    session.fail(error)
                except AccountContextError:
                    captured["late_save_denied"] = True
                raise
            finally:
                finished.set()
    async def authorize(_request):
        return HostRequestContext(tenant_id="org", actor_id="actor.one", request_id="stream.test", permissions={"project.write"})
    app = create_app(host_authorizer=authorize, require_host_context=False)
    app.dependency_overrides[get_episode_script_agent] = lambda: MockAgent()
    async def run():
        body = json.dumps({"content_spec_id":"content.test", "generation_strategy_id":"strategy.test", "output_language":"zh", "desired_scene_count":3}).encode()
        first = True
        async def receive():
            nonlocal first
            if first:
                first = False
                return {"type":"http.request", "body":body, "more_body":False}
            assert await asyncio.to_thread(started.wait, 5)
            return {"type":"http.disconnect"}
        async def send(message):
            if end_mode == "send_error" and message["type"] == "http.response.body":
                assert await asyncio.to_thread(started.wait, 5)
                raise OSError("test client closed socket")
        scope={"type":"http", "asgi":{"version":"3.0", "spec_version":"2.4" if end_mode=="send_error" else "2.0"}, "http_version":"1.1", "method":"POST", "scheme":"http", "path":"/script-generation/generate-draft/stream", "raw_path":b"/script-generation/generate-draft/stream", "query_string":b"", "headers":[(b"content-type",b"application/json")], "client":("test",1), "server":("test",80), "root_path":""}
        try:
            await asyncio.wait_for(app(scope, receive, send), 8)
        except Exception:
            if end_mode != "send_error":
                raise
    try:
        asyncio.run(run())
        assert captured["schema"] == account_schema("org", "actor.one")
        assert captured["scope"].active is False
        assert storage_scope.get() is None
        saved = store.get_run(captured["run"].run_id)
        assert saved.status == AgentRunStatus.failed
        assert saved.failure_type == "LLMRequestCancelledError"
        assert all(step.status.value == "failed" for step in saved.tool_executions)
    finally:
        release.set()
        assert finished.wait(5)
    if end_mode == "late_worker":
        assert captured["late_scope_denied"] and captured["late_save_denied"]


def test_cancel_preserves_checkpoint_and_original_key_can_resume(store):
    lifecycle = EpisodeStreamLifecycle()
    with lifecycle.bind():
        initial = start_stream_session(store, lambda: start(store))
        initial.session.call_tool("draft", kind=AgentToolKind.model, operation=lambda: {"safe":"checkpoint"},
            checkpoint_serializer=lambda value:("draft.checkpoint.v1",value))
    lifecycle.close()
    saved = store.get_run(initial.record.run_id)
    assert saved.status == AgentRunStatus.failed
    assert store.load_tool_checkpoint(saved.run_id,"draft") == ("draft.checkpoint.v1",{"safe":"checkpoint"})
    resumed = start(store)
    assert resumed.record.attempt_count == 2
    with pytest.raises(AgentRunPersistenceConflictError):
        store.save_record(initial.record)
    assert resumed.session.call_tool("draft",kind=AgentToolKind.model, operation=lambda:pytest.fail("checkpoint should replay"), checkpoint_loader=lambda value:value, expected_checkpoint_type="draft.checkpoint.v1") == {"safe":"checkpoint"}


def test_cancel_cannot_overwrite_other_owner_key_attempt_or_completed_result(store):
    first = start(store)
    for field,value in [("owner_instance_id","other.worker"),("request_key","other.key"),("attempt_count",99),("input_fingerprint","b"*64)]:
        store.cancel_stream_run(first.record.model_copy(update={field:value}))
        assert store.get_run(first.record.run_id).status == AgentRunStatus.running
    first.session.complete(result_type="result.test",result_payload={"done":True})
    store.cancel_stream_run(first.record)
    assert store.get_run(first.record.run_id).status == AgentRunStatus.completed


def test_disconnect_before_start_prevents_an_orphan_run(store):
    lifecycle=EpisodeStreamLifecycle()
    lifecycle.close()
    with pytest.raises(LLMRequestCancelledError):
        lifecycle.start(store,lambda:start(store))
    assert store.list_runs()==[]


@pytest.mark.parametrize("streaming",[False,True])
def test_context_cancellation_stops_model_repairs_without_explicit_event(streaming):
    cancelled=threading.Event();calls=[]
    def handler(request):
        calls.append(request)
        cancelled.set()
        if streaming:
            return httpx.Response(200,text='data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',headers={"content-type":"text/event-stream"})
        return httpx.Response(200,json={"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]})
    adapter=RealLLMAdapter(provider="openai_compatible",model_name="test-model",api_key="test",base_url="https://cancel.test/v1",transport=httpx.MockTransport(handler),max_retries=2)
    strategy=GenerationStrategy.model_validate(build_strategy())
    operation=adapter.generate_structured_output_stream if streaming else adapter.generate_structured_output
    with bind_llm_cancellation(cancelled):
        with pytest.raises(LLMRequestCancelledError):operation("repair without explicit cancel",strategy=strategy,output_schema=None)
        with pytest.raises(LLMRequestCancelledError):operation("next repair must not start",strategy=strategy,output_schema=None)
    assert len(calls)==1


@pytest.mark.parametrize("change", ["cancel", "resume"])
def test_inflight_heartbeat_cannot_restore_cancelled_or_replaced_payload(store, monkeypatch, change):
    initial = start(store)
    expected = initial.record.model_copy(deep=True)
    acquired, release, changing = threading.Event(), threading.Event(), threading.Event()
    original = AgentRunRepository.require_current_owner
    heartbeat_thread = []

    def hold_after_lease_read(repository, record):
        table = original(repository, record)
        if threading.get_ident() in heartbeat_thread:
            acquired.set()
            assert release.wait(5)
        return table

    monkeypatch.setattr(AgentRunRepository, "require_current_owner", hold_after_lease_read)

    def heartbeat():
        heartbeat_thread.append(threading.get_ident())
        store.heartbeat(expected)

    def replace_or_cancel():
        changing.set()
        if change == "cancel":
            store.cancel_stream_run(expected)
        else:
            replacement = AgentRunService(store._runtime(), instance_id="worker.two")
            start(replacement)

    with ThreadPoolExecutor(max_workers=2) as workers:
        pulse = workers.submit(heartbeat)
        assert acquired.wait(5)
        update_run = workers.submit(replace_or_cancel)
        try:
            assert changing.wait(5)
            # The mutation must wait for the heartbeat's transaction. Without
            # the lock it commits now and the held heartbeat restores old JSON.
            with pytest.raises(TimeoutError):
                update_run.result(timeout=0.1)
        finally:
            release.set()
        pulse.result(timeout=5)
        update_run.result(timeout=5)

    saved = store.get_run(expected.run_id)
    if change == "cancel":
        assert saved.status == AgentRunStatus.failed
        assert saved.failure_type == "LLMRequestCancelledError"
    else:
        assert saved.status == AgentRunStatus.running
        assert saved.attempt_count == 2
        assert saved.owner_instance_id == "worker.two"
    snapshot = saved.model_dump(mode="json")
    with pytest.raises(AgentRunPersistenceConflictError):
        store.heartbeat(expected)
    assert store.get_run(expected.run_id).model_dump(mode="json") == snapshot


@pytest.mark.parametrize("field,value", [
    ("owner_instance_id", "worker.other"), ("request_key", "other.key"),
    ("attempt_count", 99), ("input_fingerprint", "b" * 64), ("project_id", "other.project"),
])
def test_heartbeat_cannot_renew_another_run_lease(store, field, value):
    initial = start(store)
    snapshot = store.get_run(initial.record.run_id).model_dump(mode="json")
    with pytest.raises(AgentRunPersistenceConflictError):
        store.heartbeat(initial.record.model_copy(update={field: value}))
    assert store.get_run(initial.record.run_id).model_dump(mode="json") == snapshot
