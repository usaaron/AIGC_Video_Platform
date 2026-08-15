import json
import logging
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Iterator, NoReturn

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

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
from app.modules.script_engine.continuity_qc import BlockingContinuityConflictError
from app.modules.script_engine.llm_adapter import (
    LLMRequestError,
    LLMStructuredOutputError,
    MissingLLMConfigurationError,
)
from app.modules.script_engine.knowledge_bundle import InvalidKnowledgeBundleError
from app.modules.script_engine.script_post_editor import InvalidScriptPostEditError
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


def _raise_llm_configuration_unavailable(
    error: MissingLLMConfigurationError,
) -> NoReturn:
    logger.error("LLM role configuration is incomplete: %s", error)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="生成服务配置尚未完成，请联系管理员检查模型角色配置。",
        headers=_generation_failure_headers(
            retryable=False,
            failure_class="configuration",
            error_type="configuration_unavailable",
        ),
    ) from error


def _public_llm_request_message(error: LLMRequestError) -> str:
    if error.status_code == 429:
        return "上游模型当前请求过多，已保留此前成功保存的内容，请稍后继续。"
    if error.category == "empty_response":
        return (
            "上游模型返回了空的结构化响应，已完成一次有界重试仍无可读取内容；"
            "此前成功内容已保留，可从当前失败集继续。"
        )
    if error.category == "timeout":
        return "上游模型响应超时，已保留此前成功保存的内容，请重试当前集。"
    if (
        error.category in {
            "provider_gateway",
            "failover_exhausted",
            "script_generation_routes_exhausted",
        }
        or (error.status_code is not None and error.status_code >= 500)
    ):
        status_detail = (
            f"（状态码 {error.status_code}）"
            if error.status_code is not None
            else ""
        )
        return (
            f"正文模型供应商网关连续异常{status_detail}，本集尚未进入 JSON 和剧本规则校验；"
            "此前成功内容已保留，可从当前失败集继续。"
        )
    return "上游模型请求暂时未完成，已保留此前成功保存的内容，请重试当前集。"


def _llm_request_is_retryable(error: LLMRequestError) -> bool:
    provider_status = error.status_code
    return (
        provider_status in {408, 429}
        or (provider_status is not None and provider_status >= 500)
        or (
            provider_status is None
            and error.category in {
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


def _raise_llm_upstream_unavailable(error: LLMRequestError) -> NoReturn:
    provider_status = error.status_code
    retryable = _llm_request_is_retryable(error)
    raise HTTPException(
        status_code=(
            status.HTTP_429_TOO_MANY_REQUESTS
            if error.status_code == status.HTTP_429_TOO_MANY_REQUESTS
            else status.HTTP_503_SERVICE_UNAVAILABLE
        ),
        detail=_public_llm_request_message(error),
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
    ) from error


def _raise_script_output_incomplete(error: Exception) -> NoReturn:
    logger.warning(
        "Script model output failed validation error_type=%s detail=%s",
        type(error).__name__,
        str(error)[:2000],
    )
    if isinstance(error, BlockingContinuityConflictError):
        detail = "本集正文未能满足已批准的剧情连续性，请重试当前集。"
    elif isinstance(error, InvalidScriptPostEditError):
        detail = "GPT正文终审结果尚未形成完整可用内容，请重试当前集。"
    else:
        detail = "正文模型本次未返回完整可用内容，请重试当前集。"
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=detail,
        headers=_generation_failure_headers(
            retryable=False,
            failure_class="contract",
            error_type="output_incomplete",
        ),
    ) from error


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
    except (InvalidBilingualViewOutputError, LLMStructuredOutputError) as exc:
        _raise_script_output_incomplete(exc)
    except MissingLLMConfigurationError as exc:
        _raise_llm_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_llm_upstream_unavailable(exc)


@router.post(
    "/generate-draft",
    response_model=ScriptGenerationDraftResponse,
    responses={
        404: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
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
        InvalidResolvedCreativeContextError,
        InvalidKnowledgeBundleError,
    ) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except (
        InvalidDraftMasterScriptOutputError,
        InvalidScriptPostEditError,
        BlockingContinuityConflictError,
        LLMStructuredOutputError,
    ) as exc:
        _raise_script_output_incomplete(exc)
    except LLMRequestError as exc:
        _raise_llm_upstream_unavailable(exc)
    except MissingLLMConfigurationError as exc:
        _raise_llm_configuration_unavailable(exc)

    return ScriptGenerationDraftResponse(data=result)


@router.post(
    "/generate-draft/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
def stream_script_draft(
    payload: ScriptGenerationDraftRequest,
    service: ScriptGenerationService = Depends(get_script_generation_service),
) -> StreamingResponse:
    """Stream model deltas and validation stages for one episode draft."""

    def event_stream() -> Iterator[str]:
        events: queue.Queue[dict[str, object] | None] = queue.Queue()
        generation_started_at = time.perf_counter()
        last_stage = "queued"
        episode_number = (
            payload.episode_context.episode_number
            if payload.episode_context is not None
            else None
        )

        def publish(event_type: str, event_payload: dict[str, object]) -> None:
            nonlocal last_stage
            if event_type == "stage":
                stage = event_payload.get("stage")
                if isinstance(stage, str) and stage.strip():
                    last_stage = stage
            events.put({
                "type": event_type,
                "episode_number": episode_number,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **event_payload,
            })

        def generate() -> None:
            try:
                result = service.generate_draft(
                    payload,
                    progress_callback=publish,
                )
                runtime_metadata = result.draft_master_script.llm_metadata
                logger.info(
                    "Episode generation completed episode=%s elapsed_ms=%s "
                    "first_delta_ms=%s initial_model_ms=%s passes=%s prompt_chars=%s",
                    episode_number,
                    runtime_metadata.get("generation_elapsed_ms"),
                    runtime_metadata.get("first_draft_delta_elapsed_ms"),
                    runtime_metadata.get("initial_model_elapsed_ms"),
                    runtime_metadata.get("model_pass_count"),
                    runtime_metadata.get("prompt_characters"),
                )
                result_payload = result.model_dump(mode="json")
                # The streamed draft already contains the parsed screenplay. The
                # full prompt and raw model JSON duplicate tens of thousands of
                # characters in every browser workspace and are not needed for
                # review, modification, retry, or export. Keep trace metadata and
                # a schema-valid marker so later source-run requests still validate.
                prompt_build = result_payload.get("prompt_build_result")
                if isinstance(prompt_build, dict):
                    prompt_build["prompt_text"] = (
                        "Prompt omitted after streamed generation."
                    )
                    prompt_build["rendered_variables"] = {}
                result_payload["llm_raw_output"] = {}
                publish("result", {"data": result_payload})
            except Exception as exc:  # The response has already started with HTTP 200.
                elapsed_ms = round((time.perf_counter() - generation_started_at) * 1000)
                logger.exception(
                    "Streamed episode generation failed episode=%s elapsed_ms=%s stage=%s",
                    episode_number,
                    elapsed_ms,
                    last_stage,
                )
                error_payload: dict[str, object] = {
                    "error_type": "generation_failed",
                    "message": "正文生成暂时未完成，请重试当前集。",
                    "status": 500,
                    "recoverable": False,
                }
                if isinstance(exc, LLMRequestError):
                    in_gpt_edit = last_stage in {
                        "checking_gpt_edit",
                        "editing_with_gpt",
                        "validating_gpt_edit",
                    }
                    error_payload.update({
                        "error_type": "upstream_unavailable",
                        "message": (
                            "GPT正文终审服务暂时未完成本集优化，请从当前失败集重试。"
                            if in_gpt_edit
                            else _public_llm_request_message(exc)
                        ),
                        "status": exc.status_code or 503,
                        "recoverable": _llm_request_is_retryable(exc),
                    })
                elif isinstance(exc, InvalidScriptPostEditError):
                    error_payload.update({
                        "error_type": "post_edit_incomplete",
                        "message": "GPT正文终审结果尚未形成完整可用的场景编辑，请从当前失败集重试。",
                        "status": 422,
                        "recoverable": True,
                    })
                elif (
                    isinstance(exc, LLMStructuredOutputError)
                    and last_stage in {"editing_with_gpt", "validating_gpt_edit"}
                ):
                    error_payload.update({
                        "error_type": "post_edit_incomplete",
                        "message": "GPT正文终审结果尚未形成完整可用的场景编辑，请从当前失败集重试。",
                        "status": 422,
                        "recoverable": True,
                    })
                elif isinstance(exc, LLMStructuredOutputError):
                    error_payload.update({
                        "error_type": "output_incomplete",
                        "message": "正文模型本次未返回完整可用内容，已保存的内容不会丢失，请重试当前集。",
                        "status": 422,
                        "recoverable": True,
                    })
                elif isinstance(exc, InvalidDraftMasterScriptOutputError):
                    error_payload.update({
                        "error_type": "output_incomplete",
                        "message": "本集正文结构尚未完整生成，已保存的内容不会丢失，请重试当前集。",
                        "status": 422,
                        "recoverable": True,
                    })
                elif isinstance(exc, BlockingContinuityConflictError):
                    error_payload.update({
                        "error_type": "continuity_conflict",
                        "message": "本集正文未能满足已批准的剧情连续性，请重试当前集。",
                        "status": 422,
                        "recoverable": True,
                    })
                elif isinstance(exc, MissingLLMConfigurationError):
                    error_payload.update({
                        "error_type": "configuration_unavailable",
                        "message": "正文生成服务配置尚未完成，请联系管理员检查模型配置。",
                        "status": 503,
                        "recoverable": False,
                    })
                publish("error", error_payload)
            finally:
                events.put(None)

        threading.Thread(target=generate, daemon=True).start()
        yield ": connected\n\n"
        sequence = 0
        while True:
            event = events.get()
            if event is None:
                break
            sequence += 1
            yield (
                f"id: {sequence}\n"
                f"data: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


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
    except (
        InvalidDraftMasterScriptOutputError,
        BlockingContinuityConflictError,
    ) as exc:
        _raise_script_output_incomplete(exc)


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
        InvalidScriptPostEditError,
        BlockingContinuityConflictError,
        LLMStructuredOutputError,
    ) as exc:
        _raise_script_output_incomplete(exc)
    except InvalidKnowledgeBundleError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except MissingLLMConfigurationError as exc:
        _raise_llm_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_llm_upstream_unavailable(exc)


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
        LLMStructuredOutputError,
    ) as exc:
        _raise_script_output_incomplete(exc)
    except (InvalidKnowledgeBundleError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except MissingLLMConfigurationError as exc:
        _raise_llm_configuration_unavailable(exc)
    except LLMRequestError as exc:
        _raise_llm_upstream_unavailable(exc)


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
