from copy import deepcopy
import json
from pathlib import Path

import httpx
import pytest

from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine.generation_service import (
    InvalidDraftMasterScriptOutputError, ScriptGenerationService,
)
from app.modules.script_engine.llm_adapter import LLMRequestError, RealLLMAdapter
from app.modules.script_engine.models import GenerationStrategy, ScriptReleaseRegion
from scripts.probe_production_counts import (
    ReplayCountService, capture_count_repairs, failure, replay_count_repair,
)


@pytest.fixture
def sample(monkeypatch):
    def no_http(*args, **kwargs):
        pytest.fail("Offline count regression attempted an HTTP request")

    monkeypatch.setattr(httpx.Client, "send", no_http)
    return json.loads((Path(__file__).parent / "fixtures/production_count_repair/gemini_shortfall.v1.json").read_text())


def ensure(service, source):
    return service._ensure_episode_production_counts(
        output=source["output"], strategy=GenerationStrategy.model_validate(source["strategy"]),
        release_region=ScriptReleaseRegion(source["release_region"]),
        target_duration_seconds=source["target_duration_seconds"],
    )


def test_captured_empty_gemini_patches_fail_without_changing_the_source(sample):
    source = deepcopy(sample["source"])
    service = ReplayCountService(sample["failed_patches"])
    with pytest.raises(InvalidDraftMasterScriptOutputError):
        ensure(service, source)
    assert len(service.requests) == 2
    assert source == sample["source"]


def test_captured_gemini_repair_preserves_ledgers_bilingual_fields_and_order(sample):
    service = ReplayCountService([sample["repaired_patch"]])
    source = deepcopy(sample["source"])
    result = ensure(service, source)
    validated = LLMGeneratedDraftMasterScript.model_validate({key: value for key, value in result.items() if key != "_meta"})
    assert service._episode_production_counts(validated) == (3, 25, 15)
    assert len(service.requests) == 1
    assert result["_meta"]["episode_production_count_duration_preserved"] is True
    for key, value in source["output"].items():
        if key not in {"scenes", "_meta"}:
            assert result[key] == value
    for original, scene in zip(source["output"]["scenes"], validated.scenes):
        assert original["scene_number"] == scene.scene_number
        assert all(line.chinese_translation and line.chinese_character_name for line in scene.dialogues)
        assert set(scene.body_order) == {
            *(f"action:{index}" for index in range(len(scene.character_actions))),
            *(f"dialogue:{index}" for index in range(len(scene.dialogues))),
        }
        assert len(scene.body_order) == len(set(scene.body_order))
    assert source == sample["source"]


def test_count_fallback_does_not_accept_a_patch_that_breaks_runtime(sample):
    patch = deepcopy(sample["repaired_patch"])
    for scene in patch["output"]["scenes"]:
        for line in scene["dialogues"]:
            line["text"] = "Keep the door shut. " * 12
    service = ReplayCountService([patch, patch])
    with pytest.raises(InvalidDraftMasterScriptOutputError, match="时长"):
        ensure(service, sample["source"])
    assert len(service.requests) == 2


def test_capture_and_cross_process_format_replay_are_isolated(sample, tmp_path, monkeypatch):
    original_ensure = ScriptGenerationService._ensure_episode_production_counts
    original_parse = RealLLMAdapter._parse_json_content

    def generate(self, **kwargs):
        adapter = RealLLMAdapter.__new__(RealLLMAdapter)
        adapter._model_name = "offline-count-parser"
        return adapter._parse_json_content(json.dumps(sample["repaired_patch"]["output"]),
                                           output_schema=kwargs["output_schema"])

    monkeypatch.setattr(ScriptGenerationService, "_generate_postprocess_output", generate)
    service = ScriptGenerationService.__new__(ScriptGenerationService)
    service._production_count_llm_adapter = None
    service._repair_llm_adapter = None
    with capture_count_repairs(tmp_path):
        expected = ensure(service, sample["source"])
    assert ScriptGenerationService._ensure_episode_production_counts is original_ensure
    assert ScriptGenerationService._generate_postprocess_output is generate
    assert RealLLMAdapter._parse_json_content is original_parse
    directory, = (tmp_path / "count_repairs").iterdir()
    record = json.loads((directory / "patch_01.json").read_text())
    assert json.loads(record["raw_responses"][0]) == sample["repaired_patch"]["output"]
    replay = replay_count_repair(directory)
    assert replay["output"] == expected
    assert replay["patch_calls"] == 1
    assert replay["provider_requests"] == 0


def test_replay_preserves_transport_failure_category_and_retry_decision(sample):
    error = LLMRequestError("Gateway exhausted", category="failover_exhausted", recoverable=True, status_code=502)
    error.stream_fallback_attempted = True
    service = ReplayCountService([failure(error)])
    with pytest.raises(InvalidDraftMasterScriptOutputError):
        ensure(service, sample["source"])
    assert len(service.requests) == 1
    service = ReplayCountService([failure(RuntimeError("Unsupported probe failure"))])
    with pytest.raises(AssertionError, match="Unsupported captured error"):
        ensure(service, sample["source"])
