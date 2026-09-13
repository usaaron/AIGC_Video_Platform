"""Deadline failures must stop recovery and leave a durable failed Agent."""

import json
import logging
import time

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import SQLModel

from app.api.routes.script_generation import _raise_llm_upstream_unavailable
from app.database import create_database_runtime
from app.dependencies import get_episode_script_agent
from app.llm_runtime import _build_role_adapter_from_env
from app.main import create_app
from app.modules.agent_runtime.episode_script import EpisodeScriptAgent
from app.modules.agent_runtime.service import AgentRunService
from app.modules.script_engine.llm_adapter import (
    LLMRequestError, LLMStructuredOutputError, MockLLMAdapter,
    ModelFailoverLLMAdapter, PooledLLMAdapter, RealLLMAdapter,
)
from app.modules.script_engine.models import GenerationStrategy, ScriptGenerationDraftRequest
from app.modules.script_engine.llm_deadline import DeadlineExceeded, deadline_scope
from tests.test_llm_adapter import build_strategy
from tests.test_script_generation_service import seed_dependencies


def make_adapter(handler, *, seconds=5):
    return RealLLMAdapter(
        provider="openai_compatible", model_name="deadline-fixture", api_key="PRIVATE_KEY",
        base_url="https://deadline.invalid/v1", wire_api="responses",
        timeout_seconds=60, request_deadline_seconds=seconds, max_retries=2,
        transport=httpx.MockTransport(handler),
    )


def test_initial_chain_keeps_deadline_across_stream_and_nonstream_and_persists_failure(monkeypatch, tmp_path):
    now = [100.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    calls = []

    class BrokenStream(httpx.SyncByteStream):
        def __iter__(self):
            yield b'data: {"type":"response.output_text.delta","delta":"{\\"title\\":"}\n\n'
            now[0] += 4
            raise httpx.ReadError("Injected broken stream")

    def handler(request):
        calls.append(json.loads(request.content).get("stream", False))
        if calls[-1]:
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=BrokenStream())
        assert 0 < request.extensions["timeout"]["read"] <= 1
        now[0] += 2
        return httpx.Response(200, json={"output_text": '{"title":"Too late"}'})

    live = make_adapter(handler, seconds=60)
    service, content_spec_id = seed_dependencies(llm_adapter=live)
    service._initial_generation_timeout_seconds = 5
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'agent.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    run_service = AgentRunService(runtime)
    agent = EpisodeScriptAgent(generation_service=service, run_service=run_service)
    payload = ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, story_project_id="story_project.deadline",
        agent_request_id="agent-request.deadline.episode-1",
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en", release_region="overseas", desired_scene_count=3,
        episode_context={"generation_mode": "sequential", "episode_number": 1, "total_episodes": 3},
    )
    try:
        with pytest.raises(LLMRequestError) as failure:
            agent.run(payload)
        assert failure.value.category == "deadline"
        assert failure.value.recoverable is False
        assert failure.value.deadline_scope == "initial_generation"
        assert calls == [True, False]
        with runtime.engine.connect() as connection:
            rows = connection.exec_driver_sql("SELECT status,failure_type FROM agent_runs").all()
            steps = connection.exec_driver_sql("SELECT status,checkpoint_type FROM agent_steps").all()
        assert rows == [("failed", "LLMRequestError")]
        assert steps == [("failed", None)]
    finally:
        live._client.close()
        runtime.engine.dispose()


def test_expired_request_does_not_rotate_key_or_accept_a_late_result(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    calls = []

    def handler(request):
        calls.append(request)
        now[0] += 6
        return httpx.Response(200, json={"output_text": '{"title":"Too late"}'})

    pool = PooledLLMAdapter(
        provider="openai_compatible", model_name="deadline-fixture", api_keys=["key-1", "key-2"],
        base_url="https://deadline.invalid/v1", wire_api="responses", request_deadline_seconds=5,
        transport=httpx.MockTransport(handler), max_retries=2,
    )
    try:
        with pytest.raises(LLMRequestError) as failure:
            pool.generate_structured_output("Return JSON", strategy=GenerationStrategy.model_validate(build_strategy()))
        assert failure.value.category == "deadline"
        assert len(calls) == 1
        assert pool._active == [0, 0]
    finally:
        for route in pool._adapters:
            route._client.close()


@pytest.mark.parametrize("streaming", [False, True])
def test_opted_in_request_deadline_switches_model_then_cools_down(monkeypatch, streaming):
    now = [100.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    calls = []

    def primary_handler(request):
        calls.append("primary")
        now[0] += 6
        return httpx.Response(200, json={"output_text": '{"title":"Too late"}'})

    def fallback_handler(request):
        calls.append("fallback")
        if streaming:
            events = [
                {"type": "response.output_text.delta", "delta": '{"title":"Recovered"}'},
                {"type": "response.completed", "response": {"status": "completed"}},
            ]
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"},
                text="".join(f"data: {json.dumps(event)}\n\n" for event in events),
            )
        return httpx.Response(200, json={"output_text": '{"title":"Recovered"}'})

    primary = make_adapter(primary_handler)
    fallback = make_adapter(fallback_handler)
    adapter = ModelFailoverLLMAdapter(
        primary=primary, fallback=fallback,
        failover_on_request_deadline=True,
        circuit_failure_threshold=1, circuit_cooldown_seconds=600,
    )
    operation = adapter.generate_structured_output_stream if streaming else adapter.generate_structured_output
    strategy = GenerationStrategy.model_validate(build_strategy())
    try:
        with deadline_scope(30, scope="workflow"):
            first = operation("Return JSON", strategy=strategy)
            second = operation("Return JSON", strategy=strategy)
        assert first["title"] == second["title"] == "Recovered"
        assert first["_meta"]["model_failover_used"] is True
        assert second["_meta"]["primary_circuit_open"] is True
        assert calls == ["primary", "fallback", "fallback"]
        now[0] += 601
        operation("Return JSON", strategy=strategy)
        assert calls[-2:] == ["primary", "fallback"]
    finally:
        primary._client.close()
        fallback._client.close()


@pytest.mark.parametrize("allow_failover,parent_seconds", [(False, 30), (True, 3)])
def test_request_failover_preserves_default_and_parent_deadline(monkeypatch, allow_failover, parent_seconds):
    now = [100.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    fallback_calls = []

    def handler(request):
        now[0] += 6
        return httpx.Response(200, json={"output_text": '{"title":"Too late"}'})

    primary = make_adapter(handler)
    fallback = MockLLMAdapter()
    monkeypatch.setattr(fallback, "generate_structured_output", lambda *a, **k: fallback_calls.append(True))
    adapter = ModelFailoverLLMAdapter(
        primary=primary, fallback=fallback, failover_on_request_deadline=allow_failover,
    )
    try:
        with pytest.raises((LLMRequestError, DeadlineExceeded)) as failure:
            with deadline_scope(parent_seconds, scope="workflow"):
                adapter.generate_structured_output("Return JSON", strategy=GenerationStrategy.model_validate(build_strategy()))
        assert getattr(failure.value, "deadline_scope", getattr(failure.value, "scope", None)) == (
            "workflow" if allow_failover else "request"
        )
        assert fallback_calls == []
    finally:
        primary._client.close()


def test_key_queue_wait_is_included_in_deadline():
    pool = PooledLLMAdapter(
        provider="openai_compatible", model_name="deadline-fixture", api_keys=["key-1"],
        base_url="https://deadline.invalid/v1", request_deadline_seconds=0.03,
        transport=httpx.MockTransport(lambda _: pytest.fail("No slot was released")),
    )
    pool._active[0] = 1
    started = time.monotonic()
    try:
        with pytest.raises(LLMRequestError) as failure:
            pool.generate_structured_output("Return JSON", strategy=GenerationStrategy.model_validate(build_strategy()))
        assert failure.value.category == "deadline"
        assert time.monotonic() - started < 1
        assert pool._active == [1]
    finally:
        pool._adapters[0]._client.close()


def test_deadline_in_fallback_is_not_wrapped_as_recoverable_schema_failure():
    class SchemaFailure(MockLLMAdapter):
        def generate_structured_output(self, *args, **kwargs):
            raise LLMStructuredOutputError("Invalid source JSON", raw_content="{")

    deadline = LLMRequestError("Budget exhausted", category="deadline", recoverable=False)

    class ExpiredFallback(MockLLMAdapter):
        def generate_structured_output(self, *args, **kwargs):
            raise deadline

    route = ModelFailoverLLMAdapter(primary=SchemaFailure(), fallback=ExpiredFallback())
    with pytest.raises(LLMRequestError) as failure:
        route.generate_structured_output("Return JSON", strategy=GenerationStrategy.model_validate(build_strategy()))
    assert failure.value is deadline


def test_deadline_api_error_is_not_automatic_retry_or_input_error():
    with pytest.raises(HTTPException) as failure:
        _raise_llm_upstream_unavailable(LLMRequestError("PRIVATE", category="deadline", recoverable=False))
    error = failure.value
    assert error.status_code == 503
    assert error.headers["X-Generation-Retryable"] == "false"
    assert error.headers["X-Generation-Failure-Class"] == "time_budget_exhausted"
    assert error.headers["X-Generation-Error-Type"] == "local_deadline_exceeded"
    assert "PRIVATE" not in error.detail


def test_streaming_api_preserves_deadline_and_disables_reconnect():
    class ExpiredAgent:
        def run(self, payload, **kwargs):
            raise LLMRequestError("PRIVATE", category="deadline", recoverable=False)

    app = create_app()
    app.dependency_overrides[get_episode_script_agent] = lambda: ExpiredAgent()
    with TestClient(app) as client:
        response = client.post("/script-generation/generate-draft/stream", json={
            "content_spec_id": "content_spec.deadline", "generation_strategy_id": "strategy.deadline",
            "output_language": "en", "release_region": "overseas",
        })
    assert response.status_code == 200
    events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
    failures = [event for event in events if event["type"] == "error"]
    assert len(failures) == 1
    assert failures[0]["error_type"] == "local_deadline_exceeded"
    assert failures[0]["recoverable"] is False
    assert "PRIVATE" not in response.text
    assert not any(event["type"] == "result" for event in events)


@pytest.mark.parametrize("pooled", [False, True])
def test_role_request_deadline_reaches_real_adapter_and_pool(monkeypatch, pooled):
    prefix = "LLM_OVERSEAS_SCRIPT"
    for name, value in {"PROVIDER": "openai_compatible", "MODEL": "deadline-fixture", "API_KEY": "key",
                        "BASE_URL": "https://deadline.invalid/v1", "TIMEOUT_SECONDS": "60",
                        "REQUEST_DEADLINE_SECONDS": "17"}.items():
        monkeypatch.setenv(f"{prefix}_{name}", value)
    if pooled:
        monkeypatch.setenv(f"{prefix}_API_KEY_01", "key-1")
    route = _build_role_adapter_from_env(prefix, default_model_env=f"{prefix}_MODEL",
                                         default_timeout_seconds=60, default_max_retries=0)
    adapters = route._adapters if pooled else [route]
    try:
        assert all(adapter._request_deadline_seconds == 17 for adapter in adapters)
        assert all(adapter._timeout_seconds == 60 for adapter in adapters)
    finally:
        for adapter in adapters:
            adapter._client.close()


def test_stream_activity_distinguishes_comments_reasoning_and_text_without_content(monkeypatch, caplog):
    now = [0.0]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    events = [
        b": PRIVATE_COMMENT\n\n",
        b'data: {"type":"response.reasoning_summary_text.delta","delta":"PRIVATE_REASONING"}\n\n',
        b'data: {"type":"response.output_text.delta","delta":"{\\"title\\":\\"PRIVATE_BODY\\"}"}\n\n',
        b'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    ]

    class Stream(httpx.SyncByteStream):
        def __iter__(self):
            for index, event in enumerate(events):
                now[0] = [1, 2, 3, 35][index]
                yield event

    route = make_adapter(lambda _: httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=Stream()), seconds=60)
    caplog.set_level(logging.WARNING, logger="app.modules.script_engine.llm_adapter")
    try:
        result = route.generate_structured_output_stream("PRIVATE_PROMPT", strategy=GenerationStrategy.model_validate(build_strategy()))
        assert result["title"] == "PRIVATE_BODY"
    finally:
        route._client.close()
    rows = [json.loads(record.getMessage().split("metrics=", 1)[1]) for record in caplog.records
            if record.getMessage().startswith("LLM route response progress ")]
    assert [row["reason"] for row in rows] == ["headers", "first_byte", "first_comment", "first_reasoning", "first_text", "activity", "response_closed"]
    assert rows[-1]["comment_lines"] == 1
    assert rows[-1]["first_text_seconds"] == 3
    assert rows[-1]["last_text_seconds"] == 3
    assert rows[-1]["last_byte_seconds"] == 35
    assert rows[-1]["reasoning_chars"] == len("PRIVATE_REASONING")
    assert rows[-1]["body_bytes"] == sum(map(len, events))
    assert "PRIVATE" not in caplog.text
