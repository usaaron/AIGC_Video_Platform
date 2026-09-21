"""Interrupted SSE feedback stays readable without changing failure semantics."""

import json
from unittest.mock import Mock

from fastapi import HTTPException
import pytest

from app.api.copilot_stream import copilot_stream_response
from app.modules.script_engine.copilot_progress import (
    CopilotProgress,
    CopilotRequestCancelled,
    INCOMPLETE_NOTICE,
    LANGUAGE_NOTICE,
    current_copilot_progress,
)
from app.modules.script_engine.llm_deadline import DeadlineExceeded


async def stream_events(operation):
    response = copilot_stream_response(operation, request_id="failed-feedback-test")
    frames = [frame async for frame in response.body_iterator]
    return [json.loads(line[6:]) for frame in frames for line in frame.splitlines() if line.startswith("data: ")]


def fail(kind):
    if kind == "http":
        raise HTTPException(429, "请求较多，请稍后重试。", headers={"X-Generation-Retryable": "true"})
    if kind == "deadline":
        raise DeadlineExceeded("test")
    raise RuntimeError("PRIVATE_PROVIDER_FAILURE")


def receiver(observer, channel):
    return observer.thinking_delta if channel == "model_thinking" else observer.summary_delta


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["http", "deadline", "unexpected"])
@pytest.mark.parametrize("channel", ["model_thinking", "reasoning_summary"])
async def test_error_terminal_preserves_received_chinese_tail_and_original_failure(kind, channel):
    text = "已核对人物。正在检查场景衔接"

    def operation():
        observer = current_copilot_progress()
        observer._last_flush[channel] = 0
        receiver(observer, channel)(text)
        fail(kind)

    events = await stream_events(operation)
    assert "".join(event.get("delta", "") for event in events if event["type"] == channel) == text
    assert events[-1]["type"] == "error"
    assert events[-1]["status"] == {"http": 429, "deadline": 503, "unexpected": 500}[kind]
    assert events[-1]["retryable"] is (kind == "http")
    if kind == "deadline":
        assert events[-1]["error_type"] == "deadline"
        assert events[-1]["failure_class"] == "time_budget_exhausted"
    assert all(event["request_id"] == "failed-feedback-test" for event in events)
    assert not any(event["type"] == "result" for event in events)
    assert "PRIVATE_PROVIDER_FAILURE" not in json.dumps(events)


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["http", "deadline", "unexpected"])
@pytest.mark.parametrize("channel", ["model_thinking", "reasoning_summary"])
async def test_failure_flush_keeps_complete_chinese_but_discards_english_and_mixed_unfinished_tail(kind, channel):
    def operation():
        observer = current_copilot_progress()
        receiver(observer, channel)("We need to check the scene.\n已核对人物。接下来 Le")
        fail(kind)

    events = await stream_events(operation)
    assert "".join(event.get("delta", "") for event in events if event["type"] == channel) == "已核对人物。"
    assert {LANGUAGE_NOTICE, INCOMPLETE_NOTICE} <= {event.get("message") for event in events}
    assert "We need" not in json.dumps(events)
    assert "接下来" not in json.dumps(events, ensure_ascii=False)
    assert events[-1]["type"] == "error"


@pytest.mark.anyio
@pytest.mark.parametrize("kind", ["cancel", "http", "deadline"])
async def test_cancelled_request_does_not_flush_pending_text_or_failure(kind, monkeypatch):
    flush = Mock()
    monkeypatch.setattr(CopilotProgress, "flush_interrupted_text", flush)

    def operation():
        observer = current_copilot_progress()
        observer.thinking_delta("已核对但尚未提交的过程")
        observer.cancel.set()
        if kind == "cancel":
            raise CopilotRequestCancelled()
        fail(kind)

    events = await stream_events(operation)
    flush.assert_not_called()
    assert not any(event["type"] in {"model_thinking", "reasoning_summary", "result", "error"} for event in events)


@pytest.mark.anyio
async def test_feedback_flush_exception_cannot_hide_the_original_terminal(monkeypatch):
    flush = Mock(side_effect=RuntimeError("PRIVATE_FEEDBACK_FAILURE"))
    monkeypatch.setattr(CopilotProgress, "flush_interrupted_text", flush)
    events = await stream_events(lambda: fail("http"))
    flush.assert_called_once()
    assert events[-1] == {"type": "error", "status": 429, "message": "请求较多，请稍后重试。",
                          "retryable": True, "request_id": "failed-feedback-test"}
    assert "PRIVATE_FEEDBACK_FAILURE" not in json.dumps(events)
