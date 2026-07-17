from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_platform_profile_service
from app.modules.platform_profile.models import (
    ErrorResponse,
    PlatformProfileCreate,
    PlatformProfileListResponse,
    PlatformProfileResponse,
)
from app.modules.platform_profile.service import (
    DuplicatePlatformProfileError,
    PlatformProfileService,
)

router = APIRouter(prefix="/platform-profiles", tags=["PlatformProfile"])


@router.post(
    "",
    response_model=PlatformProfileResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_platform_profile(
    payload: PlatformProfileCreate,
    service: PlatformProfileService = Depends(get_platform_profile_service),
) -> PlatformProfileResponse:
    try:
        platform_profile = service.create(payload)
    except DuplicatePlatformProfileError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return PlatformProfileResponse(data=platform_profile)


@router.get(
    "",
    response_model=PlatformProfileListResponse,
)
def list_platform_profiles(
    service: PlatformProfileService = Depends(get_platform_profile_service),
) -> PlatformProfileListResponse:
    return PlatformProfileListResponse(data=service.list())


@router.get(
    "/{platform_profile_id}",
    response_model=PlatformProfileResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_platform_profile(
    platform_profile_id: str,
    service: PlatformProfileService = Depends(get_platform_profile_service),
) -> PlatformProfileResponse:
    platform_profile = service.get(platform_profile_id)
    if platform_profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PlatformProfile '{platform_profile_id}' was not found.",
        )

    return PlatformProfileResponse(data=platform_profile)
