"""Content-free activity counters for long model responses."""

from __future__ import annotations

import time
from typing import Any, Callable, Iterator

import httpx

from app.modules.script_engine.llm_deadline import check_deadline


class LLMStreamProgress:
    def __init__(self, started: float, emit: Callable[[dict[str, Any]], None]) -> None:
        self._started = started
        self._emit = emit
        self._last_logged = started
        self._finished = False
        self._state: dict[str, Any] = {
            "status_code": None, "body_bytes": 0, "events": 0, "comment_lines": 0,
            "content_chars": 0, "reasoning_chars": 0,
            "headers_seconds": None, "first_byte_seconds": None,
            "first_text_seconds": None, "first_reasoning_seconds": None,
            "last_byte_seconds": None, "last_text_seconds": None,
        }

    def _seconds(self) -> float:
        return round(time.monotonic() - self._started, 3)

    def _report(self, reason: str) -> None:
        self._last_logged = time.monotonic()
        self._emit({**self._state, "reason": reason, "elapsed_seconds": self._seconds()})

    def headers(self, status_code: int) -> None:
        self._state.update(status_code=status_code, headers_seconds=self._seconds())
        self._report("headers")

    def body(self, byte_count: int) -> None:
        if not byte_count:
            return
        now = self._seconds()
        first = self._state["first_byte_seconds"] is None
        self._state["body_bytes"] += byte_count
        self._state["last_byte_seconds"] = now
        if first:
            self._state["first_byte_seconds"] = now
            self._report("first_byte")
        elif time.monotonic() - self._last_logged >= 30:
            self._report("activity")

    def comment(self) -> None:
        self._state["comment_lines"] += 1
        if self._state["comment_lines"] == 1:
            self._report("first_comment")

    def event(self, *, text_chars: int, reasoning_chars: int) -> None:
        self._state["events"] += 1
        self._state["content_chars"] += text_chars
        self._state["reasoning_chars"] += reasoning_chars
        first_text = text_chars > 0 and self._state["first_text_seconds"] is None
        first_reasoning = reasoning_chars > 0 and self._state["first_reasoning_seconds"] is None
        if text_chars:
            self._state["last_text_seconds"] = self._seconds()
        if first_text:
            self._state["first_text_seconds"] = self._seconds()
            self._report("first_text")
        if first_reasoning:
            self._state["first_reasoning_seconds"] = self._seconds()
            self._report("first_reasoning")

    def finish(self) -> None:
        if not self._finished:
            self._finished = True
            self._report("response_closed")

    def wrap(self, inner: httpx.SyncByteStream) -> httpx.SyncByteStream:
        progress = self

        class ObservedStream(httpx.SyncByteStream):
            def __iter__(self) -> Iterator[bytes]:
                for chunk in inner:
                    check_deadline()
                    progress.body(len(chunk))
                    yield chunk

            def close(self) -> None:
                try:
                    inner.close()
                finally:
                    progress.finish()

        return ObservedStream()
