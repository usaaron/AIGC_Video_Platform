"""Optional SSE transport for the existing synchronous copilot operations."""

from __future__ import annotations

import asyncio
from contextvars import copy_context
import json
import logging
import queue
import threading
import time
from typing import Any, AsyncIterator, Callable

from fastapi import HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse

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
    return event


def copilot_stream_response(operation: Callable[[], Any]) -> StreamingResponse:
    # Dependencies are resolved before entry and retained by the operation.
    # copy_context preserves the account/host isolation ContextVars in the worker.
    context = copy_context()
    events: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=COPILOT_QUEUE_SIZE)
    terminal: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
    cancelled = threading.Event()
    finished = threading.Event()
    text_truncated = {"reasoning_summary": threading.Event(), "model_thinking": threading.Event()}

    def publish(event: dict[str, Any]) -> None:
        if cancelled.is_set():
            return
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

    def worker() -> None:
        try:
            with bind_copilot_progress(observer), deadline_scope(COPILOT_DEADLINE_SECONDS, scope="copilot"):
                observer.progress("context")
                result = operation()
                observer.check_cancelled()
                observer.flush_text()
                observer.progress("validating")
                encoded = jsonable_encoder(result)
                observer.check_cancelled()
                check_deadline()
            publish({"type": "result", "data": encoded})
        except CopilotRequestCancelled:
            pass
        except HTTPException as error:
            publish(_http_error_event(error))
        except DeadlineExceeded:
            publish({"type": "error", "status": 503, "message": "本次请求已达到处理时限，请稍后重试。",
                     "retryable": False, "failure_class": "time_budget_exhausted", "error_type": "deadline"})
        except Exception:
            # Exception reprs may contain prompts/provider bodies; only class-free
            # diagnostics and a fixed public message belong on this transport.
            logger.error("Copilot streaming operation failed; original route did not map the exception.")
            publish({"type": "error", "status": 500, "message": "本次请求未能完成，请稍后重试。", "retryable": False})
        finally:
            finished.set()

    async def stream() -> AsyncIterator[str]:
        threading.Thread(target=lambda: context.run(worker), name="copilot-request", daemon=True).start()
        sequence = 0
        last_sent = time.monotonic()
        try:
            while True:
                # Snapshot before checking queues: completion may race an empty
                # read, but a finished worker has already enqueued its terminal.
                worker_finished = finished.is_set()
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
            cancelled.set()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
    })
