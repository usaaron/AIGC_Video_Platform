from copy import deepcopy
import json

import pytest
from pydantic import ValidationError

from app.modules.quick_script.engine import QuickEngineError, _plan_retry_diagnostics, validate_quick_plan
from app.modules.quick_script.models import QuickPlanContent, QuickSettings
from app.modules.quick_script.plan_contract import (
    normalize_quick_plan_payload, normalize_quick_scene_heading, quick_plan_output_schema,
)
from tests.quick_script_fixtures import make_state
from tests.test_quick_script_engine import FakeAdapter, engine


def plan_payload(state):
    return {key: state.plan.model_dump(mode="json")[key] for key in QuickPlanContent.model_fields}


@pytest.mark.parametrize(("source", "expected"), [
    ("外景·旧站台——深夜", "EXT. 旧站台——深夜"),
    ("内景·站务室——夜", "INT. 站务室——夜"),
    ("内景／外景·站务室／旧站台——深夜", "INT./EXT. 站务室／旧站台——深夜"),
    ("内/外景·候车厅与站台—连续", "INT./EXT. 候车厅与站台—连续"),
    ("外 / 内景：站台与候车厅 - 清晨", "EXT./INT. 站台与候车厅 - 清晨"),
    ("内外景 - 列车门口 - 夜", "INT./EXT. 列车门口 - 夜"),
    ("室内 站务室 - 日", "INT. 站务室 - 日"),
    ("外，站台 - 黄昏", "EXT. 站台 - 黄昏"),
    ("int./ext. 列车门口 - 深夜", "INT./EXT. 列车门口 - 深夜"),
    (" EXT./INT. 旧站台/候车厅 - 清晨 ", "EXT./INT. 旧站台/候车厅 - 清晨"),
])
def test_only_explicit_environment_prefix_is_normalized(source, expected):
    assert normalize_quick_scene_heading(source) == expected
    state = make_state()
    payload = plan_payload(state)
    payload["episodes"][0]["scene_execution_plan"][0]["scene_heading"] = source
    before = deepcopy(payload)
    normalized = normalize_quick_plan_payload(payload)
    assert payload == before
    assert normalized["episodes"][0]["scene_execution_plan"][0]["scene_heading"] == expected
    normalized["episodes"][0]["scene_execution_plan"][0]["scene_heading"] = source
    assert normalized == before  # No scene prose, subplots, endings or metadata changed.


@pytest.mark.parametrize("heading", [
    "旧车站站台 - 傍晚", "站务室 - 夜", "旧车站站台 - 深夜",  # Live synthetic baseline.
    "内景录音棚 - 夜", "外滩 - 夜", "内景·", "外景", "未指定地点", None,
])
def test_missing_or_ambiguous_environment_is_not_guessed(heading):
    assert normalize_quick_scene_heading(heading) == heading
    payload = plan_payload(make_state())
    payload["episodes"][0]["scene_execution_plan"][0]["scene_heading"] = heading
    with pytest.raises(ValidationError) as caught:
        QuickPlanContent.model_validate(normalize_quick_plan_payload(payload))
    assert ("episodes", 0, "scene_execution_plan", 0, "scene_heading") in {
        tuple(error["loc"]) for error in caught.value.errors()
    }


def test_chinese_heading_reaches_validated_plan_in_one_call_without_global_model_changes():
    state = make_state()
    payload = plan_payload(state)
    payload["episodes"][0]["scene_execution_plan"][0]["scene_heading"] = "外景·旧站台——夜"
    payload["episodes"][1]["scene_execution_plan"][0]["scene_heading"] = "内景／外景·站务室／旧站台——深夜"
    with pytest.raises(ValidationError):
        QuickPlanContent.model_validate(payload)  # Shared stored/API contract stays strict.
    adapter = FakeAdapter(payload)
    result = engine(adapter).draft_plan(state)
    assert result.call.physical_requests == len(adapter.calls) == 1
    assert validate_quick_plan(state, result.plan) == []
    assert result.plan.episodes[0].scene_execution_plan[0].scene_heading == "EXT. 旧站台——夜"
    assert result.plan.episodes[1].scene_execution_plan[0].scene_heading == "INT./EXT. 站务室／旧站台——深夜"


@pytest.mark.parametrize("storyline_count", [1, 2])
def test_generation_contract_matches_approved_storylines(storyline_count):
    state = make_state()
    state.settings.storyline_count = storyline_count
    payload = plan_payload(state)
    if storyline_count == 2:
        payload["subplot"] = "证人通过寻找原始档案恢复与家人的信任，直接帮助主角确认记录来源。"
    adapter = FakeAdapter(payload)
    result = engine(adapter).draft_plan(state)
    prompt = adapter.calls[0]["prompt"]
    schema = json.loads(prompt.split("输出合同：\n", 1)[1])
    if storyline_count == 1:
        assert "subplot必须为JSON null" in prompt
        assert "至多一条直接服务主线的支线" not in prompt
        assert schema["properties"]["subplot"]["type"] == "null"
    else:
        assert "至多一条直接服务主线的支线" in prompt
        assert schema["properties"]["subplot"]["anyOf"] == [{"maxLength": 800, "type": "string"}, {"type": "null"}]
    assert result.plan.subplot == payload["subplot"]
    assert "INT. 中文地点 - 中文时段" in prompt
    assert "第2集是全剧最后一集" in prompt


def test_unapproved_real_subplot_is_retained_and_blocked():
    state = make_state()
    payload = plan_payload(state)
    payload["subplot"] = "证人通过寻找原始档案恢复与家人的信任，直接帮助主角确认记录来源。"
    adapter = FakeAdapter(payload)
    with pytest.raises(QuickEngineError) as caught:
        engine(adapter).draft_plan(state)
    assert caught.value.code == "quick_plan_not_ready"
    assert caught.value.candidate["subplot"] == payload["subplot"]
    assert caught.value.call.physical_requests == 1
    assert "subplot_not_approved" in {issue.code for issue in validate_quick_plan(state, QuickPlanContent.model_validate(caught.value.candidate))}


@pytest.mark.parametrize("episode_count", [1, 2, 12])
def test_generation_schema_binds_episode_count_and_finale_without_mutating_shared_schema(episode_count):
    base = QuickPlanContent.model_json_schema()
    before = deepcopy(base)
    schema = quick_plan_output_schema(base, QuickSettings(episode_count=episode_count))
    assert base == before
    assert schema["properties"]["episodes"]["minItems"] == schema["properties"]["episodes"]["maxItems"] == episode_count
    episode_shape = schema["$defs"]["EpisodePlanGenerationItem"]
    assert "ending_mode" in episode_shape["required"]
    assert episode_shape["properties"]["episode_number"]["maximum"] == episode_count
    condition = episode_shape["allOf"][0]
    assert condition["if"]["properties"]["episode_number"]["const"] == episode_count
    assert condition["then"]["properties"]["ending_mode"]["enum"] == ["series_finale"]
    assert condition["then"]["properties"]["hook_payoff_target_episode"]["type"] == "null"
    assert condition["else"]["properties"]["ending_mode"]["enum"] == ["serial_hook"]


@pytest.mark.parametrize("canonical_closure", [True, False])
def test_wrong_finale_is_not_silently_rewritten_even_with_closure_metadata(canonical_closure):
    state = make_state()
    payload = plan_payload(state)
    ending = payload["episodes"][-1]
    ending["ending_mode"] = "serial_hook"
    if not canonical_closure:
        ending["next_episode_obligation"] = "下一集需要找到证人并核实档案中遗漏的线索。"
        ending["hook_payoff_target_episode"] = 3
    before = deepcopy(ending)
    with pytest.raises(QuickEngineError) as caught:
        engine(FakeAdapter(payload)).draft_plan(state)
    assert caught.value.code == "quick_plan_not_ready"
    assert caught.value.candidate["episodes"][-1] == before
    issues = validate_quick_plan(state, QuickPlanContent.model_validate(caught.value.candidate))
    assert "ending_mode" in {issue.code for issue in issues}
    if not canonical_closure:
        assert {"finale_obligation", "finale_future_payoff"} <= {issue.code for issue in issues}


def test_explicit_retry_gets_bounded_metadata_feedback_and_exact_episode_endings():
    state = make_state()
    valid = plan_payload(state)
    candidate = deepcopy(valid)
    candidate["episodes"][-1]["ending_mode"] = "serial_hook"
    candidate["title"] = "CANDIDATE_PROSE_MUST_NOT_REENTER_PROMPT"
    state.operation_records = [{"stage": "plan", "status": "failed", "candidate": candidate,
                                "error_code": "UNTRUSTED_ERROR_TEXT"}]
    before = state.model_dump(mode="json")
    adapter = FakeAdapter(valid)
    result = engine(adapter).draft_plan(state)
    assert result.call.physical_requests == len(adapter.calls) == 1
    prompt = adapter.calls[0]["prompt"]
    data = json.loads(prompt.split("只输出指定JSON。\n", 1)[1].split("\n只返回完整根JSON对象", 1)[0])
    assert data["previous_plan_contract_issues"] == [{"code": "ending_mode", "episode": 2,
        "field": "ending_mode", "current": "serial_hook", "expected": "series_finale"}]
    assert data["episode_ending_contract"] == [
        {"episode_number": 1, "ending_mode": "serial_hook"},
        {"episode_number": 2, "ending_mode": "series_finale", "hook_payoff_target_episode": None,
         "next_episode_obligation": "本集完成正式收束；后续内容仅按已批准方向承接。"}]
    assert candidate["title"] not in prompt and "UNTRUSTED_ERROR_TEXT" not in prompt
    assert state.model_dump(mode="json") == before


def test_retry_diagnostics_exclude_raw_heading_and_exception_prose():
    state = make_state()
    candidate = plan_payload(state)
    candidate["episodes"][0]["scene_execution_plan"][0]["scene_heading"] = "DO_NOT_COPY_RAW_PLACE_OR_INSTRUCTIONS"
    state.operation_records = [{"stage": "plan", "status": "failed", "candidate": candidate,
        "diagnostics": {"error_type": "RAW_UNTRUSTED_ERROR"}}]
    result = _plan_retry_diagnostics(state)
    assert result == [{"code": "scene_heading_format", "episode": 1, "field": "scene_heading",
        "current": "missing_or_invalid_environment", "expected": "INT. / EXT. / INT./EXT. / EXT./INT. + 中文地点与时段"}]


@pytest.mark.parametrize("latest", [
    {"stage": "plan", "status": "completed"},
    {"stage": "synopsis", "status": "completed"},
    {"stage": "plan", "status": "failed"},
])
def test_retry_never_reuses_an_older_failure_after_another_attempt(latest):
    state = make_state()
    candidate = plan_payload(state)
    candidate["subplot"] = "另开一条寻找亲人的独立支线。"
    state.operation_records = [{"stage": "plan", "status": "failed", "candidate": candidate}, latest]
    assert _plan_retry_diagnostics(state) == []


def test_retry_rechecks_current_settings_and_caps_metadata_rows():
    state = make_state(12)
    candidate = plan_payload(state)
    candidate["subplot"] = "另开一条寻找亲人的独立支线。"
    state.operation_records = [{"stage": "plan", "status": "failed", "candidate": candidate}]
    assert _plan_retry_diagnostics(state) == [{"code": "subplot_not_approved", "field": "subplot",
                                              "current": "provided", "expected": None}]
    state.settings.storyline_count = 2
    assert _plan_retry_diagnostics(state) == []
    for episode in candidate["episodes"][:-1]:
        episode["ending_mode"] = "series_finale"
    result = _plan_retry_diagnostics(state)
    assert len(result) == 8
    assert all(row["code"] == "ending_mode" and row["expected"] == "serial_hook" for row in result)
