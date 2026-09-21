"""Mechanical recovery stays scene-local, version-bound, and limited to one POST."""
from copy import deepcopy
import json
from uuid import uuid4

import pytest
import app.main  # Initialize existing application imports before repository helpers.

from app.modules.quick_script.engine import (
    QuickEngineError, draft_body_hash, local_repair_scene_numbers,
    mechanical_repair_contract, mechanical_review, plan_content_hash, synopsis_hash,
)
from app.modules.quick_script.models import QuickActionRequest, QuickIssue, QuickPlanResult, QuickReview, QuickReviewResult
from app.modules.quick_script.service import QuickInputError
from tests.quick_script_fixtures import add_episode, make_state
from tests.test_quick_script_engine import FakeAdapter, engine
from tests.test_quick_script_service import PROJECT_ID, act, make_test_service, model_call, ready


def short_state(number=1):
    state = make_state()
    state.settings.target_total_characters = 2000
    approved = state.plan.episodes[number - 1]
    second = approved.scene_execution_plan[0].model_copy(deep=True)
    second.scene_number, second.dialogue_line_target, second.shot_target = 2, 12, 7
    second.scene_objective = "将核验结果当面交回保管员"
    second.visible_action = "林澈把核验记录放到保管台逐项签名"
    second.turn_or_reveal = "保管员确认原件可以留在档案室复查"
    approved.scene_execution_plan[0].dialogue_line_target = 13
    approved.scene_execution_plan[0].shot_target = 10
    approved.scene_execution_plan.append(second)
    approved.planned_scene_count, approved.planned_shot_count = 2, 17
    state.plan.content_hash = plan_content_hash(state.plan)
    for prior in range(1, number):
        add_episode(state, prior)
    episode = add_episode(state, number, status="blocked")
    first = episode.draft.scenes[0]
    second = first.model_copy(deep=True)
    second.scene_number = 2
    second.scene_causality.caused_by_scene_number = 1
    second.scene_causality.causal_link = "完成原件核验后，林澈把结果交给保管员。"
    second.character_actions, second.dialogues = second.character_actions[8:], second.dialogues[13:]
    first.character_actions, first.dialogues = first.character_actions[:8], first.dialogues[:13]
    episode.draft.scenes.append(second)
    for scene in episode.draft.scenes:
        scene.character_actions = [f"林澈核对第{scene.scene_number}册第{i+1}页签名后放回原处。"
                                   for i in range(len(scene.character_actions))]
        for i, line in enumerate(scene.dialogues):
            line.text = f"第{scene.scene_number}册第{i+1}项先核对原件。"
        scene.body_order = [f"action:{i}" for i in range(len(scene.character_actions))] + [
            f"dialogue:{i}" for i in range(len(scene.dialogues))]
    episode.body_hash = draft_body_hash(episode.draft)
    episode.metrics, issues = mechanical_review(state, number, episode.draft)
    episode.review = QuickReview(status="blocked", summary="正文篇幅和估算时长不足。", issues=issues,
                                source_body_hashes={str(number): episode.body_hash})
    return state


def body_patch(episode, scene_number=1):
    scene = episode.draft.scenes[scene_number - 1]
    return {"scene_number": scene_number, "character_actions": list(scene.character_actions),
            "dialogues": [line.model_dump(mode="json") for line in scene.dialogues],
            "body_order": list(scene.body_order)}


def test_short_draft_has_one_verified_scope_and_full_context_fits_existing_budget():
    state = short_state(number=2)
    episode = state.episodes[-1]
    before = state.model_dump(mode="json")
    contract = mechanical_repair_contract(state, episode)
    assert {issue.code for issue in episode.review.issues} == {"duration", "body_below_minimum"}
    assert contract["allowed_scene_numbers"] == [1]
    assert contract["action_count_min"] == 8 and contract["action_count_max"] == 10
    assert contract["scene_duration_tracks"][0]["dialogue_seconds"] > contract["scene_duration_tracks"][0]["visual_seconds"]
    patch = body_patch(episode)
    patch["character_actions"][0] += "他逐字指给保管员确认。"
    adapter = FakeAdapter({"scenes": [patch]}, {"scenes": [patch]})
    runtime = engine(adapter, limit=65_536)
    baseline = runtime.repair_episode(state, 2)
    # Fill the remaining envelope with source text to test the existing hard cap
    # while retaining every saved prefix line and the complete current draft.
    state.source_material = "x" * (65_536 - baseline.call.input_upper_bound_tokens - 12_000 - 128)
    result = runtime.repair_episode(state, 2)
    assert result.call.input_upper_bound_tokens + result.call.output_reserve_tokens <= 65_536
    assert result.call.output_reserve_tokens == 12_000
    prompt = adapter.calls[-1]["prompt"]
    from app.modules.quick_script.engine import complete_screenplay_text
    assert json.dumps(complete_screenplay_text(state.episodes[0].draft), ensure_ascii=False) in prompt
    assert json.dumps(episode.draft.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")) in prompt
    assert state.source_material in prompt
    assert prompt.count("输出合同：") == 1
    assert '"approved_scene_number":1' in prompt and '"approved_scene":' not in prompt
    assert result.draft.scenes[1] == episode.draft.scenes[1]
    assert result.draft.character_state_updates == episode.draft.character_state_updates
    assert result.draft.synopsis == episode.draft.synopsis
    state.source_material = before["source_material"]
    assert state.model_dump(mode="json") == before
    episode.repair_count = 1
    with pytest.raises(QuickEngineError, match="修复额度"):
        runtime.repair_episode(state, 2)
    assert len(adapter.calls) == 2


@pytest.mark.parametrize("change", ["stale_review", "stale_prefix", "ambiguity", "narrative", "counts", "two_gaps", "spent"])
def test_global_repair_refuses_unverified_or_nonmechanical_defects(change):
    state = short_state(number=2)
    episode = state.episodes[-1]
    if change == "stale_review":
        episode.review.source_body_hashes["2"] = "old-body-hash"
    elif change == "stale_prefix":
        state.episodes[0].draft.scenes[0].character_actions[0] += "作者修改过前文。"
    elif change in {"ambiguity", "narrative"}:
        episode.review.issues.append(QuickIssue(code="unclear_knowledge", severity="ambiguity" if change == "ambiguity" else "critical",
                                              episode_number=2, message="人物是否知情需要作者决定。"))
    elif change == "counts":
        episode.draft.scenes[0].character_actions.pop()
        episode.body_hash = draft_body_hash(episode.draft)
        episode.review.source_body_hashes = {"2": episode.body_hash}
        episode.review.issues = mechanical_review(state, 2, episode.draft)[1]
    elif change == "two_gaps":
        state.plan.episodes[1].scene_execution_plan[1].shot_target += 1
        state.plan.episodes[1].planned_shot_count += 1
        state.plan.content_hash = plan_content_hash(state.plan)
        for item in state.episodes:
            item.source_plan_hash = state.plan.content_hash
    else:
        episode.repair_attempts = 1
    assert mechanical_repair_contract(state, episode) is None
    assert local_repair_scene_numbers(episode, state) == set()
    adapter = FakeAdapter()
    with pytest.raises(QuickEngineError):
        engine(adapter).repair_episode(state, 2)
    assert not adapter.calls


@pytest.mark.parametrize("change", ["other_scene", "speaker", "extra_actions"])
def test_mechanical_patch_cannot_expand_scope(change):
    state = short_state()
    episode = state.episodes[0]
    before = state.model_dump(mode="json")
    patch = body_patch(episode, 2 if change == "other_scene" else 1)
    if change == "speaker":
        patch["dialogues"][0]["character_name"] = "未批准人物"
    elif change == "extra_actions":
        for index in range(3):
            patch["body_order"].append(f'action:{len(patch["character_actions"])}')
            patch["character_actions"].append(f"林澈重新翻开第{index+1}张核验页。")
    adapter = FakeAdapter({"scenes": [patch]})
    with pytest.raises(QuickEngineError) as error:
        engine(adapter).repair_episode(state, 1)
    assert error.value.code == "quick_repair_scope"
    assert error.value.call.physical_requests == 1
    assert state.model_dump(mode="json") == before


@pytest.mark.parametrize("legacy_pause", [False, True])
def test_service_resumes_old_review_preserving_diagnosis_and_requires_recheck(monkeypatch, legacy_pause):
    service, fake, db = make_test_service()
    template = short_state()
    def plan(state):
        result = deepcopy(template.plan)
        result.source_synopsis_hash = synopsis_hash(state.synopsis)
        return QuickPlanResult(plan=result, call=model_call("plan"))
    def draft(state, number):
        return engine(FakeAdapter())._draft_result(state, number, deepcopy(template.episodes[0].draft), model_call("draft"))
    def review(state, number):
        episode = state.episodes[0]
        return QuickReviewResult(review=QuickReview(status="blocked", summary="正文篇幅和估算时长不足。",
            issues=mechanical_review(state, number, episode.draft)[1], source_body_hashes={str(number): episode.body_hash}),
            call=model_call("review"))
    fake.draft_plan, fake.generate_episode, fake.review_episode = plan, draft, review
    adapter = FakeAdapter({"scenes": [body_patch(template.episodes[0])]})
    fake.repair_episode = engine(adapter, limit=65_536).repair_episode
    try:
        ready(service)
        act(service, "advance")
        with monkeypatch.context() as old_version:
            if legacy_pause:
                old_version.setattr("app.modules.quick_script.engine.local_repair_scene_numbers", lambda *args: set())
            checked = act(service, "advance")
        original = checked.state.episodes[0]
        if legacy_pause:
            assert checked.state.status == "blocked" and checked.state.next_step == "review"
            operation_id = str(uuid4())
            revision = checked.state.revision
            resumed = act(service, "resume", operation_id=operation_id, revision=revision)
            replay = act(service, "resume", operation_id=operation_id, revision=revision)
            assert resumed.state == replay.state
            assert resumed.state.episodes[0].review == original.review
            assert resumed.state.episodes[0].body_hash == original.body_hash
            assert resumed.state.next_step == "repair" and not adapter.calls
        else:
            assert checked.state.status == "idle" and checked.state.next_step == "repair"
        stale = service.get(PROJECT_ID).state.model_copy(deep=True)
        stale.episodes[0].draft.scenes[0].character_actions[0] += "未检查的修改。"
        with pytest.raises(QuickInputError, match="修复范围已变化"):
            service._prepare(stale, QuickActionRequest(action="advance", operation_id=str(uuid4()), expected_revision=stale.revision), {})
        repaired = act(service, "advance")
        assert repaired.state.next_step == "recheck"
        assert repaired.state.episodes[0].repair_count == repaired.state.episodes[0].repair_attempts == 1
        assert repaired.state.episodes[0].history[-1]["review"] == original.review.model_dump(mode="json")
        rechecked = act(service, "advance")
        assert rechecked.state.status == "blocked"
        with pytest.raises(QuickInputError, match="先修改正文"):
            act(service, "resume")
        assert len(adapter.calls) == 1
    finally:
        db.engine.dispose()
