"""Chinese display policy never rewrites the generated screenplay payload."""

import json
import threading

import pytest

from app.api.copilot_stream import copilot_stream_response
from app.modules.script_engine.copilot_language import chinese_progress_text
from app.modules.script_engine.copilot_progress import (
    INCOMPLETE_NOTICE,
    LANGUAGE_NOTICE,
    MAX_SENTENCE_CONTEXT_CHARACTERS,
    MAX_THINKING_CHARACTERS,
    CopilotProgress,
    CopilotRequestCancelled,
)
from app.modules.script_engine.models import GenerationStrategy
from tests.test_copilot_llm import chat_thinking, deepseek_adapter, stream_response
from tests.test_llm_adapter import build_strategy


@pytest.mark.parametrize("text", [
    "先核对人物目标，再调整冲突。",
    "先核对 Alex Morgan 的目标，再检查 JSON 和 O.S. 标注。",
    "核对 `scenes[0].dialogues` 字段与 `character_name` 的一致性。",
    "检验 GPT-4 与 AI 的返回结构。",
    "先确认 Will Marshall 与 May Chen 的目标。",
])
def test_chinese_process_preserves_names_and_technical_references(text):
    assert chinese_progress_text(text)


@pytest.mark.parametrize("text", [
    "Let me analyze the character motivation.",
    "LET ME THINK ABOUT THIS.",
    "先看一下。We need to revise the scene.",
    "这个发展 needs a better reason。",
    "接下来 WE NEED TO FIX THIS NOW。",
    "现在 Let Us Think Step By Step。",
    "先看 Character Motivation And Scene Analysis。",
    "下面 Check The Plot。",
    "接下来 Thinking。",
    "接下来 Analyzing。",
    "现在 **We** **Need** **To** **Check**。",
    "继续 We\u00a0Need\u00a0To\u00a0Fix\u00a0This。",
    "现在 We, Need, To, Fix, This。",
    "继续 `Let` `Us` `Think`。",
    "下面 ＴＨＩＮＫＩＮＧ。",
    "Сначала нужно проверить героя。",
    "先检查 персонаж 的目标。",
    "まず登場人物を確認する。",
    "먼저 등장인물을 확인합니다。",
])
def test_english_explanations_are_not_displayable(text):
    assert not chinese_progress_text(text)


@pytest.mark.parametrize("channel", ["model_thinking", "reasoning_summary"])
def test_fragmented_english_never_reaches_browser_and_chinese_recovers(channel):
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    receive = observer.thinking_delta if channel == "model_thinking" else observer.summary_delta
    source = "Let me analyze the character motivation.\n接着核对人物的目标。"
    for character in source:
        receive(character)
        assert "Let" not in "".join(event.get("delta", "") for event in events)
    observer.flush_text()
    assert "".join(event["delta"] for event in events if event["type"] == channel).strip() == "接着核对人物的目标。"
    notices = [event for event in events if event.get("message") == LANGUAGE_NOTICE]
    assert len(notices) == 1
    assert all(event["type"] == "progress" for event in notices)


def test_omitted_sentence_does_not_splice_adjacent_chinese_into_one_explanation():
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    observer.thinking_delta("先核对来源。An English detour.\n再整理冲突。")
    observer.flush_text()
    displayed = "".join(event["delta"] for event in events if event["type"] == "model_thinking")
    assert displayed == "先核对来源。\n\n再整理冲突。"


def test_long_english_tail_remains_bounded_and_never_becomes_model_text():
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    observer.thinking_delta("untranslated analysis " * 4_000)
    assert len(observer._pending["model_thinking"]) <= MAX_THINKING_CHARACTERS
    observer.flush_text()
    assert not any(event["type"] == "model_thinking" for event in events)
    assert observer._pending["model_thinking"] == ""


def test_cancellation_does_not_flush_english_or_publish_language_notice():
    events = []
    cancel = threading.Event()
    observer = CopilotProgress(events.append, cancel)
    observer.thinking_delta("Let me check")
    cancel.set()
    with pytest.raises(CopilotRequestCancelled):
        observer.flush_text()
    assert events == []


@pytest.mark.parametrize("channel", ["model_thinking", "reasoning_summary"])
@pytest.mark.parametrize("text", [
    "现在 **We** **Need** **To** **Check**。",
    "继续 We\u00a0Need\u00a0To\u00a0Fix\u00a0This。",
    "接下来 Thinking。",
    "Сначала нужно проверить героя。",
])
def test_decorated_or_non_latin_process_text_never_leaks_even_with_flush_on_each_character(channel, text):
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    receive = observer.thinking_delta if channel == "model_thinking" else observer.summary_delta
    for character in text:
        observer._last_flush[channel] = 0
        receive(character)
        displayed = "".join(event.get("delta", "") for event in events)
        assert all(not char.isalpha() or "\u3400" <= char <= "\u9fff" for char in displayed)
    observer.flush_text()
    assert len([event for event in events if event.get("message") == LANGUAGE_NOTICE]) == 1


@pytest.mark.parametrize("channel", ["model_thinking", "reasoning_summary"])
@pytest.mark.parametrize("chunk_size", [1, 64, 512])
@pytest.mark.parametrize("name", ["Alex Morgan", "Will Marshall"])
def test_inline_names_keep_their_chinese_sentence_context_across_cadence_flushes(channel, chunk_size, name):
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    receive = observer.thinking_delta if channel == "model_thinking" else observer.summary_delta
    source = "中" * 256 + f" {name}。"
    for offset in range(0, len(source), chunk_size):
        receive(source[offset:offset + chunk_size])
        assert len(observer._sentence_context[channel]) <= MAX_SENTENCE_CONTEXT_CHARACTERS
    observer.flush_text()
    assert "".join(event.get("delta", "") for event in events) == source
    assert not any(event.get("message") == LANGUAGE_NOTICE for event in events)
    assert observer._sentence_context[channel] == ""


@pytest.mark.parametrize("channel", ["model_thinking", "reasoning_summary"])
def test_sentence_context_cannot_authorize_a_separate_english_sentence_or_a_new_request(channel):
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    receive = observer.thinking_delta if channel == "model_thinking" else observer.summary_delta
    receive("中" * 64)
    receive("。Alex Morgan。")
    observer.flush_text()
    assert "".join(event.get("delta", "") for event in events) == "中" * 64 + "。"
    receive("继续核对")
    observer.request_started()
    receive("Will Marshall。")
    observer.flush_text()
    assert "Will" not in "".join(event.get("delta", "") for event in events)


@pytest.mark.parametrize("channel", ["model_thinking", "reasoning_summary"])
@pytest.mark.parametrize("chunk_size", [1, 10_000])
def test_budget_cutoff_does_not_reinterpret_a_partial_english_word_as_a_name(channel, chunk_size):
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    receive = observer.thinking_delta if channel == "model_thinking" else observer.summary_delta
    source = "中" * (MAX_THINKING_CHARACTERS - 3) + " Let me analyze the scene."
    for offset in range(0, len(source), chunk_size):
        receive(source[offset:offset + chunk_size])
    observer.flush_text()
    displayed = "".join(event.get("delta", "") for event in events)
    assert len(displayed) <= MAX_THINKING_CHARACTERS
    assert not any("A" <= char <= "Z" or "a" <= char <= "z" for char in displayed)
    assert observer._pending[channel] == ""
    assert len([event for event in events if event.get("message") == INCOMPLETE_NOTICE]) == 1


@pytest.mark.parametrize("channel", ["model_thinking", "reasoning_summary"])
def test_retry_discards_incomplete_latin_tail_and_preserves_complete_chinese_segments(channel):
    events = []
    observer = CopilotProgress(events.append, threading.Event())
    receive = observer.thinking_delta if channel == "model_thinking" else observer.summary_delta
    receive("先核对。中文 Le")
    observer.request_started()
    receive("重试确认。")
    observer.flush_text()
    assert "".join(event.get("delta", "") for event in events) == "先核对。\n\n重试确认。"
    assert len([event for event in events if event.get("message") == INCOMPLETE_NOTICE]) == 1
    assert not any(event.get("message") == LANGUAGE_NOTICE for event in events)


def test_cancelled_retry_cannot_publish_buffered_text_or_an_incomplete_notice():
    events = []
    cancel = threading.Event()
    observer = CopilotProgress(events.append, cancel)
    observer.thinking_delta("中文 Le")
    cancel.set()
    with pytest.raises(CopilotRequestCancelled):
        observer.request_started()
    assert events == []


@pytest.mark.anyio
async def test_real_sse_omits_english_process_but_keeps_overseas_dialogue_and_translation():
    answer = {
        "setting": "仓库内，夜晚。",
        "dialogues": [{
            "character_name": "Maya Chen",
            "text": "Don't open that door.",
            "chinese_translation": "别开那扇门。",
        }],
    }
    requests = []

    def handler(request):
        requests.append(request)
        return stream_response(
            chat_thinking("Let me analyze the scene.\n"),
            chat_thinking("先核对场景内的冲突。"),
            {"choices": [{"delta": {"content": json.dumps(answer, ensure_ascii=False)}, "finish_reason": "stop"}]},
        )

    client = deepseek_adapter(handler)
    strategy = GenerationStrategy.model_validate(build_strategy())
    response = copilot_stream_response(lambda: client.generate_structured_output(
        "按海外路径给出英文台词及对应中文翻译，其余中文。",
        strategy=strategy,
        output_schema={"type": "object", "properties": {
            "setting": {"type": "string"},
            "dialogues": {"type": "array", "items": {"type": "object"}},
        }},
    ))
    frames = [frame async for frame in response.body_iterator]
    events = [json.loads(line[6:]) for frame in frames for line in frame.splitlines() if line.startswith("data: ")]
    assert len(requests) == 1  # No translation call or regeneration for progress.
    assert "Let me" not in json.dumps(events, ensure_ascii=False)
    assert "".join(event["delta"] for event in events if event["type"] == "model_thinking") == "先核对场景内的冲突。"
    assert any(event.get("message") == LANGUAGE_NOTICE for event in events)
    assert events[-1]["type"] == "result"
    assert {key: events[-1]["data"][key] for key in answer} == answer
