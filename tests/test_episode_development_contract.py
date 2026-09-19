import json
import re
from types import SimpleNamespace

import pytest

from app.modules.script_engine.episode_development_contract import validate_episode_developments
from app.modules.script_engine.episode_plan_contracts import validate_episode_plan_prefix
from app.modules.script_engine.long_story_models import EpisodeDevelopment, EpisodePlanGenerationItem, EpisodeSceneExecutionBeat, StoryPlanExpansionStatus, StoryPlanNode
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_story_planning_service import build_active_lineage_episode_item, build_active_lineage_story_bible, build_active_lineage_story_node, build_episode_item_generation_service, episode_item_request


def authored_leaf():
    node = build_active_lineage_story_node(node_id="node.ownership", version=1, start_episode=1, end_episode=8, expansion_status=StoryPlanExpansionStatus.episode_ready)
    developments = [
        "主角翻查旧账本，发现几处转账日期彼此矛盾，决定寻找原始凭证。",
        "主角赶到档案室时撞见中间人碎纸，只来得及保下一张存根。",
        "主角将存根与账本逐项比对，发现时间戳修改处，随后收到证人的求助。",
        "证人不肯独自躲藏，主角决定先放下公开计划，安排两人一起转移。",
        "主角把自己的安全屋让给证人，失去藏身地后只能向保管员寻求协助。",
        "保管员不肯交出原件，主角提交存根请他现场比对，使其同意共同封存。",
        "封存时中间人追来索要材料，证人选择现身证明来源，保管员留下签名。",
        "主角在共同见证下固定原件，并从背面转账编号锁定资金入口，证人获得保护。",
    ]
    entries = []
    previous = node.entry_state
    for number, synopsis in enumerate(developments, 1):
        exit_state = node.exit_state if number == 8 else synopsis
        entry = EpisodeDevelopment(episode_number=number, synopsis=synopsis, entry_state=previous, exit_state=exit_state, source_unit_story_beats={1:node.unit_story_beats[:1],2:node.unit_story_beats[1:2],4:node.unit_story_beats[2:3],8:node.unit_story_beats[3:]}.get(number,[]), source_turning_points=node.turning_points if number == 3 else [])
        entries.append(entry);previous=exit_state
    return node.model_copy(update={"episode_developments":entries})


def test_authored_ownership_survives_serialization_and_uneven_chunk_resume():
    node = authored_leaf()
    validate_episode_developments(node, required=True)
    restored = StoryPlanNode.model_validate_json(node.model_dump_json())
    assert restored.episode_developments == node.episode_developments
    plans = [EpisodePlanGenerationItem.model_validate({**build_active_lineage_episode_item(entry.episode_number), **entry.model_dump()}) for entry in restored.episode_developments]
    before = [item.model_dump() for item in plans]
    for count in [1,4,5,8]:
        validate_episode_plan_prefix(plans[:count], node=node, story_bible=build_active_lineage_story_bible(), require_complete=count == 8)
    assert [item.model_dump() for item in plans] == before
    # Even moving only the source claim cannot manufacture new event ownership.
    plans[3] = plans[3].model_copy(update={"source_unit_story_beats":node.unit_story_beats[-1:]})
    with pytest.raises(StoryPlanningInputError, match="approved episode_developments.source_unit_story_beats"):
        validate_episode_plan_prefix(plans[:4], node=node, story_bible=build_active_lineage_story_bible(), require_complete=False)


@pytest.mark.parametrize("failure", ["missing", "gap", "handoff", "end", "early_settlement", "repeated"])
def test_invalid_upstream_ownership_is_rejected_without_rewriting(failure):
    node = authored_leaf()
    items = list(node.episode_developments)
    if failure == "missing": items = []
    elif failure == "gap": items.pop(3)
    elif failure == "handoff": items[3] = items[3].model_copy(update={"entry_state":"前文没有发生的另一种状态。"})
    elif failure == "end": items[-1] = items[-1].model_copy(update={"exit_state":"主角还在等待确认，没有完成结算。"})
    elif failure == "repeated": items[3] = items[3].model_copy(update={"synopsis":items[2].synopsis})
    else:
        items[3] = items[3].model_copy(update={"source_unit_story_beats":[*items[3].source_unit_story_beats,*items[-1].source_unit_story_beats]})
        items[-1] = items[-1].model_copy(update={"source_unit_story_beats":[]})
    node = node.model_copy(update={"episode_developments":items});before=node.model_dump()
    with pytest.raises(StoryPlanningInputError):validate_episode_developments(node, required=True)
    assert node.model_dump() == before


def test_real_generation_without_upstream_ownership_stops_before_model_invocation():
    adapter = SimpleNamespace(get_model_info=lambda: SimpleNamespace(provider="openai_compatible", model_name="test-real-route"))
    service, node = build_episode_item_generation_service(adapter)
    with pytest.raises(StoryPlanningInputError, match="缺少逐集事件分配"):
        service.generate_episode_plan_chunk(episode_item_request(node))


@pytest.mark.parametrize("numbers", [[1],[1,2,3,4],[5,6,7,8]])
def test_chunk_receives_only_its_executable_episode_developments(numbers):
    node=authored_leaf()
    prompt=StoryPlanningService._build_episode_plan_prompt(node=node, story_bible=build_active_lineage_story_bible(), start_episode=1, end_episode=8, knowledge_context="")
    prompt=StoryPlanningService._build_segmented_episode_roadmap_prompt(contract_prompt=prompt,all_episode_numbers=list(range(1,9)),current_episode_numbers=numbers,accepted_plans=[])
    supplied=json.loads(re.search(r"<episode_developments>(.*?)</episode_developments>",prompt,re.S)[1])
    assert supplied == [item.model_dump(mode="json") for item in node.episode_developments if item.episode_number in numbers]
    assert ('"settlement_episode":8' in prompt) == (8 in numbers)
    assert node.synopsis not in prompt
    assert "distribute every approved" not in prompt
    if max(numbers) < 8:
        assert node.unit_story_beats[-1] not in prompt
        assert node.episode_developments[-1].synopsis not in prompt


def test_fixed_single_episode_prompt_does_not_offer_future_events_for_selection():
    node = authored_leaf()
    prompt = StoryPlanningService._build_episode_plan_item_prompt(
        node=node, story_bible=build_active_lineage_story_bible(), episode_number=1,
        accepted_plans=[], predecessor_plan=None, knowledge_context="",
    )
    assert node.episode_developments[0].synopsis in prompt
    assert node.episode_developments[1].synopsis not in prompt
    assert node.unit_story_beats[-1] not in prompt
    assert node.synopsis not in prompt
    assert node.central_conflict not in prompt


@pytest.mark.parametrize("episode_number", [1, 8])
def test_episode_revision_uses_the_same_fixed_execution_scope(episode_number):
    node = authored_leaf().model_copy(update={
        "central_conflict": "段末公开资金入口会使尚未发生的追捕全面展开。",
    })
    entry = node.episode_developments[episode_number - 1]
    current = EpisodePlanGenerationItem.model_validate({
        **build_active_lineage_episode_item(episode_number), **entry.model_dump(),
    })
    prompt = StoryPlanningService._build_episode_plan_item_modification_prompt(
        node=node, story_bible=build_active_lineage_story_bible(),
        current_plan=current, accepted_plans=[], predecessor_plan=None,
        instruction="使人物行动更具体", revision_mode="targeted", selection_context=None,
        knowledge_context="",
    )
    supplied = json.loads(re.search(r"<episode_developments>(.*?)</episode_developments>", prompt, re.S)[1])
    assert supplied == [entry.model_dump(mode="json")]
    assert node.synopsis not in prompt
    assert node.central_conflict not in prompt
    assert ('"settlement_episode":8' in prompt) == (episode_number == 8)
    if episode_number == 1:
        assert node.episode_developments[1].synopsis not in prompt
        assert node.unit_story_beats[-1] not in prompt


@pytest.mark.parametrize("chunk_size", [1, 3, 6])
def test_actual_chunk_adapter_receives_only_assigned_story_and_retains_canonical_facts(chunk_size):
    from tests.test_story_planning_service import build_strategy
    node = authored_leaf()
    bible = build_active_lineage_story_bible()
    bible.locked_facts = ["证人当晚不能离开保护范围。"]
    calls = []
    class Adapter:
        def get_model_info(self): return SimpleNamespace(provider="test", model_name="fixed-scope-probe")
        def generate_structured_output_stream(self, prompt, **kwargs):
            calls.append(prompt)
            entries = json.loads(re.search(r"<episode_developments>(.*?)</episode_developments>", prompt, re.S)[1])
            assert [entry['episode_number'] for entry in entries] == list(range(1, chunk_size + 1))
            assert node.synopsis not in prompt
            assert node.unit_story_beats[-1] not in prompt
            assert node.episode_developments[chunk_size].synopsis not in prompt
            assert bible.locked_facts[0] in prompt
            assert "distribute every approved" not in prompt
            assert "既成事实与本次增量" in prompt
            return {"episode_plans": [{**build_active_lineage_episode_item(entry['episode_number']), **entry} for entry in entries]}
    adapter = Adapter()
    service = object.__new__(StoryPlanningService)
    service._long_story_service = None  # This probe exercises the non-rebuild path.
    service._episode_plan_llm_adapter = service._llm_adapter = adapter
    service._episode_plan_chunk_size = chunk_size
    service._episode_plan_context = lambda *args, **kwargs: (node, bible, build_strategy())
    service._knowledge_context = lambda **kwargs: ""
    service._content_spec_for_story_bible = lambda _: SimpleNamespace()
    service._require_active_story_plan_lineage = lambda _: None
    # End the probe at the actual model boundary; scene finishing is covered by
    # the separate complete-first-call tests, not by invented scenes here.
    service._repair_episode_repetition = lambda item, **kwargs: item
    service._complete_episode_scene_execution_plan = lambda item, **kwargs: item
    service._ensure_episode_item_short_drama_fields = lambda item, **kwargs: item
    service._ensure_mainland_planning_language = lambda **kwargs: kwargs['output']
    service._episode_plan_diversity_issues = lambda *args, **kwargs: []
    items = service.generate_episode_plan_chunk(episode_item_request(node))
    assert len(calls) == 1
    assert [item.episode_number for item in items] == list(range(1, chunk_size + 1))


def test_cross_leaf_prompt_preserves_prior_action_missing_from_coarse_exit():
    prior = EpisodePlanGenerationItem.model_validate(build_active_lineage_episode_item(8))
    scene = EpisodeSceneExecutionBeat(
        scene_number=1, scene_heading="INT. 港务室 - 夜", character_refs=["character.mara"],
        scene_objective="依法完成船舶停航。", visible_action="港务员收回唯一通行证并锁上登船闸门。",
        turn_or_reveal="航线许可已被撤销。", dialogue_objective="告知船长停航后须承担的责任。",
        dialogue_line_target=24, shot_target=16, exit_state="登船通道关闭，通行证由港务员保管。",
    )
    prior = prior.model_copy(update={"synopsis": "船长得知航线停航后继续整理事故材料。", "scene_execution_plan": [scene]})
    before = prior.model_dump()
    node = authored_leaf()
    prompt = StoryPlanningService._build_episode_plan_prompt(
        node=node, story_bible=build_active_lineage_story_bible(), start_episode=9, end_episode=16,
        knowledge_context="", predecessor_plan=prior,
    )
    assert scene.visible_action not in prior.exit_state
    assert scene.visible_action in prompt
    assert scene.exit_state in prompt
    assert prior.synopsis in prompt
    assert "逐字保留来源不要求把其中已发生的动作重新当成首次完成" in prompt
    assert prior.model_dump() == before


def test_whole_rewrite_uses_first_generation_inputs_without_defective_draft_claims():
    from app.modules.script_engine.long_story_models import StoryBibleSelectionContext
    node = authored_leaf()
    stale = "旧稿虚构出一条此前从未出现的备用通路，并将它关闭。"
    current = EpisodePlanGenerationItem.model_validate(build_active_lineage_episode_item(2)).model_copy(update={
        "synopsis": stale, "reveal": stale, "pressure_escalation": stale,
    })
    prompt = StoryPlanningService._build_episode_plan_item_modification_prompt(
        node=node, story_bible=build_active_lineage_story_bible(), current_plan=current,
        accepted_plans=[], predecessor_plan=None, instruction="请整体修订本集。",
        revision_mode="targeted", selection_context=StoryBibleSelectionContext(source_field="第2集梗概", selected_text=stale), knowledge_context="",
    )
    assert "SINGLE EPISODE ROADMAP CONTRACT" in prompt
    assert "WHOLE EPISODE REVISION FROM APPROVED INPUTS" in prompt
    assert stale not in prompt
    assert node.episode_developments[1].synopsis in prompt
    assert node.episode_developments[2].synopsis not in prompt
    assert '"episode_number":2' in prompt


def test_whole_rewrite_retains_only_explicitly_requested_old_details():
    from app.modules.script_engine.story_planning_service import _explicit_episode_retention
    current = EpisodePlanGenerationItem.model_validate(build_active_lineage_episode_item()).model_copy(update={"episode_title": "保留的标题"})
    retained = _explicit_episode_retention(current, "请整体重写本集。保留标题和预算，不保留旧梗概。")
    assert retained == {"episode_title": current.episode_title, "target_duration_seconds": current.target_duration_seconds,
                        "planned_shot_count": current.planned_shot_count, "planned_dialogue_line_count": current.planned_dialogue_line_count}


@pytest.mark.parametrize("path", ["chunk", "single", "revision"])
def test_oldest_in_leaf_actual_action_survives_prefix_compaction(path):
    node = authored_leaf()
    prefix = [EpisodePlanGenerationItem.model_validate({**build_active_lineage_episode_item(n), **node.episode_developments[n-1].model_dump()}) for n in range(1, 8)]
    first = prefix[0]
    action = "保管员收走原件的唯一钥匙，现场封住取件口。"
    first.scene_execution_plan = [EpisodeSceneExecutionBeat(
        scene_number=1, scene_heading="INT. 保管室 - 日", character_refs=["character.mara"],
        scene_objective="完成现有原件封存。", visible_action=action, turn_or_reveal="现有取件通路封闭。",
        dialogue_objective="确认后续查阅须申请复核。", dialogue_line_target=24, shot_target=16,
        exit_state="钥匙已收回，取件口封闭。",
    )]
    common = dict(node=node, story_bible=build_active_lineage_story_bible(), accepted_plans=prefix, predecessor_plan=None, knowledge_context="")
    if path == "chunk":
        prompt = StoryPlanningService._build_segmented_episode_roadmap_prompt(
            contract_prompt=StoryPlanningService._build_episode_plan_prompt(
                node=node, story_bible=common['story_bible'], start_episode=1, end_episode=8, knowledge_context=""),
            all_episode_numbers=list(range(1,9)), current_episode_numbers=[8], accepted_plans=prefix,
        )
    elif path == "single":
        prompt = StoryPlanningService._build_episode_plan_item_prompt(**common, episode_number=8)
    else:
        prompt = StoryPlanningService._build_episode_plan_item_modification_prompt(
            **common, current_plan=EpisodePlanGenerationItem.model_validate(build_active_lineage_episode_item(8)),
            instruction="核对本集行动因果", revision_mode="targeted", selection_context=None,
        )
    assert action in prompt
    assert "不能复位再演" in prompt
    assert "不能临时虚构剩余通路制造升级" in prompt


def test_technical_root_placeholder_does_not_override_an_authored_opening():
    from app.modules.script_engine.story_decomposition_contracts import TECHNICAL_STORY_ROOT_MARKER, validate_decomposition_ranges
    from tests.test_story_planning_service import build_active_lineage_decomposition_output
    parent=build_active_lineage_story_node(node_id="node.root",version=1,start_episode=1,end_episode=16,expansion_status=StoryPlanExpansionStatus.expanded)
    output=build_active_lineage_decomposition_output(parent)
    output.children[0].entry_state="主角在夜班结束时发现了来源不明的旧账本。"
    with pytest.raises(StoryPlanningInputError,match="first child entry_state"):
        validate_decomposition_ranges(output.children,parent=parent,max_episode_ready_span=12)
    parent=parent.model_copy(update={"decomposition_reason":TECHNICAL_STORY_ROOT_MARKER})
    validate_decomposition_ranges(output.children,parent=parent,max_episode_ready_span=12)
    assert output.children[0].entry_state=="主角在夜班结束时发现了来源不明的旧账本。"


def test_new_event_contract_rejects_competing_accounts_without_rewriting_legacy_nodes():
    node = authored_leaf()
    before = node.model_dump()
    validate_episode_developments(node, required=True)
    with pytest.raises(StoryPlanningInputError, match="转折必须逐字选自本节点事件表"):
        validate_episode_developments(node, required=True, require_canonical_events=True)
    assert node.model_dump() == before


def test_same_event_cannot_be_assigned_twice_through_different_source_arrays():
    node = authored_leaf()
    event = node.unit_story_beats[0]
    entries = [entry.model_copy(update={"source_turning_points": [event] if entry.episode_number == 1 else []}) for entry in node.episode_developments]
    node = node.model_copy(update={"turning_points": [event], "episode_developments": entries})
    validate_episode_developments(node, required=True, require_canonical_events=True)
    entries[0] = entries[0].model_copy(update={"source_turning_points": []})
    entries[2] = entries[2].model_copy(update={"source_turning_points": [event]})
    node = node.model_copy(update={"episode_developments": entries})
    before = node.model_dump()
    with pytest.raises(StoryPlanningInputError, match="必须属于同一集"):
        validate_episode_developments(node, required=True, require_canonical_events=True)
    assert node.model_dump() == before
