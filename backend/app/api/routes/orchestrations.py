from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_orchestrator_service
from app.modules.orchestrator.models import (
    ErrorResponse,
    OrchestrationPlanCreate,
    OrchestrationPlanListResponse,
    OrchestrationPlanResponse,
)
from app.modules.orchestrator.service import (
    MissingContentSpecError,
    MissingPlatformProfileError,
    OrchestratorService,
)

router = APIRouter(prefix="/orchestrations", tags=["Orchestrator"])


@router.post(
    "",
    response_model=OrchestrationPlanResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_orchestration_plan(
    payload: OrchestrationPlanCreate,
    service: OrchestratorService = Depends(get_orchestrator_service),
) -> OrchestrationPlanResponse:
    try:
        plan = service.create(payload)
    except MissingContentSpecError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except MissingPlatformProfileError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    return OrchestrationPlanResponse(data=plan)


@router.get(
    "",
    response_model=OrchestrationPlanListResponse,
)
def list_orchestration_plans(
    service: OrchestratorService = Depends(get_orchestrator_service),
) -> OrchestrationPlanListResponse:
    return OrchestrationPlanListResponse(data=service.list())


@router.get(
    "/{plan_id}",
    response_model=OrchestrationPlanResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_orchestration_plan(
    plan_id: str,
    service: OrchestratorService = Depends(get_orchestrator_service),
) -> OrchestrationPlanResponse:
    plan = service.get(plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"OrchestrationPlan '{plan_id}' was not found.",
        )

    return OrchestrationPlanResponse(data=plan)
