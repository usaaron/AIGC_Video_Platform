"""Deterministic scale/acceptance contracts; synthetic bodies are not quality evidence."""

from copy import deepcopy

import pytest

from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine import draft_contract
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.llm_adapter import LLMStructuredOutputError
from app.modules.script_engine.models import ScriptDraftReviewRequest, ScriptGenerationDraftRequest
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from app.modules.script_engine.screenplay_metrics import screenplay_character_count
from app.modules.script_engine.script_body_length import BODY_SCALE_POLICY, script_body_length_guidance
from tests.test_script_generation_service import _mainland_single_scene_payload, seed_dependencies


def _body(characters=900):
    raw = _mainland_single_scene_payload(action="林夏把证物箱拖到桌边，按住箱盖。")
    raw["target_duration_seconds"] = 90
    scene = raw["scenes"][0]
    line = scene["dialogues"][0]
    scene["dialogues"] = [
        {**line, "text": "把钥匙给我，你先站到桌子对面。"} for _ in range(30)
    ]
    scene["character_actions"] = [f"林夏按住箱盖第{index}处。" for index in range(18)]
    raw = ScriptGenerationService._normalize_mechanical_draft_contract(raw)
    raw = ScriptGenerationService._normalize_mainland_scene_slugs(raw)
    validated = LLMGeneratedDraftMasterScript.model_validate(draft_contract.without_metadata(raw))
    missing = characters - screenplay_character_count(validated)
    assert missing >= 0
    # Padding exists only to isolate exact character boundaries in this unit fixture.
    actions = raw["scenes"][0]["character_actions"]
    for index in range(len(actions)):
        actions[index] += "甲" * (missing // len(actions) + (index < missing % len(actions)))
    raw = LLMGeneratedDraftMasterScript.model_validate(
        draft_contract.without_metadata(raw)
    ).model_dump(mode="json")
    raw["_meta"] = {"provider": "scale-contract-test"}
    assert screenplay_character_count(LLMGeneratedDraftMasterScript.model_validate(
        draft_contract.without_metadata(raw)
    )) == characters
    return raw


def _patch(body):
    return {"scenes": [
        {key: deepcopy(scene[key]) for key in ("scene_number", "character_actions", "dialogues", "body_order")}
        for scene in body["scenes"]
    ]}


def _service(monkeypatch, patch):
    service, content_id = seed_dependencies()
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    calls = []

    def generate(**kwargs):
        calls.append(kwargs)
        if isinstance(patch, Exception):
            raise patch
        return deepcopy(patch)

    monkeypatch.setattr(service, "_generate_postprocess_output", generate)
    return service, strategy, content_id, calls


def _accept(service, strategy, body):
    return service._ensure_mainland_draft_acceptance(
        original_prompt="按批准场景写正文。", output=body, strategy=strategy,
        target_characters=1389, target_duration_seconds=90,
    )


@pytest.mark.parametrize("actual,expected_calls,status", [
    (900, 1, "below_minimum"),  # Above 25%, below the former 70% edge.
    (1110, 1, "below_minimum"),
    (1111, 0, "within_range"),
    (1668, 0, "above_reference_range"),
])
def test_mainland_uses_preferred_minimum_not_truncation(monkeypatch, actual, expected_calls, status):
    body = _body(actual)
    service, strategy, _, calls = _service(monkeypatch, _patch(body))
    result = _accept(service, strategy, body)
    metadata = result["_meta"]
    assert len(calls) == expected_calls
    assert metadata["script_body_scale_status"] == status
    assert metadata["script_body_scale_warning"] == (actual < 1111)
    assert metadata["script_body_shortfall_characters"] == max(0, 1111 - actual)
    assert metadata["script_body_reference_gap_characters"] == max(0, 1389 - actual)
    assert metadata["script_body_scale_initial_characters"] == actual
    assert metadata["script_body_scale_repair_attempted"] == bool(expected_calls)
    if expected_calls:
        assert metadata["mainland_acceptance_repair_reasons"] == ["body_scale"]
        assert metadata["first_pass_accepted"] is False
        assert f"body_below_preferred_minimum:{actual}/1111" in metadata["mainland_acceptance_warnings"]
        _accept(service, strategy, result)  # Post-continuity recheck must not loop on scale.
        assert len(calls) == 1


def test_successful_scale_patch_keeps_original_measurement_and_firstpass_false(monkeypatch):
    body = _body()
    service, strategy, _, calls = _service(monkeypatch, _patch(_body(1389)))
    result = _accept(service, strategy, body)
    metadata = result["_meta"]
    assert len(calls) == 1
    assert metadata["script_body_scale_status"] == "within_range"
    assert metadata["script_body_scale_initial_characters"] == 900
    assert metadata["script_body_scale_initial_below_minimum"] is True
    assert metadata["script_body_expanded"] is True
    assert metadata["script_body_scale_warning"] is False
    assert metadata["first_model_pass_accepted"] is False
    assert not any(item.startswith("body_below_preferred_minimum:") for item in metadata["mainland_acceptance_warnings"])
    assert result["character_state_updates"] == body["character_state_updates"]
    assert result["scenes"][0]["dialogues"] == body["scenes"][0]["dialogues"]


def test_invalid_patch_and_existing_contract_fallback_preserve_scale_history(monkeypatch):
    source = _body()
    service, strategy, _, calls = _service(monkeypatch, {"scenes": []})
    result = _accept(service, strategy, deepcopy(source))
    assert [call["phase"] for call in calls] == ["acceptance_repair", "acceptance_contract_fallback"]
    assert result["scenes"] == source["scenes"]
    assert result["_meta"]["script_body_scale_warning"] is True
    assert result["_meta"]["script_body_scale_repair_attempted"] is True
    assert result["_meta"]["script_body_scale_initial_characters"] == 900
    _accept(service, strategy, result)
    assert len(calls) == 2


@pytest.mark.parametrize("failure", ["duration", "actions", "dialogues", "transport"])
def test_scale_repair_preserves_usable_source_on_failure_or_production_regression(monkeypatch, failure):
    source = _body()
    patch = _patch(_body(1389))
    scene = patch["scenes"][0]
    if failure == "duration":
        for line in scene["dialogues"]:
            line["text"] *= 2
    elif failure == "actions":
        scene["character_actions"] += [f"林夏翻到第{index}页。" for index in range(3)]
        scene["body_order"] = []
    elif failure == "dialogues":
        scene["dialogues"] = scene["dialogues"][:25]
        scene["body_order"] = []
    else:
        patch = LLMStructuredOutputError("invalid response", raw_content="bad")
    service, strategy, _, calls = _service(monkeypatch, patch)
    result = _accept(service, strategy, deepcopy(source))
    assert len(calls) == 1
    assert draft_contract.without_metadata(result) == draft_contract.without_metadata(source)
    assert result["_meta"]["script_body_scale_warning"] is True
    assert result["_meta"]["first_pass_accepted"] is False
    assert result["_meta"]["postprocess_failure_preserved_valid_draft"] is True
    _accept(service, strategy, result)
    assert len(calls) == 1


@pytest.mark.parametrize("body_only", [True, False])
def test_acceptance_scale_prompt_is_executable_and_keeps_runtime_budget(body_only):
    body = LLMGeneratedDraftMasterScript.model_validate(draft_contract.without_metadata(_body()))
    kwargs = dict(
        output=body, screenplay_issues=[], actual_characters=900,
        guidance=script_body_length_guidance(1389), scene_characters=[900],
        duration_estimate=estimate_screenplay_duration(body), duration_issue=False,
        scene_count=1, dialogue_count=30, shot_count=18,
    )
    if body_only:
        prompt = ScriptGenerationService._build_mainland_body_repair_prompt(**kwargs)
    else:
        prompt = ScriptGenerationService._build_mainland_acceptance_repair_prompt(
            **kwargs, original_prompt="原批准内容", language_issues=["title"],
        )
    assert "缺口 211 字" in prompt
    assert "首稿瞄准reference=1389" in prompt
    assert "NFKC" in prompt
    assert "人物回应或可见后果" in prompt
    assert "【与验收相同的估时口径】" in prompt
    assert "不得删除、合并、拆分对白轮次" in prompt
    assert "不能用填充或虚报计数伪装达标" in prompt


@pytest.mark.parametrize("final_size", [900, 1389])
def test_real_mainland_generation_route_and_finalization_never_claim_repaired_firstpass(monkeypatch, final_size):
    service, strategy, content_id, calls = _service(monkeypatch, _patch(_body(final_size)))
    service._generation_strategy_repository.save(strategy.model_copy(update={"target_platform": "cn_mainland"}))
    service._script_editor_enabled = False
    monkeypatch.setattr(service, "_generate_initial_draft_output", lambda **kwargs: _body())
    monkeypatch.setattr(service, "_ensure_script_body_length", lambda **kwargs: pytest.fail("Legacy length path called"))
    result = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_id, generation_strategy_id=strategy.id,
        output_language="zh", desired_scene_count=1, target_script_body_characters=1389,
    ))
    metadata = result.draft_master_script.llm_metadata
    assert len(calls) == 1
    assert calls[0]["phase"] == "acceptance_repair"
    assert metadata["script_body_characters"] == final_size
    assert metadata["script_body_scale_repair_attempted"] is True
    assert metadata["script_body_scale_initial_characters"] == 900
    assert metadata["mainland_acceptance_model_pass_count"] == 1
    assert metadata["script_body_scale_warning"] == (final_size < 1111)
    assert metadata["first_pass_accepted"] is False
    assert metadata["first_model_pass_accepted"] is False
    finalized = service.finalize_pre_edit_draft(result)
    assert finalized.draft_master_script.llm_metadata["first_pass_accepted"] is False
    if final_size < 1111:
        review = finalized.draft_master_script.llm_metadata["episode_quality_review"]
        assert review["status"] == "review_required"
        assert "script_body_below_preferred_minimum" in review["review_reasons"]


def test_final_review_recounts_effective_body_and_clears_stale_warning_without_erasing_history():
    service, content_id = seed_dependencies()
    run = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="zh",
    ))
    draft = run.draft_master_script.model_copy(deep=True)
    draft.llm_metadata.update({
        "script_body_scale_policy": BODY_SCALE_POLICY,
        "script_body_reference_characters": 1389, "first_pass_accepted": True,
        "first_model_pass_accepted": True, "script_body_scale_initial_characters": 1389,
        "script_body_scale_initial_below_minimum": False,
        "mainland_acceptance_warnings": ["unrelated_diagnostic"],
    })
    for scene in draft.scenes:
        scene.character_actions = ["甲乙１２。 空白！"]
        for line in scene.dialogues:
            line.text = "丙丁！"
            line.intent = "不计量" * 1000
    draft.synopsis = "不计量" * 1000
    expected = sum(6 + 2 * len(scene.dialogues) for scene in draft.scenes)
    reviewed = service._attach_episode_quality_review(draft, None)
    meta = reviewed.llm_metadata
    assert meta["script_body_characters"] == expected
    assert meta["script_body_scale_status"] == "below_minimum"
    assert meta["first_pass_accepted"] is False
    assert meta["first_model_pass_accepted"] is False
    assert meta["script_body_scale_initial_characters"] == 1389
    assert meta["episode_quality_review"]["status"] == "review_required"
    assert draft.llm_metadata["first_pass_accepted"] is True
    reviewed.scenes[0].character_actions[0] += "甲" * (1389 - expected)
    refreshed = service._attach_episode_quality_review(reviewed, None).llm_metadata
    assert refreshed["script_body_scale_warning"] is False
    assert refreshed["mainland_acceptance_warnings"] == ["unrelated_diagnostic"]
    assert "script_body_below_preferred_minimum" not in refreshed["episode_quality_review"]["review_reasons"]
    assert refreshed["first_pass_accepted"] is False


@pytest.mark.parametrize("violation", ["language", "protected_story"])
def test_semantic_scale_rejection_survives_real_checkpoint_and_continuity_recheck(monkeypatch, violation):
    source = _body()
    service, strategy, _, calls = _service(monkeypatch, None)
    bad_patch = _patch(_body(1389))
    for line in bad_patch["scenes"][0]["dialogues"]:
        line["text"] = "Hand over the key before you leave the warehouse."
    bad_patch["scenes"][0]["character_actions"] = [
        f"Lin holds the evidence box beside shelf number {index}." for index in range(18)
    ]
    bad_fallback = _body(1389)
    bad_fallback["episode_goal"] = "林夏放弃调查，决定离开仓库。"

    def generate(**kwargs):
        calls.append(kwargs)
        if violation == "language":
            return deepcopy(bad_patch)
        return deepcopy(bad_fallback) if kwargs["phase"] == "acceptance_contract_fallback" else {"scenes": []}

    monkeypatch.setattr(service, "_generate_postprocess_output", generate)
    preserved = service._run_valid_draft_postprocess_stage(
        output=deepcopy(source), phase="mainland_acceptance",
        operation=lambda checkpoint: _accept(service, strategy, checkpoint),
    )
    assert preserved["scenes"] == source["scenes"]
    assert preserved["episode_goal"] == source["episode_goal"]
    assert preserved["_meta"]["script_body_scale_repair_attempted"] is True
    assert preserved["_meta"]["script_body_scale_warning"] is True
    assert preserved["_meta"]["first_pass_accepted"] is False
    assert preserved["_meta"]["postprocess_failure_preserved_valid_draft"] is True
    count = len(calls)

    def continuity_patch(checkpoint):
        checkpoint["character_state_updates"][0]["current_goal"] = "保住手中的证物箱并核对钥匙。"
        return checkpoint

    corrected = service._run_valid_draft_postprocess_stage(
        output=preserved, phase="continuity", operation=continuity_patch,
    )
    rechecked = service._run_valid_draft_postprocess_stage(
        output=corrected, phase="post_continuity_acceptance",
        operation=lambda checkpoint: _accept(service, strategy, checkpoint),
    )
    assert len(calls) == count
    assert rechecked["_meta"]["script_body_scale_repair_attempted"] is True


@pytest.mark.parametrize("new_policy", [False, True])
def test_title_only_save_review_preserves_legacy_policy_and_firstpass(monkeypatch, new_policy):
    service, strategy, content_id, _ = _service(monkeypatch, None)
    service._script_editor_enabled = False
    monkeypatch.setattr(service, "_generate_initial_draft_output", lambda **kwargs: _body(1000))
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_id, generation_strategy_id=strategy.id,
        output_language="zh", desired_scene_count=1,
    ))
    source.draft_master_script.llm_metadata.update({
        "script_body_reference_characters": 1389,
        "script_body_preferred_min_characters": 972,
        "script_body_preferred_max_characters": 1945,
        "script_body_characters": -1,
        "first_pass_accepted": True,
        "first_model_pass_accepted": True,
    })
    if new_policy:
        source.draft_master_script.llm_metadata["script_body_scale_policy"] = BODY_SCALE_POLICY
    before = source.model_dump(mode="json")
    edited = source.draft_master_script.model_copy(update={"title": "雨夜追凶新标题"})
    reviewed = service.review_draft(ScriptDraftReviewRequest(
        source_generation_run=source, draft_master_script=edited,
    )).draft_master_script
    meta = reviewed.llm_metadata
    assert reviewed.title == edited.title
    assert reviewed.scenes == source.draft_master_script.scenes
    assert meta["script_body_characters"] == 1000
    assert source.model_dump(mode="json") == before
    if new_policy:
        assert meta["script_body_preferred_min_characters"] == 1111
        assert meta["script_body_scale_warning"] is True
        assert meta["first_pass_accepted"] is False
    else:
        assert meta["script_body_preferred_min_characters"] == 972
        assert meta["script_body_preferred_max_characters"] == 1945
        assert "script_body_scale_policy" not in meta
        assert "script_body_scale_warning" not in meta
        assert meta["first_pass_accepted"] is True
        assert meta["first_model_pass_accepted"] is True
