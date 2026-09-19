"""Fault injection at the real adapter and durable episode Agent boundaries."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import httpx
import pytest
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.agent_runtime.episode_script import EpisodeScriptAgent
from app.modules.agent_runtime.service import AgentRunService
from app.modules.script_engine.llm_adapter import LLMRequestError, LLMStructuredOutputError, RealLLMAdapter
from app.modules.script_engine.models import GenerationStrategy, ScriptGenerationDraftRequest
from scripts.real_generation_probe_transport import ProbeLimitExceeded, ProviderRequestMeter
from scripts.run_real_generation_probe import replay_result_digest
from tests.test_llm_adapter import build_strategy
from tests.test_script_generation_service import CountingMockLLMAdapter, seed_dependencies


def adapter(max_retries=0):
    return RealLLMAdapter(
        provider="openai_compatible", model_name="overseas-recovery-fixture", api_key="fixture-only",
        base_url="https://overseas-recovery.invalid/v1", wire_api="responses", max_retries=max_retries,
    )


@pytest.mark.parametrize("max_retries,expected", [(0, [True, False, False]), (1, [True, True, False, False])])
def test_exhausted_empty_response_recovery_has_one_owner(monkeypatch, tmp_path, max_retries, expected):
    requests = []

    def handle(_transport, request):
        assert request.url.host == "overseas-recovery.invalid"
        payload = json.loads(request.content)
        requests.append(payload.get("stream", False))
        if payload.get("stream"):
            return httpx.Response(200, headers={"content-type": "text/event-stream"},
                                  stream=httpx.ByteStream(b"data: [DONE]\n\n"))
        return httpx.Response(200, stream=httpx.ByteStream(b'{"id":"fixture.empty","output":[],"status":"completed"}'))

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", handle)
    service, _ = seed_dependencies()
    live_adapter = adapter(max_retries)
    with ProviderRequestMeter(tmp_path / "empty-requests.jsonl", max_requests=6) as meter:
        with pytest.raises(LLMStructuredOutputError) as failure:
            service._generate_postprocess_output(
                adapter=live_adapter, prompt="Return the repaired JSON.",
                strategy=GenerationStrategy.model_validate(build_strategy()),
                output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
                phase="acceptance_repair", progress_callback=None,
            )
    live_adapter._client.close()
    assert failure.value.stream_fallback_attempted is True
    assert failure.value.empty_response_retry_attempted is True
    assert requests == expected
    assert meter.summary()["physical_requests"] == len(expected)
    assert meter.summary()["requests_missing_usage"] == len(expected)


@pytest.mark.parametrize("request_limit", [1, 2])
def test_partial_provider_stream_fallback_obeys_the_shared_physical_request_cap(monkeypatch, tmp_path, request_limit):
    requests = []

    class BrokenStream(httpx.SyncByteStream):
        def __iter__(self):
            yield b'data: {"type":"response.output_text.delta","delta":"{\\"title\\":"}\n\n'
            raise httpx.RemoteProtocolError("Injected incomplete chunked read")

    def handle(_transport, request):
        assert request.url.host == "overseas-recovery.invalid"
        streaming = json.loads(request.content).get("stream", False)
        requests.append(streaming)
        if streaming:
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=BrokenStream())
        return httpx.Response(200, stream=httpx.ByteStream(json.dumps({
            "id": "fixture.recovered", "output": [{"type": "message", "content": [
                {"type": "output_text", "text": '{"title":"Recovered once"}'}]}],
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }).encode()))

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", handle)
    live_adapter = adapter(max_retries=1)
    with ProviderRequestMeter(tmp_path / "broken-requests.jsonl", max_requests=request_limit) as meter:
        if request_limit == 1:
            with pytest.raises(ProbeLimitExceeded, match="request_limit"):
                live_adapter.generate_structured_output_stream("Return JSON.", strategy=GenerationStrategy.model_validate(build_strategy()))
        else:
            result = live_adapter.generate_structured_output_stream("Return JSON.", strategy=GenerationStrategy.model_validate(build_strategy()))
            assert result["title"] == "Recovered once"
            assert result["_meta"]["stream_fallback"] is True
    live_adapter._client.close()
    assert requests == [True, False][:request_limit]
    assert meter.summary()["physical_requests"] == request_limit
    assert meter.summary()["requests_missing_usage"] == 1
    assert meter.summary()["blocked_requests"] == (1 if request_limit == 1 else 0)


def _completed_replay_child(database: str, request_path: str) -> None:
    class NoGenerationAllowed:
        def generate_draft(self, *_args, **_kwargs):
            raise AssertionError("A completed episode must not call a model stage again.")

    runtime = create_database_runtime(f"sqlite:///{database}")
    agent = EpisodeScriptAgent(generation_service=NoGenerationAllowed(), run_service=AgentRunService(runtime))
    payload = ScriptGenerationDraftRequest.model_validate_json(Path(request_path).read_text())
    with ProviderRequestMeter(Path(request_path).with_suffix(".network.jsonl"), max_requests=0) as meter:
        result = agent.run(payload)
    print(json.dumps({"result_digest": replay_result_digest({"data": result.draft_run.model_dump(mode="json")}),
                      "attempt_count": result.run.attempt_count, "provider_requests": meter.summary()["physical_requests"]}))
    runtime.engine.dispose()


def test_failed_second_episode_reuses_pre_edit_and_completed_first_episode_survives_process_restart(monkeypatch, tmp_path):
    model = CountingMockLLMAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=model)
    database = tmp_path / "agent.db"
    runtime = create_database_runtime(f"sqlite:///{database}")
    SQLModel.metadata.create_all(runtime.engine)
    agent = EpisodeScriptAgent(generation_service=service, run_service=AgentRunService(runtime))
    requests = [ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, story_project_id="story_project.overseas_recovery",
        agent_request_id=f"agent-request.overseas-recovery.episode-{number}",
        generation_strategy_id="strategy.tiktok.service_generation.v1", output_language="en", release_region="overseas",
        desired_scene_count=3, episode_context={"generation_mode": "sequential", "episode_number": number, "total_episodes": 3},
    ) for number in (1, 2)]
    first = agent.run(requests[0])
    first_digest = replay_result_digest({"data": first.draft_run.model_dump(mode="json")})
    after_first = model.structured_call_count
    original_finalize = service.finalize_pre_edit_draft

    def fail_finalization(source, **kwargs):
        if source.episode_context.episode_number == 2:
            raise LLMRequestError("Injected post-edit disconnection", category="transport", recoverable=True)
        return original_finalize(source, **kwargs)

    monkeypatch.setattr(service, "finalize_pre_edit_draft", fail_finalization)
    with pytest.raises(LLMRequestError, match="Injected"):
        agent.run(requests[1])
    after_failure = model.structured_call_count
    assert after_failure > after_first
    runtime.engine.dispose()
    replacement_runtime = create_database_runtime(f"sqlite:///{database}")
    replacement = EpisodeScriptAgent(generation_service=service, run_service=AgentRunService(replacement_runtime))
    monkeypatch.setattr(service, "finalize_pre_edit_draft", original_finalize)
    resumed = replacement.run(requests[1])
    assert model.structured_call_count == after_failure
    assert resumed.run.attempt_count == 2
    assert resumed.draft_run.draft_master_script.llm_metadata["agent_resumed_from_checkpoint"] is True
    first_replay = replacement.run(requests[0])
    assert replay_result_digest({"data": first_replay.draft_run.model_dump(mode="json")}) == first_digest
    assert model.structured_call_count == after_failure
    replacement_runtime.engine.dispose()

    request_path = tmp_path / "first-request.json"
    request_path.write_text(requests[0].model_dump_json())
    root = Path(__file__).resolve().parents[1]
    child = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), str(database), str(request_path)],
        cwd=root, env={"PATH": os.environ.get("PATH", ""), "PYTHONPATH": os.pathsep.join([str(root), str(root / 'backend')]),
                       "PYTHONUTF8": "1", **{key: os.environ[key] for key in ("SystemRoot", "SYSTEMROOT", "WINDIR") if key in os.environ}},
        capture_output=True, text=True, timeout=30, check=True,
    )
    restored = json.loads(child.stdout)
    assert restored == {"result_digest": first_digest, "attempt_count": 1, "provider_requests": 0}


def test_revised_planning_epoch_survives_final_review_and_pre_edit_recovery(monkeypatch, tmp_path):
    from app.modules.script_engine.generation_service import EpisodeExecutionNotReadyError

    model = CountingMockLLMAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=model)
    current = {"id": "story_project.revised_epoch", "planningRevisionEpoch": 3, "episodes": []}
    service._episode_plan_workspace_loader = lambda _project: current
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'epoch.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    from sqlmodel import Session
    from app.modules.script_engine.long_story_models import StoryProjectWorkspaceSnapshot
    from app.modules.script_engine.long_story_repository import LongStoryRepository
    from tests.test_long_story_api import build_project
    with Session(runtime.engine) as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project().model_copy(update={"project_id": "story_project.revised_epoch"}))
        repository.save_workspace_snapshot(StoryProjectWorkspaceSnapshot(
            project_id="story_project.revised_epoch", revision=1, client_instance_id="epoch.test",
            workspace_payload=dict(current), payload_checksum="0" * 64, payload_size_bytes=100,
        ))
        session.commit()
    agent = EpisodeScriptAgent(generation_service=service, run_service=AgentRunService(runtime))
    payload = ScriptGenerationDraftRequest(
        planning_revision_epoch=3, story_project_id="story_project.revised_epoch",
        agent_request_id="agent-request.revised-epoch", content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1", output_language="en",
        desired_scene_count=3,
    )
    original = service.review_draft
    seen = []

    def interrupted_review(request):
        seen.append(request.planning_revision_epoch)
        if len(seen) == 1:
            raise RuntimeError("injected final review interruption")
        return original(request)

    monkeypatch.setattr(service, "review_draft", interrupted_review)
    with pytest.raises(RuntimeError, match="injected"):
        agent.run(payload)
    calls = model.structured_call_count
    result = agent.run(payload)
    assert seen == [3, 3]
    assert model.structured_call_count == calls
    assert result.draft_run.draft_master_script.llm_metadata["agent_resumed_from_checkpoint"] is True
    current["planningRevisionEpoch"] = 4
    with pytest.raises(EpisodeExecutionNotReadyError, match="epoch"):
        agent.run(payload)
    assert model.structured_call_count == calls
    runtime.engine.dispose()


if __name__ == "__main__":
    _completed_replay_child(*sys.argv[1:])
