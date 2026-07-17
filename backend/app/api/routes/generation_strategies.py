from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_generation_strategy_service
from app.modules.script_engine.models import (
    ErrorResponse,
    GenerationStrategyCreate,
    GenerationStrategyListResponse,
    GenerationStrategyResponse,
)
from app.modules.script_engine.service import (
    DuplicateGenerationStrategyError,
    GenerationStrategyService,
    MissingOntologyNodeError,
    MissingPromptLibraryItemError,
)

router = APIRouter(prefix="/generation-strategies", tags=["Generation Strategies"])


@router.post(
    "",
    response_model=GenerationStrategyResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_generation_strategy(
    payload: GenerationStrategyCreate,
    service: GenerationStrategyService = Depends(get_generation_strategy_service),
) -> GenerationStrategyResponse:
    try:
        item = service.create(payload)
    except (MissingOntologyNodeError, MissingPromptLibraryItemError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateGenerationStrategyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return GenerationStrategyResponse(data=item)


@router.get("", response_model=GenerationStrategyListResponse)
def list_generation_strategies(
    service: GenerationStrategyService = Depends(get_generation_strategy_service),
) -> GenerationStrategyListResponse:
    return GenerationStrategyListResponse(data=service.list())


@router.get(
    "/{item_id}",
    response_model=GenerationStrategyResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_generation_strategy(
    item_id: str,
    service: GenerationStrategyService = Depends(get_generation_strategy_service),
) -> GenerationStrategyResponse:
    item = service.get(item_id)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"GenerationStrategy '{item_id}' was not found.",
        )

    return GenerationStrategyResponse(data=item)
