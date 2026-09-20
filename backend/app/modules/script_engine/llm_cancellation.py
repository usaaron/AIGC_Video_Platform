"""Cancellation shared by all model calls inside one streaming generation."""
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Event


class LLMRequestCancelledError(Exception):
    """Stop a model request when its streaming client disconnects."""


_request_cancel: ContextVar[Event | None] = ContextVar("llm_request_cancel", default=None)


@contextmanager
def bind_llm_cancellation(event: Event):
    token = _request_cancel.set(event)
    try:
        check_llm_cancelled()
        yield
    finally:
        _request_cancel.reset(token)


def check_llm_cancelled() -> None:
    event = _request_cancel.get()
    if event is not None and event.is_set():
        raise LLMRequestCancelledError()
