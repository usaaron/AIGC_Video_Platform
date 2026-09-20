"""Close only the exact episode run while its original request is authorized."""
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Event, RLock

from app.modules.script_engine.llm_cancellation import (
    LLMRequestCancelledError, bind_llm_cancellation,
)

_lifecycle: ContextVar["EpisodeStreamLifecycle | None"] = ContextVar("episode_stream_lifecycle", default=None)


class EpisodeStreamLifecycle:
    def __init__(self):
        self.cancel = Event()
        self.done = Event()
        self._lock = RLock()
        self._owned = None
        self.wake = lambda: None

    @contextmanager
    def bind(self):
        token = _lifecycle.set(self)
        try:
            with bind_llm_cancellation(self.cancel):
                yield
        finally:
            _lifecycle.reset(token)

    def start(self, store, operation):
        # Disconnect cannot pass between creating the run and registering the
        # exact owner. A disconnected request cannot subsequently create a run.
        with self._lock:
            if self.cancel.is_set():
                raise LLMRequestCancelledError()
            started = operation()
            if started.session is not None:
                self._owned = (store, started.record.model_copy(deep=True))
            return started

    def close(self):
        self.cancel.set()
        self.wake()
        # Give cooperative model cancellation time to record its normal error.
        # An unresponsive socket must not retain the request's storage identity.
        self.done.wait(0.25)
        with self._lock:
            if self._owned is not None:
                store, record = self._owned
                store.cancel_stream_run(record)


def start_stream_session(store, operation):
    lifecycle = _lifecycle.get()
    return lifecycle.start(store, operation) if lifecycle is not None else operation()
