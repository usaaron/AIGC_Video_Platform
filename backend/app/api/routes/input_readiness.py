from __future__ import annotations

from fastapi import APIRouter, Depends

from app.llm_runtime import build_creative_llm_adapter_from_env
from app.modules.input_readiness.models import (
    CreativeInputReadinessRequest,
    CreativeInputReadinessResponse,
)
from app.modules.input_readiness.service import CreativeInputReadinessService
from app.modules.script_engine.llm_adapter import MissingLLMConfigurationError


router = APIRouter(prefix="/input-readiness", tags=["Input Readiness"])


def get_input_readiness_service() -> CreativeInputReadinessService:
    """Build an optional classifier; local analysis remains available offline."""

    try:
        llm_adapter = build_creative_llm_adapter_from_env()
    except MissingLLMConfigurationError:
        llm_adapter = None
    return CreativeInputReadinessService(llm_adapter=llm_adapter)


@router.post(
    "/analyze",
    response_model=CreativeInputReadinessResponse,
    summary="Analyze creative input completeness without changing workflow state",
)
def analyze_input_readiness(
    payload: CreativeInputReadinessRequest,
    service: CreativeInputReadinessService = Depends(get_input_readiness_service),
) -> CreativeInputReadinessResponse:
    return CreativeInputReadinessResponse(data=service.analyze(payload))
