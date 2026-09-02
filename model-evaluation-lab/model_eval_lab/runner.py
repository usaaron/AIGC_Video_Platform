from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import json
import ssl
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid

from .config import EvaluationModelConfig


async def run_evaluation_models(
    *,
    stage: str,
    prompt: str,
    models: list[EvaluationModelConfig],
) -> list[dict[str, object]]:
    return list(
        await asyncio.gather(
            *(_run_one(stage=stage, prompt=prompt, model=model) for model in models)
        )
    )


async def _run_one(
    *,
    stage: str,
    prompt: str,
    model: EvaluationModelConfig,
) -> dict[str, object]:
    started = time.monotonic()
    result_id = f"evaluation-result.{uuid.uuid4()}"
    if not model.configured:
        return _result(
            result_id=result_id,
            model=model,
            status="configuration_required",
            started=started,
            error="该模型配置尚未填写完整。",
        )
    try:
        output = await asyncio.to_thread(_generate_text, stage, prompt, model)
    except PartialGenerationError as exc:
        return _result(
            result_id=result_id,
            model=model,
            status="partial",
            started=started,
            output=exc.output,
            error=str(exc),
        )
    except Exception as exc:  # Provider-specific failures are returned per model.
        return _result(
            result_id=result_id,
            model=model,
            status="failed",
            started=started,
            error=_safe_error(exc),
        )
    return _result(
        result_id=result_id,
        model=model,
        status="completed",
        started=started,
        output=output,
    )


def _generate_text(stage: str, prompt: str, model: EvaluationModelConfig) -> str:
    payload = _build_payload(prompt, model)
    endpoint = model.base_url.rstrip("/") + (
        "/responses" if model.wire_api.casefold() == "responses" else "/chat/completions"
    )
    if model.wire_api.casefold() != "responses":
        return _generate_chat_text(endpoint, payload, model)
    last_error: Exception | None = None
    for attempt in range(model.max_retries + 1):
        try:
            response = _request_json(endpoint, payload, model)
            output = _extract_output_text(response, model.wire_api)
            if output.strip():
                return output.strip()
            raise EvaluationProviderError("模型返回了空内容。", retryable=True)
        except EvaluationProviderError as exc:
            last_error = exc
            if not exc.retryable or attempt >= model.max_retries:
                raise
    raise EvaluationProviderError(str(last_error or "模型请求失败。"))


class EvaluationProviderError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class PartialGenerationError(EvaluationProviderError):
    """The provider emitted usable text before the connection stalled."""

    def __init__(self, output: str, message: str) -> None:
        super().__init__(message, retryable=False)
        self.output = output


def _generate_chat_text(
    endpoint: str,
    payload: dict[str, object],
    model: EvaluationModelConfig,
) -> str:
    """Read chat-completions incrementally so gateway timeouts do not erase output."""
    try:
        return _stream_request_text(endpoint, {**payload, "stream": True}, model)
    except PartialGenerationError:
        raise
    except EvaluationProviderError as stream_error:
        # Some compatible gateways reject stream=true. Preserve the old request
        # path as a compatibility fallback when no partial output was received.
        if stream_error.retryable:
            raise
        response = _request_json(endpoint, payload, model)
        output = _extract_output_text(response, model.wire_api)
        if output.strip():
            return output.strip()
        raise stream_error


def _stream_request_text(
    endpoint: str,
    payload: dict[str, object],
    model: EvaluationModelConfig,
) -> str:
    # Stay below the proxy's 120-second read window while preserving emitted text.
    read_timeout = min(max(model.timeout_seconds, 30), 110)
    request = Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {model.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    parts: list[str] = []
    try:
        with urlopen(request, timeout=read_timeout, context=ssl.create_default_context()) as response:
            content_type = (response.headers.get("Content-Type") or "").casefold()
            if "text/event-stream" not in content_type:
                body = response.read()
                try:
                    parsed = json.loads(body.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    detail = _response_body_preview(body)
                    if _looks_like_html(detail):
                        message = (
                            "模型线路地址返回了网站页面，不是 API JSON；"
                            "请检查服务商提供的 API Base URL。"
                        )
                    else:
                        message = "模型线路返回了非 JSON 内容"
                    raise EvaluationProviderError(
                        f"{message}（Content-Type: {content_type or '未知'}）：{detail}",
                        retryable=True,
                    ) from exc
                output = _extract_output_text(parsed, model.wire_api)
                if output.strip():
                    return output.strip()
                raise EvaluationProviderError("模型线路返回了空内容。", retryable=True)
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices")
                if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                    continue
                delta = choices[0].get("delta")
                if isinstance(delta, dict):
                    text = _collect_text(delta.get("content"))
                    if text:
                        parts.append(text)
    except HTTPError as exc:
        detail = _read_error_body(exc)
        raise EvaluationProviderError(
            f"模型线路返回 HTTP {exc.code}: {detail}",
            retryable=exc.code in {408, 409, 425, 429} or exc.code >= 500,
        ) from exc
    except (TimeoutError, URLError, OSError) as exc:
        if parts:
            raise PartialGenerationError(
                "".join(parts),
                f"模型流式输出在网关超时前中断：{type(exc).__name__}",
            ) from exc
        raise EvaluationProviderError(
            f"模型线路连接失败：{type(exc).__name__}", retryable=True
        ) from exc
    output = "".join(parts).strip()
    if not output:
        raise EvaluationProviderError("模型线路返回了空内容。", retryable=True)
    return output


def _build_payload(prompt: str, model: EvaluationModelConfig) -> dict[str, object]:
    if model.wire_api.casefold() == "responses":
        payload: dict[str, object] = {
            "model": model.model,
            "max_output_tokens": model.max_tokens,
            "input": [
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": "你是一个独立的创作能力评测模型。请直接输出结果。"}],
                },
                {"role": "user", "content": [{"type": "input_text", "text": prompt}]},
            ],
        }
        if model.reasoning_effort:
            payload["reasoning"] = {"effort": model.reasoning_effort}
        return payload

    is_deepseek = "deepseek" in f"{model.provider} {model.model}".casefold()
    thinking_enabled = model.thinking_mode and model.thinking_mode.casefold() == "enabled"
    payload = {
        "model": model.model,
        "max_tokens": model.max_tokens,
        "messages": [
            {"role": "system", "content": "你是一个独立的创作能力评测模型。请直接输出结果。"},
            {"role": "user", "content": prompt},
        ],
    }
    if model.thinking_mode:
        payload["thinking"] = {"type": model.thinking_mode}
    if model.reasoning_effort:
        payload["reasoning_effort"] = model.reasoning_effort
    if not (is_deepseek and thinking_enabled):
        payload["temperature"] = model.temperature
        payload["top_p"] = 0.9
    return payload


def _request_json(
    endpoint: str,
    payload: dict[str, object],
    model: EvaluationModelConfig,
) -> dict[str, object]:
    request = Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {model.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=model.timeout_seconds, context=ssl.create_default_context()) as response:
            body = response.read()
    except HTTPError as exc:
        detail = _read_error_body(exc)
        status = exc.code
        raise EvaluationProviderError(
            f"模型线路返回 HTTP {status}: {detail}",
            retryable=status in {408, 409, 425, 429} or status >= 500,
        ) from exc
    except (TimeoutError, URLError, OSError) as exc:
        raise EvaluationProviderError(
            f"模型线路连接失败：{type(exc).__name__}",
            retryable=True,
        ) from exc
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EvaluationProviderError("模型线路返回了不可读取的 JSON。", retryable=True) from exc
    if not isinstance(parsed, dict):
        raise EvaluationProviderError("模型线路返回的顶层数据不是对象。", retryable=True)
    return parsed


def _extract_output_text(response: dict[str, object], wire_api: str) -> str:
    if wire_api.casefold() == "responses":
        direct = response.get("output_text")
        if isinstance(direct, str) and direct.strip():
            return direct
        return _collect_text(response.get("output"))
    choices = response.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise EvaluationProviderError("模型响应缺少 choices 内容。")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise EvaluationProviderError("模型响应缺少 message 内容。")
    return _collect_text(message.get("content"))


def _collect_text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(part for part in parts if part.strip())
    if isinstance(value, dict):
        return _collect_text(value.get("text") or value.get("content"))
    return ""


def _read_error_body(error: HTTPError) -> str:
    try:
        body = error.read(4096).decode("utf-8", errors="replace")
    except OSError:
        return "无错误详情"
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return " ".join(body.split())[:400] or "无错误详情"
    if isinstance(payload, dict):
        detail = payload.get("error") or payload.get("detail") or payload.get("message")
        if isinstance(detail, dict):
            detail = detail.get("message")
        if isinstance(detail, str) and detail.strip():
            return " ".join(detail.split())[:400]
    return "无错误详情"


def _response_body_preview(body: bytes) -> str:
    """Keep malformed gateway responses useful without returning a whole page."""
    if not body:
        return "响应为空"
    preview = body.decode("utf-8", errors="replace")
    return " ".join(preview.split())[:240] or "响应为空"


def _looks_like_html(preview: str) -> bool:
    normalized = preview.casefold().lstrip()
    return normalized.startswith("<!doctype html") or normalized.startswith("<html")


def _result(
    *,
    result_id: str,
    model: EvaluationModelConfig,
    status: str,
    started: float,
    output: str | None = None,
    error: str | None = None,
) -> dict[str, object]:
    latency_ms = round((time.monotonic() - started) * 1000)
    return {
        "id": result_id,
        "model_id": model.id,
        "label": model.label,
        "provider": model.provider,
        "model": model.model,
        "status": status,
        "latency_ms": latency_ms,
        "character_count": len(output or ""),
        "completed_at": datetime.now(UTC).isoformat(),
        "output": output,
        "error": error,
    }


def _safe_error(exc: Exception) -> str:
    message = " ".join(str(exc).split()).strip()
    return (message or type(exc).__name__)[:600]
