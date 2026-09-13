import logging
import json
import hashlib

import pytest

from copy import deepcopy

from scripts.run_real_generation_probe import (
    _ProbeRouteLog,
    _ensure_real_generation_runtime,
    replay_result_digest,
    screenplay_markdown,
)
from scripts.real_generation_probe_continuity import project_probe_continuity
from scripts.real_generation_probe_fixture import _overseas_fixture, _plans, fixture_metadata


def test_probe_v1_planning_baseline_is_preserved():
    encoded = json.dumps(_plans(), sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    assert hashlib.sha256(encoded).hexdigest() == "d049a1b3082b622ed108abd337715b5333a6b717833a1ec45547fce8fea1683d"
    assert _plans("v1") == _plans()
    with pytest.raises(ValueError, match="Unknown probe fixture"):
        fixture_metadata("unversioned")


def test_probe_v2_survives_overseas_contract_projection_with_linked_states():
    from app.modules.script_engine.models import ApprovedEpisodePlanContext

    original = _plans()
    plans = _overseas_fixture(_plans("v2"))
    contexts = [ApprovedEpisodePlanContext.model_validate({
        key: value for key, value in plan.items() if key in ApprovedEpisodePlanContext.model_fields
    }) for plan in plans]
    assert contexts[0].exit_state == contexts[1].entry_state
    assert contexts[1].exit_state == contexts[2].entry_state
    for plan, context in zip(plans, contexts):
        assert context.layer_contracts.meets_contract
        assert context.layer_contracts.model_dump(mode="json") == plan["layer_contracts"]
        assert all(ref.startswith("character.") and ref not in {
            "character.su_wan", "character.gu_chenzhou", "character.zhou_ning",
        } for ref in plan["character_refs"])
    assert all(plans[1]["scene_execution_plan"][index]["scene_heading"].startswith("EXT.") for index in (0, 2))
    assert _plans() == original


def test_probe_diagnostics_redact_credentials_and_endpoint(tmp_path, monkeypatch):
    secret = "probe-private-key-should-never-be-written"
    monkeypatch.setenv("LLM_OVERSEAS_SCRIPT_API_KEY", secret)
    destination = tmp_path / "diagnostics.log"
    handler = _ProbeRouteLog(destination)
    handler.emit(logging.LogRecord(
        "probe", logging.WARNING, "", 1,
        "LLM route request finished gateway=private.example detail=%s url=https://private.example/path",
        (secret,), None,
    ))
    text = destination.read_text()
    assert secret not in text
    assert "private.example" not in text
    assert "[REDACTED]" in text


def test_probe_runtime_gate_uses_effective_market_script_route(monkeypatch):
    from app.llm_runtime import build_market_routed_role_adapter_from_env

    class Route:
        def __init__(self, provider):
            self.provider = provider

        def get_model_info(self):
            from app.modules.script_engine.llm_adapter import LLMModelInfo

            return LLMModelInfo(
                provider=self.provider,
                model_name="configured-script",
                supports_structured_output=True,
                max_context_tokens=128_000,
            )

    monkeypatch.setattr(
        "app.llm_runtime.build_script_generation_adapter_from_env",
        lambda: Route("mock"),
    )
    monkeypatch.setattr(
        "app.llm_runtime.build_market_routed_role_adapter_from_env",
        lambda role, **kwargs: Route("real-overseas"),
    )

    # The base runtime is mock, but the selected overseas market route is real.
    _ensure_real_generation_runtime("overseas")


def test_probe_runtime_gate_rejects_effective_market_mock_before_generation(monkeypatch):
    class Route:
        def get_model_info(self):
            from app.modules.script_engine.llm_adapter import LLMModelInfo

            return LLMModelInfo(
                provider="mock",
                model_name="mock-script-generator",
                supports_structured_output=True,
                max_context_tokens=128_000,
            )

    monkeypatch.setattr(
        "app.llm_runtime.build_script_generation_adapter_from_env",
        lambda: Route(),
    )
    monkeypatch.setattr(
        "app.llm_runtime.build_market_routed_role_adapter_from_env",
        lambda role, **kwargs: Route(),
    )

    with pytest.raises(RuntimeError, match="effective overseas script route is mock"):
        _ensure_real_generation_runtime("overseas")


def test_probe_export_preserves_body_order_and_paired_dialogue():
    draft = {"title": "Probe", "scenes": [{
        "scene_number": 1, "slug": "INT. HALL - NIGHT",
        "character_actions": ["First action.", "Last action."],
        "dialogues": [{"character_name": "Eve Hart", "chinese_character_name": "伊芙",
                       "text": "Keep the original.", "chinese_translation": "保留原件。"}],
        "body_order": ["action:0", "dialogue:0", "action:1"],
    }]}
    result = screenplay_markdown(draft, 1)
    assert "伊芙（EVE HART）" in result
    assert result.index("First action.") < result.index("Keep the original.")
    assert result.index("Keep the original.") < result.index("保留原件。") < result.index("Last action.")


def test_probe_replay_accepts_checkpoint_debug_compaction_without_mutation():
    original = {"data": {
        "draft_master_script": {"title": "Unchanged"},
        "llm_raw_output": {"title": "Unchanged"},
        "prompt_build_result": {"prompt_text": "Full prompt", "rendered_variables": {"genre": "drama"},
                                "selected_prompt_ids": ["draft.v1"]},
    }}
    before = deepcopy(original)
    restored = deepcopy(original)
    restored["data"]["llm_raw_output"] = {}
    restored["data"]["prompt_build_result"].update(
        prompt_text="Prompt omitted after validated Agent checkpoint.", rendered_variables={},
    )
    assert replay_result_digest(original) == replay_result_digest(restored)
    assert original == before


def test_probe_replay_rejects_changes_to_prose_or_stable_prompt_metadata():
    original = {"data": {"draft_master_script": {"title": "Original"},
                         "prompt_build_result": {"selected_prompt_ids": ["draft.v1"]}}}
    edited = deepcopy(original)
    edited["data"]["draft_master_script"]["title"] = "Changed"
    assert replay_result_digest(original) != replay_result_digest(edited)
    edited = deepcopy(original)
    edited["data"]["prompt_build_result"]["selected_prompt_ids"] = ["draft.v2"]
    assert replay_result_digest(original) != replay_result_digest(edited)


def _continuity_bridge_input():
    from app.modules.master_script.models import DraftMasterScript
    from tests.test_master_script_models import build_draft_payload

    draft = build_draft_payload()
    draft["characters"] = [{"name": "Eve Hart", "role": "Investigator", "description": "Protects witnesses.",
                            "motivation": "Protect the witness."}]
    draft["character_state_updates"] = [{
        "character_name": "Eve Hart", "life_status": "dead", "current_goal": "Protect the witness.", "emotional_state": "unknown",
        "change_summary": "Died at the warehouse.", "change_cause": "The roof collapsed.",
        "evidence_scene_numbers": [1],
    }]
    draft["scenes"][0]["character_actions"] = ["Eve Hart dies beneath the collapsed roof."]
    draft["scenes"][0]["dialogues"] = [{"character_name": "Eve Hart", "text": "Save the witness.", "intent": "protect"}]
    draft = DraftMasterScript.model_validate(draft).model_dump(mode="json")
    workspace = {
        "id": "probe.bridge", "creativePrompt": "Protect the witness.",
        "storyBibleVersion": 1, "storyBibleStatus": "approved",
        "characters": [{"id": "eve", "name": "Eve Hart", "age": "", "gender": "", "role": "Investigator",
                        "background": "", "appearance": "", "description": "Protects witnesses.", "source": "user"}],
        "storyLines": [], "characterRelationships": [], "continuityStates": [],
        "episodes": [{"id": "episode.1", "episodeNumber": 1, "status": "saved",
                      "generationRun": {"draft_master_script": draft, "episode_context": {"episode_number": 1}},
                      "workingDraftJson": json.dumps(draft), "hasLocalDraftEdits": False}],
    }
    bible = {"story_project_id": "probe.bridge", "status": "approved", "version": 1,
             "character_registry": [{"character_ref": "character.eve", "name": "Eve Hart", "role": "Investigator"}],
             "character_arc_targets": [], "story_lines": [], "relationships": []}
    return workspace, bible


def test_real_product_projection_reaches_backend_conflict_check():
    from app.modules.master_script.models import DraftMasterScript
    from app.modules.script_engine.continuity_qc import evaluate_episode_continuity
    from app.modules.script_engine.models import EpisodeGenerationContext

    workspace, bible = _continuity_bridge_input()
    original = deepcopy(workspace)
    result = project_probe_continuity(workspace, bible, {"characterRefs": ["character.eve"]})
    assert workspace == original
    assert result["workspace"]["episodes"] == original["episodes"]
    assert result["workspace"]["characters"][0]["stateHistory"][0]["status"] == "provisional"
    assert result["memoryRecall"]["through_episode_number"] == 1
    next_draft = deepcopy(workspace["episodes"][0]["generationRun"]["draft_master_script"])
    next_draft["character_state_updates"] = []
    next_draft["scenes"][0]["slug"] = "INT. STATION - CURRENT DAY"
    next_draft["scenes"][0]["character_actions"] = ["Eve Hart opens the station door."]
    report = evaluate_episode_continuity(DraftMasterScript.model_validate(next_draft), EpisodeGenerationContext(
        generation_mode="full", episode_number=2, total_episodes=3,
        provisional_continuity_checkpoint=result["checkpoint"], memory_recall=result["memoryRecall"],
    ))
    assert report.checked_through_episode_number == 1
    assert any(issue.issue_type.value == "dead_character_action" for issue in report.issues)
    assert report.blocking_issue_count > 0


def test_probe_projection_rejects_broken_draft_before_request():
    workspace, bible = _continuity_bridge_input()
    workspace["episodes"][0]["workingDraftJson"] = "{broken"
    with pytest.raises(RuntimeError, match="projection failed"):
        project_probe_continuity(workspace, bible)
