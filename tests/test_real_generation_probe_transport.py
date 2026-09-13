import gzip
import json
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from app.modules.script_engine.llm_adapter import RealLLMAdapter
from scripts.real_generation_probe_transport import ProbeLimitExceeded, ProviderRequestMeter


def install_response(monkeypatch, content, *, content_type="application/json", headers=None, observed=None):
    def handle_request(transport, request):
        if observed is not None:
            observed.append(request)
        return httpx.Response(
            200,
            headers={"content-type": content_type, **(headers or {})},
            stream=httpx.ByteStream(content),
        )

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", handle_request)
    return handle_request


def test_json_usage_timeout_cap_and_sensitive_content_not_logged(monkeypatch, tmp_path):
    observed = []
    original = install_response(monkeypatch, json.dumps({
        "choices": [{"message": {"content": "PRIVATE_RESPONSE"}}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19,
                  "prompt_tokens_details": {"cached_tokens": 5},
                  "completion_tokens_details": {"reasoning_tokens": 3}},
    }).encode(), observed=observed)
    log_path = tmp_path / "requests.jsonl"
    with ProviderRequestMeter(log_path, request_timeout_seconds=10) as meter:
        with httpx.Client(timeout=httpx.Timeout(300, connect=2)) as client:
            response = client.post("https://private-host.test/PRIVATE_URL", headers={"Authorization": "PRIVATE_KEY"},
                                   json={"model": "test-model", "reasoning_effort": "medium", "max_tokens": 32000,
                                         "messages": [{"content": "PRIVATE_PROMPT"}]})
            assert response.json()["choices"][0]["message"]["content"] == "PRIVATE_RESPONSE"
    assert httpx.HTTPTransport.handle_request is original
    assert observed[0].extensions["timeout"] == {"connect": 2, "read": 10, "write": 10, "pool": 10}
    summary = meter.summary()
    assert summary["known_tokens"] == {"input_tokens": 12, "output_tokens": 7, "total_tokens": 19,
                                      "cached_input_tokens": 5, "reasoning_output_tokens": 3}
    assert summary["physical_requests"] == summary["completed_requests"] == 1
    assert summary["requests_missing_usage"] == 0
    assert "PRIVATE" not in log_path.read_text()
    events = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert [event["event"] for event in events] == [
        "request_started", "response_headers_received", "response_body_started", "request_finished",
    ]
    assert events[-1]["model"] == "test-model"
    assert events[-1]["status_code"] == 200
    assert events[-1]["parameters"] == {"reasoning_effort": "medium", "output_token_budget": 32000, "stream": False}
    assert 0 <= events[-1]["response_headers_seconds"] <= events[-1]["first_body_byte_seconds"] <= events[-1]["elapsed_seconds"]


@pytest.mark.parametrize("usage_event", [
    {"usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}},
    {"type": "response.completed", "response": {"usage": {"input_tokens": 10, "output_tokens": 4,
                                                            "output_tokens_details": {"reasoning_tokens": 2}}}},
])
def test_sse_streaming_preserved_and_final_usage_recorded(monkeypatch, tmp_path, usage_event):
    parts = [b'data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n',
             ("data: " + json.dumps(usage_event) + "\r\n\r\n").encode(), b"data: [DONE]\r\n\r\n"]
    yielded = []

    class ChunkedStream(httpx.SyncByteStream):
        def __iter__(self):
            for part in parts:
                yielded.append(part)
                yield part

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", lambda *_: httpx.Response(
        200, headers={"content-type": "text/event-stream"}, stream=ChunkedStream()))
    log_path = tmp_path / "requests.jsonl"
    with ProviderRequestMeter(log_path) as meter:
        with httpx.Client() as client, client.stream("POST", "https://test.invalid") as response:
            assert yielded == []
            headers_event = json.loads(log_path.read_text().splitlines()[-1])
            assert headers_event["event"] == "response_headers_received"
            assert headers_event["status_code"] == 200
            assert headers_event["first_body_byte_seconds"] is None
            chunks = response.iter_raw()
            assert next(chunks) == parts[0]
            assert yielded == parts[:1]
            byte_event = json.loads(log_path.read_text().splitlines()[-1])
            assert byte_event["event"] == "response_body_started"
            assert byte_event["first_body_byte_seconds"] >= headers_event["response_headers_seconds"]
            assert byte_event["outcome"] == "in_progress"
            assert byte_event["usage"] is None
            assert "hello" not in log_path.read_text()
            assert meter.summary()["in_progress_requests"] == 1
            assert list(chunks) == parts[1:]
    assert meter.summary()["known_tokens"]["total_tokens"] == 14
    assert meter.summary()["known_tokens"]["reasoning_output_tokens"] == (2 if usage_event.get("type") else None)


def test_compressed_usage_is_observed_without_changing_response(monkeypatch, tmp_path):
    payload = {"usage": {"input_tokens": 0, "output_tokens": 3}}
    install_response(monkeypatch, gzip.compress(json.dumps(payload).encode()), headers={"content-encoding": "gzip"})
    with ProviderRequestMeter(tmp_path / "requests.jsonl") as meter, httpx.Client() as client:
        assert client.get("https://test.invalid").json() == payload
    assert meter.summary()["known_tokens"]["input_tokens"] == 0
    assert meter.summary()["known_tokens"]["total_tokens"] == 3


@pytest.mark.parametrize("wire_api", ["responses", "chat_completions"])
def test_adapter_terminal_closes_metered_stream_without_transport_error(monkeypatch, tmp_path, wire_api):
    closed = []
    if wire_api == "responses":
        events = [
            {"type": "response.output_text.delta", "delta": '{"ok":true}'},
            {"type": "response.completed", "response": {"id": "resp_test", "status": "completed",
                "usage": {"input_tokens": 10, "output_tokens": 4, "total_tokens": 14}}},
        ]
    else:
        events = [
            {"id": "resp_test", "choices": [{"delta": {"content": '{"ok":true}'}}]},
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            {"usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}},
            "[DONE]",
        ]

    class TerminalStream(httpx.SyncByteStream):
        def __iter__(self):
            for event in events:
                yield ("data: " + (event if isinstance(event, str) else json.dumps(event)) + "\n\n").encode()
            raise AssertionError("The adapter read past the provider terminal event")

        def close(self):
            closed.append(True)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", lambda *_: httpx.Response(
        200, headers={"content-type": "text/event-stream"}, stream=TerminalStream()))
    adapter = RealLLMAdapter(provider="openai_compatible", model_name="test-model", api_key="test-key",
                             base_url="https://test.invalid/v1", wire_api=wire_api, max_retries=0)
    log_path = tmp_path / "requests.jsonl"
    with ProviderRequestMeter(log_path) as meter:
        try:
            body, usage, response_id, termination = adapter._stream_text({"model": "test-model"}, on_delta=None)
        finally:
            adapter._client.close()
    assert json.loads(body) == {"ok": True}
    assert usage["total_tokens"] == 14
    assert response_id == "resp_test"
    assert termination == "completed"
    assert closed == [True]
    summary = meter.summary()
    assert summary["physical_requests"] == summary["completed_requests"] == 1
    assert summary["known_tokens"]["total_tokens"] == 14
    assert summary["requests"][0]["outcome"] == "closed"
    assert "error_type" not in summary["requests"][0]
    events = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert sum(event["event"] == "request_finished" for event in events) == 1


def test_missing_usage_is_unknown_and_errors_do_not_leak_messages(monkeypatch, tmp_path):
    attempts = []

    def handle_request(transport, request):
        attempts.append(request)
        if len(attempts) == 1:
            raise httpx.ConnectError("PRIVATE_KEY and PRIVATE_URL")
        return httpx.Response(429, stream=httpx.ByteStream(b'{"error":"PRIVATE_RESPONSE"}'))

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", handle_request)
    log_path = tmp_path / "requests.jsonl"
    with ProviderRequestMeter(log_path) as meter, httpx.Client() as client:
        with pytest.raises(httpx.ConnectError):
            client.get("https://test.invalid")
        assert client.get("https://test.invalid").status_code == 429
    summary = meter.summary()
    assert summary["requests_missing_usage"] == 2
    assert summary["known_tokens"]["total_tokens"] is None
    assert summary["requests"][0]["error_type"] == "ConnectError"
    assert "PRIVATE" not in log_path.read_text()


def test_request_cap_is_atomic_for_parallel_attempts(monkeypatch, tmp_path):
    observed = []
    install_response(monkeypatch, b"{}", observed=observed)
    with ProviderRequestMeter(tmp_path / "requests.jsonl", max_requests=3) as meter, httpx.Client() as client:
        def request_once(_):
            try:
                client.get("https://test.invalid")
                return True
            except ProbeLimitExceeded:
                return False

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(request_once, range(8)))
    assert sum(results) == len(observed) == 3
    assert meter.summary()["blocked_requests"] == 5


def test_deadline_blocks_before_transport_and_caps_missing_timeouts(monkeypatch, tmp_path):
    observed = []
    install_response(monkeypatch, b"{}", observed=observed)
    with ProviderRequestMeter(tmp_path / "requests.jsonl", deadline_seconds=30) as meter, httpx.Client(timeout=None) as client:
        client.get("https://test.invalid")
        assert all(0 < value <= 30 for value in observed[0].extensions["timeout"].values())
        monkeypatch.setattr(time, "monotonic", lambda: meter._deadline + 1)
        with pytest.raises(ProbeLimitExceeded, match="deadline"):
            client.get("https://test.invalid")
    assert len(observed) == 1


def test_mock_transport_is_not_metered(monkeypatch, tmp_path):
    install_response(monkeypatch, b"{}")
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"ok": True}))
    with ProviderRequestMeter(tmp_path / "requests.jsonl") as meter, httpx.Client(transport=transport) as client:
        assert client.get("https://test.invalid").json() == {"ok": True}
    assert meter.summary()["physical_requests"] == 0


def test_zero_request_limit_guarantees_no_outbound_calls(monkeypatch, tmp_path):
    observed = []
    install_response(monkeypatch, b"{}", observed=observed)
    with ProviderRequestMeter(tmp_path / "requests.jsonl", max_requests=0) as meter, httpx.Client() as client:
        with pytest.raises(ProbeLimitExceeded, match="request_limit"):
            client.get("https://test.invalid")
    assert observed == []
    assert meter.summary()["physical_requests"] == 0
    assert meter.summary()["blocked_requests"] == 1


def test_stream_failure_is_recorded_and_original_exception_preserved(monkeypatch, tmp_path):
    closed = []
    error = httpx.ReadError("PRIVATE_RESPONSE")

    class BrokenStream(httpx.SyncByteStream):
        def __iter__(self):
            yield b'data: {"choices":[]}\n\n'
            raise error

        def close(self):
            closed.append(True)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", lambda *_: httpx.Response(
        200, headers={"content-type": "text/event-stream"}, stream=BrokenStream()))
    log_path = tmp_path / "requests.jsonl"
    with ProviderRequestMeter(log_path) as meter, httpx.Client() as client:
        with pytest.raises(httpx.ReadError) as failure:
            client.get("https://test.invalid")
    assert failure.value is error
    assert closed == [True]
    assert meter.summary()["requests"][0]["outcome"] == "error"
    assert meter.summary()["requests"][0]["error_type"] == "ReadError"
    assert meter.summary()["requests_missing_usage"] == 1
    assert "PRIVATE_RESPONSE" not in log_path.read_text()


def test_capture_limit_preserves_body_and_marks_usage_unknown(monkeypatch, tmp_path):
    content = b'{"usage":{"input_tokens":5,"output_tokens":8}}'
    install_response(monkeypatch, content)
    with ProviderRequestMeter(tmp_path / "requests.jsonl", max_capture_bytes=4) as meter, httpx.Client() as client:
        assert client.get("https://test.invalid").content == content
    assert meter.summary()["requests_missing_usage"] == 1
