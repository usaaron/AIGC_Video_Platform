from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_content_spec_service
from app.modules.content_spec.models import (
    ContentSpecCreate,
    ContentSpecListResponse,
    ContentSpecResponse,
    CreativeIntentInput,
    CreativeIntentResolutionResponse,
    ErrorResponse,
)
from app.modules.content_spec.service import (
    ContentSpecService,
    CreativeIntentConflictError,
    InactiveOntologyNodeError,
    InvalidTagReferenceError,
    MissingOntologyNodeError,
    MissingPlatformProfileError,
)

router = APIRouter(prefix="/content-specs", tags=["ContentSpec"])


@router.post(
    "",
    response_model=ContentSpecResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_content_spec(
    payload: ContentSpecCreate,
    service: ContentSpecService = Depends(get_content_spec_service),
) -> ContentSpecResponse:
    try:
        content_spec = service.create(payload)
    except MissingPlatformProfileError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except MissingOntologyNodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except InvalidTagReferenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return ContentSpecResponse(data=content_spec)


@router.post(
    "/resolve-creative-intent",
    response_model=CreativeIntentResolutionResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def resolve_creative_intent(
    payload: CreativeIntentInput,
    service: ContentSpecService = Depends(get_content_spec_service),
) -> CreativeIntentResolutionResponse:
    try:
        result = service.resolve_creative_intent(payload)
    except (MissingPlatformProfileError, MissingOntologyNodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except (CreativeIntentConflictError, InactiveOntologyNodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return CreativeIntentResolutionResponse(data=result)


@router.get(
    "",
    response_model=ContentSpecListResponse,
)
def list_content_specs(
    service: ContentSpecService = Depends(get_content_spec_service),
) -> ContentSpecListResponse:
    return ContentSpecListResponse(data=service.list())


@router.get(
    "/{content_spec_id}",
    response_model=ContentSpecResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_content_spec(
    content_spec_id: str,
    service: ContentSpecService = Depends(get_content_spec_service),
) -> ContentSpecResponse:
    content_spec = service.get(content_spec_id)
    if content_spec is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ContentSpec '{content_spec_id}' was not found.",
        )

    return ContentSpecResponse(data=content_spec)
