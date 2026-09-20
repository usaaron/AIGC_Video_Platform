from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import ValidationError

from app.api.copilot_stream import accepts_copilot_stream, copilot_stream_response
from app.database import DatabaseConfigurationError
from app.dependencies import get_long_story_database_runtime
from app.modules.quick_script.models import QuickActionRequest, QuickResponse
from app.modules.quick_script.repository import QuickRepository
from app.modules.quick_script.service import QuickInputError, QuickService
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError
from app.modules.script_engine.long_story_service import LongStoryNotFoundError, LongStoryPayloadTooLargeError

router = APIRouter(prefix="/story-projects/{project_id}/quick-script", tags=["Quick Script"])


class _LazyEngine:
    """Reading, confirming and recovering saved work never requires a live model."""
    def __getattr__(self, name):
        from app.modules.quick_script.engine import build_quick_script_engine
        engine = build_quick_script_engine()
        return getattr(engine, name)


def get_quick_script_service() -> QuickService:
    try:
        runtime = get_long_story_database_runtime()
    except DatabaseConfigurationError:
        raise HTTPException(503, "快速创作需要可用的项目持久化服务。") from None
    return QuickService(QuickRepository(runtime), _LazyEngine())


def _handle(operation):
    try:
        return QuickResponse(data=operation())
    except LongStoryNotFoundError as exc:
        raise HTTPException(404, str(exc)) from None
    except LongStoryPersistenceConflictError as exc:
        raise HTTPException(409, str(exc)) from None
    except LongStoryPayloadTooLargeError as exc:
        raise HTTPException(413, str(exc)) from None
    except QuickInputError as exc:
        raise HTTPException(422, str(exc)) from None
    except ValidationError:
        raise HTTPException(422, "快速创作内容格式不完整，请检查设置、创作安排或正文后重试。") from None


@router.get("", response_model=QuickResponse)
def get_quick_script(project_id: str, service: QuickService = Depends(get_quick_script_service)):
    return _handle(lambda: service.get(project_id))


@router.post("/actions", response_model=QuickResponse)
def quick_script_action(project_id: str, payload: QuickActionRequest, request: Request,
                        service: QuickService = Depends(get_quick_script_service)):
    operation = lambda: _handle(lambda: service.action(project_id, payload))
    if accepts_copilot_stream(request):
        return copilot_stream_response(operation)
    return operation()
