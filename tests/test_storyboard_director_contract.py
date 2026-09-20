"""Production contracts stay source-grounded through editing and candidate history."""
import copy
import json

import pytest
from app.modules.preproduction.models import ActingDirection, SceneProductionContract, SceneProposal
from app.modules.preproduction.repository import StoryboardConflictError
from app.modules.preproduction.service import StoryboardService
from tests.test_preproduction import PROJECT, SOURCE, edit_request, generated, storyboard


def contract(marker="现版"):
    return SceneProductionContract(
        lighting=f"{marker}：门外的冷光从侧后方进入，门内保留暗部细节。",
        visual_style=f"{marker}：真实布料与门框的磨损纹理。",
        composition=f"{marker}：门框作前景，局部特写按需要裁切。",
        axis=f"{marker}：所有机位位于门口两人的关系轴同一侧。",
        optics=f"{marker}：对角视场角 60°，摄影机距主要人物 2 米。",
        continuity=f"{marker}：钥匙持续在林岚左手；关门发生在周宁通过之后。",
        sound=f"{marker}：门声之后出现敲击，环境声在对白时降低。",
        reference_rules=f"{marker}：当前只有正文人物资料；参考图待绑定核对。",
    )


def proposal_from(adapter):
    return adapter.generate_structured_output_stream(
        "scene", strategy=type("Strategy", (), {"max_tokens": 12000})(), output_schema={"source_refs": {}},
    )


def test_legacy_scene_remains_readable_without_creative_backfill(storyboard):
    service, adapter, _, _ = storyboard
    proposal = SceneProposal.model_validate(proposal_from(adapter))
    assert proposal.design.production_contract is None
    assert proposal.shots[0].handoff == proposal.shots[0].optics == ""
    plan = generated(service)
    assert plan.scenes[0].design.production_contract is None
    assert plan.source_draft == SOURCE
    assert "参考图" in plan.scenes[0].shots[0].prompt
    assert "100%" not in plan.scenes[0].shots[0].prompt


def test_shared_settings_are_complete_per_shot_and_optics_override_has_one_value(storyboard):
    service, _, _, _ = storyboard
    old = generated(service)
    request = edit_request(old)
    scene = request.scenes[0]
    scene.design.production_contract = contract()
    first = scene.shots[0]
    first.source_refs = SOURCE["scenes"][0]["body_order"][:2]
    first.handoff = "承接门即将合上的起始状态，先让同伴通过。"
    second = first.model_copy(deep=True, update={
        "shot_id": "shot.contract.second",
        "source_refs": SOURCE["scenes"][0]["body_order"][2:],
        "handoff": "承接同伴开始跨过门槛的动作，不重演开门。",
        "optics": "本镜例外：对角视场角 40°，机距 3 米，用于压住门后空间。",
    })
    scene.shots.append(second)
    accepted = service.edit(PROJECT, 1, request)
    shared = scene.design.production_contract
    for shot in accepted.scenes[0].shots:
        assert shot.prompt_plan.lighting == shared.lighting
        assert shot.handoff in shot.prompt
        assert f"镜尾状态\n{shot.continuity_out}" in shot.prompt
        assert scene.design.transition in shot.prompt
        for field in ("visual_style", "composition", "axis", "continuity", "sound", "reference_rules"):
            assert getattr(shared, field) in shot.prompt
        assert "同一" in shot.prompt and "不重新从句首配音" in shot.prompt
        assert "中文对照仅供阅读，不入画、不配音" in shot.prompt
    assert accepted.scenes[0].shots[0].prompt_plan.optics == shared.optics
    assert accepted.scenes[0].shots[1].prompt_plan.optics == second.optics
    assert shared.optics not in accepted.scenes[0].shots[1].prompt
    assert "替代全场默认" in accepted.scenes[0].shots[1].prompt
    assert [ref for shot in accepted.scenes[0].shots for ref in shot.source_refs] == SOURCE["scenes"][0]["body_order"]
    assert accepted.source_draft == SOURCE
    assert service.require(PROJECT, 1, revision=old.revision) == old


def test_source_voice_profiles_are_read_only_and_only_for_actual_speakers(storyboard):
    service, _, _, _ = storyboard
    source = copy.deepcopy(SOURCE)
    source["scenes"][0]["dialogues"][0].update({
        "character_name": "Lina", "chinese_character_name": "林岚",
        "text": "Go inside first.", "chinese_translation": "先进去。",
    })
    source["characters"] = [
        {"name": "林岚", "role": "主角", "description": "为了保护同伴而留在门边的年轻调查员。", "motivation": "确保同伴能够安全通过门口。",
         "acting_profile": {"voice": "声音清晰，语速短促。", "permanentVoicePrompt": "压力下压低句尾。拒绝｜EN: Not now.｜中译: 现在不行。"}},
        {"name": "张伟", "role": "场外同伴", "description": "还在门外远处街道查找证据的调查员。", "motivation": "先找到出口的道路。",
         "acting_profile": {"voice": "不应进入本镜的声音档案"}},
    ]
    before = copy.deepcopy(source)
    plan = service.start(PROJECT, 1, source, 0)
    plan = service.generate_scene(PROJECT, 1, 1, plan.revision, "")
    prompt = plan.scenes[0].shots[0].prompt
    assert "声音清晰，语速短促。" in prompt and "压力下压低句尾。" in prompt
    assert "不应进入本镜的声音档案" not in prompt
    assert "例句仅说明表达方式，不是待配音台词" in prompt
    assert "不补造年龄、口音或声线" in prompt
    assert "听者不动嘴" in prompt
    assert "Lina: Go inside first." in prompt
    assert "中文对照（仅阅读，不入画、不配音）：先进去。" in prompt
    assert plan.source_draft == source == before


@pytest.mark.parametrize("field", ["production_contract", "spatial_layout", "transition"])
def test_scene_settings_cannot_bypass_locked_shots_even_in_unlock_request(storyboard, field):
    service, _, _, _ = storyboard
    plan = generated(service)
    request = edit_request(plan)
    request.scenes[0].design.production_contract = contract()
    request.scenes[0].shots[0].locked = True
    locked = service.edit(PROJECT, 1, request)
    edit = edit_request(locked)
    edit.scenes[0].shots[0].locked = False
    setattr(edit.scenes[0].design, field, contract("修改") if field == "production_contract" else "修改后的内容")
    with pytest.raises(StoryboardConflictError, match="解锁"):
        service.edit(PROJECT, 1, edit)
    assert service.require(PROJECT, 1) == locked
    unlock = edit_request(locked)
    unlock.scenes[0].shots[0].locked = False
    unlocked = service.edit(PROJECT, 1, unlock)
    edit.expected_revision = unlocked.revision
    result = service.edit(PROJECT, 1, edit)
    assert getattr(result.scenes[0].design, field) == getattr(edit.scenes[0].design, field)


def test_candidate_and_stale_history_compile_their_own_contracts(storyboard):
    service, adapter, runtime, _, = storyboard
    plan = generated(service)
    request = edit_request(plan)
    request.scenes[0].design.production_contract = contract("旧版")
    original = service.edit(PROJECT, 1, request)
    changed_source = copy.deepcopy(SOURCE)
    changed_source["scenes"][0]["dialogues"][0]["text"] = "快过来。"
    stale = service.start(PROJECT, 1, changed_source, original.revision)
    assert stale.scenes == original.scenes
    proposal = proposal_from(adapter)
    proposal["design"]["production_contract"] = contract("新版").model_dump()
    adapter.generate_structured_output_stream = lambda *args, **kwargs: proposal
    proposed = service.generate_scene(PROJECT, 1, 1, stale.revision, "")
    assert proposed.candidate.design.production_contract == contract("新版")
    assert "新版" in proposed.candidate.shots[0].prompt and "旧版" not in proposed.candidate.shots[0].prompt
    assert "快过来。" in proposed.candidate.shots[0].dialogue[0]
    assert proposed.scenes == original.scenes
    rejected = service.edit(PROJECT, 1, edit_request(proposed, candidate_action="reject"))
    assert rejected.scenes == original.scenes and rejected.stale_scene_numbers == [1]
    proposed = service.generate_scene(PROJECT, 1, 1, rejected.revision, "")
    accepted = service.edit(PROJECT, 1, edit_request(proposed, candidate_action="accept"))
    assert accepted.scenes[0] == proposed.candidate
    assert accepted.stale_scene_numbers == []
    restarted = StoryboardService(service.repository, lambda: adapter)
    assert restarted.require(PROJECT, 1) == accepted
    assert restarted.require(PROJECT, 1, revision=original.revision) == original


def test_long_valid_contract_fields_compile_without_loss(storyboard):
    service, _, _, _ = storyboard
    plan = generated(service)
    request = edit_request(plan)
    shared = contract()
    shared.lighting = "光" * 1200
    shared.optics = "镜" * 800
    request.scenes[0].design.production_contract = shared
    request.scenes[0].shots[0].continuity_in = "首" * 1000
    request.scenes[0].shots[0].continuity_out = "尾" * 1000
    result = service.edit(PROJECT, 1, request)
    shot = result.scenes[0].shots[0]
    assert shot.prompt_plan.lighting == shared.lighting
    assert shot.prompt_plan.optics == shared.optics
    assert shared.lighting in shot.prompt and shared.optics in shot.prompt
    assert shot.continuity_in in shot.prompt and shot.continuity_out in shot.prompt


def test_optional_nested_contract_repairs_only_invalid_field(storyboard):
    service, adapter, _, _ = storyboard
    proposal = proposal_from(adapter)
    proposal["design"]["production_contract"] = contract().model_dump()
    proposal["design"]["production_contract"]["lighting"] = "过长" * 610
    proposal["shots"][0]["handoff"] = "起始依据是原文已建立的门口状态。"
    original = copy.deepcopy(proposal)

    class RepairAdapter:
        calls = 0

        def generate_structured_output_stream(self, prompt, *, strategy, output_schema):
            self.calls += 1
            if self.calls == 1:
                return proposal
            repair = output_schema["properties"]["repairs"]["items"]["oneOf"][0]
            assert repair["properties"]["path"]["const"] == ["design", "production_contract", "lighting"]
            assert repair["properties"]["value"]["maxLength"] == 1200
            return {"repairs": [{"path": ["design", "production_contract", "lighting"], "value": contract().lighting}]}

    repair_adapter = RepairAdapter()
    service.adapter_factory = lambda: repair_adapter
    plan = service.start(PROJECT, 1, SOURCE, 0)
    result = service.generate_scene(PROJECT, 1, 1, plan.revision, "")
    assert result.scenes[0].design.production_contract == contract()
    assert result.scenes[0].shots[0].handoff == original["shots"][0]["handoff"]
    assert result.scenes[0].shots[0].source_refs == original["shots"][0]["source_refs"]
    assert proposal == original and repair_adapter.calls == 2


def test_generation_contract_requires_executable_source_grounded_design(storyboard):
    service, adapter, _, _ = storyboard
    plan = generated(service)
    prompt = adapter.last_prompt
    for rule in ("场景制作约定 + 逐镜执行稿", "shot.optics 留空表示继承全场光学", "同一句跨镜", "不新增 audio 引用",
                 "不擅自换手", "后镜才发生", "作者明确要求的其他转场", "正文原本为中文则按中文原句配音"):
        assert rule in prompt
    assert "84°" not in prompt and "血月" not in prompt
    context = json.loads(prompt.splitlines()[-1])
    assert context["ordered_source_refs"] == SOURCE["scenes"][0]["body_order"]
    assert plan.source_draft == SOURCE


@pytest.mark.parametrize("shared_contract", [None, SceneProductionContract()])
def test_long_author_direction_survives_generation_edit_and_candidate_without_becoming_lighting(storyboard, shared_contract):
    service, adapter, _, _ = storyboard
    proposal = proposal_from(adapter)
    proposal["design"]["production_contract"] = shared_contract.model_dump() if shared_contract else None
    adapter.generate_structured_output_stream = lambda *args, **kwargs: copy.deepcopy(proposal)
    plan = service.start(PROJECT, 1, SOURCE, 0)
    request = edit_request(plan)
    request.visual_direction = "作者拍摄要求须完整保留。" * 300
    assert 1200 < len(request.visual_direction) <= 4000
    plan = service.edit(PROJECT, 1, request)
    generated_plan = service.generate_scene(PROJECT, 1, 1, plan.revision, "")
    generated_shot = generated_plan.scenes[0].shots[0]
    assert request.visual_direction in generated_shot.prompt
    assert generated_shot.prompt_plan.lighting != request.visual_direction
    assert "未单独指定灯光" in generated_shot.prompt_plan.lighting
    edit = edit_request(generated_plan)
    edit.visual_direction = "保存后的要求。" * 500
    assert 1200 < len(edit.visual_direction) <= 4000
    saved = service.edit(PROJECT, 1, edit)
    assert edit.visual_direction in saved.scenes[0].shots[0].prompt
    candidate = service.generate_scene(PROJECT, 1, 1, saved.revision, "重新安排机位")
    assert edit.visual_direction in candidate.candidate.shots[0].prompt
    assert len(candidate.candidate.shots[0].prompt_plan.lighting) <= 1200
    accepted = service.edit(PROJECT, 1, edit_request(candidate, candidate_action="accept"))
    assert edit.visual_direction in accepted.scenes[0].shots[0].prompt
    assert accepted.source_draft == SOURCE


def test_full_production_detail_capacity_keeps_all_authored_fields(storyboard):
    service, _, _, _ = storyboard
    plan = generated(service)
    request = edit_request(plan)
    request.visual_direction = "作" * 4000
    scene = request.scenes[0]
    scene.design.production_contract = SceneProductionContract(**{
        key: key[0] * maximum for key, maximum in {
            "lighting": 1200, "visual_style": 500, "composition": 1000, "axis": 1000,
            "optics": 800, "continuity": 1600, "sound": 1200, "reference_rules": 800,
        }.items()
    })
    scene.design.spatial_layout = "位" * 1000
    shot = scene.shots[0]
    shot.continuity_in = "始" * 1000
    shot.continuity_out = "终" * 1000
    shot.handoff = "承" * 600
    shot.camera = "机" * 500
    shot.sound = "声" * 1000
    shot.action_sequence = ["沿原文先后执行完整连续表演，" + "动" * 600]
    shot.acting_direction = ActingDirection(**{
        key: "演" * maximum for key, maximum in {
            "objective": 240, "obstacle": 300, "stakes": 240, "tactic": 240,
            "subtext": 300, "business": 240, "listening_reaction": 300,
            "physical_state": 300, "line_delivery": 300, "emphasis_and_pause": 300, "status_change": 300,
        }.items()
    })
    result = service.edit(PROJECT, 1, request)
    output = result.scenes[0].shots[0]
    for value in scene.design.production_contract.model_dump().values():
        assert value in output.prompt
    assert request.visual_direction in output.prompt
    assert shot.action_sequence[0] in output.prompt
    assert output.acting_direction.business == shot.acting_direction.business
    assert output.prompt_plan.scene_map == scene.design.spatial_layout
    assert result.source_draft == SOURCE


def test_oversized_compiled_prompt_reports_actionable_error_and_keeps_prior_version(storyboard):
    service, _, _, _ = storyboard
    plan = generated(service)
    edit = edit_request(plan)
    edit.scenes[0].shots[0].action_sequence = ["动作" * 21000]
    with pytest.raises(StoryboardConflictError, match="缩短拍摄要求或拆分镜头动作"):
        service.edit(PROJECT, 1, edit)
    assert service.require(PROJECT, 1) == plan


def test_candidate_adoption_cannot_unlock_and_replace_old_locked_shot_in_one_request(storyboard):
    service, adapter, _, _ = storyboard
    original = generated(service)
    proposed = service.generate_scene(PROJECT, 1, 1, original.revision, "调整候选机位")
    lock_request = edit_request(proposed)
    lock_request.scenes[0].shots[0].locked = True
    locked = service.edit(PROJECT, 1, lock_request)
    assert locked.candidate is not None
    bypass = edit_request(locked, candidate_action="accept")
    bypass.scenes[0].shots[0].locked = False
    with pytest.raises(StoryboardConflictError, match="先单独解锁"):
        service.edit(PROJECT, 1, bypass)
    assert service.require(PROJECT, 1) == locked
    unlock_request = edit_request(locked)
    unlock_request.scenes[0].shots[0].locked = False
    unlocked = service.edit(PROJECT, 1, unlock_request)
    accepted = service.edit(PROJECT, 1, edit_request(unlocked, candidate_action="accept"))
    assert accepted.candidate is None and accepted.scenes[0] == unlocked.candidate
    assert adapter.calls == 2
