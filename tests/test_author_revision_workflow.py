"""Exercise the persisted handoff between screenplay review and outline revision."""

from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.author_revisions import get_author_revision_service, router as revision_router
from app.api.routes.script_generation import router as generation_router
from app.dependencies import get_script_generation_service
from app.modules.script_engine.author_conflicts import AuthorConflictReviewRepository
from app.modules.script_engine.author_revision_service import AuthorRevisionService
from app.modules.script_engine.long_story_models import StoryProjectWorkspaceSave
from app.modules.script_engine.long_story_service import LongStoryNotFoundError
from app.modules.script_engine.models import ScriptDraftModificationRequest, ScriptGenerationDraftRequest
from test_author_conflicts import ReviewAdapter
from test_author_revision_service import PROJECT_ID, revision_context
from test_script_generation_service import seed_dependencies


@pytest.fixture
def workflow(revision_context):
    runtime, long_story, revision_service, adapter, revision_request, bible, workspace = revision_context
    reviewer = ReviewAdapter()
    generation, spec_id = seed_dependencies(author_conflict_llm_adapter=reviewer)
    generation._author_conflict_repository = AuthorConflictReviewRepository(lambda: runtime)
    source = generation.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en", desired_scene_count=3,
    ))
    draft = source.draft_master_script.model_copy(update={"synopsis": bible.ending_direction})
    source = source.model_copy(update={"story_project_id": PROJECT_ID, "draft_master_script": draft})
    long_story.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id=PROJECT_ID, client_instance_id="fixture.review_workflow",
        revision=workspace.revision + 1,
        workspace_payload={
            **workspace.workspace_payload,
            "generationRun": source.model_dump(mode="json"),
            "workingDraftJson": draft.model_dump_json(),
        },
    ))
    workspace = long_story.get_workspace_snapshot(PROJECT_ID)
    reviewer.output = {
        "user_goal": revision_request.instruction,
        "conflicts": [{
            "source_ref": "source_draft_master_script.synopsis",
            "established_fact": bible.ending_direction,
            "requested_change": revision_request.instruction,
            "impact": "The approved ending needs to change.",
        }],
        "options": [{
            "option_id": "revise.ending", "kind": "revise_upstream",
            "title": "Revise the ending", "plan": revision_request.resolution_plan,
            "impact": "Create a separate draft and review its planning.",
        }],
    }
    request = ScriptDraftModificationRequest(
        source_generation_run=source, source_draft_master_script=draft,
        source_story_bible_version=bible.version, instruction=revision_request.instruction,
    )
    app = FastAPI()
    app.include_router(generation_router)
    app.include_router(revision_router)
    app.dependency_overrides[get_script_generation_service] = lambda: generation
    # Each request receives a new service, so the handoff must use SQLite.
    app.dependency_overrides[get_author_revision_service] = lambda: AuthorRevisionService(
        runtime, revision_service._planning_service,
    )
    with TestClient(app) as client:
        response = client.post("/script-generation/modify-draft", json=request.model_dump(mode="json"))
        assert response.status_code == 200, response.text
        review_data = response.json()["data"]
        assert review_data["candidate_generation_run"] is None
        review = review_data["conflict_review"]
        stored = AuthorConflictReviewRepository(lambda: runtime).get(review["review_id"])
        assert stored.source_project_id == PROJECT_ID
        assert stored.review.model_dump(mode="json") == review
        assert len(reviewer.prompts) == 1
        assert adapter.calls == 0
        assert long_story.get_workspace_snapshot(PROJECT_ID) == workspace
        body = {
            "source_story_bible_version": review["source_story_bible_version"],
            "expected_workspace_revision": workspace.revision,
            "instruction": review["instruction"],
            "resolution_plan": review["options"][0]["plan"],
            "request_id": str(uuid4()), "review_id": review["review_id"],
            "option_id": review["options"][0]["option_id"],
        }
        yield client, long_story, adapter, body, bible, workspace
    runtime.engine.dispose()


def test_review_api_hands_off_to_revision_api_without_replacing_source(workflow):
    client, long_story, adapter, body, bible, workspace = workflow
    original_project = long_story.get_project(PROJECT_ID)
    url = f"/story-projects/{PROJECT_ID}/author-revisions"
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["story_bible"]["status"] == "draft"
    assert result["story_bible"]["version"] == 1
    assert result["story_bible"]["ending_direction"] == adapter.output["ending_direction"]
    assert result["workspace_payload"]["episodes"] == []
    assert long_story.get_project(PROJECT_ID) == original_project
    assert long_story.get_story_bible(PROJECT_ID, bible.story_bible_id) == bible
    assert long_story.get_workspace_snapshot(PROJECT_ID) == workspace
    assert client.post(url, json=body).json()["data"] == result
    assert adapter.calls == 1


def test_real_review_is_rejected_when_source_changes_before_confirmation(workflow):
    client, long_story, adapter, body, _, workspace = workflow
    long_story.save_workspace_snapshot(StoryProjectWorkspaceSave(
        project_id=PROJECT_ID, client_instance_id="fixture.concurrent_author",
        revision=workspace.revision + 1,
        workspace_payload={**workspace.workspace_payload, "workingDraftJson": "Edited after review"},
    ))
    response = client.post(f"/story-projects/{PROJECT_ID}/author-revisions", json=body)
    assert response.status_code == 409
    assert adapter.calls == 0
    with pytest.raises(LongStoryNotFoundError):
        long_story.get_project(f"story_project.author_revision.{body['request_id'].replace('-', '')}")
    assert long_story.get_workspace_snapshot(PROJECT_ID).workspace_payload["workingDraftJson"] == "Edited after review"
