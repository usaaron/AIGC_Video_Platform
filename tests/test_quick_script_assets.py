"""Quick asset cards share the existing planning/draft calls and saved sources."""
from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.main import create_app
from app.modules.quick_script.engine import QuickEngineError, plan_content_hash, source_hash, validate_quick_plan
from app.modules.quick_script.models import QuickPlanContent, QuickProductionAsset, QuickState
from app.modules.quick_script.service import QuickService
from app.modules.script_engine.long_story_models import CharacterActingProfile
from tests.quick_script_fixtures import make_state, make_llm_draft
from tests.test_quick_script_engine import FakeAdapter, engine


CARDS = [
    {"asset_ref": "scene.archive", "name": "档案室", "kind": "scene",
     "appearance": "密集档案架分列两侧，中央留出摆放档案原件的长桌。", "fixed_details": ["两侧档案架", "中央长桌"]},
    {"asset_ref": "prop.original", "name": "档案原件", "kind": "prop",
     "appearance": "边缘破损的纸质档案，纸面残留原始签名。", "fixed_details": ["破损边缘", "原始签名"]},
]


def plan_payload(state):
    return {key: value for key, value in state.plan.model_dump(mode="json").items() if key in QuickPlanContent.model_fields}


def test_production_cards_generated_in_same_plan_call_and_retained_in_draft_context():
    state = make_state()
    payload = {**plan_payload(state), "production_assets": CARDS}
    raw = make_llm_draft()
    raw["scenes"][0]["content_manifest"].update(location="档案室", props=["档案原件"])
    adapter = FakeAdapter(payload, raw)
    quick = engine(adapter)
    plan = quick.draft_plan(state).plan
    assert [card.model_dump() for card in plan.production_assets] == CARDS
    assert len(adapter.calls) == 1
    state.plan = plan
    result = quick.generate_episode(state, 1)
    assert len(adapter.calls) == 2
    assert result.call.physical_requests == 1
    assert "prop.original" in adapter.calls[1]["prompt"]
    assert "密集档案架" in adapter.calls[1]["prompt"]
    assert result.draft.scenes[0].content_manifest.props == ["档案原件"]
    assert result.draft.llm_metadata["quick_asset_manifest_undeclared_scenes"] == []
    assert "实际出场但未说话的人物" in adapter.calls[1]["prompt"]


@pytest.mark.parametrize("missing", ["manifest", "props", "character_refs"])
def test_legacy_synthesized_manifest_never_becomes_declared_asset_evidence(missing):
    raw = make_llm_draft()
    if missing == "manifest":
        raw["scenes"][0].pop("content_manifest")
    else:
        raw["scenes"][0]["content_manifest"].pop(missing)
    state = make_state()
    adapter = FakeAdapter(raw)
    result = engine(adapter).generate_episode(state, 1)
    assert result.draft.llm_metadata["quick_asset_manifest_undeclared_scenes"] == [1]
    assert result.draft.scenes[0].content_manifest is not None
    assert len(adapter.calls) == 1
    state.episodes = []
    # Reloading persisted data retains the provenance flag after legacy defaults
    # have materialized a perfectly valid but originally undeclared manifest.
    from app.modules.quick_script.models import QuickEpisode
    state.episodes.append(QuickEpisode(episode_number=1, draft=result.draft, body_hash=result.body_hash,
                                      source_plan_hash=state.plan.content_hash))
    loaded = QuickState.model_validate(state.model_dump(mode="json"))
    assert loaded.episodes[0].draft.llm_metadata["quick_asset_manifest_undeclared_scenes"] == [1]


def test_partial_manifest_missing_required_location_is_not_silently_accepted():
    raw = make_llm_draft()
    raw["scenes"][0]["content_manifest"].pop("location")
    adapter = FakeAdapter(raw)
    with pytest.raises(QuickEngineError) as failure:
        engine(adapter).generate_episode(make_state(), 1)
    assert failure.value.code == "quick_output_invalid"
    assert failure.value.candidate["scenes"][0]["content_manifest"].get("location") is None
    assert len(adapter.calls) == 1


def test_real_adapter_local_schema_preserves_missing_prop_declaration_marker():
    from tests.test_quick_script_resilience import make_adapter, sse_response
    raw = make_llm_draft()
    raw["scenes"][0]["content_manifest"].pop("props")
    calls = []
    def handler(request):
        calls.append(request)
        return sse_response(raw)
    adapter = make_adapter(handler)
    try:
        result = engine(adapter).generate_episode(make_state(), 1)
        assert result.draft.llm_metadata["quick_asset_manifest_undeclared_scenes"] == [1]
        assert result.draft.scenes[0].content_manifest.props == []
        assert len(calls) == 1
    finally:
        adapter._client.close()


def test_explicit_empty_prop_list_is_preserved_without_inventing_planned_props():
    state = make_state()
    state.plan.production_assets = [QuickProductionAsset.model_validate(card) for card in CARDS]
    state.plan.content_hash = plan_content_hash(state.plan)
    raw = make_llm_draft()
    raw["scenes"][0]["content_manifest"]["props"] = []
    result = engine(FakeAdapter(raw)).generate_episode(state, 1)
    assert result.draft.scenes[0].content_manifest.props == []
    assert result.draft.llm_metadata["quick_asset_manifest_undeclared_scenes"] == []
    assert result.draft.scenes[0].supporting_asset_ids == []


def test_new_optional_cards_do_not_invalidate_legacy_plan_hash_but_real_cards_do():
    state = make_state()
    legacy = plan_payload(state)
    legacy.pop("production_assets")
    for character in legacy["characters"]:
        character.pop("acting_profile")
    old_hash = source_hash(legacy)
    loaded = QuickPlanContent.model_validate(legacy)
    assert loaded.production_assets is None
    assert plan_content_hash(loaded) == old_hash
    loaded.production_assets = [QuickProductionAsset.model_validate(card) for card in CARDS]
    with_cards = plan_content_hash(loaded)
    assert with_cards != old_hash
    loaded.production_assets[0].appearance += "墙面没有其他陈设。"
    assert plan_content_hash(loaded) != with_cards


@pytest.mark.parametrize("change", ["duplicate_id", "duplicate_name", "character_id", "invalid_id"])
def test_asset_ids_and_names_cannot_ambiguously_reuse_another_identity(change):
    payload = {**plan_payload(make_state()), "production_assets": deepcopy(CARDS)}
    if change == "duplicate_id":
        payload["production_assets"][1]["asset_ref"] = payload["production_assets"][0]["asset_ref"]
    elif change == "duplicate_name":
        payload["production_assets"].append({**CARDS[0], "asset_ref": "scene.archive2", "name": " 档案室 "})
    elif change == "character_id":
        payload["production_assets"][0]["asset_ref"] = payload["characters"][0]["character_ref"]
    else:
        payload["production_assets"][0]["asset_ref"] = "场景名称不是稳定ID"
    with pytest.raises(ValidationError):
        QuickPlanContent.model_validate(payload)


def test_asset_visual_facts_stay_chinese():
    state = make_state()
    state.plan.production_assets = [QuickProductionAsset.model_validate({**CARDS[0], "appearance": "An archive with metal shelves."})]
    assert any(issue.code == "asset_language" for issue in validate_quick_plan(state, state.plan))


def test_blank_asset_facts_are_not_accepted_as_visual_descriptions():
    with pytest.raises(ValidationError):
        QuickProductionAsset.model_validate({**CARDS[0], "appearance": "     "})


def test_approved_acting_profile_cannot_disappear_or_drift_in_generated_character():
    state = make_state()
    state.plan.characters[0].acting_profile = CharacterActingProfile(voice="低沉清楚", bodyLanguage="手指紧贴文件边缘")
    state.plan.content_hash = plan_content_hash(state.plan)
    raw = make_llm_draft()
    raw["characters"][0]["acting_profile"] = {"voice": "模型新编的尖细声音"}
    result = engine(FakeAdapter(raw)).generate_episode(state, 1)
    assert result.draft.characters[0].acting_profile == state.plan.characters[0].acting_profile.model_dump()


def test_silent_character_manifest_is_preserved_and_edits_invalidate_its_evidence():
    state = make_state()
    raw = make_llm_draft()
    silent = state.plan.characters[0].model_copy(update={"character_ref": "character.witness", "name": "周宁"})
    state.plan.characters.append(silent)
    state.plan.content_hash = plan_content_hash(state.plan)
    raw["scenes"][0]["character_refs"].append("character.witness")
    raw["scenes"][0]["content_manifest"]["character_refs"].append("character.witness")
    raw["scenes"][0]["character_actions"][0] = "周宁扶稳档案长桌，将破损原件轻轻放到林澈面前的比对尺旁。"
    result = engine(FakeAdapter(raw)).generate_episode(state, 1)
    assert "character.witness" in result.draft.scenes[0].content_manifest.character_refs
    assert all(line.character_name != "周宁" for line in result.draft.scenes[0].dialogues)
    edited = result.draft.model_copy(deep=True)
    edited.scenes[0].character_actions[0] = "林澈将破损原件轻轻放到面前的比对尺旁。"
    QuickService._invalidate_edited_scene_evidence(result.draft, edited)
    assert edited.llm_metadata["quick_asset_evidence_invalidated_scenes"] == [1]
