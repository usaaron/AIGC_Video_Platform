from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_master_script_service
from app.modules.master_script.models import (
    ErrorResponse,
    MasterScriptFinalizationResponse,
    MasterScriptFinalizeRequest,
    MasterScriptListResponse,
    MasterScriptResponse,
)
from app.modules.master_script.service import (
    DirectMasterScriptCreationDeprecatedError,
    FinalizationThresholdNotMetError,
    InvalidFinalScriptAcceptanceError,
    InvalidFinalizationChainError,
    MasterScriptService,
    MissingContentSpecError,
)

router = APIRouter(prefix="/master-scripts", tags=["MasterScript"])


@router.post(
    "",
    response_model=MasterScriptResponse,
    status_code=status.HTTP_410_GONE,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        410: {"model": ErrorResponse},
    },
    deprecated=True,
)
def create_master_script(
    payload: dict,
    service: MasterScriptService = Depends(get_master_script_service),
) -> MasterScriptResponse:
    try:
        master_script = service.create(payload)
    except DirectMasterScriptCreationDeprecatedError as exc:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=str(exc),
        ) from exc
    except MissingContentSpecError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    return MasterScriptResponse(data=master_script)


@router.post(
    "/from-draft",
    response_model=MasterScriptFinalizationResponse,
    status_code=status.HTTP_410_GONE,
    responses={
        410: {"model": ErrorResponse},
    },
    deprecated=True,
)
def create_master_script_from_draft(
    payload: dict,
    service: MasterScriptService = Depends(get_master_script_service),
) -> MasterScriptFinalizationResponse:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail=(
            "Direct draft finalization is deprecated. "
            "Use POST /master-scripts/finalize with the full revision chain."
        ),
    )


@router.post(
    "/finalize",
    response_model=MasterScriptFinalizationResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def finalize_master_script(
    payload: MasterScriptFinalizeRequest,
    service: MasterScriptService = Depends(get_master_script_service),
) -> MasterScriptFinalizationResponse:
    try:
        result = service.create_from_draft(payload)
    except MissingContentSpecError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except (
        InvalidFinalizationChainError,
        FinalizationThresholdNotMetError,
        InvalidFinalScriptAcceptanceError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return MasterScriptFinalizationResponse(data=result)


@router.get(
    "",
    response_model=MasterScriptListResponse,
)
def list_master_scripts(
    service: MasterScriptService = Depends(get_master_script_service),
) -> MasterScriptListResponse:
    return MasterScriptListResponse(data=service.list())


@router.get(
    "/{master_script_id}",
    response_model=MasterScriptResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_master_script(
    master_script_id: str,
    service: MasterScriptService = Depends(get_master_script_service),
) -> MasterScriptResponse:
    master_script = service.get(master_script_id)
    if master_script is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"MasterScript '{master_script_id}' was not found.",
        )

    return MasterScriptResponse(data=master_script)
