from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.dependencies import get_agent_run_service
from app.main import create_app
from app.modules.agent_runtime.models import AgentRunPolicy
from app.modules.agent_runtime.service import AgentRunService


@pytest.mark.anyio
async def test_agent_run_queries_are_scoped_to_project() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    service = AgentRunService(runtime)
    started = service.start_session(
        agent_name="episode_script",
        subject_ref="project.alpha:episode-1",
        policy=AgentRunPolicy(
            max_steps=1,
            max_model_tool_calls=0,
            allowed_tools=frozenset({"inspect"}),
        ),
        request_key="agent-request.project-scope",
        input_fingerprint="7" * 64,
        project_id="project.alpha",
        episode_number=1,
    )
    assert started.session is not None
    completed = started.session.complete(result_type="episode_script_run.v1")

    app = create_app()
    app.dependency_overrides[get_agent_run_service] = lambda: service
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        correct = await client.get(
            f"/story-projects/project.alpha/agent-runs/{completed.run_id}"
        )
        wrong = await client.get(
            f"/story-projects/project.beta/agent-runs/{completed.run_id}"
        )
        wrong_list = await client.get(
            "/story-projects/project.beta/agent-runs"
        )

    assert correct.status_code == 200
    assert correct.json()["data"]["project_id"] == "project.alpha"
    assert wrong.status_code == 404
    assert wrong_list.status_code == 200
    assert wrong_list.json()["data"] == []
