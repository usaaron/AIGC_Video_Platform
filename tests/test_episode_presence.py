from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.modules.script_engine.episode_presence import episode_scene_presence_issues
from app.modules.script_engine.episode_readiness import episode_execution_readiness_issues
from app.modules.script_engine.episode_plan_contracts import validate_episode_plan_prefix
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.long_story_models import StoryPlanExpansionStatus
from tests.test_episode_readiness import quiet_episode_plan
from tests.test_episode_plan_contracts import episode
from tests.test_story_planning_service import build_active_lineage_story_bible, build_active_lineage_story_node


NAMES = {"character.lin": "林知微", "character.elder": "独居老人"}


def plan(rule, *, scene_rule=False, action="知微把样本交给核验人员。", refs=None):
    return SimpleNamespace(
        continuity_requirements=[] if scene_rule else [rule],
        scene_execution_plan=[SimpleNamespace(
            scene_number=3, scene_heading="EXT. 救助窗口 - 白天",
            character_refs=refs or ["character.lin", "character.elder"],
            forbidden_changes=[rule] if scene_rule else [],
            visible_action=action, evidence_requirements=["核验人员查看样本。"],
        )],
    )


@pytest.mark.parametrize("rule,scene_rule", [
    ("本集独居老人不得到场。", False),
    ("老人本场全程未到场。", True),
    ("本场老人不在场。", True),
    ("本集不得让老人本人出现在现场。", False),
    ("独居老人本人不得到场。", True),
    ("老人仅被提及。", True),
    ("老人下落未明，本场老人不在场。", True),
    ("本集character.elder不得出场。", False),
])
def test_explicit_current_presence_restrictions_block_only_the_named_scene_ref(rule, scene_rule):
    source = plan(rule, scene_rule=scene_rule)
    before = deepcopy(source)
    assert episode_scene_presence_issues(source, character_names=NAMES) == [
        "scene_execution_plan.3.scene_presence_conflict:character.elder"
    ]
    assert source == before


@pytest.mark.parametrize("rule", [
    "老人下落未明，本集不得写成已找到老人下落。",
    "本场开始时老人未到场，稍后抵达。",
    "老人仍未到场。",
    "本集不得写成老人未到场。",
    "本集不得让老人到场前就回应。",
    "如果本集老人不得到场。",
    "如果知微未能脱身，本集老人不得到场。",
    "若知微失联，本集老人不得到场。",
    "顾岚谎称：“规则是，本集老人不得到场，其实并无此规则。”",
    "上集老人不得到场。",
    "第17集老人不得到场。",
    "顾岚声称‘本集老人不得到场’。",
    "未找到老人下落的知微本场不在场。",
])
def test_knowledge_start_states_historical_conditional_and_negated_claims_are_not_absence_bans(rule):
    assert episode_scene_presence_issues(plan(rule), character_names=NAMES) == []


def test_unknown_whereabouts_allows_parallel_scene_visible_only_to_audience():
    source = plan(
        "老人下落未明，本集不得写成已找到老人下落。",
        action="老人独自在隐蔽房间折好一张纸。", refs=["character.elder"],
    )
    assert episode_scene_presence_issues(source, character_names=NAMES) == []


@pytest.mark.parametrize("action", [
    "知微播放老人的录音。", "知微展示老人的照片。", "知微翻看老人的档案。",
    "知微观看独居老人的录像。", "老人仅通过录音出现。", "老人只在回忆画面出现。",
    "知微与老人电话通话。", "老人通过视频回应。",
    "知微播放老人的录音但不能确定录制地点。",
    "知微没有亲临现场而是播放老人的录音。",
    "知微播放老人的录像，老人现身并把纸条塞进门缝，画面随即定格。",
])
def test_explicit_same_identity_mediated_appearances_are_allowed(action):
    source = plan("本场老人不得到场。", scene_rule=True, action=action)
    assert episode_scene_presence_issues(source, character_names=NAMES) == []


def test_flashback_heading_is_local_to_that_scene():
    source = plan("本集老人不得到场。", action="老人把回执放在桌面。")
    source.scene_execution_plan[0].scene_heading += "（FLASHBACK）"
    second = deepcopy(source.scene_execution_plan[0])
    second.scene_number = 4
    second.scene_heading = "EXT. 救助窗口 - 日"
    source.scene_execution_plan.append(second)
    assert episode_scene_presence_issues(source, character_names=NAMES) == [
        "scene_execution_plan.4.scene_presence_conflict:character.elder"
    ]


@pytest.mark.parametrize("action", [
    "知微播放顾岚的录音。", "知微没有播放老人的录音。",
    "知微不能继续播放老人的录音。",
])
def test_unrelated_or_negated_media_does_not_exempt_roster(action):
    assert episode_scene_presence_issues(plan("本场老人不得到场。", scene_rule=True, action=action), character_names=NAMES)


def test_ambiguous_registered_name_or_suffix_never_assigns_absence_to_one_identity():
    source = plan("本集知微不得到场。")
    assert episode_scene_presence_issues(source, character_names={**NAMES, "character.other": "沈知微"}) == []
    names = {**NAMES, "character.other": "林知微"}
    assert episode_scene_presence_issues(plan("本集林知微不得到场。"), character_names=names) == []


def test_identity_tokens_do_not_match_larger_names_or_translate_technical_ids():
    for rule, names in [
        ("本集Anna不得到场。", {"character.lin": "Ann"}),
        ("本集character.alice不得到场。", {"character.lin": "Ann"}),
        ("本集老人不得到场。", {}),
    ]:
        assert episode_scene_presence_issues(plan(rule, refs=["character.a", "character.lin"]), character_names=names) == []


def test_history_and_entry_state_never_create_absence_restrictions():
    source = plan("")
    source.entry_state = "本场老人不得到场。"
    source.character_states = [{"character_ref": "character.elder", "life_status": "missing", "location": "旧城街口"}]
    assert episode_scene_presence_issues(source, character_names=NAMES) == []


def test_unbound_scene_scope_in_episode_rules_does_not_apply_to_every_scene():
    assert episode_scene_presence_issues(plan("本场老人不得到场。"), character_names=NAMES) == []


def test_readiness_handoff_rejects_literal_ref_conflict_without_registry_or_model_call():
    source = quiet_episode_plan()
    source.continuity_requirements = ["本集character.elder不得到场。"]
    source.scene_execution_plan[0].character_refs = ["character.elder"]
    assert episode_execution_readiness_issues(source) == [
        "scene_execution_plan.1.scene_presence_conflict:character.elder"
    ]


def test_planning_prefix_resolves_registered_names_before_acceptance_without_changing_plan():
    bible = build_active_lineage_story_bible()
    ref = bible.character_refs[0]
    bible.character_registry = [SimpleNamespace(character_ref=ref, name="林知微")]
    node = build_active_lineage_story_node(
        node_id="story_plan.presence.leaf", version=1, start_episode=9, end_episode=16,
        expansion_status=StoryPlanExpansionStatus.episode_ready,
    )
    source = episode(9, continuity_requirements=["本集知微不得到场。"], scene_execution_plan=[
        SimpleNamespace(scene_number=1, character_refs=[ref], scene_heading="INT. 档案室 - 日", visible_action="管理员展示文件。", evidence_requirements=[]),
    ])
    before = deepcopy(source)
    with pytest.raises(StoryPlanningInputError, match="scene_presence_conflict"):
        validate_episode_plan_prefix([source], node=node, story_bible=bible, require_complete=False)
    assert source == before
