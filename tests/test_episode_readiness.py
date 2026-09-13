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
