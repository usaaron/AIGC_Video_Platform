"""Overseas Quick runs use the real engine/service and isolated fake transports."""
from copy import deepcopy
import json
from uuid import uuid4

import pytest

from app.main import create_app  # Initialize shared runtime modules in application order.
from app.modules.quick_script.engine import (
    QuickEngineError, QuickScriptEngine, complete_screenplay_text, draft_body_hash,
    mechanical_review, plan_content_hash, source_hash, validate_quick_plan,
)
from app.modules.quick_script.models import QuickEpisode, QuickPlanContent, QuickState
from app.modules.quick_script.repository import QuickRepository
from app.modules.quick_script.service import QuickInputError, QuickService
from app.modules.script_engine.llm_adapter import MarketRoutedLLMAdapter
from app.modules.script_engine.long_story_models import StoryProjectWorkspaceSave
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from app.modules.script_engine.screenplay_metrics import screenplay_character_count
from tests.quick_script_fixtures import make_state, make_overseas_state, make_overseas_llm_draft, make_overseas_draft
from tests.test_quick_script_engine import FakeAdapter, passed
from tests.test_quick_script_service import make_test_service, act, PROJECT_ID


PROFILE = {"enabled": True, "country": "英国", "region": "伦敦", "socialContext": "独立档案调查机构",
           "storyEngine": "证据保管和公开之间的持续冲突"}
ACTING = {"bodyLanguage": "手指紧贴纸张边缘", "voice": "低沉而清楚", "movement": "行动克制",
          "gazeAndAttention": "盯紧证据", "habitualActions": "说话前整理文件", "pressureResponse": "降低音量",
          "relationshipBehavior": "对证人保持耐心", "permanentVoicePrompt": "低声但坚定。\n拒绝｜EN: I cannot release it.｜中译: 我不能交出原件。"}


def plan_payload():
    return {key: value for key, value in make_overseas_state().plan.model_dump(mode="json").items()
            if key in QuickPlanContent.model_fields}


def create_overseas_service(*outputs, with_character=True):
    service, _, runtime = make_test_service()
    snapshot = service.get(PROJECT_ID).workspace_snapshot
    workspace = deepcopy(snapshot.workspace_payload)
    workspace["marketProfile"] = "overseas_tiktok"
    workspace["generationSettings"].update(outputLanguage="en", releaseRegion="overseas", overseasStoryProfile=PROFILE)
    if with_character:
        workspace["characters"] = [{"id": "character.lin", "name": "Ethan", "actingProfile": ACTING}]
    LongStoryService(runtime).save_workspace_snapshot(StoryProjectWorkspaceSave(project_id=PROJECT_ID,
        revision=snapshot.revision + 1, client_instance_id="overseas-quick-fixture", workspace_payload=workspace))
    adapter = FakeAdapter(*outputs)
    engine = QuickScriptEngine(planning_adapter=adapter, script_adapter=adapter, verified_context_tokens=65_536,
                               verified_models={"deepseek-v4.1-flash"})
    return QuickService(QuickRepository(runtime), engine), adapter, runtime


def setup_plan(service):
    act(service, "setup", {"settings": {"language": "en", "episode_count": 2, "target_total_characters": 2000}})
    act(service, "draft_synopsis")
    act(service, "confirm_synopsis")
    response = act(service, "draft_plan")
    assert response.state.plan is not None, response.state.blocked_reason
    return act(service, "confirm_plan")


def test_two_episode_overseas_run_persists_projection_and_replays_without_extra_calls():
    synopsis = "Ethan逐一核验档案原件，在证人帮助下查清签名来源，公开证据并保护证人的安全。"
    service, adapter, runtime = create_overseas_service({"synopsis": synopsis}, plan_payload(),
        make_overseas_llm_draft(1, 2), passed(), make_overseas_llm_draft(2, 2), passed(), passed())
    try:
        setup_plan(service)
        assert len(adapter.calls) == 2
        operation_id = str(uuid4())
        first = act(service, "advance", operation_id=operation_id)
        assert first.state.next_step == "review"
        replay = act(service, "advance", operation_id=operation_id, revision=0)
        assert len(adapter.calls) == 3
        assert replay.state.episodes[0].body_hash == first.state.episodes[0].body_hash
        # Reconstruct service from the durable DB between requests.
        service = QuickService(QuickRepository(runtime), service.engine)
        for next_step in ("draft", "review", "final_review", "done"):
            result = act(service, "advance")
            assert result.state.next_step == next_step, result.state.blocked_reason
        assert result.state.phase == "complete"
        assert result.state.status == "completed"
        assert len(adapter.calls) == 7
        assert all(call.physical_requests == 1 for call in result.state.model_calls)
        assert all(call.input_upper_bound_tokens + call.output_reserve_tokens <= 65_536 for call in result.state.model_calls)
        workspace = result.workspace_snapshot.workspace_payload
        assert workspace["marketProfile"] == "overseas_tiktok"
        assert workspace["generationSettings"]["outputLanguage"] == "en"
        assert workspace["generationSettings"]["releaseRegion"] == "overseas"
        assert workspace["generationSettings"]["overseasStoryProfile"] == PROFILE
        assert workspace["characters"][0]["actingProfile"] == ACTING
        assert result.state.overseas_story_profile["country"] == "英国"
        assert len(workspace["episodes"]) == 2
        for row in workspace["episodes"]:
            draft = json.loads(row["workingDraftJson"])
            assert draft["language"] == "en"
            assert all(line["chinese_translation"] for scene in draft["scenes"] for line in scene["dialogues"])
        assert LongStoryService(runtime).get_project(PROJECT_ID).output_language == "en"
        assert "原件" in adapter.calls[-1]["prompt"]
        assert "中译：" in adapter.calls[-1]["prompt"]
        assert "2.7" in adapter.calls[2]["prompt"]
        assert "英国" in adapter.calls[0]["prompt"]
        assert "低沉而清楚" in adapter.calls[4]["prompt"]
        assert "EN: I cannot release it." in adapter.calls[4]["prompt"]
        assert "market_path" not in result.state.model_dump()  # No client-owned parallel selector.
    finally:
        runtime.engine.dispose()


def test_missing_translation_gets_one_scene_local_repair_and_bounded_recheck():
    bad = make_overseas_llm_draft()
    bad["scenes"][0]["dialogues"][0]["chinese_translation"] = None
    good = make_overseas_llm_draft()
    patch = {key: good["scenes"][0][key] for key in ("scene_number", "character_actions", "dialogues", "body_order")}
    service, adapter, runtime = create_overseas_service({"synopsis": "档案调查员逐一核验档案原件，在证人帮助下查清签名来源，公开证据保护证人。"},
        plan_payload(), bad, passed(), {"scenes": [patch]}, passed())
    try:
        setup_plan(service)
        act(service, "advance")
        reviewed = act(service, "advance")
        assert reviewed.state.next_step == "repair"
        assert all(issue.scene_number == 1 for issue in reviewed.state.episodes[0].review.issues)
        repaired = act(service, "advance")
        assert repaired.state.next_step == "recheck"
        assert repaired.state.episodes[0].repair_count == 1
        checked = act(service, "advance")
        assert checked.state.next_step == "draft"
        assert checked.state.episodes[0].status == "passed"
        assert len(adapter.calls) == 6
        episode = checked.state.episodes[0]
        with pytest.raises(QuickEngineError, match="修复额度"):
            service.engine.repair_episode(checked.state, 1)
        assert len(adapter.calls) == 6
        assert episode.draft.title == episode.initial_draft.title
    finally:
        runtime.engine.dispose()


def test_saved_market_is_authoritative_and_profile_is_not_client_replaceable():
    service, adapter, runtime = create_overseas_service()
    try:
        original = service.get(PROJECT_ID)
        with pytest.raises(QuickInputError, match="发行地区"):
            act(service, "setup", {"settings": {"language": "zh", "episode_count": 2}})
        assert service.get(PROJECT_ID) == original
        result = act(service, "setup", {"settings": {"episode_count": 2},
            "overseas_story_profile": {"country": "客户端偷偷修改"}})
        assert result.state.settings.language == "en"
        assert result.state.overseas_story_profile["country"] == "英国"
        assert not adapter.calls
        for key in ("marketProfile", "generationSettings"):
            snapshot = service.get(PROJECT_ID).workspace_snapshot
            payload = deepcopy(snapshot.workspace_payload)
            if key == "marketProfile":
                payload[key] = "cn_mainland"
            else:
                payload[key]["outputLanguage"] = "zh"
            with pytest.raises(LongStoryPersistenceConflictError):
                LongStoryService(runtime).save_workspace_snapshot(StoryProjectWorkspaceSave(project_id=PROJECT_ID,
                    revision=snapshot.revision + 1, client_instance_id="stale-market-edit", workspace_payload=payload))
        assert service.get(PROJECT_ID).state.settings.language == "en"
    finally:
        runtime.engine.dispose()


@pytest.mark.parametrize("field", ["title", "action", "dialogue", "translation", "alias", "character"])
def test_overseas_language_failures_remain_blocking_despite_model_pass(field):
    state = make_overseas_state()
    draft = make_overseas_draft()
    if field == "title":
        draft.title = "The hidden evidence"
    elif field == "action":
        draft.scenes[0].character_actions[0] = "Ethan quietly examines the paper while watching the door."
    elif field == "dialogue":
        draft.scenes[0].dialogues[0].text = "这份原始证据需要仔细核对后才能保存。"
    elif field == "translation":
        draft.scenes[0].dialogues[0].chinese_translation = "Please check the file."
    elif field == "alias":
        draft.scenes[0].dialogues[0].chinese_character_name = "伊森"
    else:
        draft.characters[0].name = "伊森"
    state.episodes = [QuickEpisode(episode_number=1, draft=draft, source_plan_hash=state.plan.content_hash,
                                   body_hash=draft_body_hash(draft))]
    adapter = FakeAdapter(passed())
    engine = QuickScriptEngine(planning_adapter=adapter, script_adapter=adapter, verified_context_tokens=250_000)
    review = engine.review_episode(state, 1).review
    assert review.status == "blocked"
    assert any(issue.code in {"language", "character_identity"} for issue in review.issues)
    assert len(adapter.calls) == 1


def test_translation_does_not_inflate_body_or_runtime_but_is_in_full_context():
    draft = make_overseas_draft()
    original = draft.model_copy(deep=True)
    for line in draft.scenes[0].dialogues:
        line.chinese_translation += "这是用来验证对照翻译不影响篇幅和时长的补充中文。" * 10
    assert screenplay_character_count(draft) == screenplay_character_count(original)
    assert estimate_screenplay_duration(draft) == estimate_screenplay_duration(original)
    assert draft.scenes[0].dialogues[0].chinese_translation in complete_screenplay_text(draft)
    assert mechanical_review(make_overseas_state(), 1, original)[1] == []


@pytest.mark.parametrize("invented", [False, True])
def test_review_accepts_only_exact_saved_translation_as_evidence(invented):
    state = make_overseas_state()
    draft = make_overseas_draft()
    state.episodes = [QuickEpisode(episode_number=1, draft=draft, source_plan_hash=state.plan.content_hash,
                                   body_hash=draft_body_hash(draft))]
    quote = "我已经知道凶手是谁。" if invented else draft.scenes[0].dialogues[0].chinese_translation
    adapter = FakeAdapter(passed(accepted_facts=[{"id": "event.evidence", "kind": "event", "subject": "character.lin",
        "value": "要求核对原始证据", "certainty": "established", "episode_number": 1, "scene_number": 1,
        "evidence_quote": quote}]))
    engine = QuickScriptEngine(planning_adapter=adapter, script_adapter=adapter, verified_context_tokens=65_536)
    result = engine.review_episode(state, 1)
    assert result.review.status == ("needs_author" if invented else "passed")
    if invented:
        assert result.review.accepted_facts == []
    else:
        assert result.review.accepted_facts[0].body_hash == draft_body_hash(draft)


def test_legacy_plan_hash_and_state_remain_usable_without_optional_fields():
    state = make_state()
    legacy = state.model_dump(mode="json")
    legacy.pop("overseas_story_profile")
    for row in legacy["plan"]["characters"]:
        row.pop("acting_profile")
    original_hash = source_hash({key: legacy["plan"][key] for key in QuickPlanContent.model_fields})
    legacy["plan"]["content_hash"] = original_hash
    loaded = QuickState.model_validate(legacy)
    assert loaded.settings.language == "zh"
    assert loaded.plan.content_hash == plan_content_hash(loaded.plan)
    assert validate_quick_plan(loaded, loaded.plan) == []


def test_overseas_plan_rejects_english_narrative_and_identity_drift():
    state = make_overseas_state()
    state.supplied_characters = [state.plan.characters[0].model_copy(deep=True)]
    plan = state.plan.model_copy(deep=True)
    plan.characters[0].name = "AnotherPerson"
    plan.episodes[0].episode_goal = "Inspect the evidence carefully"
    issues = validate_quick_plan(state, plan)
    assert {issue.code for issue in issues} >= {"language", "character_identity"}


def test_valid_optional_layer_contract_schema_version_is_not_creator_prose():
    from app.modules.script_engine.episode_layer_contracts import compile_episode_three_layer_contract
    state = make_overseas_state()
    state.plan.episodes[0].layer_contracts = compile_episode_three_layer_contract(state.plan.episodes[0])
    assert validate_quick_plan(state, state.plan) == []


def test_market_router_uses_real_overseas_model_and_enforces_its_context_limit():
    class NamedAdapter(FakeAdapter):
        def __init__(self, name, limit, *outputs):
            super().__init__(*outputs)
            self.name, self.limit = name, limit

        def get_model_info(self):
            return super().get_model_info().model_copy(update={"model_name": self.name, "max_context_tokens": self.limit})

        def generate_structured_output_stream(self, *args, **kwargs):
            result = super().generate_structured_output_stream(*args, **kwargs)
            result["_meta"]["model_name"] = self.name
            return result

    cn = NamedAdapter("cn-fixture", 500_000)
    overseas = NamedAdapter("overseas-fixture", 65_536, {"synopsis": "调查员保留原始证据，通过核对签名发现真相，最终公开完整记录保护证人。"})
    route = MarketRoutedLLMAdapter(mainland=cn, overseas=overseas)
    engine = QuickScriptEngine(planning_adapter=route, script_adapter=route, verified_context_tokens=250_000,
                               verified_models={"overseas-fixture"})
    result = engine.draft_synopsis(make_overseas_state())
    assert result.call.model == result.call.response_model == "overseas-fixture"
    assert len(overseas.calls) == 1 and not cn.calls
    assert overseas.calls[0]["strategy"].target_platform == "海外竖屏短剧"
    overseas.limit = 8_192
    with pytest.raises(QuickEngineError) as failure:
        engine.generate_episode(make_overseas_state(), 1)
    assert failure.value.code == "quick_context_limit"
    assert len(overseas.calls) == 1


def test_unexpected_response_model_is_preserved_but_not_accepted():
    adapter = FakeAdapter({"synopsis": "调查员保留原始证据，通过核对签名发现真相，最终公开完整记录保护证人。",
        "_meta": {"model_name": "unexpected-model", "stream_termination": "completed"}})
    engine = QuickScriptEngine(planning_adapter=adapter, script_adapter=adapter, verified_context_tokens=65_536,
                               verified_models={"deepseek-v4.1-flash"})
    with pytest.raises(QuickEngineError) as failure:
        engine.draft_synopsis(make_overseas_state())
    assert failure.value.code == "quick_model_changed"
    assert failure.value.call.physical_requests == 1
    assert failure.value.candidate["synopsis"]


def test_no_supplied_name_synopsis_uses_chinese_roles_until_plan_registers_names():
    service, adapter, runtime = create_overseas_service(
        {"synopsis": "调查员带着旧档案进入仓库，逐一核对原始签名，公开完整证据并保护证人。"}, plan_payload(), with_character=False)
    try:
        result = setup_plan(service)
        assert result.state.plan_confirmed
        assert result.state.plan.characters[0].name == "Ethan"
        assert "尚未登记姓名的人物先使用中文身份称呼" in adapter.calls[0]["prompt"]
    finally:
        runtime.engine.dispose()
