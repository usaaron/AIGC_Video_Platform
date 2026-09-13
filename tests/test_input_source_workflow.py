"""Validate imported facts across the public readiness and inspiration routes."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel

from app.api.routes.input_readiness import get_input_readiness_service, router as readiness_router
from app.api.routes.story_projects import router as projects_router
from app.database import create_database_runtime
from app.dependencies import get_story_planning_service
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.input_readiness.service import CreativeInputReadinessService
from app.modules.script_engine.llm_adapter import LLMStructuredOutputError, MockLLMAdapter
from app.modules.script_engine.long_story_models import StoryProject
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.repository import GenerationStrategyRepository
from app.modules.script_engine.story_planning_service import StoryPlanningService
from test_input_source_handoff import SOURCE
from test_story_planning_service import build_content_spec, build_strategy


@pytest.mark.parametrize("invalid_model_output", [False, True], ids=["model", "recovery"])
def test_imported_facts_survive_inspiration_and_deferred_answer_round(tmp_path, invalid_model_output):
    class InspirationAdapter(MockLLMAdapter):
        def generate_structured_output(self, prompt, *, strategy, output_schema=None):
            assert output_schema["title"] == "StoryInspirationTurnModelOutput"
            if invalid_model_output:
                raise LLMStructuredOutputError("Invalid fixture output", raw_content="{invalid")
            return {
                "assistant_message": "The supplied facts are retained for this round.",
                "questions": [], "brief_patch": {}, "ready_to_generate": False,
            }

    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'source-workflow.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    content_specs = ContentSpecRepository()
    strategies = GenerationStrategyRepository()
    content_spec = content_specs.save(build_content_spec())
    strategy = strategies.save(build_strategy())
    long_story = LongStoryService(runtime)
    project = long_story.save_project(StoryProject(
        project_id="story_project.input_source_workflow", title="Imported source workflow",
        content_spec_id=content_spec.id, planned_episode_count=20,
    ))
    planning = StoryPlanningService(
        long_story_service=long_story, content_spec_repository=content_specs,
        generation_strategy_repository=strategies, llm_adapter=InspirationAdapter(),
    )
    references = [{
        "file_name": "source.txt", "purpose": "story_reference",
        "purpose_note": "", "extracted_text": SOURCE,
    }]
    app = FastAPI()
    app.include_router(readiness_router)
    app.include_router(projects_router)
    app.dependency_overrides[get_input_readiness_service] = lambda: CreativeInputReadinessService()
    app.dependency_overrides[get_story_planning_service] = lambda: planning
    try:
        with TestClient(app) as client:
            response = client.post("/input-readiness/analyze", json={
                "creative_prompt": "", "reference_materials": references,
                "episode_count": 20, "use_model": False,
            })
            assert response.status_code == 200, response.text
            assessment = response.json()["data"]
            assert assessment["requires_user_confirmation"] is True
            assert assessment["structurally_complete"] is False
            facts = assessment["known_facts"]
            assert {"protagonist_and_goal", "ending_direction"} <= {fact["field"] for fact in facts}
            for fact in facts:
                assert fact["source_id"] == "reference_1"
                assert SOURCE[fact["start"]:fact["end"]] == fact["quote"]

            body = {
                "story_project_id": project.project_id, "content_spec_id": content_spec.id,
                "generation_strategy_id": strategy.id, "creative_prompt": "Use the supplied reference.",
                "reference_materials": references, "target_episode_count": 20,
            }
            url = f"/story-projects/{project.project_id}/story-bibles/inspiration-chat"
            response = client.post(url, json=body)
            assert response.status_code == 200, response.text
            result = response.json()["data"]
            for fact in facts:
                if fact["field"] in {"protagonist_and_goal", "ending_direction"}:
                    assert fact["quote"] in result["brief"][fact["field"]]
            assert result["ready_to_generate"] is False
            assert not any(question["decision_key"].startswith(("protagonist_and_goal.", "ending_direction."))
                           for question in result["questions"])

            brief = {**result["brief"], "protagonist_and_goal": "The author changed the protagonist's goal.",
                     "ending_direction": "", "creative_decisions": [{
                         "decision_key": "ending_direction.choice", "title": "Defer the ending",
                         "status": "unresolved",
                     }]}
            response = client.post(url, json={**body, "current_brief": brief})
            assert response.status_code == 200, response.text
            continued = response.json()["data"]["brief"]
            assert continued["protagonist_and_goal"] == brief["protagonist_and_goal"]
            assert continued["ending_direction"] == ""
            assert continued["creative_decisions"][0]["status"] == "unresolved"
            assert long_story.get_project(project.project_id) == project
            assert project.active_story_bible_id is None
    finally:
        runtime.engine.dispose()
