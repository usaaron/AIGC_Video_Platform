from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_prompt_retrieval_service
from app.modules.script_engine.models import (
    ErrorResponse,
    PromptRetrievalRequest,
    PromptRetrievalResponse,
)
from app.modules.script_engine.prompt_retrieval import (
    MissingPromptRetrievalStrategyError,
    PromptRetrievalService,
)
from app.modules.script_engine.service import MissingPromptLibraryItemError

router = APIRouter(prefix="/prompt-retrieval", tags=["Prompt Retrieval"])


@router.post(
    "/resolve",
    response_model=PromptRetrievalResponse,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def resolve_prompt_retrieval(
    payload: PromptRetrievalRequest,
    service: PromptRetrievalService = Depends(get_prompt_retrieval_service),
) -> PromptRetrievalResponse:
    try:
        result = service.resolve(payload)
    except (
        MissingPromptRetrievalStrategyError,
        MissingPromptLibraryItemError,
    ) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return PromptRetrievalResponse(data=result)
