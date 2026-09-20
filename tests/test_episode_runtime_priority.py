"""Production runtime takes precedence over optional character-count padding."""
from copy import deepcopy

import pytest

from app.modules.master_script.models import LLMGeneratedDraftMasterScript
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.llm_adapter import LLMRequestError, MockLLMAdapter
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from tests.test_script_generation_service import (
    ExpandingScriptBodyAdapter, StubRealScriptAdapter, seed_dependencies,
)


class PatchAdapter(MockLLMAdapter):
    def __init__(self, output=None, error=None):
        self.output, self.error, self.calls = output, error, 0

    def generate_structured_output(self, prompt, *, strategy, output_schema=None):
        self.calls += 1
        if self.error is not None:
            raise self.error
        assert self.output is not None, "No optional model call expected"
        return {
            "scenes": [
                {key: deepcopy(scene[key]) for key in
                 ("scene_number", "character_actions", "body_order", "dialogues") if key in scene}
                for scene in self.output["scenes"]
            ]
        }


@pytest.fixture
def drafts():
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get("strategy.tiktok.service_generation.v1")
    valid = StubRealScriptAdapter().generate_structured_output("draft", strategy=strategy)
    short = ExpandingScriptBodyAdapter().generate_structured_output("draft", strategy=strategy)
    assert duration(valid) == 111
    assert duration(short) == 60
    return strategy, valid, short


def duration(output):
    body = LLMGeneratedDraftMasterScript.model_validate({k: v for k, v in output.items() if k != "_meta"})
    return estimate_screenplay_duration(body).total_seconds


def ensure_counts(service, output, strategy):
    return service._ensure_episode_production_counts(output=output, strategy=strategy)


def test_playable_body_keeps_character_shortfall_without_padding(drafts):
    strategy, valid, _ = drafts
    adapter = PatchAdapter()
    service, _ = seed_dependencies(script_editor_llm_adapter=adapter)
    scenes = deepcopy(valid["scenes"])
    result = service._ensure_script_body_length(output=valid, strategy=strategy, target_characters=10000)
    assert result["scenes"] == scenes
    assert adapter.calls == 0
    assert result["_meta"]["script_body_completion_deferred_reason"] == "production_runtime_priority"
    assert result["_meta"]["script_body_scale_warning"] is True
    assert result["_meta"]["script_body_characters"] < 2500


def test_excess_units_go_to_required_repair_instead_of_character_expansion(drafts):
    strategy, valid, short = drafts
    for index in range(11):
        short["scenes"][0]["dialogues"].append(deepcopy(short["scenes"][0]["dialogues"][0]))
    short["scenes"][0]["body_order"] = []
    adapter = PatchAdapter()
    service, _ = seed_dependencies(script_editor_llm_adapter=adapter)
    original = deepcopy(short["scenes"])
    result = service._ensure_script_body_length(output=short, strategy=strategy, target_characters=10000)
    assert result["scenes"] == original
    assert adapter.calls == 0
    assert result["_meta"]["script_body_scale_warning"] is True


@pytest.mark.parametrize("too_long", [False, True])
def test_correct_counts_still_require_runtime_convergence(drafts, too_long):
    strategy, valid, short = drafts
    source = deepcopy(valid if too_long else short)
    if too_long:
        for scene in source["scenes"]:
            for line in scene["dialogues"]:
                line["text"] += " Please tell me what happened before the door was locked."
    assert duration(source) > 115 if too_long else duration(source) < 75
    adapter = PatchAdapter(valid)
    service, _ = seed_dependencies(production_count_llm_adapter=adapter)
    result = ensure_counts(service, source, strategy)
    assert duration(result) == 111
    assert adapter.calls == 1
    assert result["_meta"]["episode_production_count_model_pass_count"] == 1


def test_short_body_can_complete_without_exceeding_production_contract(drafts):
    strategy, valid, short = drafts
    adapter = PatchAdapter(valid)
    service, _ = seed_dependencies(script_editor_llm_adapter=adapter)
    result = service._ensure_script_body_length(output=short, strategy=strategy, target_characters=4800)
    assert adapter.calls == 1
    assert duration(result) == 111
    assert result["_meta"]["script_body_expanded"] is True


def test_overexpanded_candidate_is_discarded_then_required_repair_succeeds(drafts):
    strategy, valid, short = drafts
    bloated = deepcopy(valid)
    for scene in bloated["scenes"]:
        for line in scene["dialogues"]:
            line["text"] += " Please tell me what happened before the door was locked."
    original = deepcopy(short)
    expander, repair = PatchAdapter(bloated), PatchAdapter(valid)
    service, _ = seed_dependencies(script_editor_llm_adapter=expander, production_count_llm_adapter=repair)
    result = service._run_valid_draft_postprocess_stage(output=short, phase="body_length",
        operation=lambda checkpoint: service._ensure_script_body_length(
            output=checkpoint, strategy=strategy, target_characters=4800))
    assert result["scenes"] == original["scenes"]
    assert "body_length" in result["_meta"]["deferred_postprocess_phases"]
    result = ensure_counts(service, result, strategy)
    assert duration(result) == 111
    assert expander.calls == repair.calls == 1


def test_exhausted_provider_failure_keeps_503_classification_and_original(drafts):
    strategy, _, short = drafts
    error = LLMRequestError("system cpu overloaded", status_code=503,
                            category="provider_gateway", recoverable=True)
    error.route_failure_categories = ("provider_gateway", "provider_gateway")
    adapter = PatchAdapter(error=error)
    service, _ = seed_dependencies(production_count_llm_adapter=adapter)
    original = deepcopy(short)
    with pytest.raises(LLMRequestError) as caught:
        ensure_counts(service, short, strategy)
    assert caught.value is error
    assert caught.value.status_code == 503
    assert adapter.calls == 1
    assert short == original
