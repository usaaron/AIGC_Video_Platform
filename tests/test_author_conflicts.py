from copy import deepcopy

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.dependencies import get_script_generation_service
from app.main import create_app
from app.modules.script_engine.author_conflict_models import AuthorConflictResolution
from app.modules.script_engine.author_conflicts import AuthorConflictResolutionError, AuthorConflictReviewRepository
from app.modules.script_engine.generation_service import InvalidDraftMasterScriptOutputError
from app.modules.script_engine.llm_adapter import MockLLMAdapter
from app.modules.script_engine.models import ScriptDraftModificationRequest, ScriptGenerationDraftRequest
from test_script_generation_service import seed_dependencies


class ReviewAdapter(MockLLMAdapter):
    def __init__(self):
        super().__init__()
        self.output = {}
        self.prompts = []

    def generate_structured_output(self, prompt, *, strategy, output_schema=None):
        self.prompts.append(prompt)
        assert output_schema["title"] == "AuthorConflictAssessment"
        return deepcopy(self.output)


@pytest.fixture
def case():
    adapter = ReviewAdapter()
    service, content_spec_id = seed_dependencies(author_conflict_llm_adapter=adapter)
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en", desired_scene_count=3,
    ))
    source = source.model_copy(update={"draft_master_script": source.draft_master_script.model_copy(update={
        "synopsis": "主角不信任对方，独自调查旧案，目标是查清证据来源。",
    })})
    request = ScriptDraftModificationRequest(
        source_generation_run=source,
        source_draft_master_script=source.draft_master_script,
        instruction="让主角在本集决定与对方合作，但保留她追查真相的目标。",
    )
    adapter.output = {
        "user_goal": "让主角选择合作，同时保留调查目标。",
        "conflicts": [{
            "source_ref": "source_draft_master_script.synopsis",
            "established_fact": "主角不信任对方，独自调查旧案",
            "requested_change": "主角开始与对方合作。",
            "impact": "需要交代合作如何服务原有调查目标，否则动机突然跳变。",
        }],
        "options": [{
            "option_id": "bridge.cooperation", "kind": "bridge", "title": "为调查建立有限合作",
            "plan": "主角明确合作仅为核验现有证据，仍保留质疑，以原有行动展示合作界限。",
            "impact": "调整本集动作和对白，保留调查目标、既有事实与结局。",
        }, {
            "option_id": "revise.goal", "kind": "revise_upstream", "title": "重新设定合作目标",
            "plan": "修订人物长期目标为共同查明真相，并保留原有调查事件与角色身份。",
            "impact": "在独立修订版本中调整总纲并重新确认规划。",
        }],
    }
    return service, request, adapter


def test_conflict_returns_review_without_rewriting_or_mutating_source(case, monkeypatch):
    service, request, adapter = case
    original = request.model_dump()
    monkeypatch.setattr(service._llm_adapter, "generate_structured_output", lambda *a, **k: pytest.fail("rewrote before choice"))
    result = service.modify_draft(request)
    assert result.candidate_generation_run is None
    assert result.conflict_review.instruction == request.instruction
    assert len(result.conflict_review.options) == 2
    assert request.model_dump() == original
    assert "不预选、不排名" in adapter.prompts[0]
    assert "平台审美" in adapter.prompts[0]


def test_clear_request_keeps_existing_candidate_workflow(case):
    service, request, adapter = case
    adapter.output.update(conflicts=[], options=[])
    result = service.modify_draft(request)
    assert result.conflict_review is None
    assert result.candidate_generation_run is not None


def test_confirmed_bridge_is_saved_with_candidate_and_does_not_reassess(case):
    service, request, adapter = case
    review = service.modify_draft(request).conflict_review
    resolved = request.model_copy(update={"resolution": AuthorConflictResolution(review=review, option_id="bridge.cooperation")})
    result = service.modify_draft(resolved)
    assert len(adapter.prompts) == 1
    candidate = result.candidate_generation_run
    assert "AuthorConfirmedResolutionContract" in candidate.prompt_build_result.prompt_text
    assert review.options[0].plan in candidate.prompt_build_result.prompt_text
    record = candidate.draft_master_script.llm_metadata["author_conflict_resolution"]
    assert record["review_id"] == review.review_id
    assert record["scope"] == "episode_candidate"
    assert "author_conflict_resolution" not in request.source_draft_master_script.llm_metadata


@pytest.mark.parametrize("change", ["draft", "instruction", "bible_version", "plan", "missing", "upstream"])
def test_confirmation_rejects_stale_forged_or_wrong_scope_without_model(case, monkeypatch, change):
    service, request, _ = case
    review = service.modify_draft(request).conflict_review
    option_id = "bridge.cooperation"
    if change == "draft":
        request = request.model_copy(update={"source_draft_master_script": request.source_draft_master_script.model_copy(update={"hook": "A changed source hook."})})
    elif change == "instruction":
        request = request.model_copy(update={"instruction": "现在希望完全改写主角的目标。"})
    elif change == "bible_version":
        request = request.model_copy(update={"source_story_bible_version": 2})
    elif change == "plan":
        review = review.model_copy(deep=True)
        review.options[0].plan = "借衔接方案的名义改写所有过去事件。"
    elif change == "missing":
        service._author_conflict_repository = AuthorConflictReviewRepository()
    elif change == "upstream":
        option_id = "revise.goal"
    monkeypatch.setattr(service._llm_adapter, "generate_structured_output", lambda *a, **k: pytest.fail("unexpected rewrite"))
    with pytest.raises(AuthorConflictResolutionError):
        service.modify_draft(request.model_copy(update={"resolution": AuthorConflictResolution(review=review, option_id=option_id)}))


def test_invented_conflict_evidence_is_not_shown_as_established_fact(case):
    service, request, adapter = case
    adapter.output["conflicts"][0]["established_fact"] = "原稿中并不存在的角色设定。"
    with pytest.raises(InvalidDraftMasterScriptOutputError, match="可核对"):
        service.modify_draft(request)


def test_new_author_instruction_cannot_be_cited_as_an_established_fact(case):
    service, request, adapter = case
    adapter.output["conflicts"][0].update(
        source_ref="instruction", established_fact=request.instruction,
    )
    with pytest.raises(InvalidDraftMasterScriptOutputError, match="可核对"):
        service.modify_draft(request)


def test_saved_review_survives_repository_restart(case, tmp_path):
    service, request, _ = case
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'author-conflicts.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    try:
        service._author_conflict_repository = AuthorConflictReviewRepository(lambda: runtime)
        review = service.modify_draft(request).conflict_review
        service._author_conflict_repository = AuthorConflictReviewRepository(lambda: runtime)
        result = service.modify_draft(request.model_copy(update={"resolution": AuthorConflictResolution(review=review, option_id="bridge.cooperation")}))
        assert result.candidate_generation_run is not None
    finally:
        runtime.engine.dispose()


@pytest.mark.anyio
async def test_api_returns_review_as_data_and_rejects_changed_confirmation(case):
    service, request, _ = case
    app = create_app()
    app.dependency_overrides[get_script_generation_service] = lambda: service
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/script-generation/modify-draft", json=request.model_dump(mode="json"))
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["candidate_generation_run"] is None
        assert data["conflict_review"]["conflicts"][0]["established_fact"] == "主角不信任对方，独自调查旧案"
        changed = request.model_dump(mode="json")
        changed["instruction"] = "更换后的修改要求不应复用先前的确认。"
        changed["resolution"] = {"review": data["conflict_review"], "option_id": "bridge.cooperation"}
        response = await client.post("/script-generation/modify-draft", json=changed)
        assert response.status_code == 409
        assert "重新检查影响" in response.json()["detail"]
