"""Exercise the documented configuration layouts without provider requests."""

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

from app import dependencies
from app.api.routes.input_readiness import get_input_readiness_service
from app.modules.script_engine.llm_adapter import (
    AdaptiveTransportLLMAdapter, MarketRoutedLLMAdapter, ModelFailoverLLMAdapter,
)


ROOT = Path(__file__).resolve().parents[1]


def load_template_environment(layout):
    paths = (
        [ROOT / "config/model-config.env.example"]
        if layout == "merged"
        else sorted((ROOT / "config/model-config.parts").glob("*.env.example"))
    )
    result = subprocess.run(
        ["bash", "-c", 'set -a\nfor config_part in "$@"; do source "$config_part"; done\n'
         '"$CONFIG_TEST_PYTHON" -c \'import os,json; print(json.dumps(dict(os.environ)))\'',
         "template-check", *(str(path) for path in paths)],
        env={"PATH": os.environ.get("PATH", ""), "CONFIG_TEST_PYTHON": sys.executable},
        check=True, capture_output=True, text=True,
    )
    return json.loads(result.stdout)


@pytest.mark.parametrize("layout", ["merged", "parts"])
def test_config_templates_wire_requested_editors_and_astra_fallbacks(layout, monkeypatch):
    for name in os.environ:
        if name.startswith("LLM_"):
            monkeypatch.delenv(name)
    for name, value in load_template_environment(layout).items():
        if name.startswith(("LLM_", "SCRIPT_")):
            monkeypatch.setenv(name, value)
    monkeypatch.setattr(dependencies, "get_long_story_service", lambda: None)
    dependencies._get_story_planning_service.cache_clear()
    dependencies._get_script_generation_service.cache_clear()
    try:
        planning = dependencies.get_story_planning_service()
        assert planning._episode_plan_chunk_size == 1
        classifier = get_input_readiness_service()._llm_adapter
        assert classifier.get_model_info().model_name == "deepseek-v4-pro"
        assert classifier._wire_api == "chat_completions"
        assert classifier._effective_reasoning_effort == "none"
        assert classifier._request_deadline_seconds == 60
        dialogue = dependencies.get_bilingual_script_view_service()._llm_adapter
        for route in (dialogue._mainland, dialogue._overseas):
            assert route.get_model_info().model_name == "deepseek-v4-pro"
            assert route._effective_reasoning_effort == "none"
        assert planning._planning_editor_llm_adapter.get_model_info().model_name == "deepseek-v4-pro"
        for role in ("_creative_llm_adapter", "_story_bible_llm_adapter",
                     "_story_architect_llm_adapter", "_episode_plan_llm_adapter"):
            for route in (getattr(planning, role)._mainland, getattr(planning, role)._overseas):
                assert isinstance(route, ModelFailoverLLMAdapter)
                assert route._primary.get_model_info().model_name == "deepseek-v4-pro"
                assert route._primary._wire_api == "chat_completions"
                assert route._primary._send_response_format is True
                assert route._fallback.get_model_info().model_name == "gpt-6-astra"
                assert route._fallback._wire_api == "responses"
                assert not isinstance(route._fallback, ModelFailoverLLMAdapter)
                if role == "_story_bible_llm_adapter":
                    assert route._primary._request_deadline_seconds == 600
                    assert route._fallback._request_deadline_seconds == 600
        for route in (planning._inspiration_llm_adapter._mainland, planning._inspiration_llm_adapter._overseas):
            assert isinstance(route, ModelFailoverLLMAdapter)
            assert route._primary.get_model_info().model_name == "deepseek-v4-pro"
            assert route._primary._request_deadline_seconds == 45
            assert route._fallback.get_model_info().model_name == "gpt-6-astra"
            assert route._fallback._effective_reasoning_effort == "max"
            assert route._fallback._send_response_format is True
            assert route._fallback._request_deadline_seconds == 45
            assert route._failover_on_request_deadline is True
        generation = dependencies.get_script_generation_service()
        editor = generation._conversation_editor_adapter()
        assert isinstance(editor, MarketRoutedLLMAdapter)
        assert editor._mainland.get_model_info().model_name == "deepseek-v4-pro"
        assert editor._mainland._send_response_format is True
        assert editor._overseas.get_model_info().model_name == "deepseek-v4-pro"
        assert editor._overseas._wire_api == "chat_completions"
        assert generation._script_editor_enabled is False
        for adapter in (generation._llm_adapter, generation._repair_llm_adapter):
            assert adapter._mainland.get_model_info().model_name == "deepseek-v4-pro"
            mainland = adapter._mainland
            if isinstance(mainland, AdaptiveTransportLLMAdapter):
                mainland = mainland._adapter
            assert mainland._send_response_format is True
            assert adapter._overseas.get_model_info().model_name == "deepseek-v4-pro"
    finally:
        dependencies._get_story_planning_service.cache_clear()
        dependencies._get_script_generation_service.cache_clear()


def test_merged_and_split_model_templates_export_identical_runtime_settings():
    def runtime_values(layout):
        return {name: value for name, value in load_template_environment(layout).items()
                if name.startswith(("LLM_", "SCRIPT_", "CFG_"))}
    assert runtime_values("merged") == runtime_values("parts")
