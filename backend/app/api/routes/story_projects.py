import logging
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import ValidationError

from app.api.copilot_stream import accepts_copilot_stream, copilot_stream_response
from app.api.generation_errors import _generation_failure_headers
from app.dependencies import (
    get_episode_roadmap_agent,
    get_long_story_service,
    get_story_planning_service,
    get_story_quality_agent,
)
from app.modules.agent_runtime.episode_roadmap import (
    AgentOutputRejectedError,
    EpisodeRoadmapAgent,
)
from app.modules.agent_runtime.story_quality import StoryQualityAgent
from app.modules.agent_runtime.repository import (
    AgentRunInProgressError,
    AgentRunPersistenceConflictError,
)
from app.modules.agent_runtime.service import AgentRunPersistenceUnavailableError
from app.modules.script_engine.long_story_models import (
    ContinuityLedgerAuditResponse,
    ContinuityLedgerRollbackRequest,
    ContinuityLedgerResponse,
    CreativeDirectionDraftRequest,
    CreativeDirectionDraftResponse,
    EpisodeArtifactCreate,
    EpisodeArtifactKind,
    EpisodeArtifactListResponse,
    EpisodeArtifactResponse,
    EpisodePlan,
    EpisodePlanBatchDraftRequest,
    EpisodePlanItemDraftRequest,
    EpisodePlanItemModificationRequest,
    EpisodePlanItemPreparationRequest,
    EpisodePlanListResponse,
    EpisodePlanMaterializationCreate,
    EpisodePlanMaterializationListResponse,
    EpisodePlanMaterializationResponse,
    EpisodePlanResponse,
    EpisodeRoadmapDraftResponse,
    EpisodeRoadmapItemDraftResponse,
    GenerationTaskCheckpoint,
    GenerationTaskClaimRequest,
    GenerationTaskClaimResponse,
    GenerationTaskCheckpointResponse,
    LongStoryErrorResponse,
    NarrativeEventListResponse,
    NarrativeEventSetResponse,
    PlanningSessionResponse,
    PlanningSessionSave,
    StoryBible,
    StoryBibleDraftRequest,
    StoryBibleDraftResponse,
    StoryBibleInteractiveCompleteRequest,
    StoryBibleInteractiveStepRequest,
    StoryBibleInteractiveStepResponse,
    StoryInspirationChatRequest,
    StoryInspirationChatResponse,
    StorySynopsisDraftRequest,
    StorySynopsisDraftResponse,
    StoryBibleModificationRequest,
    StoryBibleResponse,
    StoryPlanNode,
    StoryPlanNodeDraftRequest,
    StoryPlanNodeDecompositionRequest,
    StoryPlanNodeModificationRequest,
    StoryPlanNodeListResponse,
    StoryPlanNodeResponse,
    StoryPlanQualityAuditRequest,
    StoryPlanQualityAuditResponse,
    StoryProject,
    StoryProjectDeletionResponse,
    StoryProjectListResponse,
    StoryProjectResponse,
    StoryProjectStatus,
    StoryProjectWorkspaceResponse,
    StoryProjectWorkspaceSave,
    StoryStagePlan,
    StoryStagePlanListResponse,
    StoryStagePlanResponse,
)
from app.modules.script_engine.long_story_repository import (
    LongStoryPersistenceConflictError,
)
from app.modules.script_engine.long_story_service import (
    LongStoryNotFoundError,
    LongStoryPayloadTooLargeError,
    LongStoryReferenceError,
    LongStoryService,
)
from app.modules.script_engine.llm_adapter import (
    LLMRequestError,
    LLMStructuredOutputError,
    MissingLLMConfigurationError,
)
from app.modules.script_engine.planning_call_budget import PlanningCallBudgetExceeded
from app.modules.script_engine.story_planning_service import (
    STORY_BIBLE_IMPORT_INSTRUCTION,
    StoryPlanningInputError,
    StoryBibleLanguageRepairPendingError,
    StoryPlanningService,
    StoryPlanningTransientOutputError,
    is_transient_story_planning_output_error,
)


router = APIRouter(prefix="/story-projects", tags=["Long Story Planning"])
logger = logging.getLogger(__name__)


def _source_import_author_instruction(author_instruction: str) -> str:
    """Keep the import contract intact when the caller already filled the limit."""

    contract = STORY_BIBLE_IMPORT_INSTRUCTION.strip()
    prefix = author_instruction.strip()
    if not prefix:
        return contract
    # StoryBibleDraftRequest.author_instruction is capped at 7,500 characters.
    # Reserve room for the non-negotiable import contract instead of truncating
    # it away when a previous planning session supplied a long instruction.
    prefix_budget = max(0, 7_500 - len(contract) - 2)
    return f"{prefix[:prefix_budget]}\n\n{contract}"


def _raise_planning_configuration_unavailable(
    exc: MissingLLMConfigurationError,
) -> NoReturn:
    logger.error("Planning model role configuration is incomplete: %s", exc)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="剧情规划服务配置尚未完成，请联系管理员检查模型角色配置。",
        headers=_generation_failure_headers(
            retryable=False,
            failure_class="configuration",
            error_type="configuration_unavailable",
        ),
    ) from exc


def _raise_planning_upstream_unavailable(
    exc: LLMRequestError,
    *,
    artifact: str,
    project_id: str,
    node_id: str | None = None,
) -> NoReturn:
    category = getattr(exc, "category", "unknown")
    provider_status = getattr(exc, "status_code", None)
    retryable = (
        provider_status in {408, 429}
        or (provider_status is not None and provider_status >= 500)
        or (
            provider_status is None
            and category in {
                "timeout",
                "transport",
                "provider_gateway",
                "provider_protocol",
                "empty_response",
                "failover_exhausted",
                "script_generation_routes_exhausted",
            }
        )
    )
    logger.warning(
        "Planning upstream failed artifact=%s project=%s node=%s "
        "category=%s provider_status=%s detail=%s",
        artifact,
        project_id,
        node_id or "-",
        category,
        provider_status,
        str(exc)[:2000],
    )
    if provider_status == status.HTTP_429_TOO_MANY_REQUESTS:
        response_status = status.HTTP_429_TOO_MANY_REQUESTS
        detail = "剧情规划模型当前请求较多，已保存的规划内容不会丢失，请稍后继续。"
    elif category in {"timeout", "deadline"}:
        response_status = status.HTTP_503_SERVICE_UNAVAILABLE
        detail = "剧情规划模型响应超时，已保存的规划内容不会丢失，请重试当前部分。"
    elif category == "empty_response":
        response_status = status.HTTP_503_SERVICE_UNAVAILABLE
        detail = "剧情规划模型本次未返回可读取内容，请重试当前部分。"
    else:
        response_status = status.HTTP_503_SERVICE_UNAVAILABLE
        detail = "剧情规划模型服务暂时未完成请求，已保存的规划内容不会丢失，请重试当前部分。"
    raise HTTPException(
        status_code=response_status,
        detail=detail,
        headers=_generation_failure_headers(
            retryable=retryable,
            failure_class=(
                "transient_upstream"
                if retryable
                else "auth"
                if provider_status in {401, 403}
                else "configuration"
                if provider_status == 404
                else "input"
            ),
            error_type=(
                "upstream_unavailable" if retryable else "provider_request_rejected"
            ),
        ),
    ) from exc


def _raise_planning_output_incomplete(
    exc: (
        ValidationError
        | LLMStructuredOutputError
        | StoryPlanningTransientOutputError
        | AgentOutputRejectedError
    ),
) -> NoReturn:
    retryable = is_transient_story_planning_output_error(exc)
    logger.warning(
        "Planning model output failed validation error_type=%s retryable=%s detail=%s",
        type(exc).__name__,
        retryable,
        str(exc)[:2000],
    )
    raise HTTPException(
        status_code=(
            status.HTTP_503_SERVICE_UNAVAILABLE
            if retryable
            else status.HTTP_422_UNPROCESSABLE_CONTENT
        ),
        detail=(
            "剧情规划模型连接出现短暂中断，已保存内容不会丢失。"
            if retryable
            else "剧情规划模型本次未返回完整可用内容，请重试当前部分。"
        ),
        headers=_generation_failure_headers(
            retryable=retryable,
            failure_class="transient_upstream" if retryable else "contract",
            error_type="stream_incomplete" if retryable else "output_incomplete",
        ),
    ) from exc


@router.put(
    "/{project_id}/generation-tasks/{job_id}",
    response_model=GenerationTaskCheckpointResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def save_generation_task(
    project_id: str,
    job_id: str,
    payload: GenerationTaskCheckpoint,
    service: LongStoryService = Depends(get_long_story_service),
) -> GenerationTaskCheckpointResponse:
    if (
        payload.batch.story_project_id != project_id
        or payload.checkpoint.job_id != job_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Generation task path identity must match its payload identity.",
        )
    try:
        task = service.save_generation_task(project_id, payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return GenerationTaskCheckpointResponse(data=task)


@router.get(
    "/{project_id}/generation-tasks/recoverable",
    response_model=GenerationTaskCheckpointResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_recoverable_generation_task(
    project_id: str,
    service: LongStoryService = Depends(get_long_story_service),
) -> GenerationTaskCheckpointResponse:
    try:
        task = service.get_recoverable_generation_task(project_id)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return GenerationTaskCheckpointResponse(data=task)


@router.post(
    "/{project_id}/generation-tasks/{job_id}/claim",
    response_model=GenerationTaskClaimResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def claim_generation_task(
    project_id: str,
    job_id: str,
    payload: GenerationTaskClaimRequest,
    service: LongStoryService = Depends(get_long_story_service),
) -> GenerationTaskClaimResponse:
    try:
        task = service.claim_generation_task(project_id, job_id, payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    return GenerationTaskClaimResponse(data=task)


@router.get(
    "/{project_id}/generation-tasks/{job_id}",
    response_model=GenerationTaskCheckpointResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_generation_task(
    project_id: str,
    job_id: str,
    service: LongStoryService = Depends(get_long_story_service),
) -> GenerationTaskCheckpointResponse:
    try:
        task = service.get_generation_task(project_id, job_id)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return GenerationTaskCheckpointResponse(data=task)


@router.post(
    "/{project_id}/creative-directions/draft",
    response_model=CreativeDirectionDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_creative_directions(
    project_id: str,
    payload: CreativeDirectionDraftRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
) -> CreativeDirectionDraftResponse:
    if payload.story_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Creative direction path ID must match payload story_project_id.",
        )
    try:
        directions = service.generate_creative_directions(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="creative_directions", project_id=project_id,
        )
    return CreativeDirectionDraftResponse(data=directions)


@router.put(
    "/{project_id}",
    response_model=StoryProjectResponse,
    responses={409: {"model": LongStoryErrorResponse}},
)
def save_story_project(
    project_id: str,
    payload: StoryProject,
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryProjectResponse:
    if payload.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Project path ID must match payload project_id.",
        )
    try:
        project = service.save_project(payload)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return StoryProjectResponse(data=project)


@router.get("", response_model=StoryProjectListResponse)
def list_story_projects(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    include_archived: bool = Query(default=False),
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryProjectListResponse:
    host_context = getattr(request.state, "host_context", None)
    if host_context is not None and host_context.project_id:
        # Apply host scope before pagination so an older bound project cannot
        # disappear behind unrelated projects on the account's first page.
        try:
            project = service.get_project(host_context.project_id)
        except LongStoryNotFoundError:
            projects = []
        else:
            projects = (
                [project]
                if include_archived or project.status != StoryProjectStatus.archived
                else []
            )
        total = len(projects)
        projects = projects[offset:offset + limit]
    else:
        projects, total = service.list_projects(
            limit=limit,
            offset=offset,
            include_archived=include_archived,
        )
    return StoryProjectListResponse(
        data=projects,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{project_id}",
    response_model=StoryProjectResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_story_project(
    project_id: str,
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryProjectResponse:
    try:
        project = service.get_project(project_id)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return StoryProjectResponse(data=project)


@router.delete(
    "/{project_id}",
    response_model=StoryProjectResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def archive_story_project(
    project_id: str,
    expected_revision: int = Query(ge=1),
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryProjectResponse:
    try:
        project = service.archive_project(
            project_id,
            expected_revision=expected_revision,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return StoryProjectResponse(data=project)


@router.delete(
    "/{project_id}/permanent",
    response_model=StoryProjectDeletionResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def delete_story_project_permanently(
    project_id: str,
    expected_revision: int = Query(ge=1),
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryProjectDeletionResponse:
    try:
        result = service.delete_project_permanently(
            project_id,
            expected_revision=expected_revision,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return StoryProjectDeletionResponse(data=result)


@router.put(
    "/{project_id}/workspace",
    response_model=StoryProjectWorkspaceResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        413: {"model": LongStoryErrorResponse},
    },
)
def save_story_project_workspace(
    project_id: str,
    payload: StoryProjectWorkspaceSave,
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryProjectWorkspaceResponse:
    if payload.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Workspace path ID must match payload project_id.",
        )
    try:
        snapshot = service.save_workspace_snapshot(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPayloadTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=str(exc),
        ) from exc
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return StoryProjectWorkspaceResponse(data=snapshot)


@router.get(
    "/{project_id}/workspace",
    response_model=StoryProjectWorkspaceResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_story_project_workspace(
    project_id: str,
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryProjectWorkspaceResponse:
    try:
        snapshot = service.get_workspace_snapshot(project_id)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return StoryProjectWorkspaceResponse(data=snapshot)


@router.put(
    "/{project_id}/planning-session",
    response_model=PlanningSessionResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        413: {"model": LongStoryErrorResponse},
    },
)
def save_story_project_planning_session(
    project_id: str,
    payload: PlanningSessionSave,
    service: LongStoryService = Depends(get_long_story_service),
) -> PlanningSessionResponse:
    if payload.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Planning Session path ID must match payload project_id.",
        )
    try:
        session = service.save_planning_session(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPayloadTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=str(exc),
        ) from exc
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return PlanningSessionResponse(data=session)


@router.get(
    "/{project_id}/planning-session",
    response_model=PlanningSessionResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_story_project_planning_session(
    project_id: str,
    service: LongStoryService = Depends(get_long_story_service),
) -> PlanningSessionResponse:
    try:
        session = service.get_planning_session(project_id)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return PlanningSessionResponse(data=session)


@router.get(
    "/{project_id}/continuity-ledger/latest",
    response_model=ContinuityLedgerResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_latest_continuity_ledger(
    project_id: str,
    service: LongStoryService = Depends(get_long_story_service),
) -> ContinuityLedgerResponse:
    try:
        ledger = service.get_latest_continuity_ledger(project_id)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return ContinuityLedgerResponse(data=ledger)


@router.post(
    "/{project_id}/continuity-ledger/rebuild",
    response_model=ContinuityLedgerResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def rebuild_continuity_ledger(
    project_id: str,
    through_episode_number: int | None = Query(default=None, ge=1),
    service: LongStoryService = Depends(get_long_story_service),
) -> ContinuityLedgerResponse:
    try:
        ledger = service.rebuild_continuity_ledger(
            project_id,
            through_episode_number=through_episode_number,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return ContinuityLedgerResponse(data=ledger)


@router.get(
    "/{project_id}/continuity-ledger/audit",
    response_model=ContinuityLedgerAuditResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def audit_continuity_ledger(
    project_id: str,
    service: LongStoryService = Depends(get_long_story_service),
) -> ContinuityLedgerAuditResponse:
    try:
        audit = service.audit_continuity_ledger(project_id)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return ContinuityLedgerAuditResponse(data=audit)


@router.post(
    "/{project_id}/continuity-ledger/rollback",
    response_model=ContinuityLedgerResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def rollback_continuity_ledger(
    project_id: str,
    payload: ContinuityLedgerRollbackRequest,
    service: LongStoryService = Depends(get_long_story_service),
) -> ContinuityLedgerResponse:
    try:
        ledger = service.rollback_continuity_ledger(project_id, payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return ContinuityLedgerResponse(data=ledger)


@router.post(
    "/{project_id}/episodes/{episode_number}/artifacts",
    response_model=EpisodeArtifactResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        413: {"model": LongStoryErrorResponse},
    },
)
def save_episode_artifact(
    project_id: str,
    episode_number: int,
    payload: EpisodeArtifactCreate,
    service: LongStoryService = Depends(get_long_story_service),
) -> EpisodeArtifactResponse:
    if (
        payload.story_project_id != project_id
        or payload.episode_number != episode_number
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Episode Artifact path identity must match its payload identity.",
        )
    try:
        artifact = service.save_episode_artifact(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPayloadTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=str(exc),
        ) from exc
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return EpisodeArtifactResponse(data=artifact)


@router.get(
    "/{project_id}/episodes/{episode_number}/artifacts",
    response_model=EpisodeArtifactListResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def list_episode_artifacts(
    project_id: str,
    episode_number: int,
    artifact_kind: EpisodeArtifactKind | None = Query(default=None),
    service: LongStoryService = Depends(get_long_story_service),
) -> EpisodeArtifactListResponse:
    try:
        artifacts = service.list_episode_artifacts(
            project_id,
            episode_number=episode_number,
            artifact_kind=artifact_kind,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return EpisodeArtifactListResponse(data=artifacts)


@router.get(
    "/{project_id}/episodes/{episode_number}/artifacts/{artifact_id}",
    response_model=EpisodeArtifactResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_episode_artifact(
    project_id: str,
    episode_number: int,
    artifact_id: str,
    service: LongStoryService = Depends(get_long_story_service),
) -> EpisodeArtifactResponse:
    try:
        artifact = service.get_episode_artifact(project_id, artifact_id)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    if artifact.episode_number != episode_number:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Episode Artifact '{artifact_id}' was not found in episode {episode_number}.",
        )
    return EpisodeArtifactResponse(data=artifact)


@router.get(
    "/{project_id}/episodes/{episode_number}/artifacts/{artifact_id}/event-set",
    response_model=NarrativeEventSetResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_episode_artifact_event_set(
    project_id: str,
    episode_number: int,
    artifact_id: str,
    service: LongStoryService = Depends(get_long_story_service),
) -> NarrativeEventSetResponse:
    try:
        event_set = service.get_narrative_event_set(project_id, artifact_id)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    if event_set is not None and event_set.episode_number != episode_number:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Narrative Event Set for artifact '{artifact_id}' was not found "
                f"in episode {episode_number}."
            ),
        )
    return NarrativeEventSetResponse(data=event_set)


@router.get(
    "/{project_id}/episodes/{episode_number}/events",
    response_model=NarrativeEventListResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def list_episode_narrative_events(
    project_id: str,
    episode_number: int,
    service: LongStoryService = Depends(get_long_story_service),
) -> NarrativeEventListResponse:
    try:
        events = service.list_narrative_events(
            project_id,
            episode_number=episode_number,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return NarrativeEventListResponse(data=events)


def _story_bible_draft_response(
    project_id: str,
    payload: StoryBibleDraftRequest,
    service: StoryPlanningService,
    long_story_service: LongStoryService,
    *,
    artifact: str = "story_bible",
) -> StoryBibleDraftResponse:
    if payload.story_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Bible draft path ID must match payload story_project_id.",
        )
    try:
        story_bible = service.generate_story_bible_draft(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryBibleLanguageRepairPendingError as exc:
        logger.warning("Story Bible retained for language repair project=%s reason=%s", project_id, exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="故事总纲还有少量内容未完成中文转换。已保留生成进度，请重试继续修正。",
            headers=_generation_failure_headers(
                retryable=False, failure_class="contract", error_type="language_repair_pending",
            ),
        ) from exc
    except StoryPlanningInputError as exc:
        logger.warning(
            "Story Bible generation rejected project=%s reason=%s",
            project_id,
            str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact=artifact, project_id=project_id,
        )
    project = long_story_service.get_project(project_id)
    try:
        workspace_revision = long_story_service.get_workspace_snapshot(
            project_id
        ).revision
    except LongStoryNotFoundError:
        workspace_revision = None
    return StoryBibleDraftResponse(
        data=story_bible,
        project_revision=project.revision,
        workspace_revision=workspace_revision,
    )


@router.post(
    "/{project_id}/story-bibles/draft",
    response_model=StoryBibleDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_story_bible_draft(
    project_id: str,
    payload: StoryBibleDraftRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
    long_story_service: LongStoryService = Depends(get_long_story_service),
) -> StoryBibleDraftResponse:
    return _story_bible_draft_response(
        project_id,
        payload,
        service,
        long_story_service,
    )


@router.post(
    "/{project_id}/story-bibles/import-draft",
    response_model=StoryBibleDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def import_story_bible_draft(
    project_id: str,
    payload: StoryBibleDraftRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
    long_story_service: LongStoryService = Depends(get_long_story_service),
) -> StoryBibleDraftResponse:
    """Normalize a supplied outline into an editable, source-preserving draft.

    This is an explicit adapter boundary, not a shortcut around planning
    approval.  The raw source is retained and the service is forced to keep
    the resulting Story Bible in the ordinary draft lifecycle.
    """
    import_payload = payload.model_copy(
        update={
            "author_instruction": _source_import_author_instruction(
                payload.author_instruction,
            ),
            "preserve_source_document": True,
        },
    )
    return _story_bible_draft_response(
        project_id,
        import_payload,
        service,
        long_story_service,
        artifact="story_bible_import",
    )


@router.post(
    "/{project_id}/story-bibles/interactive-step",
    response_model=StoryBibleInteractiveStepResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_story_bible_interactive_step(
    project_id: str,
    payload: StoryBibleInteractiveStepRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
) -> StoryBibleInteractiveStepResponse:
    if payload.story_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Interactive step project ID mismatch.")
    try:
        return StoryBibleInteractiveStepResponse(
            data=service.generate_story_bible_interactive_step(payload)
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="story_bible_interactive_step", project_id=project_id,
        )


@router.post(
    "/{project_id}/story-bibles/synopsis-draft",
    response_model=StorySynopsisDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_story_synopsis_draft(
    project_id: str,
    payload: StorySynopsisDraftRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
    request: Request = None,
) -> StorySynopsisDraftResponse:
    if payload.story_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Synopsis draft project ID mismatch.")
    if accepts_copilot_stream(request):
        return copilot_stream_response(
            lambda: generate_story_synopsis_draft(project_id=project_id, payload=payload, service=service)
        )
    try:
        return StorySynopsisDraftResponse(data=service.generate_story_synopsis_draft(payload))
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(exc, artifact="story_synopsis_draft", project_id=project_id)


@router.post(
    "/{project_id}/story-bibles/inspiration-chat",
    response_model=StoryInspirationChatResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_story_inspiration_turn(
    project_id: str,
    payload: StoryInspirationChatRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
    request: Request = None,
) -> StoryInspirationChatResponse:
    if payload.story_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Inspiration chat project ID mismatch.")
    if accepts_copilot_stream(request):
        return copilot_stream_response(
            lambda: generate_story_inspiration_turn(project_id=project_id, payload=payload, service=service)
        )
    try:
        return StoryInspirationChatResponse(
            data=service.generate_story_inspiration_turn(payload)
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="story_inspiration_chat", project_id=project_id,
        )


@router.post(
    "/{project_id}/story-bibles/interactive-complete",
    response_model=StoryBibleResponse,
    responses={404: {"model": LongStoryErrorResponse}, 422: {"model": LongStoryErrorResponse}},
)
def complete_story_bible_interactive(
    project_id: str,
    payload: StoryBibleInteractiveCompleteRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
) -> StoryBibleResponse:
    if payload.story_project_id != project_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Interactive completion project ID mismatch.")
    try:
        return StoryBibleResponse(data=service.complete_interactive_story_bible(payload))
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="story_bible_interactive_complete", project_id=project_id,
        )


@router.post(
    "/{project_id}/story-bibles/{story_bible_id}/modify",
    response_model=StoryBibleResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def modify_story_bible(
    project_id: str,
    story_bible_id: str,
    payload: StoryBibleModificationRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
    request: Request = None,
) -> StoryBibleResponse:
    if (
        payload.story_project_id != project_id
        or payload.story_bible_id != story_bible_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Bible modification path IDs must match the payload.",
        )
    if accepts_copilot_stream(request):
        return copilot_stream_response(
            lambda: modify_story_bible(project_id=project_id, story_bible_id=story_bible_id, payload=payload, service=service)
        )
    try:
        candidate = service.modify_story_bible(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="story_bible_modification", project_id=project_id,
        )
    return StoryBibleResponse(data=candidate)


@router.put(
    "/{project_id}/story-bibles/{story_bible_id}/versions/{version}",
    response_model=StoryBibleResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def save_story_bible(
    project_id: str,
    story_bible_id: str,
    version: int,
    payload: StoryBible,
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryBibleResponse:
    _validate_versioned_path(
        project_id,
        story_bible_id,
        version,
        payload.story_project_id,
        payload.story_bible_id,
        payload.version,
        "Story Bible",
    )
    try:
        story_bible = service.save_story_bible(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return StoryBibleResponse(data=story_bible)


@router.get(
    "/{project_id}/story-bibles/{story_bible_id}",
    response_model=StoryBibleResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_story_bible(
    project_id: str,
    story_bible_id: str,
    version: int | None = Query(default=None, ge=1),
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryBibleResponse:
    try:
        story_bible = service.get_story_bible(
            project_id,
            story_bible_id,
            version=version,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return StoryBibleResponse(data=story_bible)


@router.post(
    "/{project_id}/plan-nodes/draft",
    response_model=StoryPlanNodeResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_story_plan_node_draft(
    project_id: str,
    payload: StoryPlanNodeDraftRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
) -> StoryPlanNodeResponse:
    if payload.story_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Plan Node path ID must match payload story_project_id.",
        )
    try:
        node = service.generate_story_plan_node_draft(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="story_plan_node", project_id=project_id,
        )
    return StoryPlanNodeResponse(data=node)


@router.post(
    "/{project_id}/plan-nodes/{node_id}/modify",
    response_model=StoryPlanNodeResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def modify_story_plan_node(
    project_id: str,
    node_id: str,
    payload: StoryPlanNodeModificationRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
    request: Request = None,
) -> StoryPlanNodeResponse:
    if payload.story_project_id != project_id or payload.node_id != node_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Plan Node modification path IDs must match the payload.",
        )
    if accepts_copilot_stream(request):
        return copilot_stream_response(
            lambda: modify_story_plan_node(project_id=project_id, node_id=node_id, payload=payload, service=service)
        )
    try:
        candidate = service.modify_story_plan_node(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="story_plan_node_modification", project_id=project_id,
        )
    return StoryPlanNodeResponse(data=candidate)


@router.post(
    "/{project_id}/plan-nodes/top-level/draft",
    response_model=StoryPlanNodeListResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_top_level_story_plan_nodes(
    project_id: str,
    payload: StoryPlanNodeDraftRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
) -> StoryPlanNodeListResponse:
    if payload.story_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Top-level Story Plan path ID must match payload story_project_id.",
        )
    try:
        nodes = service.generate_top_level_story_plan_nodes(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="story_plan_top_level", project_id=project_id,
        )
    return StoryPlanNodeListResponse(data=nodes)


@router.post(
    "/{project_id}/plan-nodes/{node_id}/decompose",
    response_model=StoryPlanNodeListResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def decompose_story_plan_node(
    project_id: str,
    node_id: str,
    payload: StoryPlanNodeDecompositionRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
) -> StoryPlanNodeListResponse:
    if payload.story_project_id != project_id or payload.parent_node_id != node_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Plan Node decomposition path IDs must match the payload.",
        )
    try:
        nodes = service.decompose_story_plan_node(payload)
    except PlanningCallBudgetExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
            headers=_generation_failure_headers(
                retryable=False,
                failure_class="planning_call_budget_exhausted",
                error_type="planning_call_budget_exhausted",
            ),
        ) from exc
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        logger.warning(
            "Story plan decomposition rejected project=%s node=%s reason=%s",
            project_id,
            node_id,
            str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="story_plan_decomposition", project_id=project_id,
            node_id=node_id,
        )
    return StoryPlanNodeListResponse(data=nodes)


@router.post(
    "/{project_id}/plan-nodes/quality-audit/agent-run",
    response_model=StoryPlanQualityAuditResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def run_story_plan_quality_agent(
    project_id: str,
    payload: StoryPlanQualityAuditRequest,
    response: Response,
    agent: StoryQualityAgent = Depends(get_story_quality_agent),
) -> StoryPlanQualityAuditResponse:
    """Run one bounded, resumable quality audit without changing the tree."""

    if payload.story_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Plan quality audit path ID must match the payload.",
        )
    try:
        result = agent.run(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc,
            artifact="story_plan_quality_agent",
            project_id=project_id,
        )
    except AgentRunInProgressError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="当前剧情质检仍在处理中，请稍后继续。",
            headers={
                **_generation_failure_headers(
                    retryable=True,
                    failure_class="agent_in_progress",
                    error_type="agent_run_in_progress",
                ),
                "X-Agent-Run-ID": exc.run_id,
            },
        ) from exc
    except AgentRunPersistenceConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="当前质检请求的恢复标识与原始剧情树不一致，请刷新后重试。",
        ) from exc
    except AgentRunPersistenceUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="生成服务暂时无法保存恢复状态，请稍后重试。",
        ) from exc
    logger.info(
        "Story plan quality audit completed project=%s run=%s nodes=%d findings=%d",
        project_id,
        result.run.run_id,
        result.audit.audited_node_count,
        len(result.audit.findings),
    )
    response.headers["X-Agent-Run-ID"] = result.run.run_id
    response.headers["X-Agent-Run-Attempt"] = str(result.run.attempt_count)
    return StoryPlanQualityAuditResponse(data=result.audit)


@router.post(
    "/{project_id}/plan-nodes/{node_id}/episode-plans/draft",
    response_model=EpisodeRoadmapDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_episode_plan_batch(
    project_id: str,
    node_id: str,
    payload: EpisodePlanBatchDraftRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
) -> EpisodeRoadmapDraftResponse:
    if payload.story_project_id != project_id or payload.source_node_id != node_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Episode Plan path IDs must match the payload.",
        )
    try:
        plans = service.generate_episode_plan_batch(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc, artifact="episode_roadmap", project_id=project_id,
            node_id=node_id,
        )
    return EpisodeRoadmapDraftResponse(data=plans)


@router.post(
    "/{project_id}/plan-nodes/{node_id}/episode-plans/chunk",
    response_model=EpisodeRoadmapDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_episode_plan_chunk(
    project_id: str,
    node_id: str,
    payload: EpisodePlanItemDraftRequest,
    response: Response,
    agent: EpisodeRoadmapAgent = Depends(get_episode_roadmap_agent),
) -> EpisodeRoadmapDraftResponse:
    """Generate or replay the next idempotent transport-sized roadmap block."""

    if payload.story_project_id != project_id or payload.source_node_id != node_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Episode Plan chunk path IDs must match the payload.",
    )
    try:
        result = agent.run_chunk(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc,
            artifact="episode_roadmap_chunk",
            project_id=project_id,
            node_id=node_id,
        )
    except AgentRunInProgressError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="当前分集路线图仍在处理中，正在尝试恢复连接。",
            headers={
                **_generation_failure_headers(
                    retryable=True,
                    failure_class="agent_in_progress",
                    error_type="agent_run_in_progress",
                ),
                "X-Agent-Run-ID": exc.run_id,
            },
        ) from exc
    except AgentRunPersistenceConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="当前路线图恢复标识与原始输入不一致，请刷新后继续。",
        ) from exc
    except AgentRunPersistenceUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="生成服务暂时无法保存路线图恢复状态，请稍后重试。",
        ) from exc
    response.headers["X-Agent-Run-ID"] = result.run.run_id
    response.headers["X-Agent-Run-Attempt"] = str(result.run.attempt_count)
    return EpisodeRoadmapDraftResponse(data=result.items, rebuild_receipt=result.rebuild_receipt)


@router.post(
    "/{project_id}/plan-nodes/{node_id}/episode-plans/{episode_number}/draft",
    response_model=EpisodeRoadmapItemDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def generate_episode_plan_item(
    project_id: str,
    node_id: str,
    episode_number: int,
    payload: EpisodePlanItemDraftRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
) -> EpisodeRoadmapItemDraftResponse:
    if (
        payload.story_project_id != project_id
        or payload.source_node_id != node_id
        or payload.episode_number != episode_number
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Episode Plan item path identity must match the payload.",
        )
    try:
        plan = service.generate_episode_plan_item(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc,
            artifact="episode_roadmap_item",
            project_id=project_id,
            node_id=node_id,
        )
    return EpisodeRoadmapItemDraftResponse(data=plan)


@router.post(
    "/{project_id}/plan-nodes/{node_id}/episode-plans/{episode_number}/agent-run",
    response_model=EpisodeRoadmapItemDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def run_episode_roadmap_agent(
    project_id: str,
    node_id: str,
    episode_number: int,
    payload: EpisodePlanItemDraftRequest,
    response: Response,
    agent: EpisodeRoadmapAgent = Depends(get_episode_roadmap_agent),
) -> EpisodeRoadmapItemDraftResponse:
    """Run one bounded, resumable roadmap Agent step for the current episode."""

    if (
        payload.story_project_id != project_id
        or payload.source_node_id != node_id
        or payload.episode_number != episode_number
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Episode roadmap Agent path identity must match the payload.",
        )
    try:
        result = agent.run(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError, AgentOutputRejectedError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc,
            artifact="episode_roadmap_agent",
            project_id=project_id,
            node_id=node_id,
        )
    except AgentRunInProgressError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="当前单集仍在处理中，请稍后继续。",
            headers={
                **_generation_failure_headers(
                    retryable=True,
                    failure_class="agent_in_progress",
                    error_type="agent_run_in_progress",
                ),
                "X-Agent-Run-ID": exc.run_id,
            },
        ) from exc
    except AgentRunPersistenceConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="当前生成请求的恢复标识与原始输入不一致，请重新生成当前单集。",
        ) from exc
    except AgentRunPersistenceUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="生成服务暂时无法保存恢复状态，请稍后重试。",
        ) from exc
    logger.info(
        "Episode roadmap Agent completed project=%s node=%s episode=%d run=%s steps=%d",
        project_id,
        node_id,
        episode_number,
        result.run.run_id,
        len(result.run.tool_executions),
    )
    response.headers["X-Agent-Run-ID"] = result.run.run_id
    response.headers["X-Agent-Run-Attempt"] = str(result.run.attempt_count)
    return EpisodeRoadmapItemDraftResponse(data=result.item)


@router.post(
    "/{project_id}/plan-nodes/{node_id}/episode-plans/{episode_number}/prepare",
    response_model=EpisodeRoadmapItemDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def prepare_episode_plan_item(
    project_id: str,
    node_id: str,
    episode_number: int,
    payload: EpisodePlanItemPreparationRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
) -> EpisodeRoadmapItemDraftResponse:
    if (
        payload.story_project_id != project_id
        or payload.source_node_id != node_id
        or payload.episode_number != episode_number
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Episode Plan preparation path identity must match the payload.",
        )
    try:
        plan = service.prepare_episode_plan_item(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc,
            artifact="episode_roadmap_item_preparation",
            project_id=project_id,
            node_id=node_id,
        )
    return EpisodeRoadmapItemDraftResponse(data=plan)


@router.post(
    "/{project_id}/plan-nodes/{node_id}/episode-plans/{episode_number}/modify",
    response_model=EpisodeRoadmapItemDraftResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
        422: {"model": LongStoryErrorResponse},
        503: {"model": LongStoryErrorResponse},
        429: {"model": LongStoryErrorResponse},
    },
)
def modify_episode_plan_item(
    project_id: str,
    node_id: str,
    episode_number: int,
    payload: EpisodePlanItemModificationRequest,
    service: StoryPlanningService = Depends(get_story_planning_service),
    request: Request = None,
) -> EpisodeRoadmapItemDraftResponse:
    if (
        payload.story_project_id != project_id
        or payload.source_node_id != node_id
        or payload.episode_number != episode_number
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Episode Plan modification path identity must match the payload.",
        )
    if accepts_copilot_stream(request):
        return copilot_stream_response(
            lambda: modify_episode_plan_item(project_id=project_id, node_id=node_id, episode_number=episode_number, payload=payload, service=service)
        )
    try:
        plan = service.modify_episode_plan_item(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    except StoryPlanningInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        _raise_planning_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_planning_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_planning_upstream_unavailable(
            exc,
            artifact="episode_roadmap_item_modification",
            project_id=project_id,
            node_id=node_id,
        )
    return EpisodeRoadmapItemDraftResponse(data=plan)


@router.put(
    "/{project_id}/plan-nodes/{node_id}/versions/{version}",
    response_model=StoryPlanNodeResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def save_story_plan_node(
    project_id: str,
    node_id: str,
    version: int,
    payload: StoryPlanNode,
    descendant_policy: str = Query(default="invalidate", pattern="^(invalidate|rebase)$"),
    planning_revision_epoch: int = Query(default=0, ge=0),
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryPlanNodeResponse:
    _validate_versioned_path(
        project_id,
        node_id,
        version,
        payload.story_project_id,
        payload.node_id,
        payload.version,
        "Story Plan Node",
    )
    try:
        node = service.save_story_plan_node(
            payload,
            descendant_policy=descendant_policy,
            planning_revision_epoch=planning_revision_epoch,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return StoryPlanNodeResponse(data=node)


@router.get(
    "/{project_id}/plan-nodes/{node_id}",
    response_model=StoryPlanNodeResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def get_story_plan_node(
    project_id: str,
    node_id: str,
    version: int | None = Query(default=None, ge=1),
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryPlanNodeResponse:
    try:
        node = service.get_story_plan_node(project_id, node_id, version=version)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return StoryPlanNodeResponse(data=node)


@router.get(
    "/{project_id}/plan-nodes",
    response_model=StoryPlanNodeListResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def list_story_plan_nodes(
    project_id: str,
    parent_node_id: str | None = Query(default=None),
    roots_only: bool = Query(default=False),
    story_bible_id: str | None = Query(default=None),
    story_bible_version: int | None = Query(default=None, ge=1),
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryPlanNodeListResponse:
    if roots_only and parent_node_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="roots_only and parent_node_id cannot be used together.",
        )
    _validate_story_bible_lineage_query(story_bible_id, story_bible_version)
    try:
        nodes = service.list_story_plan_nodes(
            project_id,
            parent_node_id=parent_node_id,
            roots_only=roots_only,
            story_bible_id=story_bible_id,
            story_bible_version=story_bible_version,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return StoryPlanNodeListResponse(data=nodes)


@router.put(
    "/{project_id}/stages/{stage_id}/versions/{version}",
    response_model=StoryStagePlanResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def save_story_stage(
    project_id: str,
    stage_id: str,
    version: int,
    payload: StoryStagePlan,
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryStagePlanResponse:
    _validate_versioned_path(
        project_id,
        stage_id,
        version,
        payload.story_project_id,
        payload.stage_id,
        payload.version,
        "Story Stage",
    )
    try:
        stage = service.save_story_stage(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return StoryStagePlanResponse(data=stage)


@router.get(
    "/{project_id}/stages",
    response_model=StoryStagePlanListResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def list_story_stages(
    project_id: str,
    story_bible_id: str | None = Query(default=None),
    story_bible_version: int | None = Query(default=None, ge=1),
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryStagePlanListResponse:
    _validate_story_bible_lineage_query(story_bible_id, story_bible_version)
    try:
        stages = service.list_story_stages(
            project_id,
            story_bible_id=story_bible_id,
            story_bible_version=story_bible_version,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return StoryStagePlanListResponse(data=stages)


@router.post(
    "/{project_id}/episode-plan-materializations",
    response_model=EpisodePlanMaterializationResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def create_episode_plan_materialization(
    project_id: str,
    payload: EpisodePlanMaterializationCreate,
    service: LongStoryService = Depends(get_long_story_service),
) -> EpisodePlanMaterializationResponse:
    try:
        materialization = service.create_episode_plan_materialization(
            project_id,
            payload,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return EpisodePlanMaterializationResponse(data=materialization)


@router.get(
    "/{project_id}/episode-plan-materializations",
    response_model=EpisodePlanMaterializationListResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def list_episode_plan_materializations(
    project_id: str,
    story_bible_id: str | None = Query(default=None),
    story_bible_version: int | None = Query(default=None, ge=1),
    service: LongStoryService = Depends(get_long_story_service),
) -> EpisodePlanMaterializationListResponse:
    _validate_story_bible_lineage_query(story_bible_id, story_bible_version)
    try:
        materializations = service.list_episode_plan_materializations(
            project_id,
            story_bible_id=story_bible_id,
            story_bible_version=story_bible_version,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return EpisodePlanMaterializationListResponse(data=materializations)


@router.put(
    "/{project_id}/episode-plans/{episode_plan_id}/versions/{version}",
    response_model=EpisodePlanResponse,
    responses={
        404: {"model": LongStoryErrorResponse},
        409: {"model": LongStoryErrorResponse},
    },
)
def save_episode_plan(
    project_id: str,
    episode_plan_id: str,
    version: int,
    payload: EpisodePlan,
    service: LongStoryService = Depends(get_long_story_service),
) -> EpisodePlanResponse:
    _validate_versioned_path(
        project_id,
        episode_plan_id,
        version,
        payload.story_project_id,
        payload.episode_plan_id,
        payload.version,
        "Episode Plan",
    )
    try:
        episode_plan = service.save_episode_plan(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as exc:
        _raise_conflict(exc)
    return EpisodePlanResponse(data=episode_plan)


@router.get(
    "/{project_id}/episode-plans",
    response_model=EpisodePlanListResponse,
    responses={404: {"model": LongStoryErrorResponse}},
)
def list_episode_plans(
    project_id: str,
    start_episode: int | None = Query(default=None, ge=1, le=2_000),
    end_episode: int | None = Query(default=None, ge=1, le=2_000),
    story_bible_id: str | None = Query(default=None),
    story_bible_version: int | None = Query(default=None, ge=1),
    service: LongStoryService = Depends(get_long_story_service),
) -> EpisodePlanListResponse:
    if (
        start_episode is not None
        and end_episode is not None
        and end_episode < start_episode
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="end_episode must not be lower than start_episode.",
        )
    _validate_story_bible_lineage_query(story_bible_id, story_bible_version)
    try:
        episode_plans = service.list_episode_plans(
            project_id,
            start_episode=start_episode,
            end_episode=end_episode,
            story_bible_id=story_bible_id,
            story_bible_version=story_bible_version,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return EpisodePlanListResponse(data=episode_plans)


def _validate_story_bible_lineage_query(
    story_bible_id: str | None,
    story_bible_version: int | None,
) -> None:
    if (story_bible_id is None) != (story_bible_version is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="story_bible_id and story_bible_version must be provided together.",
        )


def _validate_versioned_path(
    project_id: str,
    resource_id: str,
    version: int,
    payload_project_id: str,
    payload_resource_id: str,
    payload_version: int,
    label: str,
) -> None:
    if (
        project_id != payload_project_id
        or resource_id != payload_resource_id
        or version != payload_version
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{label} path identity must match its payload identity.",
        )


def _raise_not_found(exc: Exception) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=str(exc),
    ) from exc


def _raise_conflict(exc: Exception) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=str(exc),
    ) from exc
