import logging
from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import ValidationError

from app.dependencies import get_long_story_service, get_story_planning_service
from app.modules.script_engine.long_story_models import (
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
    EpisodePlanListResponse,
    EpisodePlanResponse,
    EpisodeRoadmapDraftResponse,
    EpisodeRoadmapItemDraftResponse,
    GenerationTaskCheckpoint,
    GenerationTaskCheckpointResponse,
    LongStoryErrorResponse,
    StoryBible,
    StoryBibleDraftRequest,
    StoryBibleDraftResponse,
    StoryBibleModificationRequest,
    StoryBibleResponse,
    StoryPlanNode,
    StoryPlanNodeDraftRequest,
    StoryPlanNodeDecompositionRequest,
    StoryPlanNodeModificationRequest,
    StoryPlanNodeListResponse,
    StoryPlanNodeResponse,
    StoryProject,
    StoryProjectDeletionResponse,
    StoryProjectListResponse,
    StoryProjectResponse,
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
from app.modules.script_engine.story_planning_service import (
    StoryPlanningInputError,
    StoryPlanningService,
)


router = APIRouter(prefix="/story-projects", tags=["Long Story Planning"])
logger = logging.getLogger(__name__)


def _generation_failure_headers(
    *,
    retryable: bool,
    failure_class: str,
    error_type: str,
) -> dict[str, str]:
    return {
        "X-Generation-Retryable": "true" if retryable else "false",
        "X-Generation-Failure-Class": failure_class,
        "X-Generation-Error-Type": error_type,
    }


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
    elif category == "timeout":
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
    exc: ValidationError | LLMStructuredOutputError,
) -> NoReturn:
    logger.warning(
        "Planning model output failed validation error_type=%s detail=%s",
        type(exc).__name__,
        str(exc)[:2000],
    )
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="剧情规划模型本次未返回完整可用内容，请重试当前部分。",
        headers=_generation_failure_headers(
            retryable=False,
            failure_class="contract",
            error_type="output_incomplete",
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
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    include_archived: bool = Query(default=False),
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryProjectListResponse:
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
    if payload.story_project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Bible draft path ID must match payload story_project_id.",
        )
    try:
        story_bible = service.generate_story_bible_draft(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
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
            exc, artifact="story_bible", project_id=project_id,
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
) -> StoryBibleResponse:
    if (
        payload.story_project_id != project_id
        or payload.story_bible_id != story_bible_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Bible modification path IDs must match the payload.",
        )
    try:
        candidate = service.modify_story_bible(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
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
) -> StoryPlanNodeResponse:
    if payload.story_project_id != project_id or payload.node_id != node_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Story Plan Node modification path IDs must match the payload.",
        )
    try:
        candidate = service.modify_story_plan_node(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
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
    try:
        plan = service.modify_episode_plan_item(payload)
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
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
