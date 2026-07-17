from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_prompt_library_service
from app.modules.script_engine.models import (
    ErrorResponse,
    PromptLibraryItemCreate,
    PromptLibraryItemListResponse,
    PromptLibraryItemResponse,
)
from app.modules.script_engine.service import (
    DuplicatePromptLibraryItemError,
    MissingOntologyNodeError,
    PromptLibraryService,
)

router = APIRouter(prefix="/prompt-library", tags=["Prompt Library"])


@router.post(
    "",
    response_model=PromptLibraryItemResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_prompt_library_item(
    payload: PromptLibraryItemCreate,
    service: PromptLibraryService = Depends(get_prompt_library_service),
) -> PromptLibraryItemResponse:
    try:
        item = service.create(payload)
    except MissingOntologyNodeError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicatePromptLibraryItemError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return PromptLibraryItemResponse(data=item)


@router.get("", response_model=PromptLibraryItemListResponse)
def list_prompt_library_items(
    service: PromptLibraryService = Depends(get_prompt_library_service),
) -> PromptLibraryItemListResponse:
    return PromptLibraryItemListResponse(data=service.list())


@router.get(
    "/{item_id}",
    response_model=PromptLibraryItemResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_prompt_library_item(
    item_id: str,
    service: PromptLibraryService = Depends(get_prompt_library_service),
) -> PromptLibraryItemResponse:
    item = service.get(item_id)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PromptLibraryItem '{item_id}' was not found.",
        )

    return PromptLibraryItemResponse(data=item)
