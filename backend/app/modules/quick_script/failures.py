"""Public Quick failures include bounded diagnostics, never provider payloads."""
from __future__ import annotations

import httpcore
import httpx
from pydantic import ValidationError

from app.modules.script_engine.llm_adapter import (
    LLMRequestError, LLMStructuredOutputError, MissingLLMConfigurationError, is_reasoning_output_exhaustion,
)
from app.modules.script_engine.llm_deadline import DeadlineExceeded


_CATEGORIES = {"deadline", "timeout", "provider_http", "provider_gateway", "transport", "empty_response", "unknown"}
_ERROR_TYPES = {"DeadlineExceeded", "LLMRequestError", "LLMStructuredOutputError", "MissingLLMConfigurationError",
                "ValidationError", "ReadTimeout", "WriteTimeout", "ConnectTimeout", "PoolTimeout", "TimeoutError",
                "HTTPStatusError", "ReadError", "WriteError", "ConnectError", "RemoteProtocolError"}


def classify_failure(error: Exception, *, elapsed_ms: int, physical_requests: int) -> tuple[str, str, dict]:
    # The request budget and deadline wrappers can each add another exception.
    # Walk typed causes and contexts, never parse arbitrary provider error prose.
    chain, pending, seen = [], [error], set()
    while pending and len(chain) < 16:
        item = pending.pop(0)
        if id(item) in seen:
            continue
        seen.add(id(item))
        chain.append(item)
        pending.extend(cause for cause in (item.__cause__, item.__context__) if isinstance(cause, Exception))
    request = next((item for item in chain if isinstance(item, LLMRequestError)), None)
    http_error = next((item for item in chain if isinstance(item, httpx.HTTPStatusError)), None)
    status = next((item.status_code for item in chain if isinstance(item, LLMRequestError)
                   and type(item.status_code) is int and 100 <= item.status_code <= 599), None)
    if status is None:
        status = next((item.response.status_code for item in chain if isinstance(item, httpx.HTTPStatusError)), None)
    deadline = next((item for item in chain if isinstance(item, DeadlineExceeded)), None)
    timeout = next((item for item in chain if isinstance(item, (TimeoutError, httpx.TimeoutException, httpcore.TimeoutException))), None)
    structured = next((item for item in chain if isinstance(item, (LLMStructuredOutputError, ValidationError))), None)
    configuration = next((item for item in chain if isinstance(item, MissingLLMConfigurationError)), None)
    transport = next((item for item in chain if isinstance(item, (httpx.TransportError, httpcore.NetworkError))), None)
    reasoning_exhausted = next((item for item in chain if is_reasoning_output_exhaustion(item)), None)
    category = request.category if request and request.category in _CATEGORIES else "unknown"
    cause = deadline or timeout or request or http_error or structured or configuration or transport or error
    code, message = "quick_model_operation_failed", "本次模型操作未完成；已有内容已保存，恢复后仅重试当前步骤。"
    scope = getattr(deadline, "scope", None) or getattr(request, "deadline_scope", None)
    if deadline or category == "deadline":
        code, category = "quick_model_timeout", "deadline"
        message = "当前步骤已达到模型等待时限，已有内容已保存。可恢复当前步骤，不会重新生成已完成内容。"
    elif timeout or category == "timeout" or status in {408, 504, 524}:
        code = "quick_model_timeout"
        category = "provider_gateway" if status in {504, 524} else "timeout"
        message = ("模型服务网关等待超时，已有内容已保存。可稍后恢复当前步骤，不会重新生成已完成内容。"
                   if status in {504, 524} else "模型响应超时，已有内容已保存。可稍后恢复当前步骤，不会自动重复请求。")
    elif configuration or status in {401, 403, 404}:
        code, message = "quick_model_configuration", "模型接入配置暂不可用，已有内容已保存，请联系管理员检查后恢复。"
    elif status == 429:
        code, message = "quick_model_busy", "模型当前请求较多，已有内容已保存，请稍后恢复当前步骤。"
    elif reasoning_exhausted:
        code, category, cause = "quick_reasoning_output_exhausted", "empty_response", reasoning_exhausted
        message = "模型本次思考已达到输出长度上限，未返回可保存结果。已有内容已保存，请恢复当前步骤继续；不会自动重复请求。"
    elif structured:
        code, message = "quick_output_invalid", "本次模型结果不完整或格式不正确，已有内容已保存，请恢复当前步骤重新生成。"
    elif transport or category == "transport":
        code, category = "quick_model_connection", "transport"
        message = "模型连接中断，已有内容已保存。可恢复当前步骤，不会重新生成已完成内容。"
    elif status is not None and status >= 500:
        code, category = "quick_model_upstream", "provider_gateway"
        message = "模型服务暂时异常，已有内容已保存。可稍后恢复当前步骤，不会自动重复请求。"
    diagnostics = {
        "error_type": type(cause).__name__ if type(cause).__name__ in _ERROR_TYPES else "UnknownError",
        "category": category, "elapsed_ms": max(0, int(elapsed_ms)), "physical_requests": max(0, int(physical_requests)),
    }
    if status is not None:
        diagnostics["http_status"] = status
    if scope in {"request", "quick_operation", "initial_generation", "episode_generation", "planning"}:
        diagnostics["deadline_scope"] = scope
    return code, message, diagnostics
