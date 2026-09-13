"""Bounded, content-free provider request accounting for standalone probes."""

from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx


class ProbeLimitExceeded(RuntimeError):
    """The probe must stop before making another provider request."""


_PATCH_LOCK = threading.Lock()
_ACTIVE_METER: ProviderRequestMeter | None = None


def _token_count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _usage(payload: Any) -> dict[str, int | None] | None:
    if not isinstance(payload, dict):
        return None
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        response = payload.get("response")
        return _usage(response) if isinstance(response, dict) else None
    input_tokens = _token_count(usage.get("input_tokens", usage.get("prompt_tokens")))
    output_tokens = _token_count(usage.get("output_tokens", usage.get("completion_tokens")))
    total_tokens = _token_count(usage.get("total_tokens"))
    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens
    if input_tokens is None and output_tokens is None and total_tokens is None:
        return None
    details = usage.get("input_tokens_details", usage.get("prompt_tokens_details", {}))
    output_details = usage.get("output_tokens_details", usage.get("completion_tokens_details", {}))
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "cached_input_tokens": _token_count(details.get("cached_tokens"))
        if isinstance(details, dict) else None,
        "reasoning_output_tokens": _token_count(output_details.get("reasoning_tokens"))
        if isinstance(output_details, dict) else None,
    }


def _response_usage(content: bytes, headers: httpx.Headers) -> dict[str, int | None] | None:
    try:
        # Transport bytes can still be compressed. Decode a separate copy only.
        decoded = httpx.Response(200, headers=headers, content=content).content
        if "text/event-stream" not in headers.get("content-type", ""):
            return _usage(json.loads(decoded))
        last_usage = None
        event_data: list[str] = []
        for line in [*decoded.decode("utf-8").splitlines(), ""]:
            if line.startswith("data:"):
                event_data.append(line[5:].lstrip(" "))
            elif not line and event_data:
                data = "\n".join(event_data)
                event_data.clear()
                if data == "[DONE]":
                    continue
                try:
                    candidate = _usage(json.loads(data))
                except ValueError:
                    continue
                if candidate is not None:
                    last_usage = candidate
        return last_usage
    except (ValueError, UnicodeError, httpx.DecodingError):
        return None


class _MeteredStream(httpx.SyncByteStream):
    def __init__(
        self,
        inner: httpx.SyncByteStream,
        finish: Callable[[str, bytes | None, str | None], None],
        deadline: float,
        max_capture_bytes: int,
        first_byte: Callable[[], None],
    ) -> None:
        self._inner = inner
        self._finish_callback = finish
        self._deadline = deadline
        self._max_capture_bytes = max_capture_bytes
        self._captured: bytearray | None = bytearray()
        self._finished = False
        self._first_byte: Callable[[], None] | None = first_byte

    def _finish(self, outcome: str, error_type: str | None = None) -> None:
        if self._finished:
            return
        self._finished = True
        captured = bytes(self._captured) if self._captured is not None else None
        self._finish_callback(outcome, captured, error_type)
        self._captured = None

    def __iter__(self) -> Iterator[bytes]:
        try:
            for chunk in self._inner:
                if chunk and self._first_byte is not None:
                    self._first_byte()
                    self._first_byte = None
                if time.monotonic() >= self._deadline:
                    raise ProbeLimitExceeded("Probe elapsed-time limit reached while reading response")
                if self._captured is not None:
                    if len(self._captured) + len(chunk) <= self._max_capture_bytes:
                        self._captured.extend(chunk)
                    else:
                        self._captured = None
                yield chunk
        except GeneratorExit:
            # Consumers stop at SSE terminal events before EOF. close() records
            # the outcome after the underlying response has actually closed.
            raise
        except BaseException as error:
            self._finish("error", type(error).__name__)
            raise
        else:
            self._finish("completed")

    def close(self) -> None:
        try:
            self._inner.close()
        except BaseException as error:
            self._finish("error", type(error).__name__)
            raise
        else:
            self._finish("closed")


class ProviderRequestMeter:
    """Meter sync HTTPTransport requests, leaving ASGI/TestClient calls alone.

    Use in a dedicated probe process. Each transport invocation, including
    adapter retries and repairs, consumes a slot before the request is sent.
    The per-operation socket timeout cannot exceed the remaining probe budget.
    """

    def __init__(
        self,
        log_path: str | Path,
        *,
        max_requests: int = 12,
        deadline_seconds: float = 600,
        request_timeout_seconds: float = 120,
        max_capture_bytes: int = 8 * 1024 * 1024,
    ) -> None:
        if max_requests < 0 or deadline_seconds <= 0 or request_timeout_seconds <= 0 or max_capture_bytes <= 0:
            raise ValueError("Request limit must be nonnegative and all other probe limits must be positive")
        self.log_path = Path(log_path)
        self.max_requests = max_requests
        self.deadline_seconds = deadline_seconds
        self.request_timeout_seconds = request_timeout_seconds
        self.max_capture_bytes = max_capture_bytes
        self.run_id = uuid.uuid4().hex
        self._lock = threading.Lock()
        self._records: list[dict[str, Any]] = []
        self._blocked_requests = 0
        self._started = 0.0
        self._deadline = 0.0
        self._original: Callable[..., httpx.Response] | None = None

    def __enter__(self) -> ProviderRequestMeter:
        global _ACTIVE_METER
        with _PATCH_LOCK:
            if _ACTIVE_METER is not None or self._original is not None:
                raise RuntimeError("Provider request meters cannot overlap or be reused")
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            self._started = time.monotonic()
            self._deadline = self._started + self.deadline_seconds
            self._original = httpx.HTTPTransport.handle_request
            original = self._original

            def handle_request(transport: httpx.HTTPTransport, request: httpx.Request) -> httpx.Response:
                return self._handle_request(original, transport, request)

            httpx.HTTPTransport.handle_request = handle_request
            _ACTIVE_METER = self
        return self

    def __exit__(self, *exc: Any) -> None:
        global _ACTIVE_METER
        with _PATCH_LOCK:
            if _ACTIVE_METER is self and self._original is not None:
                httpx.HTTPTransport.handle_request = self._original
                _ACTIVE_METER = None

    def _write(self, event: dict[str, Any]) -> None:
        # Called under the meter lock; no long-lived file handle for hedge threads.
        with self.log_path.open("a", encoding="utf-8") as log:
            log.write(json.dumps({"run_id": self.run_id, **event}, ensure_ascii=True) + "\n")

    def _handle_request(
        self,
        original: Callable[..., httpx.Response],
        transport: httpx.HTTPTransport,
        request: httpx.Request,
    ) -> httpx.Response:
        with self._lock:
            started = time.monotonic()
            remaining = self._deadline - started
            reason = "request_limit" if len(self._records) >= self.max_requests else "deadline" if remaining <= 0 else None
            if reason is not None:
                self._blocked_requests += 1
                self._write({"event": "request_blocked", "reason": reason})
                raise ProbeLimitExceeded(f"Provider probe stopped: {reason}")
            model = None
            parameters: dict[str, Any] = {}
            try:
                payload = json.loads(request.content)
                candidate = payload.get("model") if isinstance(payload, dict) else None
                model = candidate[:128] if isinstance(candidate, str) else None
                if isinstance(payload, dict):
                    reasoning = payload.get("reasoning")
                    effort = reasoning.get("effort") if isinstance(reasoning, dict) else payload.get("reasoning_effort")
                    if isinstance(effort, str) and effort in {"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"}:
                        parameters["reasoning_effort"] = effort
                    for key in ("max_output_tokens", "max_completion_tokens", "max_tokens"):
                        budget = _token_count(payload.get(key))
                        if budget is not None:
                            parameters["output_token_budget"] = budget
                            break
                    parameters["stream"] = payload.get("stream") is True
            except (ValueError, httpx.RequestNotRead):
                pass
            record: dict[str, Any] = {
                "request_id": len(self._records) + 1,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "model": model,
                "status_code": None,
                "outcome": "in_progress",
                "elapsed_seconds": None,
                "usage": None,
                "parameters": parameters,
                "response_headers_seconds": None,
                "first_body_byte_seconds": None,
            }
            self._records.append(record)
            self._write({"event": "request_started", **record})

        timeout_cap = min(remaining, self.request_timeout_seconds)
        existing = request.extensions.get("timeout", {})
        request.extensions["timeout"] = {
            key: min(value, timeout_cap) if isinstance(value, (int, float)) else timeout_cap
            for key in ("connect", "read", "write", "pool")
            for value in [(existing or {}).get(key)]
        }

        def finish(outcome: str, content: bytes | None, error_type: str | None = None) -> None:
            usage = _response_usage(content, response.headers) if content is not None else None
            with self._lock:
                if record["outcome"] != "in_progress":
                    return
                record.update(
                    outcome=outcome,
                    elapsed_seconds=round(time.monotonic() - started, 3),
                    usage=usage,
                )
                if error_type is not None:
                    record["error_type"] = error_type
                self._write({"event": "request_finished", **record})

        try:
            response = original(transport, request)
        except BaseException as error:
            finish("error", None, type(error).__name__)
            raise
        with self._lock:
            record["status_code"] = response.status_code
            record["response_headers_seconds"] = round(time.monotonic() - started, 3)
            self._write({"event": "response_headers_received", **record})

        def first_byte() -> None:
            with self._lock:
                record["first_body_byte_seconds"] = round(time.monotonic() - started, 3)
                self._write({"event": "response_body_started", **record})

        response.stream = _MeteredStream(response.stream, finish, self._deadline, self.max_capture_bytes, first_byte)
        return response

    def summary(self) -> dict[str, Any]:
        with self._lock:
            finished = [record for record in self._records if record["outcome"] != "in_progress"]
            known = [record["usage"] for record in finished if record["usage"] is not None]
            return {
                "run_id": self.run_id,
                "physical_requests": len(self._records),
                "completed_requests": len(finished),
                "in_progress_requests": len(self._records) - len(finished),
                "blocked_requests": self._blocked_requests,
                "requests_missing_usage": sum(record["usage"] is None for record in finished),
                "known_tokens": {
                    key: sum(usage[key] for usage in known if usage[key] is not None)
                    if any(usage[key] is not None for usage in known) else None
                    for key in ("input_tokens", "output_tokens", "total_tokens", "cached_input_tokens", "reasoning_output_tokens")
                },
                "requests": [dict(record) for record in self._records],
            }
