"""A provider-truncated scene can recover without changing saved source/scenes."""
from copy import deepcopy
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.modules.agent_runtime
from app.api.routes.preproduction import router
from app.dependencies import get_long_story_service, get_storyboard_service
from app.modules.preproduction.generation_recovery import storyboard_output_truncated
from app.modules.preproduction.repository import StoryboardConflictError
from app.modules.script_engine.llm_adapter import LLMRequestError, LLMStructuredOutputError, RealLLMAdapter
from app.modules.script_engine import llm_deadline
from tests.test_preproduction import storyboard, SOURCE, PROJECT, SceneAdapter


PARTIAL = '{"design":{"purpose":"保留本场正文依据","spatial_layout":"' + "镜头空间" * 170


def scene_proposal():
    return SceneAdapter().generate_structured_output_stream(
        "scene", strategy=SimpleNamespace(max_tokens=12000), output_schema={"source_refs": {}},
    )


def response(content, *, truncated=False):
    events = []
    if truncated:
        events.append({"choices": [{"delta": {"reasoning_content": "R" * 28351}}]})
    events.extend([
        {"choices": [{"delta": {"content": content}}]},
        {"choices": [{"delta": {}, "finish_reason": "length" if truncated else "stop"}]},
    ])
    return httpx.Response(200, text="".join(f"data: {json.dumps(e)}\n\n" for e in events) + "data: [DONE]\n\n",
                          headers={"content-type": "text/event-stream"})


def install_route(service, handler):
    adapter = RealLLMAdapter(
        provider="openai_compatible", model_name="deepseek-v4-1-flash-260910", api_key="test-only",
        base_url="https://storyboard.test/v1", max_retries=0, reasoning_effort="high",
        thinking_mode="enabled", timeout_seconds=600, retry_empty_response=False, transport=httpx.MockTransport(handler),
    )
    service.adapter_factory = lambda: adapter
    return adapter


def saved_first_scene(service):
    source = deepcopy(SOURCE)
    source["scenes"].append({**deepcopy(source["scenes"][0]), "scene_number": 2})
    plan = service.start(PROJECT, 1, source, 0)
    return service.generate_scene(PROJECT, 1, 1, plan.revision, "")


@pytest.mark.parametrize("invalid_refs", [False, True])
def test_real_partial_length_retry_preserves_source_schema_and_existing_scene(storyboard, invalid_refs):
    service, _, _, _ = storyboard
    saved = saved_first_scene(service)
    seen = []
    proposal = scene_proposal()
    if invalid_refs:
        proposal["shots"][0]["source_refs"] = ["action:0"]
    def handler(request):
        seen.append(json.loads(request.content))
        if len(seen) == 1:
            return response(PARTIAL, truncated=True)
        return response(json.dumps(proposal, ensure_ascii=False))
    install_route(service, handler)
    if invalid_refs:
        with pytest.raises(StoryboardConflictError, match="遗漏"):
            service.generate_scene(PROJECT, 1, 2, saved.revision, "保留全部正文与导演约束。")
        assert service.require(PROJECT, 1) == saved
    else:
        result = service.generate_scene(PROJECT, 1, 2, saved.revision, "保留全部正文与导演约束。")
        assert result.scenes[0] == saved.scenes[0]
        assert result.source_draft == saved.source_draft and result.source_signature == saved.source_signature
        assert result.revision == saved.revision + 1
        assert [s.scene_number for s in result.scenes] == [1, 2]
        assert result.candidate is None
    assert len(seen) == (3 if invalid_refs else 2)
    assert [p["thinking"]["type"] for p in seen] == (["enabled", "disabled", "disabled"] if invalid_refs else ["enabled", "disabled"])
    assert seen[0]["model"] == seen[1]["model"] and seen[0]["max_tokens"] == seen[1]["max_tokens"] == 12000
    assert seen[0].get("response_format") == seen[1].get("response_format")
    first_prompt = seen[0]["messages"][-1]["content"]
    recovery_prompt = seen[1]["messages"][-1]["content"]
    assert first_prompt.split("\n\nDEEPSEEK JSON OUTPUT CONTRACT")[0] in recovery_prompt
    assert "incomplete_proposal" in recovery_prompt
    assert "source_refs" in recovery_prompt and "保留全部正文与导演约束" in recovery_prompt


def test_second_truncation_returns_503_without_saving_or_third_attempt(storyboard):
    service, _, _, projects = storyboard
    saved = saved_first_scene(service)
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return response(PARTIAL, truncated=True)
    install_route(service, handler)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_storyboard_service] = lambda: service
    app.dependency_overrides[get_long_story_service] = lambda: projects
    with TestClient(app) as client:
        result = client.post(f"/story-projects/{PROJECT}/episodes/1/storyboard/scenes/2/generate",
                             json={"expected_revision": saved.revision})
    assert result.status_code == 503 and "截断" in result.json()["detail"]
    assert len(seen) == 2 and service.require(PROJECT, 1) == saved


@pytest.mark.parametrize("error", [
    LLMStructuredOutputError("Wrong JSON.", raw_content="{bad", stream_termination="stop"),
    LLMStructuredOutputError("Refused.", refusal="refused", stream_termination="length"),
    LLMRequestError("Gateway failed.", category="provider_gateway", status_code=500),
])
def test_non_limit_errors_are_not_retried_and_leave_saved_scene(storyboard, error):
    service, adapter, _, _ = storyboard
    saved = saved_first_scene(service)
    before = adapter.calls
    adapter.failure = error
    with pytest.raises(type(error)) as caught:
        service.generate_scene(PROJECT, 1, 2, saved.revision, "")
    assert caught.value is error and adapter.calls == before + 1
    assert not storyboard_output_truncated(error)
    assert service.require(PROJECT, 1) == saved


def test_recovery_inherits_scene_deadline_and_does_not_save_late_result(storyboard, monkeypatch):
    service, _, _, _ = storyboard
    saved = saved_first_scene(service)
    clock = [1000.0]
    monkeypatch.setattr(llm_deadline, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    calls = []
    def handler(request):
        calls.append(llm_deadline.remaining_deadline_seconds())
        clock[0] += 400 if len(calls) == 1 else 201
        return response(PARTIAL if len(calls) == 1 else json.dumps(scene_proposal()), truncated=len(calls) == 1)
    install_route(service, handler)
    with pytest.raises(LLMRequestError) as caught:
        service.generate_scene(PROJECT, 1, 2, saved.revision, "")
    assert caught.value.category == "deadline"
    assert caught.value.deadline_scope == "storyboard_scene_generation"
    assert calls == [600, 200] and service.require(PROJECT, 1) == saved
