"""Author setting survives the local planning/screenplay boundary without new canon."""

from datetime import datetime, timezone
import json
from types import SimpleNamespace

import pytest
from tests.test_script_generation_service import seed_dependencies, StubRealScriptAdapter, StrategyBudgetRecordingAdapter

from app.modules.content_spec.market_profile import content_spec_market_contract
from app.modules.content_spec.overseas_story_profile import (
    content_spec_overseas_story_profile,
    normalize_overseas_story_profile,
    overseas_story_profile_contract,
)
from app.modules.script_engine.long_story_models import StoryBible, StoryBibleDraftRequest
from app.modules.script_engine.models import ScriptGenerationDraftRequest, ScriptReleaseRegion, ScriptDraftModificationRequest, LLMModelInfo
from app.modules.script_engine.script_post_editor import ScriptEditorialAssessment
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from app.modules.script_engine.story_bible_approval import approved_story_bible_context
from app.modules.script_engine.story_planning_service import StoryPlanningService
from app.modules.script_engine.planning_source_inheritance import planning_source_context, planning_source_signature
from tests.test_content_spec_service import build_service, build_intent_payload
from tests.test_long_story_models import build_story_bible


def profile(country="UK"):
    return {
        "schema_version": "overseas_story_profile.v1", "country": country,
        "region": "Manchester" if country == "UK" else "",
        "social_context": "同一社区内的租客与房东关系",
        "story_engine": "争取修缮会消耗邻里信任，阶段行动改变协商筹码。",
    }


def resolved_spec(country="UK", *, overseas=True):
    service = build_service()
    payload = build_intent_payload()
    platform = service._platform_profile_repository.get(payload.platform_goal.platform_profile_id)
    platform.metadata["market_profile"] = "overseas_tiktok" if overseas else "cn_mainland"
    service._platform_profile_repository.save(platform)
    payload = payload.model_copy(update={"request_metadata": {
        "overseas_story_profile": {**profile(country), "ignore_me": "not persisted"},
        "unrelated": "not copied",
    }})
    spec = service.resolve_creative_intent(payload).content_spec
    return service.get(spec.id)


@pytest.mark.parametrize("country", ["UK", "US", ""])
def test_resolve_persists_profile_and_planning_uses_same_explicit_background(country):
    spec = resolved_spec(country)
    assert spec.metadata["overseas_story_profile"] == profile(country)
    assert "unrelated" not in spec.metadata
    prompt = StoryPlanningService._build_prompt(
        payload=StoryBibleDraftRequest(
            story_project_id="story_project.local", generation_strategy_id="strategy.local",
            creative_prompt="邻里通过一次谈判面对相互冲突的需要。",
        ),
        project_title="邻里之间", content_spec=spec, knowledge_context="",
    )
    assert json.dumps(profile(country), ensure_ascii=False, separators=(",", ":")) in prompt
    assert "不重置已解决问题" in prompt
    assert "25–35条对白" in prompt
    assert "series_finale" in prompt
    assert "候选结果不能进入正式连续性记忆" in prompt
    assert "拒绝｜EN: ...｜中译: ..." in prompt
    assert "American English" not in prompt


def test_profile_normalization_is_bounded_and_does_not_coerce_foreign_values():
    assert normalize_overseas_story_profile({"country": "UK"}) is None
    assert normalize_overseas_story_profile({**profile(), "schema_version": "v2"}) is None
    value = normalize_overseas_story_profile({
        **profile(), "country": "x" * 100, "region": 77,
        "social_context": {"nested": "bad"}, "story_engine": "中" * 1000,
    })
    assert len(value["country"]) == 80
    assert value["region"] == value["social_context"] == ""
    assert len(value["story_engine"]) == 800


def test_mainland_drops_profile_and_old_projects_have_no_new_contract():
    spec = resolved_spec(overseas=False)
    assert "overseas_story_profile" not in spec.metadata
    assert content_spec_overseas_story_profile(spec) is None
    assert "【作者设定的海外背景】" not in content_spec_market_contract(spec).prompt_contract
    assert overseas_story_profile_contract(None, planning=True) == ""


def test_loaded_profile_survives_approved_projection_without_new_serialized_bible_fields():
    spec = resolved_spec()
    bible = StoryBible.model_validate({
        **build_story_bible(), "content_spec_id": spec.id,
        "market_profile": "overseas_tiktok", "status": "approved",
        "approved_at": datetime.now(timezone.utc),
        "central_conflict": "AI草案（待确认）：争取修缮必须承担邻里信任破裂的代价。",
    })
    original = bible.model_dump(mode="json")
    service = object.__new__(StoryPlanningService)
    service._long_story_service = SimpleNamespace(get_story_bible=lambda *a, **kw: bible.model_copy(deep=True))
    service._content_spec_repository = SimpleNamespace(get=lambda spec_id: spec if spec_id == spec.id else None)
    loaded = service._get_story_bible_with_profile(bible.story_project_id, bible.story_bible_id)
    projected = approved_story_bible_context(loaded)
    assert projected._overseas_story_profile == profile()
    assert "AI草案" not in projected.central_conflict
    assert bible.model_dump(mode="json") == original
    assert "_overseas_story_profile" not in projected.model_dump()
    assert "overseas_story_profile" not in StoryBible.model_json_schema()["properties"]
    prompt = service._story_bible_market_contract_text(projected)
    assert "Manchester" in prompt and "人物冲突网" in prompt
    context = planning_source_context(projected)
    assert json.loads(planning_source_signature(context)) == [
        bible.story_project_id, bible.story_bible_id, bible.version, None, profile(),
    ]
    old_context = planning_source_context(bible)
    assert len(json.loads(planning_source_signature(old_context))) == 4


@pytest.mark.parametrize("country", ["UK", "US", ""])
def test_generation_prompt_and_editor_context_use_persisted_profile(country):
    service, spec_id = seed_dependencies()
    spec = service._content_spec_repository.get(spec_id)
    service._content_spec_repository.save(spec.model_copy(update={"metadata": {
        **spec.metadata, "market_profile": "overseas_tiktok", "overseas_story_profile": profile(country),
    }}))
    result = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        release_region=ScriptReleaseRegion.overseas, output_language="en", desired_scene_count=3,
    ))
    prompt = result.prompt_build_result.prompt_text
    assert json.dumps(profile(country), ensure_ascii=False, separators=(",", ":")) in prompt
    assert "不得把海外自动等同于美国" in prompt
    assert "正文只兑现批准的本集路线" in prompt
    assert service._overseas_editor_context(spec_id) == {"overseas_story_profile": profile(country)}


@pytest.mark.parametrize("resume", [False, True])
def test_initial_and_resumed_generation_forward_profile_to_editor_and_pair_repair(monkeypatch, resume):
    service, spec_id = seed_dependencies(llm_adapter=None if resume else StubRealScriptAdapter())
    spec = service._content_spec_repository.get(spec_id)
    service._content_spec_repository.save(spec.model_copy(update={"metadata": {
        **spec.metadata, "market_profile": "overseas_tiktok", "overseas_story_profile": profile(),
    }}))
    service._script_editor_enabled = True
    calls = []

    def edit(draft, **kwargs):
        calls.append(("edit", kwargs.get("overseas_story_profile")))
        return SimpleNamespace(draft=draft, attempt_count=1, duration=estimate_screenplay_duration(draft))

    def pairs(draft, **kwargs):
        calls.append(("pairs", kwargs.get("overseas_story_profile")))
        return draft, 0

    monkeypatch.setattr(service._script_post_editor, "edit", edit)
    monkeypatch.setattr(service._script_post_editor, "ensure_overseas_dialogue_pairs", pairs)
    monkeypatch.setattr(service._script_post_editor, "assess_source", lambda draft, **kwargs: ScriptEditorialAssessment(
        source_draft_id=draft.id, duration=estimate_screenplay_duration(draft), issues=("language review",),
    ))
    request = ScriptGenerationDraftRequest(
        content_spec_id=spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        release_region=ScriptReleaseRegion.overseas, output_language="en", desired_scene_count=3,
    )
    if resume:
        source = service.generate_pre_edit_draft(request).model_copy(update={"llm_model_info": LLMModelInfo(
            provider="deepseek", model_name="mock-test-only", supports_structured_output=True, max_context_tokens=128_000,
        )})
        service.finalize_pre_edit_draft(source)
    else:
        service.generate_draft(request)
    assert calls == [("edit", profile()), ("pairs", profile())]


def test_creator_modification_passes_same_profile_to_editor(monkeypatch):
    service, spec_id = seed_dependencies()
    spec = service._content_spec_repository.get(spec_id)
    service._content_spec_repository.save(spec.model_copy(update={"metadata": {
        **spec.metadata, "market_profile": "overseas_tiktok", "overseas_story_profile": profile(),
    }}))
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        release_region=ScriptReleaseRegion.overseas, output_language="en", desired_scene_count=3,
    ))
    service._llm_adapter = StrategyBudgetRecordingAdapter()
    service._script_editor_enabled = True
    calls = []

    def edit(draft, **kwargs):
        calls.append(kwargs.get("overseas_story_profile"))
        return SimpleNamespace(draft=draft)

    monkeypatch.setattr(service._script_post_editor, "edit", edit)
    monkeypatch.setattr(service._script_post_editor, "assess_source", lambda draft, **kwargs: ScriptEditorialAssessment(
        source_draft_id=draft.id, duration=estimate_screenplay_duration(draft), issues=("language review",),
    ))
    service.modify_draft(ScriptDraftModificationRequest(
        source_generation_run=source, source_draft_master_script=source.draft_master_script,
        instruction="Make Mara's public choice more costly.",
        selection_context={
            "source_field": "Scene 1 dialogue (scenes.0.dialogues.0.text)",
            "selected_text": "Tell me who paid for this signed contract tonight.",
            "before_text": "Mara blocks the exit. ", "after_text": " Damian looks toward the cameras.",
        },
    ))
    assert calls == [profile()]


def test_voice_language_patch_retry_keeps_authorized_bilingual_quote():
    from tests.test_overseas_voice_samples import story_bible, VALID_SAMPLES, VOICE_PATH
    from tests.test_story_planning_service import build_strategy

    output = story_bible({"permanentVoicePrompt": "She speaks softly and never interrupts."})
    service = object.__new__(StoryPlanningService)
    prompts = []

    def generate(prompt, **kwargs):
        prompts.append(prompt)
        value = "She speaks softly." if len(prompts) == 1 else "低声说话，不打断他人。\n" + VALID_SAMPLES[0]
        return {"patches": [{"path": VOICE_PATH, "value": value}]}

    service._generate_story_bible_model_output = generate
    repaired = service._repair_story_bible_language_fields(
        output=output, field_paths=[VOICE_PATH], strategy=build_strategy(),
        stage="language_patch", market_profile="overseas_tiktok",
    )
    assert len(prompts) == 2
    assert "本任务明确授权的海外标记声音引文除外" in prompts[1]
    assert repaired.character_registry[0].acting_profile.permanentVoicePrompt.endswith(VALID_SAMPLES[0])
