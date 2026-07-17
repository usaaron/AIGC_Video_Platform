from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_trend_snapshot_service
from app.modules.trend_snapshot.models import (
    ErrorResponse,
    TrendSnapshotGenerateRequest,
    TrendSnapshotListResponse,
    TrendSnapshotResponse,
)
from app.modules.trend_snapshot.service import (
    InsufficientRunHistoryError,
    MissingDataIngestionJobError,
    TrendSnapshotService,
)

router = APIRouter(prefix="/trend-snapshots", tags=["TrendSnapshots"])


@router.post(
    "/generate",
    response_model=TrendSnapshotResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def generate_trend_snapshot(
    payload: TrendSnapshotGenerateRequest,
    service: TrendSnapshotService = Depends(get_trend_snapshot_service),
) -> TrendSnapshotResponse:
    try:
        snapshot = service.generate(payload)
    except MissingDataIngestionJobError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InsufficientRunHistoryError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return TrendSnapshotResponse(data=snapshot)


@router.get("", response_model=TrendSnapshotListResponse)
def list_trend_snapshots(
    service: TrendSnapshotService = Depends(get_trend_snapshot_service),
) -> TrendSnapshotListResponse:
    return TrendSnapshotListResponse(data=service.list())


@router.get(
    "/{snapshot_id}",
    response_model=TrendSnapshotResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_trend_snapshot(
    snapshot_id: str,
    service: TrendSnapshotService = Depends(get_trend_snapshot_service),
) -> TrendSnapshotResponse:
    snapshot = service.get(snapshot_id)
    if snapshot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"TrendSnapshot '{snapshot_id}' was not found.",
        )
    return TrendSnapshotResponse(data=snapshot)
