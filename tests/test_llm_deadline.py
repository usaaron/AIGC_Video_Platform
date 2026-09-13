from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import socketserver
import ssl
import threading
import time
from typing import Iterator

import httpcore
import httpx
import pytest

from app.modules.script_engine import llm_deadline
from app.modules.script_engine.llm_deadline import (
    DeadlineExceeded,
    check_deadline,
    deadline_scope,
    install_deadline_backends,
    remaining_deadline_seconds,
)


def test_nested_deadlines_keep_earlier_scope_and_reset_after_failure(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(llm_deadline.time, "monotonic", lambda: clock[0])
    with pytest.raises(DeadlineExceeded, match="initial_draft") as error:
        with deadline_scope(5, scope="initial_draft"):
            with deadline_scope(20, scope="request"):
                assert remaining_deadline_seconds() == 5
                clock[0] = 105
                check_deadline()
    assert error.value.scope == "initial_draft"
    assert remaining_deadline_seconds() is None
    with deadline_scope(20, scope="initial_draft"):
        with pytest.raises(DeadlineExceeded) as shorter:
            with deadline_scope(2, scope="request"):
                clock[0] += 2
        assert shorter.value.scope == "request"
        assert remaining_deadline_seconds() == 18


@pytest.mark.parametrize("seconds", [0, -1, float("nan"), float("inf")])
def test_deadline_rejects_invalid_duration(seconds):
    with pytest.raises(ValueError):
        with deadline_scope(seconds, scope="request"):
            pass
    assert remaining_deadline_seconds() is None


@pytest.mark.parametrize("body_error", [None, ValueError("provider error")])
def test_deadline_checks_return_and_exception_paths(monkeypatch, body_error):
    clock = [100.0]
    monkeypatch.setattr(llm_deadline.time, "monotonic", lambda: clock[0])
    with pytest.raises(DeadlineExceeded):
        with deadline_scope(5, scope="request"):
            clock[0] += 6
            if body_error is not None:
                raise body_error
    assert remaining_deadline_seconds() is None


class _FakeStream(httpcore.NetworkStream):
    def __init__(self):
        self.timeouts = []
        self.closed = 0
        self.on_read = lambda: b"data"
        self.on_tls = lambda: self

    def read(self, max_bytes, timeout=None):
        self.timeouts.append(("read", timeout))
        return self.on_read()

    def write(self, buffer, timeout=None):
        self.timeouts.append(("write", timeout))

    def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        self.timeouts.append(("tls", timeout))
        return self.on_tls()

    def close(self):
        self.closed += 1

    def get_extra_info(self, info):
        return "info:" + info


class _FakeBackend(httpcore.NetworkBackend):
    def __init__(self, stream):
        self.stream = stream
        self.timeouts = []
        self.on_connect = lambda: stream

    def connect_tcp(self, host, port, timeout=None, **kwargs):
        self.timeouts.append(("tcp", timeout))
        return self.on_connect()

    def connect_unix_socket(self, path, timeout=None, **kwargs):
        self.timeouts.append(("unix", timeout))
        return self.on_connect()

    def sleep(self, seconds):
        self.timeouts.append(("sleep", seconds))


def test_backend_clamps_each_operation_and_reuses_current_request_context(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(llm_deadline.time, "monotonic", lambda: clock[0])
    inner = _FakeStream()
    original = _FakeBackend(inner)
    backend = llm_deadline._DeadlineBackend(original)
    with deadline_scope(10, scope="first_request"):
        stream = backend.connect_tcp("localhost", 80, timeout=60)
        clock[0] += 3
        assert stream.read(10, timeout=60) == b"data"
        stream.write(b"request", timeout=2)
        stream = stream.start_tls(ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT), timeout=60)
        backend.connect_unix_socket("test.socket", timeout=None)
        backend.sleep(20)
    clock[0] = 200
    with deadline_scope(20, scope="second_request"):
        assert stream.read(10, timeout=None) == b"data"
    assert original.timeouts == [("tcp", 10), ("unix", 7), ("sleep", 7)]
    assert inner.timeouts == [("read", 7), ("write", 2), ("tls", 7), ("read", 20)]
    assert stream.get_extra_info("socket") == "info:socket"
    stream.close()
    assert inner.closed == 1


@pytest.mark.parametrize("operation", ["read", "connect", "tls"])
@pytest.mark.parametrize("fails", [False, True])
def test_backend_checks_deadline_after_blocking_return_or_exception(
    monkeypatch, operation, fails
):
    clock = [100.0]
    monkeypatch.setattr(llm_deadline.time, "monotonic", lambda: clock[0])
    inner = _FakeStream()
    backend = _FakeBackend(inner)

    def blocked():
        clock[0] += 6
        if fails:
            raise httpcore.ReadTimeout("socket timeout")
        return b"data" if operation == "read" else inner

    with pytest.raises(DeadlineExceeded):
        with deadline_scope(5, scope="request"):
            if operation == "read":
                inner.on_read = blocked
                llm_deadline._DeadlineStream(inner).read(10)
            elif operation == "connect":
                backend.on_connect = blocked
                llm_deadline._DeadlineBackend(backend).connect_tcp("localhost", 80)
            else:
                inner.on_tls = blocked
                llm_deadline._DeadlineStream(inner).start_tls(
                    ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                )
    assert inner.closed == (1 if operation in {"connect", "tls"} and not fails else 0)


def test_install_wraps_default_and_proxy_mounts_once_without_replacing_pools():
    proxy = httpx.HTTPTransport(proxy="http://127.0.0.1:8888", trust_env=False)
    mock = httpx.MockTransport(lambda request: httpx.Response(200))
    with httpx.Client(
        trust_env=False,
        mounts={"https://proxy.test": proxy, "https://mock.test": mock},
    ) as client:
        pools = [client._transport._pool, proxy._pool]
        originals = [pool._network_backend for pool in pools]
        install_deadline_backends(client)
        installed = [pool._network_backend for pool in pools]
        assert all(isinstance(backend, llm_deadline._DeadlineBackend) for backend in installed)
        assert [backend._backend for backend in installed] == originals
        install_deadline_backends(client)
        assert [pool._network_backend for pool in pools] == installed
        assert client.get("https://mock.test").status_code == 200


@pytest.mark.parametrize("field,value", [("_network_backend", None), ("_connections", [object()]), ("_http2", True)])
def test_install_rejects_unsupported_or_already_active_pools(field, value):
    with httpx.Client(trust_env=False) as client:
        pool = client._transport._pool
        original = getattr(pool, field)
        setattr(pool, field, value)
        try:
            with pytest.raises(RuntimeError):
                install_deadline_backends(client)
        finally:
            setattr(pool, field, original)


@contextmanager
def _local_server() -> Iterator[tuple[str, dict]]:
    stopped = threading.Event()
    observed = {"connections": 0, "chunks": 0, "workers": []}

    class Handler(socketserver.BaseRequestHandler):
        def handle(self):
            observed["connections"] += 1
            observed["workers"].append(threading.current_thread())
            self.request.settimeout(1)
            try:
                while not stopped.is_set():
                    request = b""
                    while b"\r\n\r\n" not in request:
                        data = self.request.recv(4096)
                        if not data:
                            return
                        request += data
                    path = request.split(b" ")[1]
                    if path in {b"/ok", b"/delayed"}:
                        if path == b"/delayed" and stopped.wait(0.18):
                            return
                        self.request.sendall(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}"
                        )
                        continue
                    if path == b"/headers":
                        self.request.sendall(b"HTTP/1.1 200 OK\r\nX-progress: ")
                        fragment = b"x"
                    else:
                        self.request.sendall(
                            b"HTTP/1.1 200 OK\r\nConnection: close\r\n"
                            b"Content-Type: text/event-stream\r\n\r\n"
                        )
                        fragment = b": heartbeat\n\n" if path == b"/heartbeat" else b"x"
                    while not stopped.wait(0.01):
                        self.request.sendall(fragment)
                        observed["chunks"] += 1
                    return
            except OSError:
                return

    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler) as server:
        thread = threading.Thread(
            target=lambda: server.serve_forever(poll_interval=0.01),
            name="deadline-test-server",
        )
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_address[1]}", observed
        finally:
            stopped.set()
            server.shutdown()
            thread.join(timeout=2)
            assert not thread.is_alive()
    assert all(not worker.is_alive() for worker in observed["workers"])


@pytest.mark.parametrize("path", ["headers", "body", "heartbeat"])
def test_local_continuous_network_activity_cannot_extend_deadline(path):
    with _local_server() as (base_url, observed):
        with httpx.Client(timeout=2, trust_env=False) as client:
            install_deadline_backends(client)
            started = time.monotonic()
            with pytest.raises(DeadlineExceeded) as error:
                with deadline_scope(0.15, scope="physical_request"):
                    with client.stream("GET", f"{base_url}/{path}") as response:
                        for _line in response.iter_lines():
                            pass
            elapsed = time.monotonic() - started
            assert error.value.scope == "physical_request"
            assert 0.1 <= elapsed < 1.5
            assert observed["chunks"] >= 2
            assert client.get(f"{base_url}/ok").json() == {}


def test_keepalive_connection_uses_new_deadline_after_original_budget_expires():
    with _local_server() as (base_url, observed):
        with httpx.Client(timeout=2, trust_env=False) as client:
            install_deadline_backends(client)
            with deadline_scope(0.1, scope="first"):
                assert client.get(f"{base_url}/ok").json() == {}
            with deadline_scope(1, scope="second"):
                assert client.get(f"{base_url}/delayed").json() == {}
            assert observed["connections"] == 1


def test_shared_client_concurrent_requests_have_independent_contexts():
    with _local_server() as (base_url, observed):
        with httpx.Client(timeout=2, trust_env=False) as client:
            install_deadline_backends(client)
            barrier = threading.Barrier(2)

            def request(scope, seconds):
                assert remaining_deadline_seconds() is None
                try:
                    with deadline_scope(seconds, scope=scope):
                        barrier.wait(timeout=2)
                        client.get(f"{base_url}/delayed")
                except DeadlineExceeded as error:
                    return error.scope
                finally:
                    assert remaining_deadline_seconds() is None
                return "success"

            with ThreadPoolExecutor(max_workers=2) as executor:
                short = executor.submit(request, "short", 0.08)
                long = executor.submit(request, "long", 1)
                assert short.result(timeout=2) == "short"
                assert long.result(timeout=2) == "success"
            assert observed["connections"] == 2
