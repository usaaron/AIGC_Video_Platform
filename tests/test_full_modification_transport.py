"""The full-edit transport preference must preserve existing route budgets."""

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import json
import threading
import time

import httpx
import pytest

from app.modules.script_engine.llm_adapter import (
    AdaptiveTransportLLMAdapter,
    AdaptiveTransportState,
    MarketRoutedLLMAdapter,
    ModelFailoverLLMAdapter,
    PooledLLMAdapter,
    RealLLMAdapter,
    bind_deepseek_full_episode_stream,
)
from app.modules.script_engine.models import GenerationStrategy, ScriptDraftModificationRequest, ScriptGenerationDraftRequest
from tests.test_llm_adapter import build_openai_compatible_response, build_strategy
from tests.test_script_generation_service import seed_dependencies


def response_for(payload, content='{"title":"完整结果"}'):
    if not payload.get("stream"):
        return httpx.Response(200, json=build_openai_compatible_response(content))
    events = [
        {"choices": [{"delta": {"content": content}}]},
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
    ]
    return httpx.Response(200, text="".join(
        f"data: {json.dumps(event, ensure_ascii=False)}\n\n" for event in events
    ) + "data: [DONE]\n\n", headers={"content-type": "text/event-stream"})


def route(handler, *, model="deepseek-v4-pro", **kwargs):
    return RealLLMAdapter(
        provider="openai_compatible", model_name=model, api_key="test-only",
        base_url="https://transport.test/v1", max_retries=0,
        reasoning_effort="medium", thinking_mode="enabled",
        transport=httpx.MockTransport(handler), **kwargs,
    )


def test_deepseek_first_wire_uses_sse_with_exact_existing_schema_strategy_and_outer_chain():
    seen = []

    def handler(request):
        payload = json.loads(request.content)
        seen.append(payload)
        time.sleep(0.02)  # Longer than the configured hedge delay, if wrongly used.
        return response_for(payload)

    primary = PooledLLMAdapter(
        provider="openai_compatible", model_name="deepseek-v4-pro",
        api_keys=["test-one", "test-two"], base_url="https://transport.test/v1",
        max_retries=0, reasoning_effort="medium", thinking_mode="enabled",
        transport=httpx.MockTransport(handler),
    )
    state = AdaptiveTransportState()
    state.prefer_non_stream_until = time.monotonic() + 900
    state.consecutive_reasoning_length_failures = 3
    cooldown = state.prefer_non_stream_until
    adaptive = AdaptiveTransportLLMAdapter(adapter=primary, state=state)

    def forbidden_fallback(_request):
        pytest.fail("The successful full edit must not activate a hedge/fallback.")

    outer = ModelFailoverLLMAdapter(
        primary=adaptive, fallback=route(forbidden_fallback), hedge_delay_seconds=0.001,
    )
    strategy = GenerationStrategy.model_validate({**build_strategy(), "max_tokens": 32000})
    schema = {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}
    before_strategy, before_schema = strategy.model_dump(), deepcopy(schema)
    ordinary = outer.generate_structured_output("Return one complete script.", strategy=strategy, output_schema=schema)
    with bind_deepseek_full_episode_stream():
        streamed = outer.generate_structured_output("Return one complete script.", strategy=strategy, output_schema=schema)
    assert ordinary["title"] == streamed["title"] == "完整结果"
    assert [bool(item.get("stream")) for item in seen] == [False, True]
    wire_stream = {key: value for key, value in seen[1].items() if key not in {"stream", "stream_options"}}
    assert wire_stream == seen[0]
    assert seen[1]["max_tokens"] == 32000
    # The existing provider protocol maps configured effort to its wire value;
    # compare the actual payloads rather than changing that mapping here.
    assert seen[1]["reasoning_effort"] == seen[0]["reasoning_effort"]
    assert seen[1]["thinking"] == {"type": "enabled"}
    assert state.prefer_non_stream_until == cooldown
    assert state.consecutive_reasoning_length_failures == 3
    assert strategy.model_dump() == before_strategy and schema == before_schema


def test_existing_sse_to_json_fallback_consumes_preference_without_recursion():
    modes = []

    def handler(request):
        payload = json.loads(request.content)
        modes.append(bool(payload.get("stream")))
        if payload.get("stream"):
            return httpx.Response(502, json={"error": {"message": "SSE route temporarily unavailable"}})
        return response_for(payload)

    adapter = route(handler)
    with bind_deepseek_full_episode_stream():
        result = adapter.generate_structured_output("Return a script.", strategy=GenerationStrategy.model_validate(build_strategy()))
    assert modes == [True, False]
    assert result["title"] == "完整结果"
    assert result["_meta"]["stream_fallback"] is True


def test_existing_primary_failure_still_uses_one_configured_gemini_fallback():
    attempts = []

    def primary_handler(request):
        attempts.append(("deepseek", bool(json.loads(request.content).get("stream"))))
        return httpx.Response(502, json={"error": {"message": "Upstream unavailable"}})

    def fallback_handler(request):
        payload = json.loads(request.content)
        attempts.append(("gemini", bool(payload.get("stream"))))
        return response_for(payload)

    adapter = ModelFailoverLLMAdapter(
        primary=route(primary_handler, retry_gateway_stream_as_non_stream=False),
        fallback=route(fallback_handler, model="gemini-3.6-flash"),
        hedge_delay_seconds=0.001,
    )
    with bind_deepseek_full_episode_stream():
        result = adapter.generate_structured_output("Return a script.", strategy=GenerationStrategy.model_validate(build_strategy()))
    assert attempts == [("deepseek", True), ("gemini", False)]
    assert result["_meta"]["model_failover_used"] is True


def test_preference_is_request_scoped_and_restored_after_error():
    ready = threading.Barrier(2)
    seen = {}

    def handler(request):
        payload = json.loads(request.content)
        prompt = payload["messages"][-1]["content"]
        seen[prompt] = bool(payload.get("stream"))
        return response_for(payload)

    adapter = route(handler)
    strategy = GenerationStrategy.model_validate(build_strategy())

    def scoped():
        with bind_deepseek_full_episode_stream():
            ready.wait(timeout=5)
            adapter.generate_structured_output("full_edit", strategy=strategy)

    def ordinary():
        ready.wait(timeout=5)
        adapter.generate_structured_output("impact_review", strategy=strategy)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(scoped), pool.submit(ordinary)]
        for future in futures:
            future.result(timeout=10)
    with pytest.raises(RuntimeError, match="interrupted"):
        with bind_deepseek_full_episode_stream():
            raise RuntimeError("interrupted")
    adapter.generate_structured_output("after_error", strategy=strategy)
    assert seen == {"full_edit": True, "impact_review": False, "after_error": False}


@pytest.mark.parametrize("market", ["cn_mainland", "overseas"])
@pytest.mark.parametrize("scope", ["full", "targeted"])
def test_real_service_limits_transport_to_deepseek_full_edit_leaving_impact_and_targeted_unchanged(market, scope):
    service, spec_id = seed_dependencies()
    content_spec = service._content_spec_repository.get(spec_id)
    content_spec.metadata["market_profile"] = "overseas_tiktok" if market == "overseas" else market
    service._content_spec_repository.save(content_spec)
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        release_region=market, output_language="en" if market == "overseas" else "zh", desired_scene_count=1,
    ))
    seen = []

    class WriterCaptured(BaseException):
        pass

    def handler(request):
        payload = json.loads(request.content)
        seen.append(payload)
        if len(seen) == 1:
            return response_for(payload, json.dumps({
                "user_goal": "只修正本集表达并保留既有事实。", "rewrite_scope": "preserve_unaffected_text",
                "conflicts": [], "options": [],
            }))
        raise WriterCaptured()

    adapters = MarketRoutedLLMAdapter(mainland=route(handler), overseas=route(handler, model="gemini-3.6-flash"))
    service._author_conflict_llm_adapter = adapters
    service._conversation_editor_llm_adapter = adapters
    request = ScriptDraftModificationRequest(
        source_generation_run=source, source_draft_master_script=source.draft_master_script,
        instruction="修正当前表达，保留批准剧情与所有已确认事实。",
        selection_context={"source_field": "本集钩子（hook）", "selected_text": source.draft_master_script.hook} if scope == "targeted" else None,
    )
    before = request.model_dump()
    with pytest.raises(WriterCaptured):
        service.modify_draft(request)
    assert len(seen) == 2
    assert not seen[0].get("stream")
    assert bool(seen[1].get("stream")) == (market == "cn_mainland" and scope == "full")
    assert seen[0]["max_tokens"] == 6000
    assert seen[1]["max_tokens"] == (32000 if scope == "full" else 16000)
    assert seen[0]["model"] == seen[1]["model"] == ("deepseek-v4-pro" if market == "cn_mainland" else "gemini-3.6-flash")
    assert request.model_dump() == before
