"""Candidate generation must not require a rewritten question or author brief."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel

from app.api.routes.story_projects import router
from app.database import create_database_runtime
from app.dependencies import get_story_planning_service
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.script_engine.llm_adapter import MockLLMAdapter
from app.modules.script_engine.long_story_models import (
    StoryProject, StoryInspirationBrief, StoryInspirationTurnModelOutput,
)
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.repository import GenerationStrategyRepository
from app.modules.script_engine.story_planning_service import StoryPlanningService
from test_grill_candidate_refresh import question, request
from test_story_planning_service import build_content_spec, build_strategy


@pytest.fixture
def candidate_client(tmp_path):
    class Adapter(MockLLMAdapter):
        output = {}

        def generate_structured_output(self, prompt, *, strategy, output_schema=None):
            assert output_schema["title"] == "StoryInspirationCandidateModelOutput"
            assert not {"questions", "brief_patch", "ready_to_generate"} & output_schema["properties"].keys()
            assert "不要返回或改写原问题" in prompt
            return self.output

    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'candidates.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    specs, strategies = ContentSpecRepository(), GenerationStrategyRepository()
    spec, strategy = specs.save(build_content_spec()), strategies.save(build_strategy())
    stories = LongStoryService(runtime)
    project = stories.save_project(StoryProject(project_id="project.candidates", title="Candidate workflow", content_spec_id=spec.id, planned_episode_count=20))
    adapter = Adapter()
    service = StoryPlanningService(long_story_service=stories, content_spec_repository=specs,
        generation_strategy_repository=strategies, llm_adapter=adapter)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_story_planning_service] = lambda: service
    payload = request(story_project_id=project.project_id, content_spec_id=spec.id, generation_strategy_id=strategy.id).model_dump(mode="json")
    try:
        with TestClient(app) as client:
            yield client, f"/story-projects/{project.project_id}/story-bibles/inspiration-chat", payload, adapter
        assert stories.get_project(project.project_id) == project
    finally:
        runtime.engine.dispose()


@pytest.mark.parametrize("legacy_wrapper", [False, True])
def test_valid_candidates_survive_irrelevant_null_patch_and_question_explanation(candidate_client, legacy_wrapper):
    client, url, payload, adapter = candidate_client
    options = ["离开城市：她公开证据后陪证人返回故乡。", "留下追查：她保护证人后继续追查旧案。"]
    adapter.output = {"assistant_message": "两个方向分别改变人物去留和调查范围。", "choices": options}
    if legacy_wrapper:
        adapter.output = {
            "assistant_message": "两个方向分别改变人物去留和调查范围。",
            "questions": [{**question().model_dump(mode="json"), "choices": options,
                           "question": "你希望人物最终去向哪里？两种选择都有不同的代价。", "title": "模型改写的标题"}],
            "brief_patch": {"must_keep": [None], "must_avoid": [None], "unresolved": [None]},
            "ready_to_generate": True,
        }
    response = client.post(url, json=payload)
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["brief"] == payload["current_brief"]
    assert result["ready_to_generate"] is False
    original = payload["messages"][-1]["questions"][0]
    assert result["questions"][0] == {**original, "choices": options, "recommended_choice": None, "recommended_answer": None}


@pytest.mark.parametrize("bad_output", [{"questions": None}, {"choices": ["重复方案", "重复方案"]}, {"choices": []}])
def test_invalid_candidates_remain_actionable_errors_without_state_changes(candidate_client, bad_output):
    client, url, payload, adapter = candidate_client
    adapter.output = {"assistant_message": "候选尚未完成。", **bad_output}
    response = client.post(url, json=payload)
    assert response.status_code == 422, response.text
    assert "已保留" in response.json()["detail"]


def test_regular_turn_accepts_question_followed_by_explanation_and_ignores_null_list_placeholders():
    current = StoryInspirationBrief(must_keep=["证人必须活着"], unresolved=["幕后人物暂不决定"])
    turn = StoryInspirationTurnModelOutput.model_validate({
        "assistant_message": "原有边界继续保留。",
        "questions": [{**question().model_dump(mode="json"),
                       "question": "你希望人物最终去向哪里？两种选择都有不同的代价。"}],
        "brief_patch": {"must_keep": [None], "unresolved": [None], "additional_notes": [None, "新补充的设定"]},
    })
    result = StoryPlanningService._expand_story_inspiration_turn(current, turn)
    assert result.brief.must_keep == current.must_keep
    assert result.brief.unresolved == current.unresolved
    assert result.brief.additional_notes == ["新补充的设定"]
    assert current.additional_notes == []
