from copy import deepcopy

import pytest

from app.modules.master_script.models import DialogueLine, DraftMasterScript, LLMTargetedScriptTextPatch
from app.modules.script_engine import targeted_revision
from app.modules.script_engine.models import (
    ScriptDraftModificationRequest,
    ScriptGenerationDraftRequest,
    ScriptReleaseRegion,
)
from tests.test_script_generation_service import TargetedModificationAdapter, seed_dependencies


@pytest.fixture
def source_case():
    service, content_spec_id = seed_dependencies()
    run = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en",
        desired_scene_count=3,
    ))
    return service, run


def _request(run, draft, path, selected_text):
    return ScriptDraftModificationRequest(
        source_generation_run=run,
        source_draft_master_script=draft,
        instruction="Make the selected action more visual without changing the story facts.",
        selection_context={"source_field": f"Selection ({path})", "selected_text": selected_text},
    )


@pytest.mark.parametrize("path", [
    "hook", "synopsis", "next_episode_question", "scenes.0.purpose",
    "scenes.0.scene_causality.goal", "scenes.0.character_actions.0",
    "scenes.0.dialogues.0.text", "scenes.0.dialogues.0.intent",
])
def test_supported_selection_paths_preserve_existing_field_policy(path):
    assert targeted_revision.targeted_modification_path(f"Selection ({path})") == path
    assert targeted_revision.targeted_modification_path(f"Selection（{path}）") == path


@pytest.mark.parametrize("path", [
    "characters.0.name", "id", "scenes.0.character_refs.0",
    "scenes.0.dialogues.0.chinese_translation", "scenes.0.scene_causality.caused_by_scene_number",
    "scenes.-1.purpose", "scenes.1.5.purpose", "scenes.0.character_actions.-1",
    "scenes.0.dialogues.0.text.extra", "scenes.0.__dict__",
    "scenes.\u00b2.purpose", "scenes.0.character_actions.\u00b2",
])
def test_unsupported_or_non_decimal_selection_paths_are_rejected(path):
    assert targeted_revision.targeted_modification_path(f"Selection ({path})") is None


@pytest.mark.parametrize("path", [
    "scenes.9.character_actions.0", "scenes.-1.character_actions.0",
    "scenes.0.character_actions.1", "scenes.0.missing.0",
    "scenes.0.character_actions.0.text", "scenes.\u00b2.character_actions.0",
])
def test_unresolvable_paths_neither_read_nor_create_fields(path):
    payload = {"scenes": [{"character_actions": ["Mara opens the door."]}]}
    before = deepcopy(payload)
    assert targeted_revision.targeted_text_value(payload, path) is None
    assert targeted_revision.set_targeted_text_value(payload, path, "changed") is False
    assert payload == before


def test_action_slot_read_and_write_share_the_same_array_index():
    payload = {"scenes": [{"character_actions": ["Mara opens the door.", "Mara turns the key."]}]}
    path = "scenes.0.character_actions.1"
    assert targeted_revision.targeted_text_value(payload, path) == "Mara turns the key."
    assert targeted_revision.set_targeted_text_value(payload, path, "Mara locks the door.") is True
    assert payload == {"scenes": [{"character_actions": ["Mara opens the door.", "Mara locks the door."]}]}


@pytest.mark.parametrize("before,after,expected", [
    ("", "", None),
    ("left ", "", "left TAKE; right wait."),
    ("", ".", "left wait; right TAKE."),
    ("unrelated", "unrelated", None),
])
def test_repeated_text_requires_unambiguous_selection_context(before, after, expected):
    assert targeted_revision.replace_selected_text(
        "left wait; right wait.", selected_text="wait", before_text=before,
        after_text=after, replacement_text="TAKE",
    ) == expected


def test_patch_envelope_preserves_inner_metadata_priority_and_three_level_limit():
    response = {
        "_meta": {"model_name": "outer", "request_id": "request-1"},
        "data": {"result": {"patch": {
            "replacement_text": "Mara turns the key.", "_meta": {"model_name": "inner"},
        }}},
    }
    unwrapped = targeted_revision.unwrap_targeted_patch_response(response)
    assert unwrapped == {
        "replacement_text": "Mara turns the key.",
        "_meta": {"model_name": "inner", "request_id": "request-1"},
    }
    too_deep = {"data": {"data": {"data": {"data": {"replacement_text": "hidden"}}}}}
    assert targeted_revision.unwrap_targeted_patch_response(too_deep) == {
        "data": {"replacement_text": "hidden"},
    }


def test_target_context_contains_only_selected_scene_body_and_episode_invariants(source_case):
    _, run = source_case
    source = run.draft_master_script
    before = source.model_dump()
    context = targeted_revision.targeted_modification_context(source, "scenes.1.character_actions.0")
    assert context["target_scene"] == source.scenes[1].model_dump(mode="json")
    assert len(context["scene_outline"]) == len(source.scenes)
    assert all("character_actions" not in scene and "dialogues" not in scene for scene in context["scene_outline"])
    assert not {"scenes", "id", "created_at", "updated_at", "llm_metadata"}.intersection(context["episode_invariants"])
    assert source.model_dump() == before


def test_action_modification_uses_one_patch_and_preserves_all_other_content(source_case):
    service, run = source_case
    source = run.draft_master_script.model_copy(deep=True)
    source.scenes[0].character_actions = [
        "Mara destroys the signed contract before the groom can stop her.",
        *source.scenes[0].character_actions,
    ]
    source = DraftMasterScript.model_validate(source.model_dump(mode="python"))
    before = source.model_dump(mode="python")
    adapter = TargetedModificationAdapter()
    service._llm_adapter = adapter
    request = _request(run, source, "scenes.0.character_actions.0", "destroys the signed contract")

    result = service.modify_draft(request)

    candidate = result.candidate_generation_run.draft_master_script
    expected = deepcopy(before)
    expected["scenes"][0]["character_actions"][0] = (
        "Mara feeds the signed contract into the ballroom flame before the groom can stop her."
    )
    for field in ("id", "created_at", "updated_at", "llm_metadata"):
        expected.pop(field)
    assert candidate.model_dump(exclude={"id", "created_at", "updated_at", "llm_metadata"}) == expected
    assert source.model_dump() == before
    assert candidate.id != source.id
    assert adapter.max_tokens_seen == [16_000]
    assert len(adapter.prompts) == 1
    assert result.candidate_generation_run.continuity_qc_report is not None
    assert candidate.llm_metadata["targeted_modification_path"] == "scenes.0.character_actions.0"


@pytest.mark.parametrize("mode", ["ambiguous", "unchanged", "invalid_length", "handoff", "missing_translation"])
def test_unusable_patch_leaves_source_unchanged_for_full_episode_fallback(source_case, mode):
    service, run = source_case
    source = run.draft_master_script.model_copy(deep=True)
    source.hook = "Mara burns paper; Mara burns paper."
    path = "hook"
    selected = "burns paper"
    patch = LLMTargetedScriptTextPatch(replacement_text="shreds paper")
    if mode == "unchanged":
        selected = source.hook
        patch = LLMTargetedScriptTextPatch(replacement_text=selected)
    elif mode == "invalid_length":
        selected = source.hook
        patch = LLMTargetedScriptTextPatch(replacement_text="x")
    elif mode == "handoff":
        patch = LLMTargetedScriptTextPatch(requires_full_episode_rewrite=True, reason="Later scenes must change.")
    elif mode == "missing_translation":
        source.scenes[0].dialogues = [DialogueLine(
            character_name="Mara", intent="demand an answer", text="Tell me who signed it.",
            chinese_translation="告诉我是谁签的。",
        )]
        run = run.model_copy(update={"release_region": ScriptReleaseRegion.overseas})
        path = "scenes.0.dialogues.0.text"
        selected = "who signed it"
        patch = LLMTargetedScriptTextPatch(replacement_text="which minister signed it")
    request = _request(run, source, path, selected)
    before = source.model_dump()
    candidate_payload = source.model_dump(mode="python")

    candidate = targeted_revision.build_targeted_candidate(
        request, candidate_payload=candidate_payload, target_path=path, patch=patch,
        raw_metadata={"provider": "test"}, requires_translation=mode == "missing_translation",
    )

    assert candidate is None
    assert source.model_dump() == before
    assert service._validate_source_run(run, source) is not None


def test_successful_candidate_preserves_model_metadata_and_refreshes_identity(source_case):
    _, run = source_case
    source = run.draft_master_script
    request = _request(run, source, "hook", source.hook)
    candidate = targeted_revision.build_targeted_candidate(
        request, candidate_payload=source.model_dump(mode="python"), target_path="hook",
        patch=LLMTargetedScriptTextPatch(replacement_text="Mara locks the contract inside the cabinet."),
        raw_metadata={"provider": "test", "model_name": "editor"}, requires_translation=False,
    )
    assert isinstance(candidate, DraftMasterScript)
    assert candidate.id != source.id
    assert candidate.llm_metadata == {
        **source.llm_metadata,
        "targeted_modification": True,
        "targeted_modification_path": "hook",
        "targeted_modification_source_draft_id": source.id,
        "targeted_modification_model": {"provider": "test", "model_name": "editor"},
    }
