from copy import deepcopy
import json

import httpx
import pytest

from app.modules.quick_script.engine import (
    QuickEngineError, QuickScriptEngine, draft_body_hash, mechanical_review, plan_content_hash,
    synopsis_hash, validate_quick_plan, complete_screenplay_text,
)
from app.modules.quick_script.models import QuickPlanContent, QuickReview, QuickIssue
from app.modules.script_engine.llm_adapter import RealLLMAdapter
from app.modules.script_engine.models import LLMModelInfo
from app.modules.script_engine.planning_call_budget import charge_planning_model_request
from tests.quick_script_fixtures import make_state, make_draft, make_llm_draft, add_episode


class FakeAdapter:
    def __init__(self, *outputs):
        self.outputs = list(outputs)
        self.calls = []

    def get_model_info(self):
        return LLMModelInfo(provider="fixture", model_name="deepseek-v4.1-flash", supports_structured_output=True, max_context_tokens=500_000)

    def generate_structured_output_stream(self, prompt, *, strategy, output_schema, on_delta):
        charge_planning_model_request()
        self.calls.append({"prompt": prompt, "strategy": strategy, "schema": output_schema})
        value = deepcopy(self.outputs.pop(0))
        value.setdefault("_meta", {"model_name": "deepseek-v4.1-flash", "stream_termination": "completed", "usage": {"input_tokens": 123}})
        return value


def engine(adapter, limit=250_000):
    return QuickScriptEngine(planning_adapter=adapter, script_adapter=adapter, verified_context_tokens=limit)


def passed(**extra):
    return {"status": "passed", "summary": "已核对正文与批准设定。", "issues": [], "accepted_facts": [], **extra}


def test_plan_is_one_request_and_uses_confirmed_synopsis_and_author_instruction():
    state = make_state()
    payload = {key: state.plan.model_dump(mode="json")[key] for key in QuickPlanContent.model_fields}
    state.active_operation = {"instruction": "保持主线，增加证据核验的可见动作。"}
    adapter = FakeAdapter(payload)
    result = engine(adapter).draft_plan(state)
    assert len(adapter.calls) == 1
    assert state.synopsis in adapter.calls[0]["prompt"]
    assert state.active_operation["instruction"] in adapter.calls[0]["prompt"]
    assert result.plan.source_synopsis_hash == synopsis_hash(state.synopsis)
    assert result.plan.content_hash == plan_content_hash(result.plan)
    assert validate_quick_plan(state, result.plan) == []
    assert "story_bible_id" not in result.plan.model_dump()


def test_synopsis_edit_receives_current_text_and_instruction():
    state = make_state()
    state.active_operation = {"instruction": "只调整结局方向。"}
    adapter = FakeAdapter({"synopsis": "林澈保留原始证据，通过核对签名发现真相，在结局公开完整记录保护证人。"})
    result = engine(adapter).draft_synopsis(state)
    assert len(adapter.calls) == 1
    assert state.synopsis in adapter.calls[0]["prompt"]
    assert "只调整结局方向" in adapter.calls[0]["prompt"]
    assert result.call.usage["input_tokens"] == 123


def test_all_saved_prefix_is_in_next_draft_and_source_is_not_mutated():
    state = make_state(episode_count=3)
    first, second = add_episode(state, 1), add_episode(state, 2)
    before = state.model_dump(mode="json")
    adapter = FakeAdapter(make_llm_draft(3, 3))
    result = engine(adapter).generate_episode(state, 3)
    assert len(adapter.calls) == 1
    for episode in (first, second):
        for action in episode.draft.scenes[0].character_actions:
            assert action in adapter.calls[0]["prompt"]
    assert result.source_episode_hashes == {"1": first.body_hash, "2": second.body_hash}
    assert result.draft.ending_mode.value == "series_finale"
    assert state.model_dump(mode="json") == before


def test_context_overflow_rejects_before_call_and_never_trims_history():
    state = make_state()
    add_episode(state)
    adapter = FakeAdapter(make_llm_draft(2, 2))
    before = state.model_dump(mode="json")
    with pytest.raises(QuickEngineError) as caught:
        engine(adapter, limit=16_384).generate_episode(state, 2)
    assert caught.value.code == "quick_context_limit"
    assert not adapter.calls
    assert state.model_dump(mode="json") == before


def test_existing_body_and_unreviewed_prefix_cannot_be_generated_again():
    state = make_state()
    add_episode(state, status="drafted")
    adapter = FakeAdapter()
    with pytest.raises(QuickEngineError, match="已有保存正文"):
        engine(adapter).generate_episode(state, 1)
    with pytest.raises(QuickEngineError, match="前文尚未保存并通过检查"):
        engine(adapter).generate_episode(state, 2)
    assert not adapter.calls


def test_review_binds_facts_to_exact_saved_body_and_keeps_suspicion():
    state = make_state()
    episode = add_episode(state, status="drafted")
    quote = episode.draft.scenes[0].character_actions[0]
    adapter = FakeAdapter(passed(accepted_facts=[{"id": "knowledge.lin", "kind": "knowledge", "subject": "林澈",
        "value": "怀疑签名来源有误", "certainty": "suspected", "episode_number": 1, "scene_number": 1,
        "body_hash": "untrusted-provider-hash", "evidence_quote": quote}]))
    result = engine(adapter).review_episode(state, 1)
    assert result.review.status == "passed"
    assert result.review.accepted_facts[0].certainty == "suspected"
    assert result.review.accepted_facts[0].body_hash == episode.body_hash
    assert result.review.source_body_hashes == {"1": episode.body_hash}
    assert state.facts == []  # Only the durable service may promote checked facts.


def test_fabricated_fact_evidence_and_local_contract_failures_cannot_pass():
    state = make_state()
    episode = add_episode(state, status="drafted")
    adapter = FakeAdapter(passed(accepted_facts=[{"id": "key.lin", "kind": "possession", "subject": "林澈",
        "value": "已获得钥匙", "certainty": "established", "episode_number": 1, "scene_number": 1,
        "evidence_quote": "原稿没有这句话"}]))
    result = engine(adapter).review_episode(state, 1)
    assert result.review.status == "needs_author"
    assert result.review.accepted_facts == []
    assert result.review.issues[0].code == "fact_evidence_invalid"


def test_local_blocking_issue_survives_provider_warning_limit():
    reviewer = engine(FakeAdapter())
    review = QuickReview.model_validate(passed(issues=[{"code": str(i), "severity": "warning", "message": "措辞建议"} for i in range(40)]))
    result = reviewer._verified_review(review, {1: make_draft()}, [QuickIssue(code="duration", severity="critical", message="时长不符合合同")])
    assert result.status == "blocked"
    assert result.issues[0].code == "duration"
    assert len(result.issues) == 40


def test_repair_is_one_local_body_patch_and_second_repair_is_rejected():
    state = make_state()
    episode = add_episode(state, status="blocked")
    episode.review = QuickReview(status="blocked", summary="需修复一处动作。", issues=[
        QuickIssue(code="wrong_action", severity="critical", message="手中物件不一致", episode_number=1, scene_number=1)])
    scene = episode.draft.scenes[0]
    patch = {"scene_number": 1, "character_actions": list(scene.character_actions),
             "dialogues": [d.model_dump(mode="json") for d in scene.dialogues], "body_order": scene.body_order}
    patch["character_actions"][0] = "林澈按住原件的破损边缘，逐项核对签名与纸面留下的原始痕迹。"
    adapter = FakeAdapter({"scenes": [patch]})
    result = engine(adapter).repair_episode(state, 1)
    assert len(adapter.calls) == 1
    assert result.draft.title == episode.draft.title
    assert result.draft.character_state_updates == episode.draft.character_state_updates
    assert episode.draft.scenes[0].character_actions[0] != result.draft.scenes[0].character_actions[0]
    episode.repair_count = 1
    with pytest.raises(QuickEngineError, match="修复额度"):
        engine(adapter).repair_episode(state, 1)
    assert len(adapter.calls) == 1


def test_final_review_gets_every_saved_episode_and_runs_once():
    state = make_state()
    add_episode(state, 1)
    add_episode(state, 2)
    adapter = FakeAdapter(passed())
    result = engine(adapter).review_final(state)
    assert result.review.status == "passed"
    assert set(result.review.source_body_hashes) == {"1", "2"}
    assert all(e.body_hash in adapter.calls[0]["prompt"] for e in state.episodes)
    assert len(adapter.calls) == 1


@pytest.mark.parametrize("termination", ["stream_ended_without_terminal_event", "finish_reason:length", ""])
def test_incomplete_returns_preserve_candidate_and_are_never_accepted(termination):
    raw = make_llm_draft()
    raw["_meta"] = {"stream_termination": termination}
    adapter = FakeAdapter(raw)
    with pytest.raises(QuickEngineError) as caught:
        engine(adapter).generate_episode(make_state(), 1)
    assert caught.value.code == "quick_incomplete_output"
    assert caught.value.candidate["scenes"] == raw["scenes"]
    assert caught.value.call.physical_requests == 1


def test_transport_retry_cannot_spend_a_second_model_call():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(500, json={"error": {"message": "fixture failure"}})
    adapter = RealLLMAdapter(provider="openai_compatible", model_name="deepseek-v4.1-flash", api_key="fixture-only",
        base_url="https://quick.invalid/v1", max_retries=3, transport=httpx.MockTransport(handler))
    with pytest.raises(QuickEngineError) as caught:
        engine(adapter).draft_synopsis(make_state())
    assert len(requests) == 1
    assert caught.value.call.physical_requests == 1
    assert caught.value.code == "quick_model_upstream"
    assert caught.value.diagnostics["http_status"] == 500


def test_fixture_preserves_real_delivery_contract():
    state = make_state()
    metrics, issues = mechanical_review(state, 1, make_draft())
    assert issues == []
    assert metrics["dialogue_count"] == 25 and metrics["action_count"] == 15
    assert 75 <= metrics["estimated_duration_seconds"] <= 115
    assert metrics["effective_body_characters"] > metrics["han_characters"]


def test_default_eight_episode_budget_keeps_every_full_saved_body_with_one_schema():
    state = make_state(8)
    state.settings.target_total_characters = 8_000
    adapter = FakeAdapter(*(make_llm_draft(number, 8) for number in range(1, 9)), passed())
    quick_engine = engine(adapter, limit=65_536)
    for number in range(1, 9):
        result = quick_engine.generate_episode(state, number)
        assert result.call.input_upper_bound_tokens + result.call.output_reserve_tokens <= 65_536
        assert result.call.physical_requests == 1
        assert adapter.calls[-1]["schema"] is None
        prompt = adapter.calls[-1]["prompt"]
        assert prompt.count("输出合同：") == 1
        for prior in state.episodes:
            # JSON quoting is the only encoding change; no prior action or line
            # is dropped, shortened, reordered or replaced with a summary.
            assert json.dumps(complete_screenplay_text(prior.draft), ensure_ascii=False) in prompt
        episode = add_episode(state, number)
        episode.draft.scenes[0].character_actions = [
            text + "他把签名抄在记录上。" for text in episode.draft.scenes[0].character_actions
        ]
        episode.body_hash = draft_body_hash(episode.draft)
        assert mechanical_review(state, number, episode.draft)[0]["effective_body_characters"] >= 1_000
    result = quick_engine.review_final(state)
    assert result.call.input_upper_bound_tokens + result.call.output_reserve_tokens <= 65_536
    assert len(adapter.calls) == 9
    assert len(result.review.source_body_hashes) == 8


@pytest.mark.parametrize("episode_count", [1, 8, 12])
def test_quick_plan_accepts_full_one_through_twelve_episode_range(episode_count):
    state = make_state(episode_count)
    assert validate_quick_plan(state, state.plan) == []
    assert state.plan.episodes[-1].ending_mode.value == "series_finale"
    assert all(item.ending_mode.value == "serial_hook" for item in state.plan.episodes[:-1])


@pytest.mark.parametrize("field,value,code", [
    ("next_episode_obligation", "下一集继续调查保管人是谁", "finale_obligation"),
    ("hook_payoff_target_episode", 3, "finale_future_payoff"),
])
def test_quick_finale_cannot_add_another_episode_obligation(field, value, code):
    state = make_state()
    setattr(state.plan.episodes[-1], field, value)
    assert code in {issue.code for issue in validate_quick_plan(state, state.plan)}


def test_pretransport_failure_records_zero_physical_requests():
    class PreflightFailure(FakeAdapter):
        def generate_structured_output_stream(self, *args, **kwargs):
            raise ValueError("fixture configuration failure before transport")
    adapter = PreflightFailure()
    with pytest.raises(QuickEngineError) as caught:
        engine(adapter).draft_synopsis(make_state())
    assert caught.value.call.physical_requests == 0
    assert not adapter.calls
