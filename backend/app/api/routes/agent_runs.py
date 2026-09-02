from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_agent_run_service
from app.modules.agent_runtime.models import (
    AgentRunListResponse,
    AgentRunResponse,
)
from app.modules.agent_runtime.service import (
    AgentRunPersistenceUnavailableError,
    AgentRunService,
)


router = APIRouter(
    prefix="/story-projects/{project_id}/agent-runs",
    tags=["Agent Runtime"],
)


@router.get("/{run_id}", response_model=AgentRunResponse)
def get_agent_run(
    project_id: str,
    run_id: str,
    service: AgentRunService = Depends(get_agent_run_service),
) -> AgentRunResponse:
    try:
        run = service.get_run(run_id)
    except AgentRunPersistenceUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Agent persistence is unavailable.",
        ) from exc
    if run is None or run.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent run not found.",
        )
    return AgentRunResponse(data=run)


@router.get("", response_model=AgentRunListResponse)
def list_agent_runs(
    project_id: str,
    episode_number: int | None = Query(default=None, ge=1, le=2_000),
    limit: int = Query(default=50, ge=1, le=100),
    service: AgentRunService = Depends(get_agent_run_service),
) -> AgentRunListResponse:
    try:
        return AgentRunListResponse(
            data=service.list_runs(
                project_id=project_id,
                episode_number=episode_number,
                limit=limit,
            )
        )
    except AgentRunPersistenceUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Agent persistence is unavailable.",
        ) from exc
