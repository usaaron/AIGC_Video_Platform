from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import (
    get_bilingual_script_view_service,
    get_revision_planner,
    get_script_generation_service,
    get_script_revision_service,
)
from app.modules.script_engine.bilingual_view import (
    BilingualScriptViewService,
    InvalidBilingualViewOutputError,
    MissingBilingualViewStrategyError,
)
from app.modules.orchestrator.service import MissingPlatformProfileError
from app.modules.script_engine.generation_service import (
    CreativeDeepeningDisabledError,
    InvalidDraftMasterScriptOutputError,
    InvalidResolvedCreativeContextError,
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
from app.modules.script_engine.knowledge_bundle import InvalidKnowledgeBundleError
from app.modules.script_engine.models import (
    BilingualScriptViewRequest,
    BilingualScriptViewResponse,
    ErrorResponse,
    ScriptRevisionRequest,
    ScriptRevisionPlanRequest,
    ScriptRevisionPlanResponse,
    ScriptRevisionResponse,
    ScriptGenerationDraftRequest,
    ScriptGenerationDraftResponse,
    ScriptCreativeDeepeningRequest,
    ScriptCreativeDeepeningResponse,
    ScriptDraftModificationRequest,
    ScriptDraftModificationResponse,
    ScriptDraftReviewRequest,
    ScriptDraftReviewResponse,
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
    "/build-bilingual-view",
    response_model=BilingualScriptViewResponse,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
def build_bilingual_script_view(
    payload: BilingualScriptViewRequest,
    service: BilingualScriptViewService = Depends(
        get_bilingual_script_view_service
    ),
) -> BilingualScriptViewResponse:
    try:
        return BilingualScriptViewResponse(data=service.build(payload))
    except MissingBilingualViewStrategyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except (
        InvalidBilingualViewOutputError,
        LLMStructuredOutputError,
        MissingLLMConfigurationError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except LLMRequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


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
        InvalidResolvedCreativeContextError,
        InvalidKnowledgeBundleError,
        LLMStructuredOutputError,
        MissingLLMConfigurationError,
    ) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except LLMRequestError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return ScriptGenerationDraftResponse(data=result)


@router.post(
    "/review-draft",
    response_model=ScriptDraftReviewResponse,
    responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)
def review_script_draft(
    payload: ScriptDraftReviewRequest,
    service: ScriptGenerationService = Depends(get_script_generation_service),
) -> ScriptDraftReviewResponse:
    try:
        return ScriptDraftReviewResponse(data=service.review_draft(payload))
    except MissingGenerationStrategyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidDraftMasterScriptOutputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc


@router.post(
    "/modify-draft",
    response_model=ScriptDraftModificationResponse,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
def modify_script_draft(
    payload: ScriptDraftModificationRequest,
    service: ScriptGenerationService = Depends(get_script_generation_service),
) -> ScriptDraftModificationResponse:
    try:
        return ScriptDraftModificationResponse(data=service.modify_draft(payload))
    except (
        MissingContentSpecError,
        MissingGenerationStrategyError,
        MissingPromptLibraryItemError,
        MissingPlatformProfileError,
    ) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (
        InvalidDraftMasterScriptOutputError,
        InvalidKnowledgeBundleError,
        LLMStructuredOutputError,
        MissingLLMConfigurationError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except LLMRequestError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.post(
    "/deepen-draft",
    response_model=ScriptCreativeDeepeningResponse,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
def deepen_script_draft(
    payload: ScriptCreativeDeepeningRequest,
    service: ScriptGenerationService = Depends(get_script_generation_service),
) -> ScriptCreativeDeepeningResponse:
    try:
        return ScriptCreativeDeepeningResponse(data=service.deepen_draft(payload))
    except CreativeDeepeningDisabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except (
        MissingContentSpecError,
        MissingGenerationStrategyError,
        MissingPromptLibraryItemError,
        MissingPlatformProfileError,
    ) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (
        InvalidDraftMasterScriptOutputError,
        InvalidKnowledgeBundleError,
        LLMStructuredOutputError,
        MissingLLMConfigurationError,
        ValueError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except LLMRequestError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


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
