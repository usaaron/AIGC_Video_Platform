import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
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


SOURCE = json.loads((Path(__file__).parent / "fixtures/storyboard_screenplay.json").read_text())
PROJECT = "story_project.storyboard_test"


class SceneAdapter:
    def __init__(self):
        self.calls = 0
        self.invalid_refs = False
        self.failure = None

    def generate_structured_output_stream(self, prompt, *, strategy, output_schema):
        self.calls += 1
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


def test_scene_generation_replays_source_dialogue_and_persists_history(storyboard):
    service, adapter, runtime, _ = storyboard
    plan = generated(service)
    assert adapter.calls == 1
    assert plan.status == "review"
    assert plan.scenes[0].shots[0].dialogue == ["林岚: 先进去。", "周宁: 钥匙别松手。"]
    prompt = plan.scenes[0].shots[0].prompt
    assert prompt.index("action:0") < prompt.index("dialogue:0") < prompt.index("action:1") < prompt.index("dialogue:1")
    assert service.require(PROJECT, 1, revision=1).scenes == []
    restarted = StoryboardService(PreproductionRepository(runtime), lambda: adapter)
    assert restarted.require(PROJECT, 1) == plan
    assert restarted.start(PROJECT, 1, SOURCE, plan.revision).revision == plan.revision
    with pytest.raises(LookupError):
        restarted.require(PROJECT, 2)


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
