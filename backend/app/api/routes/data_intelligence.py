from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_data_intelligence_service
from app.modules.content_spec.models import ErrorResponse
from app.modules.data_intelligence.models import (
    DataPipelineResponse,
    ManualCSVPipelineRequest,
    ManualJSONPipelineRequest,
)
from app.modules.data_intelligence.service import (
    DataIntelligenceService,
    MissingPlatformProfileError,
    NoMappableTagsError,
)

router = APIRouter(prefix="/data-intelligence", tags=["DataIntelligence"])


@router.post(
    "/manual-json/pipeline",
    response_model=DataPipelineResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def run_manual_json_pipeline(
    payload: ManualJSONPipelineRequest,
    service: DataIntelligenceService = Depends(get_data_intelligence_service),
) -> DataPipelineResponse:
    try:
        return service.run_manual_json_pipeline(payload)
    except MissingPlatformProfileError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except NoMappableTagsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post(
    "/manual-csv/pipeline",
    response_model=DataPipelineResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def run_manual_csv_pipeline(
    payload: ManualCSVPipelineRequest,
    service: DataIntelligenceService = Depends(get_data_intelligence_service),
) -> DataPipelineResponse:
    try:
        return service.run_manual_csv_pipeline(payload)
    except MissingPlatformProfileError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except NoMappableTagsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
