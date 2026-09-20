"""Language instructions reach both provider protocols without rewriting content."""

import json
import threading
from contextlib import nullcontext
from copy import deepcopy

import httpx
import pytest

from app.modules.content_spec.market_profile import (
    CREATOR_INTERACTION_LANGUAGE_CONTRACT,
    market_profile_contract,
)
from app.modules.script_engine.copilot_progress import CopilotProgress, bind_copilot_progress
from app.modules.script_engine.llm_adapter import RealLLMAdapter, bind_llm_market
from app.modules.script_engine.models import GenerationStrategy
from tests.test_llm_adapter import (
    build_openai_compatible_response,
    build_responses_api_response,
    build_strategy,
)


SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "assistant_message": {"type": "string"},
        "setting": {"type": "string"},
        "status": {"type": "string", "enum": ["approved", "needs_review"]},
        "dialogues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "character_name": {"type": "string"},
                    "text": {"type": "string"},
                    "chinese_translation": {"type": ["string", "null"]},
                },
            },
        },
    },
}


def _response(wire_api, payload, *, streaming=False):
    content = json.dumps(payload, ensure_ascii=False)
    if streaming:
        if wire_api == "responses":
            events = [
                {"type": "response.reasoning_summary_text.delta", "delta": "正在核对对白与人物身份。"},
                {"type": "response.output_text.delta", "delta": content},
                {"type": "response.completed", "response": {"status": "completed"}},
            ]
        else:
            events = [
                {"choices": [{"delta": {"reasoning_content": "正在核对对白与人物身份。"}}]},
                {"choices": [{"delta": {"content": content}, "finish_reason": "stop"}]},
            ]
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text="".join(f"data: {json.dumps(event)}\n\n" for event in events),
        )
    builder = build_responses_api_response if wire_api == "responses" else build_openai_compatible_response
    return httpx.Response(200, json=builder(content))


def _adapter(wire_api, handler):
    return RealLLMAdapter(
        provider="openai_compatible",
        model_name="deepseek-v4.1-flash" if wire_api == "chat_completions" else "script-model",
        api_key="mock-only",
        base_url="https://language-policy.invalid/v1",
        wire_api=wire_api,
        reasoning_effort="high",
        max_retries=0,
        transport=httpx.MockTransport(handler),
    )


def _messages(request, wire_api):
    return request["input" if wire_api == "responses" else "messages"]


@pytest.mark.parametrize("wire_api", ["chat_completions", "responses"])
@pytest.mark.parametrize("market", ["cn_mainland", "overseas_tiktok"])
@pytest.mark.parametrize("copilot", [False, True])
def test_outgoing_requests_use_chinese_process_and_preserve_market_dialogue(wire_api, market, copilot):
    overseas = market == "overseas_tiktok"
    answer = {
        "title": "仓库对峙",
        "assistant_message": "已按要求核对本场对白。",
        "setting": "INT. 仓库 - 夜",
        "status": "approved",
        "dialogues": [{
            "character_name": "Maya Chen" if overseas else "陈岚",
            "text": "Don't open that door, Maya Chen." if overseas else "陈岚，别开那扇门。",
            "chinese_translation": "Maya Chen，别开那扇门。" if overseas else None,
        }],
    }
    requests, events = [], []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        return _response(wire_api, answer, streaming=body.get("stream", False))

    prompt = (
        f"Market path: {market}. OutputLanguage={'en' if overseas else 'zh'}.\n"
        "Review the approved scene and keep the existing character identity.\n"
        + json.dumps(answer, ensure_ascii=False)
    )
    schema = deepcopy(SCHEMA)
    observer = bind_copilot_progress(CopilotProgress(events.append, threading.Event())) if copilot else nullcontext()
    with bind_llm_market(market), observer:
        result = _adapter(wire_api, handler).generate_structured_output(
            prompt,
            strategy=GenerationStrategy.model_validate(build_strategy()),
            output_schema=schema,
        )

    assert len(requests) == 1
    messages = _messages(requests[0], wire_api)
    assert messages[0]["role"] == "system"
    system = messages[0]["content"]
    assert CREATOR_INTERACTION_LANGUAGE_CONTRACT in system
    assert "可展示的模型思考过程或摘要，也必须使用简体中文" in system
    assert "助手回复、解释" in system
    assert "场景动作和画面描述都使用简体中文" in system
    assert "dialogues.text保留英文原句" in system
    assert "dialogues.chinese_translation在同一次输出中逐句提供对应的简体中文翻译" in system
    assert "海外人物在中文叙述及译文中仍沿用其稳定英文姓名" in system
    assert "不要翻译或改写JSON键名、枚举值、标识符以及INT./EXT." in system
    assert prompt in messages[1]["content"]
    assert schema == SCHEMA
    assert {key: result[key] for key in answer} == answer
    assert "思考" not in json.dumps(result, ensure_ascii=False)
    assert bool(requests[0].get("stream")) is copilot


@pytest.mark.parametrize("wire_api", ["chat_completions", "responses"])
def test_empty_output_retry_retains_chinese_process_policy_without_market_context(wire_api):
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            empty = {"id": "empty", "output": []} if wire_api == "responses" else build_openai_compatible_response("")
            return httpx.Response(200, json=empty)
        return _response(wire_api, {"title": "已修复"})

    result = _adapter(wire_api, handler).generate_structured_output(
        "Repair this fragment; preserve its fields.",
        strategy=GenerationStrategy.model_validate(build_strategy()),
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )

    assert result["title"] == "已修复"
    assert len(requests) == 2
    for request in requests:
        assert CREATOR_INTERACTION_LANGUAGE_CONTRACT in _messages(request, wire_api)[0]["content"]


@pytest.mark.parametrize("market", ["cn_mainland", "overseas_tiktok"])
def test_market_contracts_keep_interaction_chinese_and_existing_delivery_language(market):
    contract = market_profile_contract(market)
    assert CREATOR_INTERACTION_LANGUAGE_CONTRACT in contract.prompt_contract
    assert contract.output_language == ("en" if market == "overseas_tiktok" else "zh")
    if market == "overseas_tiktok":
        assert "每条dialogues.chinese_translation必须在同一次输出中写该句准确、自然的简体中文对照" in contract.prompt_contract
        assert "新输出填写null，不生成中文人名" in contract.prompt_contract


@pytest.mark.parametrize("wire_api", ["chat_completions", "responses"])
@pytest.mark.parametrize("copilot", [False, True])
def test_system_policy_authorizes_only_requested_overseas_voice_quotations(wire_api, copilot):
    sample = "表达克制，不抢话。\n拒绝｜EN: I can't promise you that.｜中译: 我不能向你保证。"
    answer = {
        "assistant_message": "已保留人物的克制语气，样本只作声音参考。",
        "acting_profile": {"voice": "低声说话，以短句表达边界。", "permanentVoicePrompt": sample},
    }
    schema = {
        "type": "object", "properties": {
            "assistant_message": {"type": "string"},
            "acting_profile": {"type": "object", "properties": {
                "voice": {"type": "string"}, "permanentVoicePrompt": {"type": "string", "maxLength": 600},
            }},
        },
    }
    original_schema = deepcopy(schema)
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        return _response(wire_api, answer, streaming=body.get("stream", False))

    prompt = (
        "Market path: overseas_tiktok. 当前任务明确授权在acting_profile.permanentVoicePrompt中"
        "保留带中文释义的原创英文声音引文，其余回复用中文。样本不属于剧情事实。"
    )
    observer = bind_copilot_progress(CopilotProgress(lambda _event: None, threading.Event())) if copilot else nullcontext()
    with bind_llm_market("overseas_tiktok"), observer:
        result = _adapter(wire_api, handler).generate_structured_output(
            prompt, strategy=GenerationStrategy.model_validate(build_strategy()), output_schema=schema,
        )
    assert len(requests) == 1
    messages = _messages(requests[0], wire_api)
    assert messages[0]["role"] == "system"
    system = messages[0]["content"]
    assert "仅当当前任务明确授权海外人物声音样本时" in system
    assert "acting_profile.permanentVoicePrompt" in system
    assert "情境｜EN: …｜中译: …" in system
    assert "其EN部分允许英文" in system
    assert "不是已发生的剧情事实，也不是英文助手回复" in system
    assert "不得将例外扩展到解释、建议、审校、规划叙述或其他人物字段" in system
    assert "大陆路径及当前任务未明确授权时不启用该引文例外" in system
    assert "英文自然语言正文例外仅限正式剧本人物对白" not in system
    assert prompt in messages[1]["content"]
    assert schema == original_schema
    assert result["acting_profile"]["permanentVoicePrompt"] == sample
    assert result["assistant_message"] == answer["assistant_message"]
    assert bool(requests[0].get("stream", False)) is copilot
