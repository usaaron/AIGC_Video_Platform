import asyncio
from contextvars import copy_context
from threading import Thread
from threading import Event
from types import SimpleNamespace

import pytest

from app.account_context import (
    AccountContextError, AccountLocalRepository, StorageScope,
    account_schema, current_schema, storage_scope,
)
from app.modules.scheduled_ingestion.dedup_repository import IngestionDedupRepository


def test_schema_identity_is_framed_stable_and_safe():
    assert account_schema("a", "bc") != account_schema("ab", "c")
    assert account_schema("org", "one") != account_schema("org", "two")
    assert account_schema("org1", "same") != account_schema("org2", "same")
    value = account_schema('";DROP SCHEMA public;--', "用户")
    assert value == account_schema('";DROP SCHEMA public;--', "用户")
    assert len(value) <= 63 and value.startswith("sm_ac_")
    assert all(char in "0123456789abcdef" for char in value[6:])


def test_copied_background_context_revoked_after_request():
    scope = StorageScope(required=True, schema=account_schema("tenant", "actor"))
    token = storage_scope.set(scope)
    try:
        copied = copy_context()
        observed = []
        worker = Thread(target=copied.run, args=(lambda: observed.append(current_schema()),))
        worker.start()
        worker.join(timeout=2)
        assert observed == [scope.schema]
        scope.active = False
        with pytest.raises(AccountContextError):
            copied.run(current_schema)
    finally:
        storage_scope.reset(token)
    assert current_schema() is None


def test_memory_repository_resolves_actor_at_each_call_even_cached_methods():
    repository = AccountLocalRepository(IngestionDedupRepository)
    save = repository.mark_imported
    for actor in ("one", "two"):
        token = storage_scope.set(StorageScope(schema=account_schema("org", actor)))
        try:
            assert not repository.has_external_id("shared")
            save("shared", None)
            assert repository.has_external_id("shared")
        finally:
            storage_scope.reset(token)
    assert not repository.has_external_id("shared")


def test_async_requests_and_threadpool_keep_distinct_scopes():
    async def run(actor):
        expected = account_schema("org", actor)
        token = storage_scope.set(StorageScope(schema=expected))
        try:
            await asyncio.sleep(0)
            assert await asyncio.to_thread(current_schema) == expected
        finally:
            storage_scope.reset(token)
    async def all_requests():
        await asyncio.gather(run("one"), run("two"))
    asyncio.run(all_requests())
    assert current_schema() is None


def test_agent_heartbeat_thread_inherits_storage_identity(monkeypatch):
    from app.modules.agent_runtime.runtime import AgentSession
    from app.modules.agent_runtime.models import AgentRunPolicy
    monkeypatch.setattr("app.modules.agent_runtime.runtime.AGENT_HEARTBEAT_INTERVAL_SECONDS", 0.005)
    completed = Event()
    observed = []
    def heartbeat(run_id):
        observed.append(current_schema())
        completed.set()
    session = AgentSession(agent_name="test", subject_ref="subject", policy=AgentRunPolicy(allowed_tools={"test"}),
                           store=SimpleNamespace(heartbeat=heartbeat))
    expected = account_schema("org", "one")
    token = storage_scope.set(StorageScope(schema=expected))
    try:
        assert session._run_with_heartbeat(lambda: completed.wait(timeout=2))
        assert observed and set(observed) == {expected}
    finally:
        storage_scope.reset(token)


def test_generation_sse_worker_inherits_actor_and_is_revoked_after_response():
    from fastapi.testclient import TestClient
    from app.dependencies import get_episode_script_agent
    from app.host_integration import HostRequestContext
    from app.main import create_app
    from app.modules.script_engine.generation_service import InvalidDraftMasterScriptOutputError
    captured = []
    class MockAgent:
        def run(self, payload, *, progress_callback=None):
            captured.append((current_schema(), storage_scope.get()))
            raise InvalidDraftMasterScriptOutputError("No provider call in this test")
    async def authorize(request):
        return HostRequestContext(tenant_id="org", actor_id=request.headers["x-test-actor"],
                                  request_id="test-stream", permissions={"project.write"})
    app = create_app(host_authorizer=authorize, require_host_context=False)
    app.dependency_overrides[get_episode_script_agent] = lambda: MockAgent()
    client = TestClient(app)
    try:
        for actor in ("one", "two"):
            response = client.post("/script-generation/generate-draft/stream", headers={"x-test-actor": actor},
                                   json={"content_spec_id": "content.test", "generation_strategy_id": "strategy.test",
                                         "output_language": "zh", "desired_scene_count": 3})
            assert response.status_code == 200
            assert "output_incomplete" in response.text
            assert captured[-1][0] == account_schema("org", actor)
            assert captured[-1][1].active is False
    finally:
        client.close()
    assert storage_scope.get() is None
