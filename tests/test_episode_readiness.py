from types import SimpleNamespace

from app.modules.script_engine.episode_readiness import episode_execution_readiness_issues


def quiet_episode_plan():
    return SimpleNamespace(
        execution_ready=True,
        planned_scene_count=1,
        dramatic_units=[],
        protagonist_cost=None,
        scene_execution_plan=[SimpleNamespace(
            scene_number=1,
            scene_objective="女儿陪父亲收拾旧物。",
            opposition="父亲不愿谈论过去。",
            information_shift="观众从保存完好的票根理解父亲的牵挂。",
            choice_or_cost="女儿把追问收回，留下陪伴。",
            evidence_requirements=["父亲抚平票根后递给女儿，女儿坐回他身旁。"],
            visible_action="父亲抚平旧票根，女儿搬来椅子。",
            turn_or_reveal="沉默中的递交使观众重新理解此前的疏离。",
            dialogue_objective="以简短回应接住父亲的试探。",
            exit_state="两人继续并肩整理旧物。",
        )],
    )


def test_quiet_episode_with_complete_evidence_needs_no_new_cost_or_dramatic_unit():
    assert episode_execution_readiness_issues(quiet_episode_plan()) == []


def test_quiet_episode_still_needs_scene_evidence_and_explicit_readiness():
    plan = quiet_episode_plan()
    plan.execution_ready = False
    plan.scene_execution_plan[0].evidence_requirements = []
    assert episode_execution_readiness_issues(plan) == [
        "execution_ready_false",
        "scene_execution_plan.1.evidence_requirements_missing",
    ]


def test_complete_cloned_scene_is_rejected_but_changed_outcome_is_valid():
    plan = quiet_episode_plan()
    first = plan.scene_execution_plan[0]
    plan.planned_scene_count = 2
    second = SimpleNamespace(**{**vars(first), "scene_number": 2})
    plan.scene_execution_plan.append(second)
    assert episode_execution_readiness_issues(plan) == [
        "scene_execution_plan.duplicate_scene_beat",
    ]
    second.exit_state = "女儿独自留下，决定把票根交给失散的亲人。"
    assert episode_execution_readiness_issues(plan) == []


def test_production_evidence_todo_is_not_execution_ready_but_story_uncertainty_is_valid():
    plan = quiet_episode_plan()
    plan.scene_execution_plan[0].evidence_requirements = ["用动作表达疏离；具体动作与触发话题待定，该缺口影响对白落点。"]
    assert episode_execution_readiness_issues(plan) == ["scene_execution_plan.1.evidence_requirements_unresolved"]
    plan.scene_execution_plan[0].evidence_requirements = ["父亲说还不知道是否离开，女儿把车票放回抽屉；两人暂不决定。"]
    assert episode_execution_readiness_issues(plan) == []
    plan.scene_execution_plan[0].evidence_requirements = ["她答复具体日期待定，父亲没有追问。"]
    assert episode_execution_readiness_issues(plan) == []
    plan.scene_execution_plan[0].visible_action = "两人交换物件，具体操作待定，只锁定交付的先后因果。"
    assert episode_execution_readiness_issues(plan) == ["scene_execution_plan.1.visible_action_unresolved"]
