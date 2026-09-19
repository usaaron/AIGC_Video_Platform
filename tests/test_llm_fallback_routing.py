"""Role routing checks use synthetic profiles and never call a model service."""

import json
import os

import httpx
import pytest

from app import llm_runtime as runtime
from app.modules.script_engine.llm_adapter import (
    AdaptiveTransportLLMAdapter,
    LLMRequestError,
    MockLLMAdapter,
    ModelFailoverLLMAdapter,
    PooledLLMAdapter,
    RealLLMAdapter,
)
from app.modules.script_engine.models import GenerationStrategy
from tests.test_llm_adapter import build_strategy


def profile(monkeypatch, prefix, model="deepseek-v4-pro", **settings):
    values = {
        "PROVIDER": "openai_compatible", "MODEL": model,
        "BASE_URL": f"https://{prefix.lower().replace('_', '-')}.test/v1",
        "API_KEY": f"{prefix}-key", "MAX_RETRIES": "0",
        "WIRE_API": "responses" if model == "gpt-6-astra" else "chat_completions",
    }
    values.update(settings)
    for suffix, value in values.items():
        monkeypatch.setenv(f"{prefix}_{suffix}", value)


@pytest.fixture(autouse=True)
def isolated_profiles(monkeypatch):
    for name in list(os.environ):
        if name.startswith("LLM_"):
            monkeypatch.delenv(name)
    runtime.build_script_generation_adapter.cache_clear()
    profile(monkeypatch, "LLM")
    profile(monkeypatch, "LLM_ASTRA", "gpt-6-astra")
    yield
    runtime.build_script_generation_adapter.cache_clear()


def unwrap_transport(adapter):
    while isinstance(adapter, AdaptiveTransportLLMAdapter):
        adapter = adapter._adapter
    return adapter


def build_role(prefix):
    return runtime._build_role_adapter_from_env(
        prefix, default_model_env="LLM_MODEL",
        default_timeout_seconds=600, default_max_retries=0,
    )


@pytest.mark.parametrize("prefix,builder", [
    ("LLM_OUTLINE", runtime.build_llm_adapter_from_env),
    ("LLM_PLANNING", runtime.build_planning_llm_adapter_from_env),
    ("LLM_CREATIVE", runtime.build_creative_llm_adapter_from_env),
    ("LLM_INPUT_READINESS", runtime.build_input_readiness_llm_adapter_from_env),
    ("LLM_STORY_BIBLE", runtime.build_story_bible_llm_adapter_from_env),
    ("LLM_STORY_ARCHITECT", runtime.build_story_architect_llm_adapter_from_env),
    ("LLM_STORY_ARCHITECT_RECOVERY", runtime.build_story_architect_recovery_llm_adapter_from_env),
    ("LLM_EPISODE_PLAN", runtime.build_episode_plan_llm_adapter_from_env),
    ("LLM_CONTINUITY", runtime.build_continuity_llm_adapter_from_env),
    ("LLM_PLANNING_EDITOR", runtime.build_planning_editor_llm_adapter_from_env),
    ("LLM_STORYBOARD", runtime.build_storyboard_llm_adapter_from_env),
    ("LLM_SCRIPT", runtime.build_script_generation_adapter_from_env),
    ("LLM_SCRIPT_REPAIR", runtime.build_script_repair_llm_adapter_from_env),
    ("LLM_SCRIPT_REPAIR", runtime.build_script_fallback_llm_adapter_from_env),
    ("LLM_SCRIPT_EDITOR", runtime.build_script_editor_llm_adapter_from_env),
    ("LLM_DIALOGUE", runtime.build_dialogue_polish_adapter_from_env),
])
def test_inherited_roles_honor_their_own_fallback_selector(monkeypatch, prefix, builder):
    monkeypatch.setenv(f"{prefix}_FALLBACK_PROFILE", "LLM_ASTRA")
    adapter = unwrap_transport(builder())
    assert isinstance(adapter, ModelFailoverLLMAdapter)
    assert adapter.get_model_info().model_name == "deepseek-v4-pro"
    assert isinstance(adapter._primary, RealLLMAdapter)
    assert isinstance(adapter._fallback, RealLLMAdapter)
    assert adapter._fallback.get_model_info().model_name == "gpt-6-astra"
    assert adapter._fallback._wire_api == "responses"
    assert adapter._fallback._client.headers["authorization"] == "Bearer LLM_ASTRA-key"


@pytest.mark.parametrize("market", ["CN", "OVERSEAS"])
@pytest.mark.parametrize("role", [
    "CREATIVE", "INSPIRATION", "STORY_BIBLE", "STORY_BIBLE_EDITOR",
    "STORY_ARCHITECT", "STORY_ARCHITECT_RECOVERY", "EPISODE_PLAN",
    "SCRIPT", "SCRIPT_REPAIR", "SCRIPT_EDITOR", "CONTINUITY", "STORYBOARD",
])
def test_market_role_fallback_is_opt_in_and_isolated(monkeypatch, market, role):
    prefix = f"LLM_{market}_{role}"
    profile(monkeypatch, prefix, REASONING_EFFORT="high")
    monkeypatch.setenv(f"{prefix}_FALLBACK_PROFILE", "LLM_ASTRA")
    sentinel = MockLLMAdapter()
    routed = runtime.build_market_routed_role_adapter_from_env(
        role, fallback=sentinel, default_timeout_seconds=600, default_max_retries=0,
    )
    adapter = unwrap_transport(routed._mainland if market == "CN" else routed._overseas)
    other = routed._overseas if market == "CN" else routed._mainland
    assert other is sentinel
    assert adapter.get_model_info().model_name == "deepseek-v4-pro"
    assert adapter._primary._client.headers["authorization"] == f"Bearer {prefix}-key"
    assert adapter._fallback._client.headers["authorization"] == "Bearer LLM_ASTRA-key"
    assert adapter._fallback._wire_api == "responses"
    assert adapter._primary._reasoning_effort == "high"


def test_complete_outline_profile_wins_over_generic_profile(monkeypatch):
    profile(monkeypatch, "LLM_OUTLINE", "explicit-outline")
    monkeypatch.setenv("LLM_OUTLINE_FALLBACK_PROFILE", "LLM_ASTRA")
    adapter = runtime.build_llm_adapter_from_env()
    assert adapter.get_model_info().model_name == "explicit-outline"
    assert adapter._primary._client.headers["authorization"] == "Bearer LLM_OUTLINE-key"


def test_unselected_roles_do_not_inherit_another_roles_astra_fallback(monkeypatch):
    monkeypatch.setenv("LLM_PLANNING_FALLBACK_PROFILE", "LLM_ASTRA")
    assert isinstance(runtime.build_planning_llm_adapter_from_env(), ModelFailoverLLMAdapter)
    assert isinstance(runtime.build_story_architect_llm_adapter_from_env(), RealLLMAdapter)
    assert isinstance(runtime.build_continuity_llm_adapter_from_env(), RealLLMAdapter)
    assert isinstance(runtime.build_planning_editor_llm_adapter_from_env(), RealLLMAdapter)


@pytest.mark.parametrize("missing", ["MODEL", "BASE_URL", "API_KEY"])
def test_partial_fallback_never_borrows_global_or_other_role_fields(monkeypatch, missing, caplog):
    monkeypatch.delenv(f"LLM_ASTRA_{missing}")
    profile(monkeypatch, "LLM_CN_SCRIPT")
    profile(monkeypatch, "LLM_ASTRA_FALLBACK")
    monkeypatch.setenv("LLM_OUTLINE_FALLBACK_PROFILE", "LLM_ASTRA")
    adapter = runtime.build_llm_adapter_from_env()
    assert isinstance(adapter, RealLLMAdapter)
    assert missing in caplog.text
    assert "LLM-key" not in caplog.text
    assert "LLM_ASTRA-key" not in caplog.text


def test_fallback_protocol_and_tuning_never_inherit_from_primary(monkeypatch):
    monkeypatch.delenv("LLM_ASTRA_WIRE_API")
    monkeypatch.delenv("LLM_ASTRA_PROVIDER")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "low")
    monkeypatch.setenv("LLM_THINKING_MODE", "enabled")
    monkeypatch.setenv("LLM_OUTLINE_FALLBACK_PROFILE", "LLM_ASTRA")
    fallback = runtime.build_llm_adapter_from_env()._fallback
    assert fallback._wire_api == "responses"
    assert fallback._reasoning_effort == "high"
    assert fallback._thinking_mode == "disabled"


def test_fallback_and_primary_pools_keep_their_own_credentials(monkeypatch):
    prefix = "LLM_CN_STORY_BIBLE"
    profile(monkeypatch, prefix)
    monkeypatch.delenv(f"{prefix}_API_KEY")
    monkeypatch.delenv("LLM_ASTRA_API_KEY")
    monkeypatch.setenv(f"{prefix}_API_KEY_01", "deepseek-pool-key")
    monkeypatch.setenv("LLM_ASTRA_API_KEY_01", "astra-pool-key")
    monkeypatch.setenv("LLM_API_KEY_01", "global-pool-key")
    monkeypatch.setenv(f"{prefix}_FALLBACK_PROFILE", "LLM_ASTRA")
    adapter = runtime.build_market_routed_role_adapter_from_env(
        "STORY_BIBLE", fallback=MockLLMAdapter(),
        default_timeout_seconds=600, default_max_retries=0,
    )._mainland
    for child, key in [(adapter._primary, "deepseek-pool-key"), (adapter._fallback, "astra-pool-key")]:
        assert isinstance(child, PooledLLMAdapter)
        assert [a._client.headers["authorization"] for a in child._adapters] == [f"Bearer {key}"]


@pytest.mark.parametrize("pooled", [False, True])
def test_dedicated_role_does_not_absorb_inherited_credential_pool(monkeypatch, pooled):
    profile(monkeypatch, "LLM_STORY_ARCHITECT")
    monkeypatch.setenv("LLM_STORY_ARCHITECT_API_KEY_01", "architect-pool-key")
    profile(monkeypatch, "LLM_CONTINUITY")
    if pooled:
        monkeypatch.delenv("LLM_CONTINUITY_API_KEY")
        monkeypatch.setenv("LLM_CONTINUITY_API_KEY_01", "continuity-pool-key")
    adapter = runtime.build_continuity_llm_adapter_from_env()
    children = adapter._adapters if pooled else [adapter]
    expected = "continuity-pool-key" if pooled else "LLM_CONTINUITY-key"
    assert [a._client.headers["authorization"] for a in children] == [f"Bearer {expected}"]


def test_generic_script_pool_survives_selector_and_selector_cache_changes(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY_01", "script-pool-key")
    monkeypatch.setenv("LLM_SCRIPT_FALLBACK_PROFILE", "LLM_ASTRA")
    adapter = unwrap_transport(runtime.build_script_generation_adapter_from_env())
    assert isinstance(adapter._primary, PooledLLMAdapter)
    assert adapter._primary._adapters[0]._client.headers["authorization"] == "Bearer script-pool-key"
    monkeypatch.setenv("LLM_SCRIPT_FALLBACK_PROFILE", "none")
    assert isinstance(unwrap_transport(runtime.build_script_generation_adapter_from_env()), PooledLLMAdapter)
    monkeypatch.delenv("LLM_SCRIPT_FALLBACK_PROFILE")
    assert isinstance(unwrap_transport(runtime.build_script_generation_adapter_from_env()), PooledLLMAdapter)


@pytest.mark.parametrize("primary_deadline,fallback_deadline,expected", [
    (None, None, 600), (420, None, 420), (None, 480, 480), (420, 480, 480),
])
def test_reverse_bible_failover_preserves_full_budget_and_explicit_deadlines(
    monkeypatch, primary_deadline, fallback_deadline, expected,
):
    prefix = "LLM_CN_STORY_BIBLE"
    profile(monkeypatch, prefix)
    monkeypatch.setenv(f"{prefix}_FALLBACK_PROFILE", "LLM_ASTRA")
    if primary_deadline:
        monkeypatch.setenv(f"{prefix}_REQUEST_DEADLINE_SECONDS", str(primary_deadline))
    if fallback_deadline:
        monkeypatch.setenv("LLM_ASTRA_REQUEST_DEADLINE_SECONDS", str(fallback_deadline))
    adapter = build_role(prefix)
    assert adapter._primary._request_deadline_seconds == (primary_deadline or 600)
    assert adapter._fallback._request_deadline_seconds == expected
    assert adapter._fallback._timeout_seconds == 300
    assert adapter._primary._max_retries == adapter._fallback._max_retries == 0


def test_reverse_inspiration_fallback_keeps_short_deadline_and_circuit_overrides(monkeypatch):
    prefix = "LLM_CN_INSPIRATION"
    monkeypatch.setenv(f"{prefix}_FALLBACK_PROFILE", "LLM_ASTRA")
    monkeypatch.setenv(f"{prefix}_FAILOVER_FAILURE_THRESHOLD", "3")
    monkeypatch.setenv(f"{prefix}_FAILOVER_COOLDOWN_SECONDS", "75")
    adapter = build_role(prefix)
    assert adapter._fallback._request_deadline_seconds == 45
    assert adapter._circuit_failure_threshold == 3
    assert adapter._circuit_cooldown_seconds == 75
    assert adapter._failover_on_request_deadline is True


def test_explicit_fallback_is_terminal_even_with_reverse_and_legacy_selectors(monkeypatch):
    profile(monkeypatch, "LLM_ASTRA_FALLBACK")
    monkeypatch.setenv("LLM_OUTLINE_FALLBACK_PROFILE", "LLM_ASTRA")
    monkeypatch.setenv("LLM_ASTRA_FALLBACK_PROFILE", "LLM")
    adapter = runtime.build_llm_adapter_from_env()
    assert isinstance(adapter._fallback, RealLLMAdapter)
    assert adapter._fallback.get_model_info().model_name == "gpt-6-astra"


@pytest.mark.parametrize("scope,expect_fallback", [("request", True), ("initial_draft", False)])
def test_configured_failover_only_retries_request_deadline(monkeypatch, scope, expect_fallback):
    monkeypatch.setenv("LLM_STORY_BIBLE_FALLBACK_PROFILE", "LLM_ASTRA")
    adapter = build_role("LLM_STORY_BIBLE")
    calls = []
    error = LLMRequestError("time budget exhausted", category="deadline", recoverable=False)
    error.deadline_scope = scope

    def primary(*args, **kwargs):
        calls.append("primary")
        raise error

    def fallback(*args, **kwargs):
        calls.append("fallback")
        return "recovered"

    monkeypatch.setattr(adapter._primary, "generate_text", primary)
    monkeypatch.setattr(adapter._fallback, "generate_text", fallback)
    strategy = GenerationStrategy.model_validate(build_strategy())
    if expect_fallback:
        assert adapter.generate_text("Full Bible", strategy=strategy) == "recovered"
        assert calls == ["primary", "fallback"]
    else:
        with pytest.raises(LLMRequestError) as caught:
            adapter.generate_text("Full Bible", strategy=strategy)
        assert caught.value is error
        assert calls == ["primary"]


@pytest.mark.parametrize("selection", ["LLM", "none", "not-a-profile"])
def test_duplicate_disabled_or_invalid_fallback_never_adds_a_route(monkeypatch, selection):
    monkeypatch.setenv("LLM_OUTLINE_FALLBACK_PROFILE", selection)
    assert isinstance(runtime.build_llm_adapter_from_env(), RealLLMAdapter)


def test_explicit_selector_can_disable_legacy_astra_failover(monkeypatch):
    profile(monkeypatch, "LLM", "gpt-6-astra")
    profile(monkeypatch, "LLM_ASTRA_FALLBACK")
    monkeypatch.setenv("LLM_OUTLINE_FALLBACK_PROFILE", "none")
    assert isinstance(runtime.build_llm_adapter_from_env(), RealLLMAdapter)


def test_market_selector_can_replace_an_inherited_roles_backup(monkeypatch):
    profile(monkeypatch, "LLM_OTHER", "other-backup")
    monkeypatch.setenv("LLM_CREATIVE_FALLBACK_PROFILE", "LLM_OTHER")
    inherited = runtime.build_creative_llm_adapter_from_env()
    monkeypatch.setenv("LLM_CN_INSPIRATION_FALLBACK_PROFILE", "LLM_ASTRA")
    routed = runtime.build_market_routed_role_adapter_from_env(
        "INSPIRATION", fallback=inherited, default_timeout_seconds=60, default_max_retries=0,
    )
    assert routed._overseas is inherited
    assert routed._mainland._primary is inherited._primary
    assert routed._mainland._fallback.get_model_info().model_name == "gpt-6-astra"


@pytest.mark.parametrize("fallback_fails", [False, True])
def test_mock_transport_fails_over_once_with_distinct_credentials_and_protocols(monkeypatch, fallback_fails):
    requests = []

    def handler(request):
        requests.append(request)
        if request.url.host == "llm.test" or fallback_fails:
            return httpx.Response(502, json={"error": {"message": "route unavailable"}})
        return httpx.Response(200, json={"output": [{
            "type": "message", "content": [{"type": "output_text", "text": '{"title":"Recovered"}'}],
        }]})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(runtime, "RealLLMAdapter", lambda **kwargs: RealLLMAdapter(**kwargs, transport=transport))
    profile(monkeypatch, "LLM_ASTRA_FALLBACK")
    monkeypatch.setenv("LLM_OUTLINE_FALLBACK_PROFILE", "LLM_ASTRA")
    monkeypatch.setenv("LLM_ASTRA_FALLBACK_PROFILE", "LLM")
    adapter = runtime.build_llm_adapter_from_env()
    strategy = GenerationStrategy.model_validate(build_strategy())
    schema = {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]}
    if fallback_fails:
        with pytest.raises(LLMRequestError):
            adapter.generate_structured_output("Return JSON.", strategy=strategy, output_schema=schema)
    else:
        result = adapter.generate_structured_output("Return JSON.", strategy=strategy, output_schema=schema)
        assert result["title"] == "Recovered"
        assert result["_meta"]["model_failover_used"] is True
    assert [r.url.path for r in requests] == ["/v1/chat/completions", "/v1/responses"]
    assert [r.headers["authorization"] for r in requests] == ["Bearer LLM-key", "Bearer LLM_ASTRA-key"]
    payloads = [json.loads(r.content) for r in requests]
    assert [p["model"] for p in payloads] == ["deepseek-v4-pro", "gpt-6-astra"]
    assert "messages" in payloads[0] and "input" in payloads[1]
