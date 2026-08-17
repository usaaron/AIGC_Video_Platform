import logging

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, model_validator

from app.dependencies import get_story_planning_service
from app.main import create_app
from app.api.routes.script_generation import (
    _llm_request_is_retryable,
    _raise_llm_configuration_unavailable,
    _raise_llm_upstream_unavailable,
)
from app.api.routes.story_projects import (
    _raise_planning_output_incomplete,
    _raise_planning_upstream_unavailable,
)
from app.modules.script_engine.llm_adapter import (
    LLMRequestError,
    LLMStructuredOutputError,
    MissingLLMConfigurationError,
)
from app.modules.script_engine.story_planning_service import (
    StoryPlanningTransientOutputError,
)


def test_generation_retry_metadata_separates_transient_and_deterministic_failures() -> None:
    transient = LLMRequestError(
        "provider gateway failed",
        status_code=502,
        category="provider_gateway",
        recoverable=True,
    )
    rejected = LLMRequestError(
        "provider rejected authentication",
        status_code=401,
        category="provider_http",
        recoverable=True,
    )

    assert _llm_request_is_retryable(transient) is True
    assert _llm_request_is_retryable(rejected) is False

    with pytest.raises(HTTPException) as script_transient:
        _raise_llm_upstream_unavailable(transient)
    assert script_transient.value.headers == {
        "X-Generation-Retryable": "true",
        "X-Generation-Failure-Class": "transient_upstream",
        "X-Generation-Error-Type": "upstream_unavailable",
    }

    with pytest.raises(HTTPException) as script_rejected:
        _raise_llm_upstream_unavailable(rejected)
    assert script_rejected.value.headers == {
        "X-Generation-Retryable": "false",
        "X-Generation-Failure-Class": "auth",
        "X-Generation-Error-Type": "provider_request_rejected",
    }

    with pytest.raises(HTTPException) as planning_transient:
        _raise_planning_upstream_unavailable(
            transient,
            artifact="story_bible",
            project_id="project.retry-metadata",
        )
    assert planning_transient.value.headers == script_transient.value.headers


def test_missing_model_configuration_is_never_automatically_retried() -> None:
    with pytest.raises(HTTPException) as captured:
        _raise_llm_configuration_unavailable(
            MissingLLMConfigurationError("SCRIPT_WRITER_API_KEY is missing"),
        )

    assert captured.value.status_code == 503
    assert captured.value.headers == {
        "X-Generation-Retryable": "false",
        "X-Generation-Failure-Class": "configuration",
        "X-Generation-Error-Type": "configuration_unavailable",
    }


def test_planning_output_metadata_separates_transport_from_contract_failures() -> None:
    with pytest.raises(HTTPException) as transient:
        _raise_planning_output_incomplete(
            StoryPlanningTransientOutputError("empty streamed decomposition"),
        )
    assert transient.value.status_code == 503
    assert transient.value.headers == {
        "X-Generation-Retryable": "true",
        "X-Generation-Failure-Class": "transient_upstream",
        "X-Generation-Error-Type": "stream_incomplete",
    }

    with pytest.raises(HTTPException) as contract:
        _raise_planning_output_incomplete(
            LLMStructuredOutputError(
                "complete response used the wrong contract",
                raw_content='{"unexpected":true}',
                stream_termination="completed",
            ),
        )
    assert contract.value.status_code == 422
    assert contract.value.headers == {
        "X-Generation-Retryable": "false",
        "X-Generation-Failure-Class": "contract",
        "X-Generation-Error-Type": "output_incomplete",
    }


@pytest.mark.anyio
async def test_request_validation_returns_field_detail_and_logs_route(caplog) -> None:
    caplog.set_level(logging.WARNING, logger="app.main")

    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/script-generation/generate-draft",
            json={
                "content_spec_id": "content.valid",
                "generation_strategy_id": "strategy.valid",
                "output_language": "zh",
                "desired_scene_count": 3,
                "episode_context": {
                    "generation_mode": "full",
                    "episode_number": 2,
                    "total_episodes": 4,
                    "unexpected_context_field": True,
                },
            },
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["loc"][-1] == "unexpected_context_field"
    assert "Request validation failed" in caplog.text
    assert "/script-generation/generate-draft" in caplog.text


@pytest.mark.anyio
async def test_model_validation_context_is_json_serializable() -> None:
    class InvalidBatchPayload(BaseModel):
        planned_episode_count: int
        default_batch_size: int

        @model_validator(mode="after")
        def validate_batch_size(self) -> "InvalidBatchPayload":
            if self.default_batch_size > self.planned_episode_count:
                raise ValueError(
                    "default_batch_size must not exceed planned_episode_count."
                )
            return self

    app = create_app()

    @app.post("/_test/model-validation")
    async def validate_model(_payload: InvalidBatchPayload) -> dict[str, bool]:
        return {"valid": True}

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/_test/model-validation",
            json={
                "planned_episode_count": 4,
                "default_batch_size": 8,
            },
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["loc"] == ["body"]
    assert detail[0]["ctx"]["error"] == (
        "default_batch_size must not exceed planned_episode_count."
    )


def test_frontend_workflow_endpoints_exist_with_expected_http_methods() -> None:
    """Guard the active creation-to-export clients against backend route drift."""

    operations = create_app().openapi()["paths"]
    expected = {
        "/ontology-nodes": {"get"},
        "/platform-profiles": {"get"},
        "/generation-strategies": {"get"},
        "/content-specs/resolve-creative-intent": {"post"},
        "/story-projects": {"get"},
        "/story-projects/{project_id}": {"get", "put"},
        "/story-projects/{project_id}/permanent": {"delete"},
        "/story-projects/{project_id}/workspace": {"get", "put"},
        "/story-projects/{project_id}/generation-tasks/recoverable": {"get"},
        "/story-projects/{project_id}/generation-tasks/{job_id}": {"put"},
        "/story-projects/{project_id}/creative-directions/draft": {"post"},
        "/story-projects/{project_id}/story-bibles/draft": {"post"},
        "/story-projects/{project_id}/story-bibles/{story_bible_id}": {"get"},
        "/story-projects/{project_id}/story-bibles/{story_bible_id}/modify": {"post"},
        "/story-projects/{project_id}/story-bibles/{story_bible_id}/versions/{version}": {"put"},
        "/story-projects/{project_id}/plan-nodes": {"get"},
        "/story-projects/{project_id}/plan-nodes/draft": {"post"},
        "/story-projects/{project_id}/plan-nodes/top-level/draft": {"post"},
        "/story-projects/{project_id}/plan-nodes/{node_id}/modify": {"post"},
        "/story-projects/{project_id}/plan-nodes/{node_id}/decompose": {"post"},
        "/story-projects/{project_id}/plan-nodes/{node_id}/versions/{version}": {"put"},
        "/story-projects/{project_id}/plan-nodes/{node_id}/episode-plans/{episode_number}/draft": {"post"},
        "/story-projects/{project_id}/episode-plans": {"get"},
        "/story-projects/{project_id}/episode-plans/{episode_plan_id}/versions/{version}": {"put"},
        "/story-projects/{project_id}/episodes/{episode_number}/artifacts": {"post"},
        "/story-projects/{project_id}/continuity-ledger/latest": {"get"},
        "/script-generation/generate-draft": {"post"},
        "/script-generation/generate-draft/stream": {"post"},
        "/script-generation/review-draft": {"post"},
        "/script-generation/modify-draft": {"post"},
        "/script-generation/deepen-draft": {"post"},
        "/script-generation/build-bilingual-view": {"post"},
        "/script-generation/revise-draft": {"post"},
        "/master-scripts/finalize": {"post"},
    }

    for path, methods in expected.items():
        assert path in operations, f"Missing frontend workflow route: {path}"
        assert methods.issubset(operations[path]), (
            f"{path} is missing methods {sorted(methods - operations[path].keys())}"
        )


@pytest.mark.anyio
async def test_planning_gateway_error_hides_provider_diagnostics() -> None:
    private_diagnostic = "502 <!DOCTYPE html><title>private upstream gateway</title>"

    class FailedPlanningService:
        def generate_creative_directions(self, _payload):
            raise LLMRequestError(
                private_diagnostic,
                status_code=502,
                category="provider_gateway",
            )

    app = create_app()
    app.dependency_overrides[get_story_planning_service] = FailedPlanningService
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/story-projects/project.safe-errors/creative-directions/draft",
            json={
                "story_project_id": "project.safe-errors",
                "generation_strategy_id": "strategy.safe-errors",
                "creative_prompt": "一个公开审判引发的复仇故事",
            },
        )

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "剧情规划模型服务暂时未完成请求，已保存的规划内容不会丢失，请重试当前部分。"
    )
    assert private_diagnostic not in response.text
