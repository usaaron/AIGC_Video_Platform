import pytest

from app.modules.script_engine.llm_adapter import (
    MarketRoutedLLMAdapter, MockLLMAdapter, RealLLMAdapter, bind_llm_market,
)
from app.modules.script_engine.models import GenerationStrategy
from tests.test_llm_adapter import build_strategy


@pytest.mark.parametrize("wire_api", ["chat_completions", "responses"])
@pytest.mark.parametrize(
    "model,effort,thinking,expected",
    [
        ("glm-5.3", "medium", "enabled", "high"),
        ("glm-5.3", "medium", "disabled", "low"),
        ("glm-5.3", "none", None, "low"),
        ("glm-5.3", "xhigh", "enabled", "max"),
        ("deepseek-v4-pro", "medium", "enabled", "high"),
        ("deepseek-v4-pro", "xhigh", "enabled", "high"),
        ("gemini-3.6-flash", "max", "enabled", "high"),
        ("gemini-3.6-flash", "medium", "disabled", "minimal"),
        ("gpt-6-astra", "high", "enabled", "high"),
    ],
)
def test_model_parameters_match_each_wire_protocol(wire_api, model, effort, thinking, expected):
    adapter = RealLLMAdapter(
        provider="openai_compatible", model_name=model, api_key="test",
        base_url="https://example.test/v1", wire_api=wire_api,
        reasoning_effort=effort, thinking_mode=thinking,
    )
    payload = adapter._build_payload(
        prompt="Return JSON.", strategy=GenerationStrategy.model_validate(build_strategy()),
        output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )
    assert adapter._wire_api == wire_api
    if wire_api == "responses":
        assert payload["reasoning"] == {"effort": expected}
        assert payload["store"] is False
        assert "max_output_tokens" in payload
    else:
        assert payload["reasoning_effort"] == expected
        if model.startswith("glm-5.3"):
            assert payload["thinking"] == {"type": "enabled"}
        if model.startswith("gpt-"):
            assert "max_completion_tokens" in payload
            assert "temperature" not in payload
            assert "max_tokens" not in payload


def test_prompt_retains_schema_when_transport_schema_is_disabled():
    adapter = RealLLMAdapter(
        provider="openai_compatible", model_name="gpt-6-astra", api_key="test",
        base_url="https://example.test/v1", wire_api="responses", send_response_format=False,
    )
    payload = adapter._build_payload(
        prompt="Return JSON.", strategy=GenerationStrategy.model_validate(build_strategy()),
        output_schema={"type": "object", "properties": {"required_answer": {"type": "string"}}},
    )
    assert "text" not in payload
    assert "required_answer" in payload["input"][1]["content"]


@pytest.mark.parametrize("model", ["deepseek-v4-pro", "deepseek-v4-flash"])
@pytest.mark.parametrize("thinking", ["enabled", "disabled"])
@pytest.mark.parametrize("strict", [False, True])
def test_deepseek_chat_reasoning_and_json_mode_are_consistent(model, thinking, strict):
    adapter = RealLLMAdapter(
        provider="openai_compatible", model_name=model, api_key="test",
        base_url="https://example.test/v1", thinking_mode=thinking,
        reasoning_effort="high", use_strict_schema=strict,
    )
    payload = adapter._build_payload(
        prompt="Return JSON.", strategy=GenerationStrategy.model_validate(build_strategy()),
        output_schema={"type": "object", "properties": {"required_answer": {"type": "string"}}},
    )
    assert payload["thinking"] == {"type": thinking}
    assert "required_answer" in payload["messages"][1]["content"]
    assert "max_tokens" in payload
    assert "max_completion_tokens" not in payload
    assert payload["response_format"] == {"type": "json_object"}
    if thinking == "enabled":
        assert payload["reasoning_effort"] == "high"
        assert "temperature" not in payload
    else:
        assert "reasoning_effort" not in payload
        assert "temperature" in payload


def test_request_market_overrides_prompt_and_resets_after_nested_failure():
    mainland, overseas = MockLLMAdapter(), MockLLMAdapter()
    adapter = MarketRoutedLLMAdapter(mainland=mainland, overseas=overseas)
    with bind_llm_market("overseas"):
        assert adapter._select("Repair this fragment.") is overseas
        assert adapter._select("Market path: cn_mainland") is overseas
        with pytest.raises(RuntimeError):
            with bind_llm_market("cn_mainland"):
                assert adapter._select("Market path: overseas") is mainland
                raise RuntimeError("operation failed")
        assert adapter._select("Repair this fragment.") is overseas
    assert adapter._select("Repair this fragment.") is mainland


def test_concurrent_request_markets_are_isolated():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    mainland, overseas = MockLLMAdapter(), MockLLMAdapter()
    adapter = MarketRoutedLLMAdapter(mainland=mainland, overseas=overseas)
    barrier = Barrier(2)

    def select(market):
        with bind_llm_market(market):
            barrier.wait(timeout=5)
            return adapter._select("Repair this fragment.")

    with ThreadPoolExecutor(max_workers=2) as pool:
        cn = pool.submit(select, "cn_mainland")
        international = pool.submit(select, "overseas")
        assert cn.result() is mainland
        assert international.result() is overseas
