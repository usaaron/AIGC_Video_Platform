from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_revision_planner,
    get_script_generation_service,
    get_script_revision_service,
)
from app.modules.orchestrator.service import MissingPlatformProfileError
from app.modules.script_engine.generation_service import (
    InvalidDraftMasterScriptOutputError,
    MissingContentSpecError,
    MissingGenerationStrategyError,
    MissingSceneSettingSourceError,
    ScriptGenerationService,
)
from app.modules.script_engine.llm_adapter import (
    LLMRequestError,
    LLMStructuredOutputError,
    MissingLLMConfigurationError,
)
from app.modules.script_engine.models import (
    ErrorResponse,
    ScriptRevisionRequest,
    ScriptRevisionPlanRequest,
    ScriptRevisionPlanResponse,
    ScriptRevisionResponse,
    ScriptGenerationDraftRequest,
    ScriptGenerationDraftResponse,
)
from app.modules.script_engine.revision_planner import RubricRevisionPlanner
from app.modules.script_engine.revision_service import (
    InvalidRevisionPlanError,
    MissingRevisionGenerationStrategyError,
    ScriptRevisionService,
)
from app.modules.script_engine.service import MissingPromptLibraryItemError

router = APIRouter(prefix="/script-generation", tags=["Script Generation"])


@router.post(
    "/generate-draft",
    response_model=ScriptGenerationDraftResponse,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def generate_script_draft(
    payload: ScriptGenerationDraftRequest,
    service: ScriptGenerationService = Depends(get_script_generation_service),
) -> ScriptGenerationDraftResponse:
    try:
        result = service.generate_draft(payload)
    except (
        MissingContentSpecError,
        MissingGenerationStrategyError,
        MissingPromptLibraryItemError,
        MissingPlatformProfileError,
    ) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (
        MissingSceneSettingSourceError,
        InvalidDraftMasterScriptOutputError,
        LLMStructuredOutputError,
        MissingLLMConfigurationError,
    ) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except LLMRequestError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return ScriptGenerationDraftResponse(data=result)


@router.post(
    "/build-revision-plan",
    response_model=ScriptRevisionPlanResponse,
    responses={422: {"model": ErrorResponse}},
)
def build_revision_plan(
    payload: ScriptRevisionPlanRequest,
    planner: RubricRevisionPlanner = Depends(get_revision_planner),
) -> ScriptRevisionPlanResponse:
    return ScriptRevisionPlanResponse(data=planner.build_plan(payload))


@router.post(
    "/revise-draft",
    response_model=ScriptRevisionResponse,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
    },
)
def revise_draft(
    payload: ScriptRevisionRequest,
    service: ScriptRevisionService = Depends(get_script_revision_service),
) -> ScriptRevisionResponse:
    try:
        result = service.revise(payload)
    except MissingRevisionGenerationStrategyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidRevisionPlanError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return ScriptRevisionResponse(data=result)
