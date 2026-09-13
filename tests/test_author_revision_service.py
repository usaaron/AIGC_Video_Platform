from copy import deepcopy
from datetime import datetime, timezone
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel

from app.api.routes.author_revisions import get_author_revision_service, router
from app.database import create_database_runtime
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.script_engine.author_conflict_models import AuthorConflictReview, StoredAuthorConflictReview
from app.modules.script_engine.author_conflicts import AuthorConflictReviewRepository
from app.modules.script_engine.author_revision_service import AuthorRevisionRequest, AuthorRevisionService
from app.modules.script_engine.llm_adapter import LLMAdapter
from app.modules.script_engine.long_story_models import (
    PlanningApprovalStatus, StoryBible, StoryBibleGenerationOutput, StoryProject, StoryProjectWorkspaceSave,
)
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError, LongStoryRepository
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.models import GenerationStrategy, LLMModelInfo
from app.modules.script_engine.repository import GenerationStrategyRepository
from app.modules.script_engine.story_planning_service import StoryPlanningInputError, StoryPlanningService


PROJECT_ID = "story_project.author_revision_source"
NOW = datetime(2026, 9, 12, tzinfo=timezone.utc)


class RevisionAdapter(LLMAdapter):
    def __init__(self, output):
        self.output = output
        self.calls = 0
        self.prompts = []
        self.before_return = None

    def generate_text(self, prompt, *, strategy):
        return ""

    def generate_structured_output(self, prompt, *, strategy, output_schema=None):
        self.calls += 1
        self.prompts.append(prompt)
        if self.before_return:
            self.before_return()
        return deepcopy(self.output)

    def validate_output(self, output, *, required_keys=None):
        return all(key in output for key in required_keys or [])

    def get_model_info(self):
        return LLMModelInfo(
            provider="fixture", model_name="revision-fixture",
            supports_structured_output=True, max_context_tokens=64_000,
        )


@pytest.fixture
def revision_context(tmp_path):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'author-revisions.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    long_story = LongStoryService(runtime)
    project = long_story.save_project(StoryProject(
        project_id=PROJECT_ID, title="归来的证词", content_spec_id="spec.author_revision",
        planned_episode_count=20, default_batch_size=5,
    ))
    bible = long_story.save_story_bible(StoryBible(
        story_bible_id="story_bible.author_revision_source",
        story_project_id=project.project_id, content_spec_id=project.content_spec_id,
        project_title="归来的证词",
        core_premise="记者陈宁追查母亲失踪的原因并寻找失散的姐姐。",
        series_goal="陈宁与姐姐取得失踪案证据，让无辜者能够回家。",
        theme="信任与真相",
        central_conflict="姐姐拒绝说出当年的事实，陈宁只能逐步验证每条线索。",
        ending_direction="陈宁公开调查结果，姐姐从被操控的关系中重新获得自由。",
        character_refs=["character.chen", "character.sister"],
        character_registry=[
            {"character_ref": "character.chen", "name": "陈宁", "role": "主角"},
            {"character_ref": "character.sister", "name": "陈岚", "role": "配角"},
        ],
        story_lines=[{
            "story_line_id": "storyline.truth", "title": "失踪的真相", "story_line_type": "main",
            "premise": "陈宁追查封存多年的失踪案件。", "planned_resolution": "姐姐交出完整证据并重获自由。",
            "character_refs": ["character.chen", "character.sister"],
        }],
        world_rules=["这是一座没有超自然力量的现代城市。"],
        locked_facts=["调查从母亲留下的一封信开始。"],
        imported_source_document="原版已经写出的旧正文只能留作历史参考。",
    ))
    bible = long_story.save_story_bible(bible.model_copy(update={
        "version": 2, "status": PlanningApprovalStatus.approved, "approved_at": NOW,
    }))
    strategies = GenerationStrategyRepository()
    strategy = strategies.save(GenerationStrategy(
        id="strategy.author_revision", name="Author revision fixture",
        target_platform="mainland china comic drama", target_content_type="serialized story",
        model_provider="fixture", model_name="revision-fixture", version="v1",
        workflow_steps=[{
            "step_order": 1, "name": "Revise", "description": "Revise the approved outline.",
            "prompt_id": "prompt.author_revision",
        }],
        prompt_ids=["prompt.author_revision"], status="active",
    ))
    workspace = long_story.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id=PROJECT_ID, client_instance_id="fixture.author_revision",
        workspace_payload={
            "id": PROJECT_ID, "title": "归来的证词", "titleSource": "user",
            "creativePrompt": "姐妹在失踪案件中重新理解彼此。", "marketProfile": "cn_mainland",
            "referenceMaterials": [], "selectedTagIds": [], "customTags": [],
            "generationStrategyId": strategy.id, "contentSpecId": project.content_spec_id,
            "generationSettings": {"episodeCount": 20, "customInstructions": ""},
            "characters": [{"id": "character.authored", "source": "user"}, {"id": "character.generated", "source": "generated"}],
            "storyBibleInputSignature": "retained-input-signature",
            "storyBibleVersion": 2, "storyBibleStatus": "approved",
            "episodes": [{"episodeNumber": 1, "confirmed": True}],
            "generationRun": {"old": "canon"}, "workingDraftJson": "旧稿",
            "episodeRoadmaps": [{"episode_number": 1, "status": "approved"}],
            "continuityStates": [{"old": "fact"}], "planningSession": {"phase": "script"},
            "deliveryConfirmation": {"approved": True},
        },
    ))
    workspace = long_story.get_workspace_snapshot(PROJECT_ID)
    output = {field: bible.model_dump(mode="json")[field] for field in StoryBibleGenerationOutput.model_fields}
    output["ending_direction"] = "陈宁保留证据等待公开时机，姐姐选择主动保护失踪案证人。"
    adapter = RevisionAdapter(output)
    planning = StoryPlanningService(
        long_story_service=long_story, content_spec_repository=ContentSpecRepository(),
        generation_strategy_repository=strategies, llm_adapter=adapter,
    )
    request = AuthorRevisionRequest(
        source_story_bible_version=2, expected_workspace_revision=workspace.revision,
        instruction="修改结局，让姐姐主动保护证人。",
        resolution_plan="只修改结局的行动结果，让姐姐主动保护失踪案证人，保留其他事实。",
        request_id=UUID("72a67bf9-c02a-40c0-9c29-5232fa7a25f4"),
        review_id="review.author_revision", option_id="option.revise_upstream",
    )
    reviews = AuthorConflictReviewRepository(lambda: runtime)
    reviews.save(StoredAuthorConflictReview(
        id=request.review_id, source_project_id=PROJECT_ID,
        review=AuthorConflictReview(
            review_id=request.review_id, source_fingerprint="a" * 64,
            instruction=request.instruction, source_story_bible_version=2,
            user_goal=request.instruction,
            conflicts=[{
                "source_ref": "episode_context.story_bible_context", "established_fact": bible.ending_direction,
                "requested_change": request.instruction, "impact": "需要重新确认总纲与完整规划。",
            }],
            options=[{
                "option_id": request.option_id, "kind": "revise_upstream", "title": "调整结局并重审规划",
                "plan": request.resolution_plan, "impact": "创建单独的修订版本，原稿不变。",
            }],
        ),
    ))
    return runtime, long_story, AuthorRevisionService(runtime, planning), adapter, request, bible, workspace


def test_revision_is_reviewable_isolated_and_idempotent(revision_context):
    runtime, long_story, service, adapter, request, bible, workspace = revision_context
    original_project = long_story.get_project(PROJECT_ID)
    result = service.create_revision(PROJECT_ID, request)
    assert result.story_bible.status == "draft"
    assert result.story_bible.version == 1
    assert result.story_bible.ending_direction == adapter.output["ending_direction"]
    assert result.story_bible.world_rules == bible.world_rules
    assert result.story_bible.locked_facts == bible.locked_facts
    assert result.story_bible.imported_source_document is None
    assert result.story_bible.creative_decisions[-1].value == request.resolution_plan
    assert "author_revision." in adapter.prompts[0]
    assert request.instruction in adapter.prompts[0]
    assert request.resolution_plan in adapter.prompts[0]
    assert bible.core_premise in adapter.prompts[0]
    assert long_story.get_project(PROJECT_ID) == original_project
    assert long_story.get_story_bible(PROJECT_ID, bible.story_bible_id) == bible
    assert long_story.get_workspace_snapshot(PROJECT_ID) == workspace
    assert result.workspace_payload["sourceProjectId"] == PROJECT_ID
    assert result.workspace_payload["characters"] == [{"id": "character.authored", "source": "user"}]
    for field in ("episodes", "episodeRoadmaps", "continuityStates", "generationBatches"):
        assert result.workspace_payload[field] == []
    for field in ("generationRun", "workingDraftJson", "planningSession", "deliveryConfirmation"):
        assert field not in result.workspace_payload
    assert long_story.get_project(result.project_id).active_story_bible_id is None
    assert long_story.get_latest_continuity_ledger(result.project_id) is None
    assert service.create_revision(PROJECT_ID, request) == result
    assert adapter.calls == 1
    with runtime.session() as session:
        assert LongStoryRepository(session).count_projects() == 2


def test_retry_returns_new_workspaces_later_edits(revision_context):
    _, long_story, service, adapter, request, _, source_workspace = revision_context
    result = service.create_revision(PROJECT_ID, request)
    long_story.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id=result.project_id, client_instance_id="fixture.new_editor", revision=2,
        workspace_payload={**result.workspace_payload, "title": "作者已修改新版标题"},
    ))
    long_story.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id=PROJECT_ID, client_instance_id="fixture.original_editor", revision=2,
        workspace_payload={**source_workspace.workspace_payload, "lastRetryAt": "2026-09-12"},
    ))
    retry = service.create_revision(PROJECT_ID, request.model_copy(update={"expected_workspace_revision": 2}))
    assert retry.workspace_payload["title"] == "作者已修改新版标题"
    assert retry.workspace_payload["serverSync"]["workspaceRevision"] == 2
    assert retry.revision == 2
    assert adapter.calls == 1


def test_retry_uses_latest_bible_before_workspace_metadata_sync(revision_context):
    _, long_story, service, adapter, request, _, _ = revision_context
    result = service.create_revision(PROJECT_ID, request)
    saved_bible = long_story.save_story_bible(result.story_bible.model_copy(update={
        "version": 2,
        "ending_direction": "陈宁确认保护证人的位置，姐姐亲自带领证人离开危险区域。",
    }))
    workspace_before = long_story.get_workspace_snapshot(result.project_id)
    assert workspace_before.workspace_payload["storyBibleVersion"] == 1

    retry = service.create_revision(PROJECT_ID, request)

    assert retry.story_bible == saved_bible
    assert retry.workspace_payload["storyBibleVersion"] == 2
    assert retry.workspace_payload["storyBibleStatus"] == "draft"
    for field, value in workspace_before.workspace_payload.items():
        if field not in {"storyBibleVersion", "storyBibleStatus", "serverSync"}:
            assert retry.workspace_payload[field] == value
    assert long_story.get_workspace_snapshot(result.project_id) == workspace_before
    assert adapter.calls == 1


def test_model_failure_leaves_no_new_project(revision_context):
    runtime, _, service, adapter, request, _, _ = revision_context
    def fail_generation():
        raise RuntimeError("fixture provider failed")
    adapter.before_return = fail_generation
    with pytest.raises(RuntimeError, match="provider failed"):
        service.create_revision(PROJECT_ID, request)
    with runtime.session() as session:
        assert LongStoryRepository(session).count_projects() == 1


@pytest.mark.parametrize("changes", [
    {"expected_workspace_revision": 2}, {"source_story_bible_version": 1},
    {"review_id": "review.missing"}, {"option_id": "option.forged"},
    {"instruction": "更改未经审阅的要求。"}, {"resolution_plan": "直接采用未经审阅的内容。"},
])
def test_rejects_stale_or_forged_request_before_model(revision_context, changes):
    runtime, _, service, adapter, request, _, _ = revision_context
    with pytest.raises(LongStoryPersistenceConflictError):
        service.create_revision(PROJECT_ID, request.model_copy(update=changes))
    assert adapter.calls == 0
    with runtime.session() as session:
        assert LongStoryRepository(session).count_projects() == 1


def test_rejects_newer_editable_source_bible(revision_context):
    _, long_story, service, adapter, request, bible, _ = revision_context
    long_story.save_story_bible(bible.model_copy(update={"version": 3, "status": PlanningApprovalStatus.draft, "approved_at": None}))
    with pytest.raises(LongStoryPersistenceConflictError, match="latest Story Bible"):
        service.create_revision(PROJECT_ID, request)
    assert adapter.calls == 0


def test_source_change_while_generating_leaves_no_revision(revision_context):
    runtime, long_story, service, adapter, request, _, workspace = revision_context
    adapter.before_return = lambda: long_story.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id=PROJECT_ID, client_instance_id="fixture.author_revision", revision=2,
        workspace_payload={**workspace.workspace_payload, "title": "作者修改中的源项目"},
    ))
    with pytest.raises(LongStoryPersistenceConflictError, match="workspace changed"):
        service.create_revision(PROJECT_ID, request)
    with runtime.session() as session:
        assert LongStoryRepository(session).count_projects() == 1


def test_storage_failure_rolls_back_project_and_bible(revision_context, monkeypatch):
    runtime, _, service, _, request, _, _ = revision_context
    def fail_save(*args, **kwargs):
        raise RuntimeError("workspace storage failed")
    monkeypatch.setattr(LongStoryRepository, "save_workspace_snapshot", fail_save)
    with pytest.raises(RuntimeError, match="workspace storage failed"):
        service.create_revision(PROJECT_ID, request)
    with runtime.session() as session:
        repository = LongStoryRepository(session)
        assert repository.count_projects() == 1
        assert repository.get_story_bible(f"story_bible.story_project.author_revision.{request.request_id.hex}.main") is None


def test_idempotency_key_cannot_be_reused_for_other_input(revision_context):
    _, _, service, adapter, request, _, _ = revision_context
    service.create_revision(PROJECT_ID, request)
    with pytest.raises(LongStoryPersistenceConflictError, match="different input"):
        service.create_revision(PROJECT_ID, request.model_copy(update={"resolution_plan": "换成未经确认的方案。"}))
    assert adapter.calls == 1


def test_cannot_repurpose_existing_storyline_reference(revision_context):
    runtime, _, service, adapter, request, _, _ = revision_context
    adapter.output["story_lines"][0]["story_line_id"] = "storyline.replaced"
    with pytest.raises(StoryPlanningInputError, match="reference IDs"):
        service.create_revision(PROJECT_ID, request)
    with runtime.session() as session:
        assert LongStoryRepository(session).count_projects() == 1


def test_exact_conflict_evidence_allows_explicit_fact_revision(revision_context):
    runtime, _, service, adapter, request, bible, _ = revision_context
    request = request.model_copy(update={
        "instruction": "修改结局，并让调查从母亲打来的电话开始。",
        "resolution_plan": "调查起点改成母亲的电话，结局里姐姐主动保护证人，其余内容不变。",
    })
    reviews = AuthorConflictReviewRepository(lambda: runtime)
    stored = reviews.get(request.review_id)
    review = stored.review.model_copy(update={
        "instruction": request.instruction,
        "options": [stored.review.options[0].model_copy(update={"plan": request.resolution_plan})],
        "conflicts": [stored.review.conflicts[0].model_copy(update={"established_fact": bible.locked_facts[0]})],
    })
    reviews.save(stored.model_copy(update={"review": review}))
    adapter.output["locked_facts"] = ["调查从母亲打来的一通电话开始。"]
    adapter.output["world_rules"] = ["这座城市突然开始出现超自然力量。"]
    result = service.create_revision(PROJECT_ID, request)
    assert result.story_bible.locked_facts == adapter.output["locked_facts"]
    assert result.story_bible.world_rules == bible.world_rules


def test_endpoint_returns_reviewable_revision_and_stale_conflict(revision_context):
    _, _, service, _, request, _, _ = revision_context
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_author_revision_service] = lambda: service
    with TestClient(app) as client:
        response = client.post(f"/story-projects/{PROJECT_ID}/author-revisions", json=request.model_dump(mode="json"))
        assert response.status_code == 200
        assert response.json()["data"]["story_bible"]["status"] == "draft"
        body = {**request.model_dump(mode="json"), "expected_workspace_revision": 9, "request_id": "e114b11d-477a-4e44-ac1a-6d113f1fd5d2"}
        stale = client.post(f"/story-projects/{PROJECT_ID}/author-revisions", json=body)
        assert stale.status_code == 409
        assert stale.json()["detail"] == "总纲、工作区或处理方案已变化，请重新检查影响后再确认。"
