"""Cumulative deadlines for synchronous HTTP/1.1 model requests.

Each network operation uses the current request context, including connections
reused from a pool. No watchdog or background request thread is created. Backend
internal work, notably DNS resolution and multiple-address connection attempts,
cannot be forcibly interrupted; its deadline is checked as soon as it returns.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import math
import ssl
import time
from typing import Any, Callable, Iterator, TypeVar

import httpcore
import httpx


class DeadlineExceeded(TimeoutError):
    """The cumulative budget for the named operation has expired."""

    def __init__(self, scope: str) -> None:
        self.scope = scope
        super().__init__(f"LLM cumulative deadline exceeded (scope={scope}).")


LLMDeadlineExceeded = DeadlineExceeded


@dataclass(frozen=True)
class _Deadline:
    expires_at: float
    scope: str


_ACTIVE_DEADLINE: ContextVar[_Deadline | None] = ContextVar(
    "llm_active_deadline", default=None
)
_Result = TypeVar("_Result")


def remaining_deadline_seconds() -> float | None:
    deadline = _ACTIVE_DEADLINE.get()
    if deadline is None:
        return None
    remaining = deadline.expires_at - time.monotonic()
    if remaining <= 0:
        raise DeadlineExceeded(deadline.scope)
    return remaining


def check_deadline() -> None:
    remaining_deadline_seconds()


@contextmanager
def deadline_scope(seconds: float, *, scope: str) -> Iterator[None]:
    """Bind a budget, retaining an earlier parent's deadline and scope."""

    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("Deadline seconds must be finite and positive.")
    parent = _ACTIVE_DEADLINE.get()
    deadline = _Deadline(time.monotonic() + seconds, scope)
    if parent is not None and parent.expires_at <= deadline.expires_at:
        deadline = parent
    token = _ACTIVE_DEADLINE.set(deadline)
    try:
        check_deadline()
        yield
        check_deadline()
    except Exception:
        check_deadline()
        raise
    finally:
        _ACTIVE_DEADLINE.reset(token)


def _bounded_timeout(timeout: float | None) -> float | None:
    remaining = remaining_deadline_seconds()
    if remaining is None:
        return timeout
    return remaining if timeout is None else min(timeout, remaining)


def cap_timeout(timeout: float | None) -> float | None:
    """Clamp an HTTPX operation timeout to the current cumulative budget."""

    return _bounded_timeout(timeout)


def _checked_call(
    operation: Callable[..., _Result], *, close_on_deadline: bool = False, **kwargs: Any
) -> _Result:
    deadline = _ACTIVE_DEADLINE.get()
    remaining = remaining_deadline_seconds()
    deadline_limited = False
    if "timeout" in kwargs and remaining is not None:
        timeout = kwargs["timeout"]
        deadline_limited = timeout is None or remaining <= timeout
        if deadline_limited:
            kwargs["timeout"] = remaining
    try:
        result = operation(**kwargs)
    except Exception as exc:
        # Socket timers can expire just before the monotonic clock reaches the
        # deadline. Classify the timeout by the budget that actually limited it.
        if isinstance(exc, httpcore.TimeoutException) and deadline_limited:
            raise DeadlineExceeded(deadline.scope) from exc
        check_deadline()
        raise
    try:
        check_deadline()
    except DeadlineExceeded:
        if close_on_deadline:
            result.close()
        raise
    return result


def _checked_stream_call(
    operation: Callable[..., httpcore.NetworkStream], **kwargs: Any
) -> _DeadlineStream:
    return _DeadlineStream(_checked_call(operation, close_on_deadline=True, **kwargs))


class _DeadlineStream(httpcore.NetworkStream):
    def __init__(self, stream: httpcore.NetworkStream) -> None:
        self._stream = stream

    def read(self, max_bytes: int, timeout: float | None = None) -> bytes:
        return _checked_call(
            self._stream.read,
            max_bytes=max_bytes,
            timeout=timeout,
        )

    def write(self, buffer: bytes, timeout: float | None = None) -> None:
        _checked_call(
            self._stream.write,
            buffer=buffer,
            timeout=timeout,
        )

    def start_tls(
        self,
        ssl_context: ssl.SSLContext,
        server_hostname: str | None = None,
        timeout: float | None = None,
    ) -> httpcore.NetworkStream:
        return _checked_stream_call(
            self._stream.start_tls,
            ssl_context=ssl_context,
            server_hostname=server_hostname,
            timeout=timeout,
        )

    def close(self) -> None:
        self._stream.close()

    def get_extra_info(self, info: str) -> Any:
        return self._stream.get_extra_info(info)


class _DeadlineBackend(httpcore.NetworkBackend):
    def __init__(self, backend: httpcore.NetworkBackend) -> None:
        self._backend = backend

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Any = None,
    ) -> httpcore.NetworkStream:
        return _checked_stream_call(
            self._backend.connect_tcp,
            host=host,
            port=port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: Any = None,
    ) -> httpcore.NetworkStream:
        return _checked_stream_call(
            self._backend.connect_unix_socket,
            path=path,
            timeout=timeout,
            socket_options=socket_options,
        )

    def sleep(self, seconds: float) -> None:
        _checked_call(self._backend.sleep, seconds=_bounded_timeout(seconds))


def install_deadline_backends(client: httpx.Client) -> None:
    """Install on a new client's HTTP transports, including proxy mounts.

    HTTPX does not expose network backend injection. These guarded pool fields
    are tested against HTTPX 0.28.1 and HTTPCore 1.0.9. Custom transports such as
    MockTransport are retained; their internal I/O cannot be bounded here.
    HTTP/2 is rejected because multiplexed reads do not belong to one request.
    """

    transport = getattr(client, "_transport", None)
    mounts = getattr(client, "_mounts", None)
    if transport is None or not isinstance(mounts, dict):
        raise RuntimeError("Unsupported HTTPX client transport layout.")
    transports = {id(item): item for item in (transport, *mounts.values())}
    pending: list[tuple[Any, httpcore.NetworkBackend]] = []
    for item in transports.values():
        if not isinstance(item, httpx.HTTPTransport):
            continue
        pool = getattr(item, "_pool", None)
        backend = getattr(pool, "_network_backend", None)
        if not isinstance(backend, httpcore.NetworkBackend):
            raise RuntimeError("Unsupported HTTPCore network backend layout.")
        if isinstance(backend, _DeadlineBackend):
            continue
        if getattr(pool, "_http2", None) is not False:
            raise RuntimeError("LLM cumulative deadlines require HTTP/1.1.")
        if getattr(pool, "_connections", None) != []:
            raise RuntimeError("Install LLM deadlines before opening connections.")
        pending.append((pool, backend))
    for pool, backend in pending:
        pool._network_backend = _DeadlineBackend(backend)
