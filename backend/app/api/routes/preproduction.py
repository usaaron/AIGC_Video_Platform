from contextlib import contextmanager
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import ValidationError

from app.dependencies import get_long_story_service, get_storyboard_service
from app.modules.script_engine.long_story_service import LongStoryService, LongStoryNotFoundError
from app.modules.script_engine.llm_adapter import (
    LLMRequestError, LLMStructuredOutputError, MissingLLMConfigurationError,
)
from app.modules.preproduction.models import (
    StoryboardEditRequest, StoryboardGenerateRequest, StoryboardResponse, StoryboardStartRequest,
)
from app.modules.preproduction.repository import StoryboardConflictError
from app.modules.preproduction.service import StoryboardService

logger = logging.getLogger(__name__)


def require_episode(
    project_id: str, episode_number: int = Path(ge=1, le=2000),
    projects: LongStoryService = Depends(get_long_story_service),
) -> None:
    try:
        project = projects.get_project(project_id)
    except LongStoryNotFoundError as exc:
        raise HTTPException(404, "项目不存在。") from exc
    if episode_number > project.planned_episode_count:
        raise HTTPException(422, "集数超出项目范围。")


router = APIRouter(
    prefix="/story-projects/{project_id}/episodes/{episode_number}/storyboard",
    tags=["Preproduction"], dependencies=[Depends(require_episode)],
)


@contextmanager
def storyboard_errors():
    try:
        yield
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except StoryboardConflictError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (ValidationError, LLMStructuredOutputError) as exc:
        logger.warning("Storyboard output rejected error_type=%s", type(exc).__name__)
        raise HTTPException(422, "分镜数据未通过结构检查，已保存的内容仍保留。") from exc
    except MissingLLMConfigurationError as exc:
        raise HTTPException(503, "分镜模型配置不完整，请检查规划编辑模型配置。") from exc
    except LLMRequestError as exc:
        logger.warning("Storyboard upstream failed category=%s status=%s", getattr(exc, "category", None), getattr(exc, "status_code", None))
        raise HTTPException(503, "分镜模型暂未完成请求，请重试本场；已保存内容仍保留。") from exc


@router.get("", response_model=StoryboardResponse)
def get_storyboard(project_id: str, episode_number: int, revision: int | None = Query(default=None, ge=1),
                   service: StoryboardService = Depends(get_storyboard_service)):
    with storyboard_errors():
        return StoryboardResponse(data=service.require(project_id, episode_number, revision=revision))


@router.post("", response_model=StoryboardResponse)
def start_storyboard(project_id: str, episode_number: int, payload: StoryboardStartRequest,
                     service: StoryboardService = Depends(get_storyboard_service)):
    with storyboard_errors():
        return StoryboardResponse(data=service.start(project_id, episode_number, payload.source_draft, payload.expected_revision))


@router.put("", response_model=StoryboardResponse)
def edit_storyboard(project_id: str, episode_number: int, payload: StoryboardEditRequest,
                    service: StoryboardService = Depends(get_storyboard_service)):
    with storyboard_errors():
        return StoryboardResponse(data=service.edit(project_id, episode_number, payload))


@router.post("/scenes/{scene_number}/generate", response_model=StoryboardResponse)
def generate_storyboard_scene(project_id: str, episode_number: int, payload: StoryboardGenerateRequest,
                              scene_number: int = Path(ge=1, le=50),
                              service: StoryboardService = Depends(get_storyboard_service)):
    with storyboard_errors():
        return StoryboardResponse(data=service.generate_scene(
            project_id, episode_number, scene_number, payload.expected_revision, payload.instruction,
        ))
