from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_long_story_service
from app.modules.script_engine.long_story_models import (
    EpisodeArtifactCreate,
    EpisodeArtifactKind,
    EpisodeArtifactListResponse,
    EpisodeArtifactResponse,
    EpisodePlan,
    EpisodePlanListResponse,
    EpisodePlanResponse,
    LongStoryErrorResponse,
    StoryBible,
    StoryBibleResponse,
    StoryProject,
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


router = APIRouter(prefix="/story-projects", tags=["Long Story Planning"])


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
    except LongStoryPersistenceConflictError as exc:
        _raise_conflict(exc)
    return StoryProjectResponse(data=project)


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
    service: LongStoryService = Depends(get_long_story_service),
) -> StoryStagePlanListResponse:
    try:
        stages = service.list_story_stages(project_id)
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
    service: LongStoryService = Depends(get_long_story_service),
) -> EpisodePlanListResponse:
    if (
        start_episode is not None
        and end_episode is not None
        and end_episode < start_episode
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_episode must not be lower than start_episode.",
        )
    try:
        episode_plans = service.list_episode_plans(
            project_id,
            start_episode=start_episode,
            end_episode=end_episode,
        )
    except LongStoryNotFoundError as exc:
        _raise_not_found(exc)
    return EpisodePlanListResponse(data=episode_plans)


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
