"""Completed modification bodies survive bounded repairs to their ledgers."""

from copy import deepcopy
import json

import pytest
from pydantic import ValidationError

from app.modules.master_script.models import CharacterKnowledgeState, LLMGeneratedDraftMasterScript
from app.modules.script_engine import draft_contract
from app.modules.script_engine.generation_service import InvalidDraftMasterScriptOutputError, ScriptGenerationService
from app.modules.script_engine.json_schema_contract import compact_json_schema
from app.modules.script_engine.llm_adapter import LLMRequestError, LLMStructuredOutputError
from app.modules.script_engine.models import ScriptDraftModificationRequest, ScriptGenerationDraftRequest
from tests.test_script_generation_service import StubRealScriptAdapter, seed_dependencies


class OutputAdapter(StubRealScriptAdapter):
    def __init__(self, output):
        self.output = output
        self.calls = []

    def generate_structured_output(self, prompt, *, strategy, output_schema=None):
        self.calls.append((prompt, strategy, deepcopy(output_schema)))
        if isinstance(self.output, Exception):
            raise self.output
        return deepcopy(self.output)


@pytest.fixture
def modification_case():
    service, content_spec_id = seed_dependencies()
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en", desired_scene_count=3,
    ))
    strategy = service._generation_strategy_repository.get(source.generation_strategy_id)
    body = StubRealScriptAdapter().generate_structured_output("fixture", strategy=strategy)
    body = LLMGeneratedDraftMasterScript.model_validate(draft_contract.without_metadata(
        service._normalize_mechanical_draft_contract(body)
    )).model_dump(mode="json")
    states = body["character_state_updates"]
    states[0]["knowledge_states"] = [
        {"knowledge_key": f"payment.fact_{index}", "statement": "The payment record names her mother.", "status": "known"}
        for index in range(3)
    ]
    states.append({**deepcopy(states[0]), "character_name": "Damian"})
    # Synthetic invalid labels reproduce the observed two nested error paths;
    # the actual R101 values were not retained and are deliberately not guessed.
    invalid = deepcopy(body)
    invalid["character_state_updates"][0]["knowledge_states"][2]["status"] = "unconfirmed"
    invalid["character_state_updates"][1]["knowledge_states"][1]["status"] = "observed"
    candidate = OutputAdapter(invalid)
    repair = OutputAdapter({"character_state_updates": states})
    fallback = OutputAdapter(AssertionError("full-episode fallback must not run"))
    service._conversation_editor_llm_adapter = candidate
    service._repair_llm_adapter = repair
    service._contract_fallback_llm_adapter = fallback
    request = ScriptDraftModificationRequest(
        source_generation_run=source, source_draft_master_script=source.draft_master_script,
        instruction="Rewrite this episode from the approved plan.",
    )
    return service, request, body, invalid, candidate, repair, fallback, strategy


def test_full_modification_repairs_only_failed_ledger_and_preserves_complete_body(modification_case):
    service, request, body, invalid, candidate, repair, fallback, _ = modification_case
    source_before = request.model_dump(mode="json")
    result = service.modify_draft(request).candidate_generation_run

    assert len(candidate.calls) == len(repair.calls) == 1
    assert fallback.calls == []
    prompt, strategy, schema = repair.calls[0]
    assert set(schema["properties"]) == {"character_state_updates"}
    assert schema["required"] == ["character_state_updates"]
    assert "Every scene, action, dialogue and body_order" in prompt
    assert strategy.max_tokens == candidate.calls[0][1].max_tokens == 32_000
    assert draft_contract.without_metadata(result.llm_raw_output) == body
    assert json.dumps(result.llm_raw_output["scenes"], ensure_ascii=False) == json.dumps(invalid["scenes"], ensure_ascii=False)
    assert result.llm_raw_output["_meta"]["draft_contract_model_pass_count"] == 1
    assert request.model_dump(mode="json") == source_before


@pytest.mark.parametrize("fault", ["still_invalid", "extra_root", "complete_episode", "malformed_json", "empty_json", "transport"])
def test_failed_modification_patch_never_regenerates_or_accepts_invalid_candidate(modification_case, fault):
    service, request, body, invalid, candidate, repair, fallback, _ = modification_case
    if fault == "still_invalid":
        repair.output = {"character_state_updates": invalid["character_state_updates"]}
    elif fault == "extra_root":
        repair.output = {**repair.output, "scenes": body["scenes"]}
    elif fault == "complete_episode":
        repair.output = body
    elif fault == "malformed_json":
        repair.output = LLMStructuredOutputError("Invalid JSON", raw_content="{broken")
    elif fault == "empty_json":
        repair.output = LLMStructuredOutputError("No JSON", empty_response=True)
    else:
        repair.output = LLMRequestError("Gateway failed", category="gateway_deadline", status_code=524)
    with pytest.raises(LLMRequestError if fault == "transport" else InvalidDraftMasterScriptOutputError):
        service.modify_draft(request)
    assert len(candidate.calls) == len(repair.calls) == 1
    assert fallback.calls == []
    assert candidate.output == invalid


def test_field_only_patch_cannot_repair_body_order_by_changing_completed_scenes(modification_case):
    service, request, body, _, candidate, repair, fallback, _ = modification_case
    candidate.output = deepcopy(body)
    scene = candidate.output["scenes"][0]
    scene["body_order"].remove("action:0")
    repair.output = {"scenes": [{
        "scene_number": scene["scene_number"], "body_order": body["scenes"][0]["body_order"],
    }]}
    with pytest.raises(InvalidDraftMasterScriptOutputError, match="changed the screenplay"):
        service.modify_draft(request)
    assert len(repair.calls) == 1
    assert fallback.calls == []
    assert "action:0" not in candidate.output["scenes"][0]["body_order"]


def test_incomplete_root_is_rejected_without_asking_for_complete_regeneration(modification_case):
    service, _, _, _, _, repair, fallback, strategy = modification_case
    with pytest.raises(InvalidDraftMasterScriptOutputError, match="no full-episode fallback"):
        service._ensure_valid_draft_contract(output={"scenes": []}, strategy=strategy, patch_only=True)
    assert repair.calls == fallback.calls == []


def test_same_patch_preserves_finale_ending_and_does_not_restore_a_hook(modification_case):
    service, _, _, invalid, _, repair, fallback, strategy = modification_case
    invalid["ending_mode"] = "series_finale"
    invalid["next_episode_question"] = None
    invalid["scenes"][-1]["cliffhanger"] = False
    result = service._ensure_valid_draft_contract(
        output=invalid, strategy=strategy, ending_mode="series_finale", patch_only=True,
    )
    assert result["ending_mode"] == "series_finale"
    assert result["next_episode_question"] is None
    assert result["scenes"] == invalid["scenes"]
    assert len(repair.calls) == 1
    assert fallback.calls == []


def test_story_line_extra_field_uses_same_bounded_root_repair(modification_case):
    service, request, body, _, candidate, repair, fallback, _ = modification_case
    body["story_line_updates"] = [{
        "story_line_id": f"storyline.payment_{index}", "status": "active",
        "progress_summary": "The displayed payment record names her mother.",
        "change_cause": "Damian shows the original payment at the altar.",
        "next_required_step": "Ask her mother to account for the payment.",
        "evidence_scene_numbers": [3],
    } for index in range(2)]
    body = LLMGeneratedDraftMasterScript.model_validate(body).model_dump(mode="json")
    candidate.output = deepcopy(body)
    candidate.output["story_line_updates"][1]["next_next_required_step"] = "A provider-only unknown field."
    repair.output = {"story_line_updates": body["story_line_updates"]}
    result = service.modify_draft(request).candidate_generation_run
    assert len(candidate.calls) == len(repair.calls) == 1
    assert set(repair.calls[0][2]["properties"]) == {"story_line_updates"}
    assert draft_contract.without_metadata(result.llm_raw_output) == body
    assert result.llm_raw_output["scenes"] == candidate.output["scenes"]
    assert fallback.calls == []


def test_requested_missing_root_field_can_be_restored_without_changing_body(modification_case):
    service, request, body, _, candidate, repair, fallback, _ = modification_case
    candidate.output = deepcopy(body)
    candidate.output.pop("tone")
    repair.output = {"tone": body["tone"]}
    result = service.modify_draft(request).candidate_generation_run
    assert draft_contract.without_metadata(result.llm_raw_output) == body
    assert len(repair.calls) == 1
    assert fallback.calls == []


def test_existing_exact_aliases_need_no_repair_but_unknown_status_is_not_coerced(modification_case):
    service, request, body, _, candidate, repair, fallback, _ = modification_case
    candidate.output = deepcopy(body)
    aliases = [("已知", "known"), ("相信", "believed"), ("怀疑", "suspected"), ("证伪", "disproved"), ("遗忘", "forgotten")]
    candidate.output["character_state_updates"][0]["knowledge_states"] = [
        {"knowledge_key": f"payment.alias_{index}", "statement": "The record identifies a payment.", "status": alias}
        for index, (alias, _) in enumerate(aliases)
    ]
    result = service.modify_draft(request).candidate_generation_run
    assert [entry.status for entry in result.draft_master_script.character_state_updates[0].knowledge_states] == [status for _, status in aliases]
    assert repair.calls == fallback.calls == []
    unknown = deepcopy(candidate.output)
    unknown["character_state_updates"][0]["knowledge_states"][0]["status"] = "unconfirmed"
    normalized = service._normalize_mechanical_draft_contract(unknown)
    assert normalized["character_state_updates"][0]["knowledge_states"][0]["status"] == "unconfirmed"
    with pytest.raises(ValidationError):
        LLMGeneratedDraftMasterScript.model_validate(draft_contract.without_metadata(normalized))


def test_knowledge_status_schema_and_deepseek_contract_expose_exact_existing_set():
    expected = ["known", "believed", "suspected", "disproved", "forgotten"]
    schema = compact_json_schema(ScriptGenerationService._initial_draft_output_schema())
    assert schema["$defs"]["CharacterKnowledgeState"]["properties"]["status"]["enum"] == expected
    for status in expected:
        assert CharacterKnowledgeState(knowledge_key="payment.sender", statement="The sender is named.", status=status).status == status
    for status in ("unknown", "unconfirmed", "KNOWN", "已知", "", None, 1):
        with pytest.raises(ValidationError):
            CharacterKnowledgeState(knowledge_key="payment.sender", statement="The sender is named.", status=status)
