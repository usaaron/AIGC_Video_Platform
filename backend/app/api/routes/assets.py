from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_asset_service
from app.modules.asset.models import (
    AssetCreate,
    AssetListResponse,
    AssetResponse,
    ErrorResponse,
)
from app.modules.asset.service import (
    AssetService,
    DuplicateAssetError,
    InvalidTagReferenceError,
    MissingOntologyNodeError,
    MissingPlatformProfileError,
)

router = APIRouter(prefix="/assets", tags=["Assets"])


@router.post(
    "",
    response_model=AssetResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_asset(
    payload: AssetCreate,
    service: AssetService = Depends(get_asset_service),
) -> AssetResponse:
    try:
        asset = service.create(payload)
    except MissingOntologyNodeError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except MissingPlatformProfileError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (DuplicateAssetError, InvalidTagReferenceError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return AssetResponse(data=asset)


@router.get("", response_model=AssetListResponse)
def list_assets(
    service: AssetService = Depends(get_asset_service),
) -> AssetListResponse:
    return AssetListResponse(data=service.list())


@router.get(
    "/{asset_id}",
    response_model=AssetResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_asset(
    asset_id: str,
    service: AssetService = Depends(get_asset_service),
) -> AssetResponse:
    asset = service.get(asset_id)
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset '{asset_id}' was not found.",
        )

    return AssetResponse(data=asset)
