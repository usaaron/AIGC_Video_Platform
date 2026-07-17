from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_scheduled_ingestion_service
from app.modules.scheduled_ingestion.models import (
    DataIngestionJobCreate,
    DataIngestionJobListResponse,
    DataIngestionJobResponse,
    DataIngestionRunHistoryListResponse,
    DataIngestionRunHistoryResponse,
    DataIngestionRunResultResponse,
    ErrorResponse,
)
from app.modules.scheduled_ingestion.service import (
    AdapterExecutionNotImplementedError,
    DuplicateDataIngestionJobError,
    MissingDataIngestionJobError,
    MissingPlatformProfileError,
    ScheduledIngestionService,
)

router = APIRouter(prefix="/ingestion-jobs", tags=["ScheduledIngestion"])


@router.post(
    "",
    response_model=DataIngestionJobResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def create_ingestion_job(
    payload: DataIngestionJobCreate,
    service: ScheduledIngestionService = Depends(get_scheduled_ingestion_service),
) -> DataIngestionJobResponse:
    try:
        job = service.create(payload)
    except MissingPlatformProfileError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except DuplicateDataIngestionJobError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return DataIngestionJobResponse(data=job)


@router.get("", response_model=DataIngestionJobListResponse)
def list_ingestion_jobs(
    service: ScheduledIngestionService = Depends(get_scheduled_ingestion_service),
) -> DataIngestionJobListResponse:
    return DataIngestionJobListResponse(data=service.list())


@router.get(
    "/{job_id}",
    response_model=DataIngestionJobResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_ingestion_job(
    job_id: str,
    service: ScheduledIngestionService = Depends(get_scheduled_ingestion_service),
) -> DataIngestionJobResponse:
    job = service.get(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DataIngestionJob '{job_id}' was not found.",
        )

    return DataIngestionJobResponse(data=job)


@router.post(
    "/{job_id}/run",
    response_model=DataIngestionRunResultResponse,
    status_code=status.HTTP_200_OK,
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        501: {"model": ErrorResponse},
    },
)
def run_ingestion_job(
    job_id: str,
    service: ScheduledIngestionService = Depends(get_scheduled_ingestion_service),
) -> DataIngestionRunResultResponse:
    try:
        result = service.run(job_id)
    except MissingDataIngestionJobError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except AdapterExecutionNotImplementedError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return DataIngestionRunResultResponse(data=result)


@router.get(
    "/{job_id}/runs",
    response_model=DataIngestionRunHistoryListResponse,
    responses={404: {"model": ErrorResponse}},
)
def list_ingestion_job_runs(
    job_id: str,
    service: ScheduledIngestionService = Depends(get_scheduled_ingestion_service),
) -> DataIngestionRunHistoryListResponse:
    try:
        histories = service.list_run_history_by_job(job_id)
    except MissingDataIngestionJobError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return DataIngestionRunHistoryListResponse(data=histories)


@router.get(
    "/runs/{run_history_id}",
    response_model=DataIngestionRunHistoryResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_ingestion_run_history(
    run_history_id: str,
    service: ScheduledIngestionService = Depends(get_scheduled_ingestion_service),
) -> DataIngestionRunHistoryResponse:
    run_history = service.get_run_history(run_history_id)
    if run_history is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DataIngestionRunHistory '{run_history_id}' was not found.",
        )
    return DataIngestionRunHistoryResponse(data=run_history)
