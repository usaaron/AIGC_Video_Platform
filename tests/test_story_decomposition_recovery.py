from types import SimpleNamespace

import pytest

from app.modules.script_engine.long_story_models import StoryPlanNodeChildOutput
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_planning_service import StoryPlanningService, StoryPlanningTransientOutputError


def recovery_example():
    parent = SimpleNamespace(
        node_id="node.recovery", planned_start_episode=1, planned_end_episode=32,
        entry_state="姐弟仍各自照护母亲，尚未形成共同安排。",
        exit_state="姐弟完成一个月轮流照护，母亲同意保留各自生活。",
        turning_points=["弟弟独自完成复诊陪护。", "姐姐承认自己也需要休息。"],
        synopsis="姐弟从分工试行到实际承担一个月照护。",
        decomposition_reason="按人物关系发展继续细化。",
    )
    middle = "姐弟已经谈妥照护分工，尚待实际履行。"
    raw = []
    for index, (start, end, entry, exit_, title, synopsis, turns) in enumerate([
        (1, 8, parent.entry_state, middle, "商量分工", "姐弟核对生活安排并当面说明各自限制，最终确定可试行的分工。", []),
        (9, 32, middle, parent.exit_state, "履行照护与调整信任", "弟弟承担复诊陪护和连续接送，姐姐克服反复查问的习惯；两人解决数次现实时间冲突，逐步建立能够持续的照护安排。", parent.turning_points),
    ]):
        raw.append(dict(
            title=title, narrative_purpose=title + "并形成可持续的人物关系变化。",
            synopsis=synopsis, entry_state=entry, exit_state=exit_,
            central_conflict=["两人的时间安排与母亲需要难以匹配。", "姐姐难以交出控制，弟弟须履行已经答应的照护责任。"][index],
            turning_points=turns or ["姐弟首次形成共同轮班安排。"],
            emotional_direction="从各自承担到愿意合作并保留差异。",
            unit_story_beats=[f"第{index + 1}段核对实际生活条件。", f"第{index + 1}段面对新的责任冲突。", f"第{index + 1}段通过分工行动承担结果。", exit_],
            unit_resolution=exit_, handoff_pressure="共同生活保留可协商的现实余波。",
            character_refs=["character.sister"], story_line_refs=["line.family"], setup_refs=[], payoff_refs=[],
            estimated_episode_count=end-start+1, estimated_script_body_characters=1000*(index+1),
            planned_start_episode=start, planned_end_episode=end,
            decomposition_reason="按独立行动和关系变化支持当前范围。",
            recommended_next_step="episode_ready" if index == 0 else "expand",
        ))
    bible = SimpleNamespace(character_refs=["character.sister"], story_lines=[SimpleNamespace(story_line_id="line.family")],
                            locked_facts=["父亲已经去世，不会突然复生。"], world_rules=["普通现实家庭，没有魔法或阴谋。"])
    strategy = SimpleNamespace(max_tokens=6000)
    strategy.model_copy = lambda **_kwargs: strategy
    return parent, bible, strategy, raw


def test_recovery_preserves_uneven_narrative_ranges_and_event_ownership():
    parent, bible, strategy, raw = recovery_example()
    service = object.__new__(StoryPlanningService)
    def forbid_generation(**_kwargs):
        raise AssertionError("The complete recovered narrative must not be repartitioned or regenerated.")
    service._generate_planning_output = forbid_generation
    output = service._generate_segmented_decomposition_recovery(
        original_prompt="original contract", strategy=strategy, parent=parent,
        story_bible=bible, requested_child_count=2, max_episode_ready_span=12, source_children=raw,
    )
    assert [(item.planned_start_episode, item.planned_end_episode) for item in output.children] == [(1, 8), (9, 32)]
    assert output.children[0].turning_points == raw[0]["turning_points"]
    assert output.children[1].turning_points == parent.turning_points
    assert [item.synopsis for item in output.children] == [item["synopsis"] for item in raw]


def test_recovery_child_failure_keeps_canonical_facts_and_never_manufactures_a_node():
    parent, bible, strategy, raw = recovery_example()
    # Narrative partition survived, but dependent child fields did not.
    partial = [{key: child[key] for key in ("title", "synopsis", "entry_state", "exit_state", "turning_points", "planned_start_episode", "planned_end_episode")} for child in raw]
    service = object.__new__(StoryPlanningService)
    prompts = []
    def fail_child(**kwargs):
        assert kwargs["output_model"] is StoryPlanNodeChildOutput
        prompts.append(kwargs["prompt"])
        raise StoryPlanningInputError("provider output incomplete")
    service._generate_planning_output = fail_child
    with pytest.raises(StoryPlanningTransientOutputError, match="本轮未保存或批准"):
        service._generate_segmented_decomposition_recovery(
            original_prompt="original contract", strategy=strategy, parent=parent,
            story_bible=bible, requested_child_count=2, max_episode_ready_span=12, source_children=partial,
        )
    assert len(prompts) == 2
    assert "FINAL SEGMENTED CHILD TRANSPORT RETRY" in prompts[-1]
    assert bible.locked_facts[0] in prompts[-1]
    assert bible.world_rules[0] in prompts[-1]
