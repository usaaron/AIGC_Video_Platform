from types import SimpleNamespace

import pytest

from app.modules.script_engine.episode_layer_contracts import (
    EpisodeHookCategory,
    classify_episode_hook,
    compile_episode_three_layer_contract,
)
from app.modules.script_engine.models import ApprovedEpisodePlanContext


def episode_plan() -> SimpleNamespace:
    return SimpleNamespace(
        episode_number=12,
        target_duration_seconds=90,
        planned_scene_count=2,
        planned_shot_count=18,
        planned_dialogue_line_count=30,
        episode_goal="主角必须在封锁前拿到原始账本。",
        entry_state="主角只持有一份无法核验的账本副本。",
        central_conflict="对手封锁档案并追查提供副本的证人。",
        protagonist_decision="主角决定先救出证人，再公开账本。",
        reveal="证人指出账本上的授权签名来自主角盟友。",
        emotional_movement="从急于公开转为克制取证。",
        stage_opposition="对手同时销毁凭证并封锁出口。",
        episode_payoff="主角救出证人并固定原始账本的时间戳。",
        pressure_escalation="原始账本将嫌疑指向主角最信任的盟友。",
        setup_refs=["setup.ledger"],
        payoff_refs=[],
        exit_state="主角带着证人和原始账本离开封锁区。",
        cliffhanger="盟友亲自出现，要求主角立刻交出原始账本。",
        character_refs=["character.lead", "character.ally"],
        story_line_refs=["storyline.ledger"],
        continuity_requirements=["盟友此前一直帮助主角。"],
        source_turning_points=["主角发现授权签名。"],
        source_unit_story_beats=["救出证人并取得原始账本。"],
        ending_hook_type="关系压力",
        next_episode_obligation="下一集必须处理盟友索要账本的直接对峙。",
        hook_payoff_target_episode=13,
        scene_execution_plan=[
            SimpleNamespace(turn_or_reveal="证人指出账本上的授权签名来自主角盟友。"),
            SimpleNamespace(turn_or_reveal="盟友亲自出现，要求主角立刻交出原始账本。"),
        ],
    )


def test_three_layer_contract_compiles_density_hook_and_story_chain_locally() -> None:
    contract = compile_episode_three_layer_contract(episode_plan())

    assert contract.schema_version == "episode_three_layer_contract.v1"
    assert contract.pacing.average_shot_interval_seconds == 5
    assert contract.pacing.dialogue_lines_per_minute == 20
    assert contract.pacing.information_progression_count >= 5
    assert contract.pacing.meets_contract is True
    assert contract.hook.category == EpisodeHookCategory.relationship_shift
    assert contract.hook.ending_hook_count == 1
    assert contract.hook.planned_hook_beat_count >= 3
    assert contract.hook.has_next_episode_obligation is True
    assert contract.story.causal_step_count == 5
    assert contract.story.causal_chain_complete is True
    assert contract.story.continuity_anchor_count == 4
    assert contract.meets_contract is True


@pytest.mark.parametrize(
    ("label", "cliffhanger", "expected"),
    [
        ("爽点钩子", "主角当众夺回公司控制权。", EpisodeHookCategory.payoff_escalation),
        ("信息反转", "真正签署合同的人竟是受害者。", EpisodeHookCategory.reversal),
        ("抉择悬念", "主角只能在证人和证据之间选一个。", EpisodeHookCategory.forced_choice),
        ("倒计时", "账户将在十分钟后清零。", EpisodeHookCategory.countdown),
        ("疑问悬念", "门后的人究竟是谁？", EpisodeHookCategory.question),
        ("关系压力", "盟友说出了隐藏的真相。", EpisodeHookCategory.relationship_shift),
    ],
)
def test_hook_category_is_bounded_to_product_categories(
    label: str,
    cliffhanger: str,
    expected: EpisodeHookCategory,
) -> None:
    assert classify_episode_hook(label, cliffhanger) == expected


def test_approved_episode_plan_recompiles_stale_layer_contract() -> None:
    source = episode_plan()
    payload = vars(source) | {
        "scene_execution_plan": [
            {
                "scene_number": 1,
                "scene_heading": "INT. 档案室 日",
                "character_refs": source.character_refs,
                "scene_objective": "救出证人。",
                "visible_action": "主角切断门锁电源并带证人撤离。",
                "turn_or_reveal": source.reveal,
                "dialogue_objective": "确认原始账本的位置。",
                "dialogue_line_target": 15,
                "shot_target": 9,
                "exit_state": "主角拿到原始账本。",
            },
            {
                "scene_number": 2,
                "scene_heading": "EXT. 封锁区出口 日",
                "character_refs": source.character_refs,
                "scene_objective": "带证据离开封锁区。",
                "visible_action": "主角掩护证人穿过封锁线。",
                "turn_or_reveal": source.cliffhanger,
                "dialogue_objective": "逼盟友说明索要账本的原因。",
                "dialogue_line_target": 15,
                "shot_target": 9,
                "exit_state": source.exit_state,
            },
        ],
        "layer_contracts": None,
    }

    approved = ApprovedEpisodePlanContext.model_validate(payload)

    assert approved.layer_contracts is not None
    assert approved.layer_contracts.meets_contract is True
    assert approved.layer_contracts.pacing.shot_count == 18
