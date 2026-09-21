"""Optional SSE transport for the existing synchronous copilot operations."""

from __future__ import annotations

import asyncio
from contextvars import copy_context
from contextlib import nullcontext
import json
import logging
import queue
import threading
import time
from typing import Any, AsyncIterator, Callable
from collections.abc import Mapping
from uuid import uuid4

from fastapi import HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from app.api.retained_generation_stream import RetainedGenerationStreamingResponse
from app.modules.agent_runtime.stream_lifecycle import EpisodeStreamLifecycle

from app.modules.script_engine.copilot_progress import (
    CopilotProgress,
    CopilotRequestCancelled,
    bind_copilot_progress,
)
from app.modules.script_engine.llm_deadline import DeadlineExceeded, check_deadline, deadline_scope

logger = logging.getLogger(__name__)
COPILOT_HEARTBEAT_SECONDS = 15.0
COPILOT_DEADLINE_SECONDS = 600.0
COPILOT_QUEUE_SIZE = 128


def accepts_copilot_stream(request: Request | None) -> bool:
    if request is None:
        return False
    for entry in request.headers.get("accept", "").split(","):
        parts = [part.strip().lower() for part in entry.split(";")]
        if parts[0] != "text/event-stream":
            continue
        quality = next((part[2:] for part in parts[1:] if part.startswith("q=")), "1")
        try:
            return float(quality) > 0
        except ValueError:
            return False
    return False


def _http_error_event(error: HTTPException) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": "error",
        "message": error.detail if isinstance(error.detail, str) else "请求未能完成，请检查输入后重试。",
        "status": error.status_code,
    }
    headers = {key.lower(): value for key, value in (error.headers or {}).items()}
    retryable = headers.get("x-generation-retryable")
    if retryable is not None:
        event["retryable"] = retryable.lower() == "true"
    for name in ("failure-class", "error-type"):
        value = headers.get(f"x-generation-{name}")
        if value is not None:
            event[name.replace("-", "_")] = value
    if headers.get("x-agent-run-id"):
        event["agent_run_id"] = headers["x-agent-run-id"]
    return event


def copilot_stream_response(operation: Callable[[], Any], *,
                            persist_on_disconnect: bool = False,
                            request_id: str | None = None,
                            on_timeout: Callable[[], None] | None = None,
                            result_headers: Mapping[str, str] | None = None) -> StreamingResponse:
    # Dependencies are resolved before entry and retained by the operation.
    # copy_context preserves the account/host isolation ContextVars in the worker.
    context = copy_context()
    events: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=COPILOT_QUEUE_SIZE)
    terminal: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
    lifecycle = EpisodeStreamLifecycle() if persist_on_disconnect else None
    cancelled = lifecycle.cancel if lifecycle is not None else threading.Event()
    finished = lifecycle.done if lifecycle is not None else threading.Event()
    started = threading.Event()
    detached = threading.Event()
    trace_id = request_id or str(uuid4())
    text_truncated = {"reasoning_summary": threading.Event(), "model_thinking": threading.Event()}

    def publish(event: dict[str, Any]) -> None:
        if cancelled.is_set() or detached.is_set():
            return
        if request_id is not None:
            event = {**event, "request_id": trace_id}
        if event.get("type") in {"result", "error"}:
            try:
                terminal.put_nowait(event)
            except queue.Full:
                pass
            return
        truncation = text_truncated.get(event.get("type"))
        if truncation is not None and truncation.is_set():
            return
        try:
            events.put_nowait(event)
        except queue.Full:
            # A slow reader gets a continuous prefix per text channel, never text with
            # missing middle fragments. Terminal delivery has its own slot.
            if truncation is not None:
                truncation.set()

    observer = CopilotProgress(publish, cancelled)

    def publish_failure(event: dict[str, Any]) -> None:
        # A failed provider call may leave its last Chinese phrase buffered.
        # Only finish display text already received; never resume model work or
        # accept an incomplete mixed-language tail as a complete explanation.
        try:
            if not cancelled.is_set() and not detached.is_set():
                observer.flush_interrupted_text()
        except CopilotRequestCancelled:
            pass
        except Exception:
            # Feedback failure must not replace or hide the original terminal.
            logger.warning("Copilot failure feedback could not be flushed request_id=%s", trace_id)
        finally:
            publish(event)

    def worker() -> None:
        try:
            with (lifecycle.bind() if lifecycle is not None else nullcontext()), bind_copilot_progress(observer), deadline_scope(COPILOT_DEADLINE_SECONDS, scope="copilot"):
                observer.progress("context")
                result = operation()
                observer.check_cancelled()
                observer.flush_text()
                observer.progress("validating")
                encoded = jsonable_encoder(result)
                observer.check_cancelled()
                check_deadline()
            event = {"type": "result", "data": encoded}
            if result_headers is not None:
                event["headers"] = {key: value for key, value in result_headers.items()
                                    if key.lower() in {"x-agent-run-id", "x-agent-run-attempt"}}
            publish(event)
        except CopilotRequestCancelled:
            pass
        except HTTPException as error:
            publish_failure(_http_error_event(error))
        except DeadlineExceeded:
            publish_failure({"type": "error", "status": 503, "message": "本次请求已达到处理时限，请稍后重试。",
                     "retryable": False, "failure_class": "time_budget_exhausted", "error_type": "deadline"})
        except Exception as error:
            # Exception reprs may contain prompts/provider bodies; only class-free
            # diagnostics and a fixed public message belong on this transport.
            logger.error("Copilot streaming operation failed request_id=%s error_type=%s", trace_id, type(error).__name__)
            publish_failure({"type": "error", "status": 500, "message": "本次请求未能完成，请稍后重试。", "retryable": False})
        finally:
            finished.set()

    async def stream() -> AsyncIterator[str]:
        started.set()
        threading.Thread(target=lambda: context.run(worker), name="copilot-request", daemon=True).start()
        sequence = 0
        last_sent = time.monotonic()
        expires_at = last_sent + COPILOT_DEADLINE_SECONDS
        try:
            while True:
                # Snapshot before checking queues: completion may race an empty
                # read, but a finished worker has already enqueued its terminal.
                worker_finished = finished.is_set()
                if not worker_finished and time.monotonic() >= expires_at:
                    sequence += 1
                    event = {"type": "error", "status": 503, "message": "本次处理已超时，已保存的内容不会丢失，请恢复当前步骤。",
                             "retryable": False, "failure_class": "time_budget_exhausted", "error_type": "deadline"}
                    if request_id is not None:
                        event["request_id"] = trace_id
                    yield f"id: {sequence}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                    break
                try:
                    event = events.get_nowait()
                except queue.Empty:
                    try:
                        event = terminal.get_nowait()
                    except queue.Empty:
                        if worker_finished:
                            break
                        if time.monotonic() - last_sent >= COPILOT_HEARTBEAT_SECONDS:
                            yield ": heartbeat\n\n"
                            last_sent = time.monotonic()
                        await asyncio.sleep(0.05)
                        continue
                sequence += 1
                yield f"id: {sequence}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                last_sent = time.monotonic()
                if event.get("type") in {"result", "error"}:
                    break
        finally:
            detached.set()
            if not persist_on_disconnect:
                cancelled.set()

    response_type = RetainedGenerationStreamingResponse if persist_on_disconnect else StreamingResponse
    def close_expired_operation():
        if lifecycle is not None:
            lifecycle.close()
        if on_timeout is not None:
            on_timeout()

    lifecycle_options = dict(finished=finished, cancelled=cancelled, started=started, detached=detached,
                            deadline_seconds=COPILOT_DEADLINE_SECONDS + 2,
                            on_timeout=close_expired_operation) if persist_on_disconnect else {}
    return response_type(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
        "X-Request-ID": trace_id,
    }, **lifecycle_options)
