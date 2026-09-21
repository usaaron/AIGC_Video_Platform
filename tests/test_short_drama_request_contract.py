"""Capture the prompts sent by real service paths; no provider calls are made."""

from copy import deepcopy

import pytest

from app.modules.master_script.models import DialogueLine
from app.modules.script_engine.llm_adapter import MarketRoutedLLMAdapter, MockLLMAdapter
from app.modules.script_engine.models import (
    ApprovedEpisodePlanContext,
    EpisodeGenerationContext,
    EpisodeGenerationMode,
    ScriptGenerationDraftRequest,
    ScriptDraftModificationRequest,
)
from app.modules.script_engine.script_post_editor import ScriptPostEditor
from app.script_delivery_contract import (
    OVERSEAS_DIALOGUE_VOICE_CONTRACT,
    SCREENPLAY_EXECUTION_ORDER_CONTRACT,
    SHORT_DRAMA_PACING_CONTRACT,
)
from tests.test_mainland_repair_dialogue_allocation import _source
from tests.test_script_generation_service import (
    ReasoningLengthExhaustedStreamAdapter,
    seed_dependencies,
)
from tests.test_script_post_editor import _draft, _strategy


class RequestCaptured(BaseException):
    """Stop immediately after observing an adapter request, before any response."""


class CaptureAdapter(MockLLMAdapter):
    def __init__(self):
        super().__init__()
        self.prompts = []

    def generate_structured_output(self, prompt, **kwargs):
        self.prompts.append(prompt)
        raise RequestCaptured()

    def generate_structured_output_stream(self, prompt, **kwargs):
        self.prompts.append(prompt)
        raise RequestCaptured()


def _assert_contract(adapter):
    assert len(adapter.prompts) == 1
    prompt = adapter.prompts[0]
    assert prompt.count(SHORT_DRAMA_PACING_CONTRACT) == 1
    assert "每集对白总数保持25–35句" in prompt
    assert "强情绪、激烈冲突" in prompt
    assert "不能套用长剧的慢铺垫标准" in prompt
    assert "不能把多集排成同一人的重复核验" in prompt
    assert "首段、中段、后段和终局采用同一范围" in prompt
    return prompt


def _request(spec_id, **kwargs):
    return ScriptGenerationDraftRequest(
        content_spec_id=spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="zh",
        desired_scene_count=1,
        **kwargs,
    )


def _ready_plan():
    return ApprovedEpisodePlanContext(
        episode_number=2, planned_scene_count=1, execution_ready=True,
        episode_goal="保护已经取得的纸质原件。", entry_state="林夏持有原件等待核验。",
        central_conflict="管理员要求立刻交回材料。", protagonist_decision="林夏坚持共同封存。",
        emotional_movement="急躁变为克制。", exit_state="原件已封存并由双方保管。",
        cliffhanger="目录编号差异仍需要解释。", character_refs=["character.lin"],
        scene_execution_plan=[{
            "scene_number": 1, "scene_heading": "INT. 档案室 - 日", "character_refs": ["character.lin"],
            "scene_objective": "保护已经取得的原件。", "opposition": "管理员要求交回材料。",
            "information_shift": "原件的编号与目录不同。", "choice_or_cost": "林夏选择留下接受检查。",
            "evidence_requirements": ["纸张上的编号"], "forbidden_changes": ["原件已取得，不得重新取件"],
            "visible_action": "林夏把原件封入证物袋。", "turn_or_reveal": "编号差异得到确认。",
            "dialogue_objective": "要求双方共同封存。", "dialogue_line_target": 30, "shot_target": 16,
            "exit_state": "原件进入共同保管。",
        }],
    )


@pytest.mark.parametrize("compact", [False, True])
def test_initial_writer_receives_short_drama_contract_for_normal_and_compact_paths(compact):
    adapter = CaptureAdapter()
    service, spec_id = seed_dependencies(llm_adapter=adapter)
    context = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=2, total_episodes=10,
        approved_episode_plan=_ready_plan(),
    ) if compact else None
    with pytest.raises(RequestCaptured):
        service.generate_draft(_request(spec_id, episode_context=context))
    prompt = _assert_contract(adapter)
    assert ("分集场次已经审核" in prompt) == compact
    assert SCREENPLAY_EXECUTION_ORDER_CONTRACT in prompt


@pytest.mark.parametrize("market", ["overseas", "cn_mainland"])
def test_selected_dialogue_routes_existing_voice_contract_only_to_overseas_adapter(market):
    mainland, overseas = CaptureAdapter(), CaptureAdapter()
    service, spec_id = seed_dependencies(conversation_editor_llm_adapter=MarketRoutedLLMAdapter(
        mainland=mainland, overseas=overseas,
    ))
    content_spec = service._content_spec_repository.get(spec_id)
    content_spec.metadata["market_profile"] = "overseas_tiktok" if market == "overseas" else market
    service._content_spec_repository.save(content_spec)
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en" if market == "overseas" else "zh", release_region=market,
        desired_scene_count=3,
    ))
    dialogue = DialogueLine(
        character_name="Mara" if market == "overseas" else "林夏",
        intent="追问变化",
        text="Tell me what changed." if market == "overseas" else "告诉我哪里变了。",
        chinese_translation="告诉我哪里变了。" if market == "overseas" else None,
    )
    first_scene = source.draft_master_script.scenes[0].model_copy(update={
        "dialogues": [dialogue],
        "body_order": [*[f"action:{index}" for index in range(len(source.draft_master_script.scenes[0].character_actions))], "dialogue:0"],
    })
    source = source.model_copy(update={"draft_master_script": source.draft_master_script.model_copy(update={
        "scenes": [first_scene, *source.draft_master_script.scenes[1:]],
    })})
    request = ScriptDraftModificationRequest(
        source_generation_run=source, source_draft_master_script=source.draft_master_script,
        instruction="Make this line more conversational without changing its meaning; overseas_tiktok is a quoted label.",
        selection_context={
            "source_field": "第1场对白1（scenes.0.dialogues.0.text）",
            "selected_text": dialogue.text,
        },
    )
    before = request.model_dump()
    with pytest.raises(RequestCaptured):
        service.modify_draft(request)
    selected = overseas if market == "overseas" else mainland
    other = mainland if market == "overseas" else overseas
    prompt = _assert_contract(selected)
    assert other.prompts == []
    assert prompt.count(OVERSEAS_DIALOGUE_VOICE_CONTRACT) == (1 if market == "overseas" else 0)
    assert ("Keep the targeted response schema" in prompt) == (market == "overseas")
    assert "Target path: scenes.0.dialogues.0.text" in prompt
    assert dialogue.text in prompt
    assert "requires_full_episode_rewrite=true" in prompt
    assert ("updated_chinese_translation as the complete Chinese translation" in prompt) == (market == "overseas")
    assert request.model_dump() == before


def test_compact_transport_recovery_keeps_the_same_short_drama_contract():
    primary = ReasoningLengthExhaustedStreamAdapter()
    recovery = CaptureAdapter()
    service, spec_id = seed_dependencies(llm_adapter=primary, initial_fallback_llm_adapter=recovery)
    with pytest.raises(RequestCaptured):
        service.generate_draft(_request(spec_id, episode_context=EpisodeGenerationContext(
            generation_mode=EpisodeGenerationMode.sequential, episode_number=8, total_episodes=72,
        )))
    prompt = _assert_contract(recovery)
    assert "上一轮请求未完成" in prompt
    assert primary.stream_call_count == 1


@pytest.mark.parametrize("repair", ["duration", "combined_language", "counts", "style", "language", "body_completion"])
def test_body_repair_adapter_requests_share_short_drama_standard(repair):
    adapter = CaptureAdapter()
    service, _ = seed_dependencies(repair_llm_adapter=adapter, script_editor_llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    source = _source((24,) if repair == "counts" else (27,))
    if repair == "body_completion":
        # A long playable draft intentionally defers word-count expansion to
        # the runtime gate. Use an actually truncated body for this request.
        scene = source["scenes"][0]
        scene["character_actions"] = ["林夏拿起钥匙。"]
        scene["dialogues"] = [{**scene["dialogues"][0], "text": "钥匙给我。"}]
        scene["body_order"] = ["action:0", "dialogue:0"]
    if repair in {"language", "combined_language"}:
        for dialogue in source["scenes"][0]["dialogues"]:
            dialogue["text"] = "Give me the key. Who changed the date?"
    if repair == "style":
        source["scenes"][0]["character_actions"][0] = "林夏意识到同伴背叛了自己，心里感到从未有过的绝望。"
    with pytest.raises(RequestCaptured):
        if repair in {"duration", "combined_language"}:
            service._ensure_mainland_draft_acceptance(
                original_prompt=SHORT_DRAMA_PACING_CONTRACT,
                output=source, strategy=strategy,
                target_characters=None, target_duration_seconds=90,
            )
        elif repair == "counts":
            service._ensure_episode_production_counts(output=source, strategy=strategy)
        elif repair == "style":
            service._ensure_mainland_screenplay_style(
                original_prompt=SHORT_DRAMA_PACING_CONTRACT,
                output=source, strategy=strategy, target_characters=None,
            )
        elif repair == "language":
            service._ensure_mainland_draft_language(
                original_prompt=SHORT_DRAMA_PACING_CONTRACT,
                output=source, strategy=strategy,
            )
        else:
            service._ensure_script_body_length(
                output=source, strategy=strategy, target_characters=6000,
            )
    prompt = _assert_contract(adapter)
    if repair == "counts":
        assert "允许短促攻防" in prompt
        assert "不要全部压成2至5字口号" not in prompt
    if repair == "duration":
        assert "第1场27轮" in prompt
        assert "不得把合法总数向25条下限压缩" in prompt


def test_body_reference_shortfall_does_not_expand_an_already_long_episode():
    adapter = CaptureAdapter()
    service, _ = seed_dependencies(repair_llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    source = _source((27,))
    before_scenes = deepcopy(source["scenes"])
    result = service._ensure_script_body_length(output=source, strategy=strategy, target_characters=6000)
    assert adapter.prompts == []
    assert result["scenes"] == before_scenes
    assert result["_meta"]["script_body_completion_deferred_reason"] == "production_runtime_priority"


@pytest.mark.parametrize("whole_fallback", [False, True])
def test_structure_repairs_that_can_replace_body_receive_the_contract(whole_fallback):
    adapter = CaptureAdapter()
    service, _ = seed_dependencies(repair_llm_adapter=adapter, contract_fallback_llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    source = {"name": "林夏", "role": "调查者"} if whole_fallback else _source()
    if not whole_fallback:
        source["scenes"][0]["emotional_objective"] = ""
    with pytest.raises(RequestCaptured):
        service._ensure_valid_draft_contract(output=source, strategy=strategy)
    prompt = _assert_contract(adapter)
    assert ("FULL DRAFT CONTRACT FALLBACK" in prompt) == whole_fallback


def test_resumed_finalization_sends_the_contract_to_the_real_post_editor():
    service, spec_id = seed_dependencies()
    source = service.generate_pre_edit_draft(_request(spec_id))
    source = source.model_copy(update={
        "llm_model_info": source.llm_model_info.model_copy(update={"provider": "deepseek"}),
    })
    adapter = CaptureAdapter()
    service._script_editor_enabled = True
    service._script_post_editor = ScriptPostEditor(llm_adapter=adapter)
    with pytest.raises(RequestCaptured):
        service.finalize_pre_edit_draft(source)
    prompt = _assert_contract(adapter)
    assert "DeepSeek已经完成一集完整初稿" in prompt
    assert "允许短促攻防" in prompt
    assert "不能全部压成口号" not in prompt
    assert "dialogues合计必须为25–35条" in prompt


def test_overseas_language_patch_receives_contract_without_expanding_its_scope():
    adapter = CaptureAdapter()
    editor = ScriptPostEditor(llm_adapter=adapter)
    payload = deepcopy(_draft().model_dump(mode="json"))
    with pytest.raises(RequestCaptured):
        editor._apply_language_field_patch(
            payload, paths=["scenes.0.dialogues.0.chinese_translation"],
            strategy=_strategy(), focused=False,
        )
    prompt = _assert_contract(adapter)
    assert "每个给定path必须且只能返回一次" in prompt
    assert "不得重写整集" in prompt
