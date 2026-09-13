from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError

from app.database import DatabaseRuntime
from app.dependencies import get_long_story_database_runtime, get_story_planning_service
from app.modules.script_engine.author_revision_service import (
    AuthorRevisionRequest,
    AuthorRevisionResponse,
    AuthorRevisionService,
)
from app.modules.script_engine.llm_adapter import (
    LLMRequestError,
    LLMStructuredOutputError,
    MissingLLMConfigurationError,
)
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.long_story_service import LongStoryNotFoundError, LongStoryReferenceError
from app.modules.script_engine.story_planning_service import StoryPlanningInputError, StoryPlanningService


router = APIRouter(prefix="/story-projects", tags=["Long Story Planning"])


def get_author_revision_service(
    database_runtime: DatabaseRuntime = Depends(get_long_story_database_runtime),
    planning_service: StoryPlanningService = Depends(get_story_planning_service),
) -> AuthorRevisionService:
    return AuthorRevisionService(database_runtime, planning_service)


@router.post(
    "/{project_id}/author-revisions",
    response_model=AuthorRevisionResponse,
)
def create_author_revision(
    project_id: str,
    payload: AuthorRevisionRequest,
    service: AuthorRevisionService = Depends(get_author_revision_service),
) -> AuthorRevisionResponse:
    try:
        return AuthorRevisionResponse(data=service.create_revision(project_id, payload))
    except LongStoryNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except (LongStoryPersistenceConflictError, LongStoryReferenceError) as error:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="总纲、工作区或处理方案已变化，请重新检查影响后再确认。",
        ) from error
    except (StoryPlanningInputError, ValidationError) as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)) from error
    except MissingLLMConfigurationError as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="修订模型暂不可用，请稍后重试。") from error
    except (LLMStructuredOutputError, LLMRequestError) as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="总纲修订未完成，原项目保持不变，请重试。") from error
