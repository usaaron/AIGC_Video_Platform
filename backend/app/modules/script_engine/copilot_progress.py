"""Bounded request feedback from explicit provider-supported display fields."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import threading
import time
from typing import Any, Callable, Iterator, Literal

from app.modules.script_engine.copilot_language import (
    chinese_progress_text,
    has_non_chinese_letters,
    is_structured_progress_fragment,
    split_progress_text,
)

Stage = Literal["context", "requesting", "thinking", "writing", "validating"]
MESSAGES: dict[Stage, str] = {
    "context": "正在核对当前内容和修改要求…",
    "requesting": "已向模型发送请求，等待响应…",
    "thinking": "模型正在处理请求…",
    "writing": "正在接收模型生成的内容…",
    "validating": "正在校验生成结果…",
}
MAX_SUMMARY_CHARACTERS = 8_000
MAX_THINKING_CHARACTERS = 8_000
TextEvent = Literal["reasoning_summary", "model_thinking"]
LANGUAGE_NOTICE = "模型返回了非中文过程，已略过该部分。"
INCOMPLETE_NOTICE = "模型过程片段未完整接收，已略过该部分。"
MAX_SENTENCE_CONTEXT_CHARACTERS = 128


class CopilotRequestCancelled(Exception):
    """The browser has disconnected; stop before further model work."""


class CopilotProgress:
    def __init__(self, emit: Callable[[dict[str, Any]], None], cancel: threading.Event):
        self._emit = emit
        self.cancel = cancel
        self._lock = threading.RLock()
        self._stage: Stage | None = None
        self._stage_message: str | None = None
        self._characters: dict[TextEvent, int] = {"reasoning_summary": 0, "model_thinking": 0}
        self._pending: dict[TextEvent, str] = {"reasoning_summary": "", "model_thinking": ""}
        self._last_flush = dict.fromkeys(self._pending, time.monotonic())
        self._separate: dict[TextEvent, bool] = {"reasoning_summary": False, "model_thinking": False}
        self._displayed: dict[TextEvent, bool] = dict.fromkeys(self._pending, False)
        self._display_characters: dict[TextEvent, int] = dict.fromkeys(self._pending, 0)
        self._trailing_newlines: dict[TextEvent, int] = dict.fromkeys(self._pending, 0)
        self._sentence_context: dict[TextEvent, str] = dict.fromkeys(self._pending, "")
        self._notices_sent: set[str] = set()
        self._unsupported_summary_routes: set[int] = set()

    def allows_summary_for(self, route: object) -> bool:
        with self._lock:
            return id(route) not in self._unsupported_summary_routes

    def reject_summary_for(self, route: object) -> None:
        with self._lock:
            self._unsupported_summary_routes.add(id(route))

    def check_cancelled(self) -> None:
        if self.cancel.is_set():
            raise CopilotRequestCancelled()

    def _publish(self, event: dict[str, Any]) -> None:
        self.check_cancelled()
        self._emit(event)

    def progress(self, stage: Stage, message: str | None = None) -> None:
        self.check_cancelled()
        with self._lock:
            message = message or MESSAGES.get(stage)
            if stage not in MESSAGES or (stage == self._stage and message == self._stage_message):
                return
            if stage in {"writing", "validating"} and stage != self._stage:
                # The provider has moved from reasoning to answer output. Its
                # final Chinese phrase may have no sentence terminator; finish
                # that display buffer before publishing the next stage. This
                # also lets cancellation stop before answer/validation work.
                self.flush_text()
            self._stage = stage
            self._stage_message = message
            self._publish({"type": "progress", "stage": stage, "message": message})

    def request_started(self) -> None:
        with self._lock:
            for event_type in self._pending:
                self._flush_text(event_type, discard_incomplete=True)
                self._separate[event_type] = self._displayed[event_type]
            self.progress("requesting")

    def summary_delta(self, delta: str) -> None:
        self._text_delta("reasoning_summary", delta, MAX_SUMMARY_CHARACTERS)

    def thinking_delta(self, delta: str) -> None:
        self._text_delta("model_thinking", delta, MAX_THINKING_CHARACTERS)

    def _text_delta(self, event_type: TextEvent, delta: str, limit: int) -> None:
        self.check_cancelled()
        if not isinstance(delta, str) or not delta:
            return
        with self._lock:
            remaining = limit - self._characters[event_type]
            if remaining <= 0:
                return
            delta = delta[:remaining]
            self._characters[event_type] += len(delta)
            self._pending[event_type] += delta
            if self._characters[event_type] >= limit:
                # A byte/character boundary cannot establish that a Latin word
                # is complete. Never reinterpret its prefix as a personal name.
                self._flush_text(event_type, discard_incomplete=True)
            elif len(self._pending[event_type]) >= 64 or time.monotonic() - self._last_flush[event_type] >= 0.1:
                self._flush_text(event_type, final=False)

    def flush_summary(self) -> None:
        self._flush_text("reasoning_summary")

    def flush_text(self) -> None:
        for event_type in self._pending:
            self._flush_text(event_type)

    def flush_interrupted_text(self) -> None:
        """Keep complete display text without accepting an unfinished foreign word."""
        for event_type in self._pending:
            self._flush_text(event_type, discard_incomplete=True)

    def _notice(self, message: str) -> None:
        if message not in self._notices_sent:
            self._notices_sent.add(message)
            self._publish({"type": "progress", "stage": self._stage or "thinking", "message": message})

    def _flush_text(self, event_type: TextEvent, *, final: bool = True, discard_incomplete: bool = False) -> None:
        with self._lock:
            self.check_cancelled()
            pieces, self._pending[event_type] = split_progress_text(
                self._pending[event_type], final=final and not discard_incomplete,
            )
            # A retry/limit may retain a Chinese-only final phrase, but a tail
            # containing another script could end halfway through a word. Do
            # not reinterpret that prefix as an allowed name or emit its
            # Chinese introduction without the rejected continuation.
            if discard_incomplete and self._pending[event_type] and not has_non_chinese_letters(self._pending[event_type]):
                pieces.append((self._pending[event_type], False))
                self._pending[event_type] = ""
            accepted = ""
            for piece, sentence_ended in pieces:
                context = self._sentence_context[event_type]
                if is_structured_progress_fragment(piece):
                    self._separate[event_type] = self._displayed[event_type] or bool(accepted.strip())
                    self._sentence_context[event_type] = ""
                    continue
                if not chinese_progress_text(context + piece):
                    # Keep omissions out of provider text: a factual Chinese
                    # progress notice is not a fabricated model explanation.
                    self._separate[event_type] = self._displayed[event_type] or bool(accepted.strip())
                    self._sentence_context[event_type] = ""
                    self._notice(LANGUAGE_NOTICE)
                    continue
                self._sentence_context[event_type] = (
                    "" if sentence_ended else (context + piece)[-MAX_SENTENCE_CONTEXT_CHARACTERS:]
                )
                if not piece.strip() and (
                    self._separate[event_type]
                    or not (self._displayed[event_type] or accepted.strip())
                ):
                    continue
                piece = piece.replace("\r\n", "\n").replace("\r", "\n")
                trailing = len(accepted) - len(accepted.rstrip("\n"))
                if not accepted.strip("\n"):
                    trailing += self._trailing_newlines[event_type]
                if self._separate[event_type] and piece.strip():
                    piece = "\n" * max(0, 2 - trailing) + piece.lstrip("\n")
                    self._separate[event_type] = False
                else:
                    # Do not accumulate a large blank area when omitted
                    # sentences had their own paragraph separators.
                    leading = len(piece) - len(piece.lstrip("\n"))
                    if leading:
                        piece = "\n" * min(leading, max(0, 2 - trailing)) + piece[leading:]
                accepted += piece
            if discard_incomplete and self._pending[event_type]:
                self._pending[event_type] = ""
                self._separate[event_type] = self._displayed[event_type] or bool(accepted.strip())
                self._notice(INCOMPLETE_NOTICE)
            if final or discard_incomplete:
                self._sentence_context[event_type] = ""
            limit = MAX_THINKING_CHARACTERS if event_type == "model_thinking" else MAX_SUMMARY_CHARACTERS
            accepted = accepted[:max(0, limit - self._display_characters[event_type])]
            for offset in range(0, len(accepted), 512):
                chunk = accepted[offset:offset + 512]
                self._publish({"type": event_type, "delta": chunk})
                self._displayed[event_type] = True
                self._display_characters[event_type] += len(chunk)
                self._trailing_newlines[event_type] = (
                    min(2, self._trailing_newlines[event_type] + len(chunk))
                    if not chunk.strip("\n") else len(chunk) - len(chunk.rstrip("\n"))
                )
            self._last_flush[event_type] = time.monotonic()


_OBSERVER: ContextVar[CopilotProgress | None] = ContextVar("copilot_progress", default=None)
_SUMMARIES_ALLOWED: ContextVar[bool] = ContextVar("copilot_summaries_allowed", default=True)
_STREAM_REDIRECT: ContextVar[bool] = ContextVar("copilot_stream_redirect", default=False)


def current_copilot_progress() -> CopilotProgress | None:
    return _OBSERVER.get()


def copilot_summaries_allowed() -> bool:
    return _OBSERVER.get() is not None and _SUMMARIES_ALLOWED.get()


def check_copilot_cancelled() -> None:
    observer = _OBSERVER.get()
    if observer is not None:
        observer.check_cancelled()


def copilot_stage(stage: Stage, message: str | None = None) -> None:
    observer = _OBSERVER.get()
    if observer is not None:
        observer.progress(stage, message)


def copilot_request_started() -> None:
    observer = _OBSERVER.get()
    if observer is not None:
        observer.request_started()


def copilot_summary_event(event: dict[str, Any]) -> None:
    # Do not broaden this allowlist to reasoning_text, reasoning_content, generic
    # reasoning fields, output_text, or completed response objects.
    if copilot_summaries_allowed() and event.get("type") == "response.reasoning_summary_text.delta":
        observer = _OBSERVER.get()
        if observer is not None:
            observer.summary_delta(event.get("delta"))


def copilot_deepseek_thinking_event(event: dict[str, Any]) -> None:
    # Only the adapter's identified DeepSeek Chat Completions route calls this.
    # Do not accept generic reasoning, Responses reasoning_text, or message bodies.
    if not copilot_summaries_allowed():
        return
    choices = event.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return
    delta = choices[0].get("delta")
    if not isinstance(delta, dict):
        return
    observer = _OBSERVER.get()
    if observer is not None:
        observer.thinking_delta(delta.get("reasoning_content"))


def copilot_validation_started() -> None:
    observer = _OBSERVER.get()
    if observer is not None:
        observer.flush_text()
        observer.progress("validating")


def should_stream_copilot_request() -> bool:
    return _OBSERVER.get() is not None and not _STREAM_REDIRECT.get()


@contextmanager
def bind_copilot_progress(observer: CopilotProgress) -> Iterator[None]:
    token = _OBSERVER.set(observer)
    try:
        yield
    finally:
        _OBSERVER.reset(token)


@contextmanager
def copilot_stream_redirect() -> Iterator[None]:
    token = _STREAM_REDIRECT.set(True)
    try:
        yield
    finally:
        _STREAM_REDIRECT.reset(token)


@contextmanager
def suppress_copilot_summaries() -> Iterator[None]:
    # Hedged routes run concurrently. Neither summaries nor model thinking can
    # be assigned to the final winner; expose factual stages only for this subtree.
    token = _SUMMARIES_ALLOWED.set(False)
    try:
        yield
    finally:
        _SUMMARIES_ALLOWED.reset(token)
