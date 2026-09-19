import copy
import json
from pathlib import Path
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlmodel import SQLModel, select

from app.database import create_database_runtime
from app.dependencies import get_long_story_service, get_storyboard_service
from app.document_repository import ModuleDocumentRecord
from app.main import create_app
from app.modules.preproduction.models import StoryboardEditRequest
from app.modules.preproduction.repository import PreproductionRepository, StoryboardConflictError
from app.modules.preproduction.service import StoryboardService
from app.modules.script_engine.long_story_models import StoryProject
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.llm_adapter import LLMRequestError
from app.modules.script_engine.scene_heading_metadata import scene_metadata_conflicts, scene_heading_with_known_time


SOURCE = json.loads((Path(__file__).parent / "fixtures/storyboard_screenplay.json").read_text())
PROJECT = "story_project.storyboard_test"


class SceneAdapter:
    def __init__(self):
        self.calls = 0
        self.invalid_refs = False
        self.failure = None

    def generate_structured_output_stream(self, prompt, *, strategy, output_schema):
        self.calls += 1
        self.last_prompt = prompt
        self.last_schema = output_schema
        assert strategy.max_tokens > 1000
        assert "scene" in prompt and "source_refs" in json.dumps(output_schema)
        if self.failure:
            raise self.failure
        return {
            "design": {"purpose": "让同伴先进门", "spatial_layout": "门内外人物位置明确", "reveal_order": "最后才听到敲门",
                       "action_rhythm": "撑门、通过、关门、敲门", "transition": "在敲门声处切黑"},
            "shots": [{
                "source_refs": ["action:0"] if self.invalid_refs else SOURCE["scenes"][0]["body_order"],
                "purpose": "保持钥匙连续性", "duration_seconds": 20, "framing": "中景", "camera": "门内固定机位",
                "action_sequence": ["林岚撑门，周宁穿过门槛。", "门合上后两人听到敲击。"],
                "sound": "门响与三声敲击", "continuity_in": "钥匙在林岚左手", "continuity_out": "钥匙仍在林岚左手",
            }], "unresolved_questions": [],
        }


@pytest.fixture
def storyboard(tmp_path):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'storyboard.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    projects = LongStoryService(runtime)
    projects.save_project(StoryProject(project_id=PROJECT, title="分镜测试", planned_episode_count=2, default_batch_size=1))
    adapter = SceneAdapter()
    service = StoryboardService(PreproductionRepository(runtime), lambda: adapter)
    yield service, adapter, runtime, projects
    runtime.engine.dispose()


def edit_request(plan, **kwargs):
    return StoryboardEditRequest(expected_revision=plan.revision, scenes=copy.deepcopy(plan.scenes),
                                 visual_direction=plan.visual_direction, **kwargs)


def generated(service):
    plan = service.start(PROJECT, 1, SOURCE, 0)
    return service.generate_scene(PROJECT, 1, 1, plan.revision, "")


@pytest.mark.parametrize("repair_kind", ["valid", "unrequested_field", "still_invalid"])
def test_scene_field_repair_preserves_valid_shots_and_has_bounded_attempts(storyboard, repair_kind):
    service, original_adapter, _, _ = storyboard
    original = original_adapter.generate_structured_output_stream(
        "scene", strategy=type("Strategy", (), {"max_tokens": 12000})(), output_schema={"source_refs": {}},
    )
    beats = ["抬手摸向钥匙。", "发现钥匙仍在左手。", "把身体让到门边。", "看同伴穿过门槛。", "合门听见敲击。"]
    original["shots"][0]["acting_direction"] = {"beat_changes": beats}
    preserved = copy.deepcopy(original)

    class RepairAdapter:
        calls = 0

        def generate_structured_output_stream(self, prompt, *, strategy, output_schema):
            self.calls += 1
            if self.calls == 1:
                return original
            assert "repairs" in output_schema["properties"]
            assert strategy.max_tokens == 4000
            path = ["shots", 0, "acting_direction", "beat_changes"]
            if repair_kind == "unrequested_field":
                path = ["shots", 0, "source_refs"]
            return {"repairs": [{"path": path, "value": beats if repair_kind == "still_invalid" else [beats[0] + beats[1], *beats[2:]]}]}

    adapter = RepairAdapter()
    service.adapter_factory = lambda: adapter
    plan = service.start(PROJECT, 1, SOURCE, 0)
    if repair_kind == "valid":
        result = service.generate_scene(PROJECT, 1, 1, plan.revision, "")
        shot = result.scenes[0].shots[0]
        assert shot.source_refs == preserved["shots"][0]["source_refs"]
        assert shot.camera == preserved["shots"][0]["camera"]
        assert shot.duration_seconds == preserved["shots"][0]["duration_seconds"]
        assert "".join(shot.acting_direction.beat_changes) == "".join(beats)
        assert adapter.calls == 2
    else:
        with pytest.raises(ValidationError):
            service.generate_scene(PROJECT, 1, 1, plan.revision, "")
        assert service.require(PROJECT, 1).revision == plan.revision
        assert not service.require(PROJECT, 1).scenes
        assert adapter.calls == (3 if repair_kind == "still_invalid" else 2)
    assert original == preserved


def test_model_design_is_compiled_without_requesting_discarded_prompt_fields(storyboard):
    service, adapter, _, _ = storyboard
    plan = generated(service)
    assert "prompt_plan" not in json.dumps(adapter.last_schema)
    assert "Output schema:" not in adapter.last_prompt
    shot = plan.scenes[0].shots[0]
    assert shot.prompt_plan.first_frame
    assert shot.prompt_plan.dialogue_rules
    assert "钥匙" in shot.prompt
    assert "先进去。" in shot.prompt


@pytest.mark.parametrize("source_changed", [False, True])
def test_rebinding_unchanged_refs_does_not_offer_stale_shot_actions_as_editing_context(storyboard, source_changed):
    service, adapter, _, _ = storyboard
    source = copy.deepcopy(SOURCE)
    for number in (2, 3):
        scene = copy.deepcopy(source["scenes"][0])
        scene["scene_number"] = number
        source["scenes"].append(scene)
    plan = service.start(PROJECT, 1, source, 0)
    for number in (1, 2, 3):
        plan = service.generate_scene(PROJECT, 1, number, plan.revision, "")
    edit = edit_request(plan)
    marker = "旧镜头独有：从夹内取出日志原件直接铺在桌上。"
    edit.scenes[2].shots[0].action_sequence = [marker]
    original = service.edit(PROJECT, 1, edit)
    changed = copy.deepcopy(source)
    if source_changed:
        changed["scenes"][2]["character_actions"][0] = "调出既有照片，放大署名页眉，打印整页照片并旁注照片核对件。"
    # Same ref and count: only the authored action text changes.
    assert changed["scenes"][2]["body_order"] == source["scenes"][2]["body_order"]
    rebound = service.start(PROJECT, 1, changed, original.revision)
    proposal = service.generate_scene(PROJECT, 1, 3, rebound.revision, "保留原对白和其他场次。")
    context = json.loads(adapter.last_prompt.splitlines()[-1])
    assert context["source_changed"] is source_changed
    assert context["scene"]["character_actions"] == changed["scenes"][2]["character_actions"]
    assert context["author_instruction"] == "保留原对白和其他场次。"
    assert context["previous_scene_end"] == original.scenes[1].shots[-1].continuity_out
    if source_changed:
        assert rebound.stale_scene_numbers == [3]
        assert context["current_scene"] is None
        assert marker not in adapter.last_prompt
        assert "不能只列 source_refs" in adapter.last_prompt
    else:
        assert context["current_scene"] == original.scenes[2].model_dump(mode="json")
        assert proposal.candidate.shots[0].shot_id == original.scenes[2].shots[0].shot_id
    assert proposal.scenes == original.scenes
    assert service.require(PROJECT, 1, revision=original.revision) == original
    accepted = service.edit(PROJECT, 1, edit_request(proposal, candidate_action="accept"))
    assert accepted.scenes[:2] == original.scenes[:2]
    assert accepted.scenes[2] == proposal.candidate
    assert accepted.stale_scene_numbers == []


def test_scene_budget_follows_content_instead_of_equal_scene_shares(storyboard):
    service, adapter, _, _ = storyboard
    source = copy.deepcopy(SOURCE)
    long_scene = copy.deepcopy(source["scenes"][0])
    long_scene["scene_number"] = 2
    long_scene["dialogues"][0]["text"] = "先核对走廊出口和钥匙编号，找到保管人再决定是否开门。" * 8
    source["scenes"].append(long_scene)
    plan = service.start(PROJECT, 1, source, 0)
    service.generate_scene(PROJECT, 1, 1, plan.revision, "")
    context = json.loads(adapter.last_prompt.splitlines()[-1])
    assert context["duration_budget_seconds"] < source["target_duration_seconds"] / 2
    assert context["spoken_reference_seconds"] > 0


def test_compiled_video_prompt_preserves_incoming_state_and_updated_duration(storyboard):
    service, _, _, _ = storyboard
    plan = generated(service)
    edit = edit_request(plan)
    shot = edit.scenes[0].shots[0]
    shot.continuity_in = "林岚站在关闭的门外，钥匙仍在左手。"
    shot.action_sequence = ["林岚开门后走到桌边，把钥匙放到桌上。"]
    shot.continuity_out = "林岚已在桌边，钥匙留在桌面。"
    shot.duration_seconds = 12.5
    result = service.edit(PROJECT, 1, edit)
    compiled = result.scenes[0].shots[0]
    assert compiled.prompt_plan.first_frame == shot.continuity_in
    assert "放到桌上" not in compiled.prompt_plan.first_frame
    assert "林岚开门后走到桌边，把钥匙放到桌上。" in "".join(compiled.prompt_plan.timing)
    assert "当前分配 12.5 秒" in compiled.prompt
    assert "当前分配 20 秒" not in compiled.prompt
    assert result.source_draft == SOURCE
    assert compiled.source_refs == plan.scenes[0].shots[0].source_refs


@pytest.mark.parametrize("camera,multiple", [
    ("固定机位；无剪辑切换；时长7秒。", False),
    ("手持跟拍，不切。", False),
    ("单一连续镜头，不做反打；只切换焦点。", False),
    ("固定镜头，不插入镜头。", False),
    ("Locked camera, no cuts.", False),
    ("回答时切到门后，再切回双人中景。", True),
    ("无闪切；在答句处切至门口。", True),
    ("Push in, then cut to the door.", True),
])
def test_compiled_format_distinguishes_cut_instructions_from_no_cut_locks(storyboard, camera, multiple):
    service, _, _, _ = storyboard
    plan = generated(service)
    edit = edit_request(plan)
    edit.scenes[0].shots[0].camera = camera
    result = service.edit(PROJECT, 1, edit)
    shot = result.scenes[0].shots[0]
    assert shot.prompt_plan.format_mode == ("受控多镜头序列" if multiple else "单一连续镜头")
    assert shot.camera == camera
    assert result.source_draft == SOURCE


def test_preflight_warns_about_rushed_dialogue_and_clears_after_timing_edit(storyboard):
    service, _, _, _ = storyboard
    source = copy.deepcopy(SOURCE)
    source["scenes"][0]["dialogues"][0]["text"] = "先核对走廊出口和钥匙编号，找到保管人再决定是否开门。" * 3
    plan = service.start(PROJECT, 1, source, 0)
    plan = service.generate_scene(PROJECT, 1, 1, plan.revision, "")
    edit = edit_request(plan)
    edit.scenes[0].shots[0].duration_seconds = 8
    plan = service.edit(PROJECT, 1, edit)
    warnings = [f for f in plan.findings if f.code == "shot_dialogue_duration"]
    assert len(warnings) == 1
    assert warnings[0].severity == "warning" and warnings[0].scene_number == 1
    assert "第 1 镜" in warnings[0].message
    assert plan.scenes[0].shots[0].dialogue[0].endswith(source["scenes"][0]["dialogues"][0]["text"])
    edit = edit_request(plan)
    edit.scenes[0].shots[0].duration_seconds = 30
    plan = service.edit(PROJECT, 1, edit)
    assert not any(f.code == "shot_dialogue_duration" for f in plan.findings)


def test_source_scene_metadata_conflicts_are_visible_without_rewriting_source(storyboard):
    service, _, _, _ = storyboard
    source = copy.deepcopy(SOURCE)
    scene = source["scenes"][0]
    scene["scene_heading"] = "INT. 旧城街口 日"
    scene["setting_hint"] = "EXT. 旧城街口 日"
    plan = service.start(PROJECT, 1, source, 0)
    assert any(f.code == "source_scene_metadata" and "内外景" in f.message for f in plan.findings)
    assert plan.source_draft == source
    corrected = copy.deepcopy(source)
    corrected["scenes"][0]["scene_heading"] = corrected["scenes"][0]["setting_hint"]
    plan = service.start(PROJECT, 1, corrected, plan.revision)
    assert not any(f.code == "source_scene_metadata" and "内外景" in f.message for f in plan.findings)


@pytest.mark.parametrize("heading,setting,time,expected", [
    ("INT. 会谈室 日", "会谈室", "夜", 1),
    ("EXT. 街口 NIGHT", "EXT. 街口 - DAY", "夜", 1),
    ("INT. 日升大厦 夜", "内景·日升大厦·深夜", "夜间", 0),
    ("INT. NIGHT OWL CLINIC - DAY", "诊所", "白天", 0),
    ("INT. NIGHT OWL CLINIC", "诊所", "白天", 0),
    ("会谈室", "会谈室外的道路传来鸣笛声。", "待确认", 0),
])
def test_scene_metadata_checks_only_explicit_conflicting_facts(heading, setting, time, expected):
    assert len(scene_metadata_conflicts(heading, setting, time)) == expected
    if heading.endswith("日"):
        assert scene_heading_with_known_time(heading, time) == heading


def test_scene_generation_replays_source_dialogue_and_persists_history(storyboard):
    service, adapter, runtime, _ = storyboard
    plan = generated(service)
    assert adapter.calls == 1
    assert plan.status == "review"
    assert plan.scenes[0].shots[0].dialogue == ["林岚: 先进去。", "周宁: 钥匙别松手。"]
    shot = plan.scenes[0].shots[0]
    assert shot.acting_direction.objective
    assert shot.acting_direction.beat_changes
    assert shot.acting_direction.line_delivery
    assert shot.acting_direction.emphasis_and_pause
    assert shot.acting_direction.status_change
    assert plan.scenes[0].design.audience_effect
    assert plan.scenes[0].design.status_change
    assert shot.prompt_plan.first_frame
    assert shot.prompt_plan.physical_constraints
    assert "首帧与空间调度" in shot.prompt
    assert "表演" in shot.prompt
    assert "物理" in shot.prompt
    prompt = plan.scenes[0].shots[0].prompt
    assert prompt.index("action:0") < prompt.index("dialogue:0") < prompt.index("action:1") < prompt.index("dialogue:1")
    assert service.require(PROJECT, 1, revision=1).scenes == []
    restarted = StoryboardService(PreproductionRepository(runtime), lambda: adapter)
    assert restarted.require(PROJECT, 1) == plan
    assert restarted.start(PROJECT, 1, SOURCE, plan.revision).revision == plan.revision
    with pytest.raises(LookupError):
        restarted.require(PROJECT, 2)


def test_prompt_uses_source_names_including_silent_cast_without_guessing_registry_ids(storyboard):
    service, _, _, _ = storyboard
    source = copy.deepcopy(SOURCE)
    source["scenes"][0]["character_refs"] = ["character.lead", "character.friend", "character.guard"]
    source["scenes"][0]["character_actions"][0] += "守门人老陈站在门旁，始终没有说话。"
    source["characters"] = [
        {"name": "老陈", "role": "守门人", "description": "负责看守走廊入口的年长门卫。", "motivation": "守住走廊入口，不让外人闯入。"},
        {"name": "张伟", "role": "场外人物", "description": "本集中暂未进入走廊的调查员。", "motivation": "在城外寻找失踪同伴的线索。"},
    ]
    plan = service.start(PROJECT, 1, source, 0)
    plan = service.generate_scene(PROJECT, 1, 1, plan.revision, "")
    shot = plan.scenes[0].shots[0]
    assert shot.prompt_plan.active_references == ["林岚", "周宁", "老陈"]
    assert "character." not in shot.prompt
    assert "张伟" not in shot.prompt
    assert plan.source_draft == source

    # Stale shots keep the cast from the source revision they actually filmed.
    changed = copy.deepcopy(source)
    changed["characters"] = []
    changed["scenes"][0]["character_actions"][0] = SOURCE["scenes"][0]["character_actions"][0]
    stale = service.start(PROJECT, 1, changed, plan.revision)
    assert stale.scenes[0].shots[0].prompt_plan.active_references == ["林岚", "周宁", "老陈"]


def test_invalid_generation_leaves_previous_scene_and_revision_untouched(storyboard):
    service, adapter, _, _ = storyboard
    plan = generated(service)
    adapter.invalid_refs = True
    with pytest.raises(StoryboardConflictError, match="遗漏"):
        service.generate_scene(PROJECT, 1, 1, plan.revision, "局部修改")
    assert service.require(PROJECT, 1) == plan


def test_failed_later_scene_keeps_checkpoint_and_can_resume(storyboard):
    service, adapter, _, _ = storyboard
    source = copy.deepcopy(SOURCE)
    source["scenes"].append({**copy.deepcopy(source["scenes"][0]), "scene_number": 2})
    plan = service.start(PROJECT, 1, source, 0)
    plan = service.generate_scene(PROJECT, 1, 1, plan.revision, "")
    adapter.failure = LLMRequestError("synthetic timeout", category="timeout")
    with pytest.raises(LLMRequestError):
        service.generate_scene(PROJECT, 1, 2, plan.revision, "")
    assert service.require(PROJECT, 1) == plan
    adapter.failure = None
    resumed = service.generate_scene(PROJECT, 1, 2, plan.revision, "")
    assert resumed.scenes[0] == plan.scenes[0]
    assert len(resumed.scenes) == 2
    assert adapter.calls == 3


@pytest.mark.parametrize("fail", [False, True])
def test_duplicate_inflight_scene_requests_share_one_model_call_and_can_retry(storyboard, monkeypatch, fail):
    service, adapter, runtime, _ = storyboard
    plan = service.start(PROJECT, 1, SOURCE, 0)
    started, release, joined = Event(), Event(), Event()
    original_generate = adapter.generate_structured_output_stream

    class ObservedFuture(Future):
        def result(self, timeout=None):
            joined.set()
            return super().result(timeout)

    def blocked_generate(*args, **kwargs):
        started.set()
        assert release.wait(5)
        return original_generate(*args, **kwargs)

    monkeypatch.setattr("app.modules.preproduction.service.Future", ObservedFuture)
    monkeypatch.setattr(adapter, "generate_structured_output_stream", blocked_generate)
    if fail:
        adapter.failure = LLMRequestError("synthetic timeout", category="timeout")
    second_service = StoryboardService(PreproductionRepository(runtime), lambda: adapter)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(service.generate_scene, PROJECT, 1, 1, plan.revision, "")
        assert started.wait(5)
        second = pool.submit(second_service.generate_scene, PROJECT, 1, 1, plan.revision, "")
        try:
            assert joined.wait(5)
        finally:
            release.set()
        if fail:
            for result in (first, second):
                with pytest.raises(LLMRequestError):
                    result.result(5)
            assert service.require(PROJECT, 1) == plan
        else:
            assert first.result(5) == second.result(5)
            assert first.result() is not second.result()
            assert first.result().revision == plan.revision + 1
    assert adapter.calls == 1
    if fail:
        adapter.failure = None
        assert service.generate_scene(PROJECT, 1, 1, plan.revision, "").scenes
        assert adapter.calls == 2


def test_candidate_is_separate_until_acceptance_and_reject_keeps_original(storyboard):
    service, _, _, _ = storyboard
    original = generated(service)
    proposal = service.generate_scene(PROJECT, 1, 1, original.revision, "增加停顿")
    assert proposal.scenes == original.scenes and proposal.candidate
    assert proposal.candidate.shots[0].shot_id == original.scenes[0].shots[0].shot_id
    rejected = service.edit(PROJECT, 1, edit_request(proposal, candidate_action="reject"))
    assert rejected.scenes == original.scenes and rejected.candidate is None
    proposal = service.generate_scene(PROJECT, 1, 1, rejected.revision, "增加停顿")
    accepted = service.edit(PROJECT, 1, edit_request(proposal, candidate_action="accept"))
    assert accepted.scenes[0] == proposal.candidate
    assert service.require(PROJECT, 1, revision=original.revision) == original


def test_locked_content_cannot_change_during_unlock_or_generation(storyboard):
    service, adapter, _, _ = storyboard
    plan = generated(service)
    request = edit_request(plan)
    request.scenes[0].shots[0].locked = True
    locked = service.edit(PROJECT, 1, request)
    request = edit_request(locked)
    request.scenes[0].shots[0].locked = False
    request.scenes[0].shots[0].camera = "新的机位"
    with pytest.raises(StoryboardConflictError, match="解锁"):
        service.edit(PROJECT, 1, request)
    with pytest.raises(StoryboardConflictError, match="锁定"):
        service.generate_scene(PROJECT, 1, 1, locked.revision, "")
    assert adapter.calls == 1
    request.scenes[0].shots[0].camera = locked.scenes[0].shots[0].camera
    unlocked = service.edit(PROJECT, 1, request)
    assert not unlocked.scenes[0].shots[0].locked


def test_source_change_preserves_old_binding_and_only_adoption_clears_staleness(storyboard):
    service, _, _, _ = storyboard
    old = generated(service)
    source = copy.deepcopy(SOURCE)
    source["scenes"][0]["dialogues"][0]["text"] = "快进来。"
    updated = service.start(PROJECT, 1, source, old.revision)
    assert updated.status == "source_changed" and updated.stale_scene_numbers == [1]
    assert updated.scenes == old.scenes
    assert "先进去" in updated.scenes[0].shots[0].dialogue[0]
    assert service.require(PROJECT, 1, revision=updated.scenes[0].source_revision).source_draft == SOURCE
    candidate = service.generate_scene(PROJECT, 1, 1, updated.revision, "")
    assert "快进来" in candidate.candidate.shots[0].dialogue[0]
    accepted = service.edit(PROJECT, 1, edit_request(candidate, candidate_action="accept"))
    assert accepted.stale_scene_numbers == []


def test_atomic_compare_and_swap_blocks_late_writer_and_project_deletion(storyboard):
    service, _, runtime, projects = storyboard
    plan = generated(service)
    late_writer = copy.deepcopy(plan)
    advanced = service.edit(PROJECT, 1, edit_request(plan))
    late_writer.revision += 1
    with pytest.raises(StoryboardConflictError):
        PreproductionRepository(runtime).save(late_writer, plan.revision)
    assert service.require(PROJECT, 1) == advanced
    projects.delete_project_permanently(PROJECT, expected_revision=1)
    with runtime.session() as session:
        assert session.exec(select(ModuleDocumentRecord)).all() == []
    with pytest.raises(StoryboardConflictError, match="不存在"):
        PreproductionRepository(runtime).save(late_writer, plan.revision)


def test_api_round_trip_rejects_cross_episode_and_missing_project(storyboard):
    service, _, _, projects = storyboard
    app = create_app()
    app.dependency_overrides[get_storyboard_service] = lambda: service
    app.dependency_overrides[get_long_story_service] = lambda: projects
    path = f"/story-projects/{PROJECT}/episodes/1/storyboard"
    with TestClient(app) as client:
        assert client.get(path).status_code == 404
        assert client.post(path, json={"source_draft": SOURCE}).status_code == 200
        response = client.post(path + "/scenes/1/generate", json={"expected_revision": 1})
        assert response.status_code == 200, response.text
        assert client.get(path).json() == response.json()
        assert client.post(path + "/scenes/1/generate", json={"expected_revision": 1}).status_code == 409
        assert client.get(path.replace("episodes/1", "episodes/3")).status_code == 422
        assert client.get(path.replace(PROJECT, "story_project.missing")).status_code == 404
