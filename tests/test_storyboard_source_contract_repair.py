"""A model corrects source-linked shots within the existing proposal budget."""
from copy import deepcopy
import json
from types import SimpleNamespace

import pytest
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.modules.agent_runtime
from app.api.routes.preproduction import router
from app.dependencies import get_long_story_service, get_storyboard_service
from app.modules.preproduction.repository import StoryboardConflictError
from app.modules.script_engine.llm_adapter import LLMRequestError, RealLLMAdapter
from app.modules.script_engine import llm_deadline
from tests.test_preproduction import storyboard, PROJECT
from tests.test_storyboard_output_recovery import (
    PARTIAL, install_route, response, saved_first_scene, scene_proposal,
)


def mismatched_proposal(kind):
    proposal = scene_proposal()
    refs = proposal["shots"][0]["source_refs"]
    if kind == "missing":
        proposal["shots"][0]["source_refs"] = refs[:-1]
    elif kind == "duplicate":
        proposal["shots"][0]["source_refs"] = [*refs, refs[-1]]
    elif kind == "reordered":
        proposal["shots"][0]["source_refs"] = list(reversed(refs))
    elif kind == "unknown":
        proposal["shots"][0]["source_refs"] = [*refs[:-1], "action:999"]
    return proposal


@pytest.mark.parametrize("kind", ["missing", "duplicate", "reordered", "unknown"])
def test_actual_model_response_repairs_complete_shots_and_keeps_original_contract(storyboard, kind):
    service, _, _, _ = storyboard
    saved = saved_first_scene(service)
    invalid = mismatched_proposal(kind)
    original_invalid = deepcopy(invalid)
    corrected = scene_proposal()
    corrected["shots"][0]["action_sequence"] = ["林岚用身体撑住房门，让周宁先通过；门合上后，两人听到三声敲击。"]
    seen = []
    def handler(request):
        payload = json.loads(request.content)
        seen.append(payload)
        return response(json.dumps(invalid if len(seen) == 1 else corrected, ensure_ascii=False))
    install_route(service, handler)
    result = service.generate_scene(PROJECT, 1, 2, saved.revision, "保留钥匙左手与上一场结尾。")
    assert len(seen) == 2
    assert {p["model"] for p in seen} == {seen[0]["model"]}
    assert {p["max_tokens"] for p in seen} == {12000}
    assert [p["thinking"]["type"] for p in seen] == ["enabled", "disabled"]
    prompts = [p["messages"][-1]["content"] for p in seen]
    original_prompt = prompts[0].split("\n\nDEEPSEEK JSON OUTPUT CONTRACT")[0]
    assert original_prompt in prompts[1]
    assert "保留钥匙左手与上一场结尾。" in prompts[1]
    assert "不能只排序、增删source_refs" in prompts[1]
    context_start = prompts[1].index('\n{"source_contract_errors":') + 1
    context, _ = json.JSONDecoder().raw_decode(prompts[1][context_start:])
    assert context["rejected_proposal"] == invalid
    assert context["source_contract_errors"]["actual_order"] == invalid["shots"][0]["source_refs"]
    assert context["source_contract_errors"]["expected_order"] == corrected["shots"][0]["source_refs"]
    contracts = [json.loads(p.split("<json_contract>\n", 1)[1].split("\n</json_contract>", 1)[0]) for p in prompts]
    assert contracts[0] == contracts[1]
    assert result.scenes[-1].shots[0].source_refs == corrected["shots"][0]["source_refs"]
    assert result.scenes[-1].shots[0].action_sequence == corrected["shots"][0]["action_sequence"]
    assert result.scenes[0] == saved.scenes[0]
    assert result.source_draft == saved.source_draft and result.source_signature == saved.source_signature
    assert result.revision == saved.revision + 1 and result.candidate is None
    assert invalid == original_invalid
    service.generate_scene(PROJECT, 1, 1, result.revision, "下一场使用正常创作配置。")
    assert len(seen) == 3 and seen[2]["thinking"]["type"] == "enabled"


def test_non_deepseek_contract_repair_preserves_provider_configuration(storyboard):
    service, _, _, _ = storyboard
    saved = saved_first_scene(service)
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return response(json.dumps(mismatched_proposal("missing") if len(seen) == 1 else scene_proposal()))
    adapter = RealLLMAdapter(provider="openai_compatible", model_name="other-structured-model",
        api_key="test-only", base_url="https://storyboard.test/v1", max_retries=0,
        reasoning_effort="high", thinking_mode="enabled", timeout_seconds=600,
        retry_empty_response=False, transport=httpx.MockTransport(handler))
    service.adapter_factory = lambda: adapter
    result = service.generate_scene(PROJECT, 1, 2, saved.revision, "保留原模型配置。")
    assert len(seen) == 2
    assert result.scenes[-1].shots[0].source_refs == scene_proposal()["shots"][0]["source_refs"]
    assert {key: value for key, value in seen[0].items() if key != "messages"} == {
        key: value for key, value in seen[1].items() if key != "messages"}


def test_second_source_mismatch_is_409_without_third_call_or_any_save(storyboard):
    service, _, _, projects = storyboard
    saved = saved_first_scene(service)
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return response(json.dumps(mismatched_proposal("duplicate")))
    install_route(service, handler)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_storyboard_service] = lambda: service
    app.dependency_overrides[get_long_story_service] = lambda: projects
    with TestClient(app) as client:
        result = client.post(f"/story-projects/{PROJECT}/episodes/1/storyboard/scenes/2/generate", json={"expected_revision": saved.revision})
    assert result.status_code == 409 and "有界修复已结束" in result.json()["detail"]
    assert len(seen) == 2 and service.require(PROJECT, 1) == saved


@pytest.mark.parametrize("order", ["field_then_source", "source_then_field", "two_fields_then_source"])
def test_structure_and_source_repairs_share_original_two_call_budget(storyboard, order):
    service, _, _, _ = storyboard
    saved = saved_first_scene(service)
    invalid = mismatched_proposal("missing")
    too_many = ["抬手。", "让路。", "看门。", "合门。", "倾听。"]
    if order != "source_then_field":
        invalid["shots"][0]["acting_direction"] = {"beat_changes": too_many}
    calls = []
    class RepairAdapter:
        def generate_structured_output_stream(self, prompt, *, strategy, output_schema):
            calls.append(strategy.max_tokens)
            if len(calls) == 1:
                return deepcopy(invalid)
            if "repairs" in output_schema.get("properties", {}):
                beats = too_many if order == "two_fields_then_source" and len(calls) == 2 else ["抬手让路，合门倾听。"]
                return {"repairs": [{"path": ["shots", 0, "acting_direction", "beat_changes"], "value": beats}]}
            result = scene_proposal()
            if order == "source_then_field":
                result["shots"][0]["acting_direction"] = {"beat_changes": too_many}
            return result
    service.adapter_factory = lambda: RepairAdapter()
    if order == "two_fields_then_source":
        with pytest.raises(StoryboardConflictError):
            service.generate_scene(PROJECT, 1, 2, saved.revision, "")
        assert service.require(PROJECT, 1) == saved
    else:
        result = service.generate_scene(PROJECT, 1, 2, saved.revision, "")
        assert result.scenes[-1].shots[0].source_refs == scene_proposal()["shots"][0]["source_refs"]
    assert calls == {"field_then_source": [12000, 4000, 12000], "source_then_field": [12000, 12000, 4000], "two_fields_then_source": [12000, 4000, 4000]}[order]


@pytest.mark.parametrize("failure", ["truncated", "schema", "deadline"])
def test_failed_contract_repair_does_not_open_another_recovery_or_save(storyboard, monkeypatch, failure):
    service, _, _, _ = storyboard
    saved = saved_first_scene(service)
    seen = []
    clock = [1000.0]
    monkeypatch.setattr(llm_deadline, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    def handler(request):
        seen.append(llm_deadline.remaining_deadline_seconds())
        clock[0] += 200 if len(seen) == 1 else (401 if failure == "deadline" else 1)
        if len(seen) == 1:
            return response(json.dumps(mismatched_proposal("missing")))
        if failure == "truncated":
            return response(PARTIAL, truncated=True)
        if failure == "schema":
            return response(json.dumps({"unrequested_field": "not a scene"}))
        return response(json.dumps(scene_proposal()))
    install_route(service, handler)
    with pytest.raises(Exception) as caught:
        service.generate_scene(PROJECT, 1, 2, saved.revision, "")
    if failure == "deadline":
        assert isinstance(caught.value, LLMRequestError)
        assert caught.value.category == "deadline" and caught.value.deadline_scope == "storyboard_scene_generation"
    elif failure == "schema":
        assert isinstance(caught.value, ValidationError)
    assert seen == [600, 400] and service.require(PROJECT, 1) == saved


def test_reordered_mixed_refs_receive_optional_contiguous_guidance_not_patched_shots(storyboard):
    service, _, _, _ = storyboard
    saved = saved_first_scene(service)
    expected = scene_proposal()["shots"][0]["source_refs"]
    invalid = scene_proposal()
    original_shot = invalid["shots"][0]
    invalid["shots"] = [deepcopy(original_shot), deepcopy(original_shot)]
    invalid["shots"][0]["source_refs"] = [expected[0], expected[2]]
    invalid["shots"][1]["source_refs"] = [expected[1], *expected[3:]]
    before = deepcopy(invalid)
    corrected = scene_proposal()
    corrected["shots"][0]["action_sequence"] = ["模型重新按完整正文编写了可见动作和对话节拍。"]
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return response(json.dumps(invalid if len(seen) == 1 else corrected, ensure_ascii=False))
    install_route(service, handler)
    result = service.generate_scene(PROJECT, 1, 2, saved.revision, "不要改变原剧情。")
    prompt = seen[1]["messages"][-1]["content"]
    context, _ = json.JSONDecoder().raw_decode(prompt[prompt.index('\n{"source_contract_errors":') + 1:])
    guidance = context["repair_guidance"]
    assert guidance["suggested_contiguous_groups"] == [
        {"suggested_shot_number": 1, "source_refs": expected[:2]},
        {"suggested_shot_number": 2, "source_refs": expected[2:]},
    ]
    assert guidance["grouping_is_optional"] is True
    assert guidance["first_mismatch_neighbors"] == {
        "start_index": 0, "expected": expected[:4], "actual": [expected[0], expected[2], expected[1], expected[3]],
    }
    assert "不是已通过的摄影设计" in prompt and "不能沿用与新引用不符的旧镜头文字" in prompt
    # The model may choose a different partition. Accept its fully validated
    # one-shot design, not a mechanically edited copy of either rejected shot.
    assert len(result.scenes[-1].shots) == 1
    assert result.scenes[-1].shots[0].action_sequence == corrected["shots"][0]["action_sequence"]
    assert invalid == before and len(seen) == 2


@pytest.mark.parametrize("kind", ["missing", "duplicate", "unknown"])
def test_incomplete_coverage_does_not_guess_a_contiguous_partition(storyboard, kind):
    service, _, _, _ = storyboard
    saved = saved_first_scene(service)
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return response(json.dumps(mismatched_proposal(kind) if len(seen) == 1 else scene_proposal()))
    install_route(service, handler)
    service.generate_scene(PROJECT, 1, 2, saved.revision, "")
    prompt = seen[1]["messages"][-1]["content"]
    context, _ = json.JSONDecoder().raw_decode(prompt[prompt.index('\n{"source_contract_errors":') + 1:])
    assert context["repair_guidance"]["suggested_contiguous_groups"] == []
    assert len(seen) == 2


def test_exhausted_source_repair_logs_exact_ref_ids_without_story_text_and_never_saves(storyboard, caplog):
    service, _, _, _ = storyboard
    saved = saved_first_scene(service)
    invalid = mismatched_proposal("reordered")
    invalid["shots"][0]["source_refs"][-1] = "正文私密内容不能进入日志"
    invalid["shots"][0]["action_sequence"] = ["候选剧本文字也不能进入日志"]
    calls = []
    def handler(request):
        calls.append(request)
        return response(json.dumps(invalid, ensure_ascii=False))
    install_route(service, handler)
    with pytest.raises(StoryboardConflictError):
        service.generate_scene(PROJECT, 1, 2, saved.revision, "")
    records = [record.getMessage() for record in caplog.records if "Storyboard source reference diagnostics" in record.getMessage()]
    assert len(records) == 2 and "exhausted=False" in records[0] and "exhausted=True" in records[1]
    logged = json.loads(records[-1].split(" refs=", 1)[1])
    assert logged["expected_order"] == scene_proposal()["shots"][0]["source_refs"]
    assert logged["actual_order"] == [*invalid["shots"][0]["source_refs"][:-1], "<invalid-ref>"]
    assert logged["first_mismatch_index"] == 0
    assert "正文私密内容" not in caplog.text and "候选剧本文字" not in caplog.text
    assert len(calls) == 2 and service.require(PROJECT, 1) == saved
