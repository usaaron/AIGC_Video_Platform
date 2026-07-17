from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_retrieval_service
from app.modules.retrieval.models import (
    ErrorResponse,
    RetrievalPlanResultResponse,
    RetrievalResolveRequest,
)
from app.modules.retrieval.service import (
    MissingOrchestrationPlanError,
    RetrievalService,
)

router = APIRouter(prefix="/retrieval", tags=["Retrieval"])


@router.post(
    "/resolve",
    response_model=RetrievalPlanResultResponse,
    status_code=status.HTTP_200_OK,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def resolve_retrieval_plan(
    payload: RetrievalResolveRequest,
    service: RetrievalService = Depends(get_retrieval_service),
) -> RetrievalPlanResultResponse:
    try:
        result = service.resolve(payload)
    except MissingOrchestrationPlanError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    return RetrievalPlanResultResponse(data=result)
