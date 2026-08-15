import json

import pytest

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.continuity_qc import (
    BlockingContinuityConflictError,
    evaluate_episode_continuity,
)
from app.modules.script_engine.models import (
    ContinuityQCStatus,
    EpisodeGenerationContext,
    EpisodeGenerationMode,
)
from tests.test_master_script_models import build_draft_payload


def build_draft(
    *,
    actions: list[str],
    speaker: str = "Nina",
    slug: str = "SCENE 1 - CURRENT DAY",
    character_updates: list[dict] | None = None,
    continuity_updates: list[dict] | None = None,
    story_line_updates: list[dict] | None = None,
    continuation_hook: dict | None = None,
) -> DraftMasterScript:
    payload = build_draft_payload()
    payload["scenes"][0]["slug"] = slug
    payload["scenes"][0]["character_actions"] = actions
    payload["scenes"][0]["dialogues"] = [{
        "character_name": speaker,
        "intent": "advance the current action",
        "text": "I will finish what we started tonight.",
    }]
    payload["character_state_updates"] = character_updates or []
    payload["continuity_state_updates"] = continuity_updates or []
    payload["story_line_updates"] = story_line_updates or []
    payload["continuation_hook"] = continuation_hook
    return DraftMasterScript.model_validate(payload)


def context(checkpoint: dict) -> EpisodeGenerationContext:
    return EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=3,
        total_episodes=20,
        confirmed_continuity_checkpoint=json.dumps(checkpoint, ensure_ascii=False),
    )


def test_dead_character_current_timeline_action_is_blocking() -> None:
    draft = build_draft(actions=["Mara opens the archive door."], speaker="Mara")
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.mara",
                "aliases": ["Mara"],
                "life_status": "dead",
                "last_updated_episode": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.blocking_issue_count == 1
    assert report.issues[0].issue_type.value == "dead_character_action"
    with pytest.raises(BlockingContinuityConflictError, match="硬冲突"):
        raise BlockingContinuityConflictError(report)


def test_dead_character_flashback_does_not_trigger_current_timeline_conflict() -> None:
    draft = build_draft(
        actions=["Mara opens the archive door."],
        speaker="Mara",
        slug="FLASHBACK - ARCHIVE",
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.mara",
                "aliases": ["Mara"],
                "life_status": "dead",
                "last_updated_episode": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.passed
    assert report.issues == []


def test_dead_character_cannot_silently_change_back_to_alive() -> None:
    draft = build_draft(
        actions=[],
        character_updates=[{
            "character_name": "Mara",
            "current_goal": "Return to the investigation.",
            "emotional_state": "Determined",
            "life_status": "alive",
            "change_summary": "Mara returns.",
            "change_cause": "She appears at the archive.",
            "evidence_scene_numbers": [1],
        }],
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.mara",
                "aliases": ["Mara"],
                "life_status": "dead",
                "last_updated_episode": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.issues[0].issue_type.value == "dead_character_revived"


def test_permanent_destroyed_state_requires_explicit_repair_transition() -> None:
    draft = build_draft(
        actions=[],
        continuity_updates=[{
            "entity_key": "item.phone",
            "entity_type": "item",
            "entity_name": "Evidence phone",
            "state_domain": "condition",
            "transition": "changed",
            "current_state": "The phone works normally.",
            "persistence": "ongoing",
            "change_cause": "It appears on the desk.",
            "evidence_scene_numbers": [1],
        }],
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "world_states": [{
                "entity_key": "item.phone",
                "entity_type": "item",
                "entity_name": "Evidence phone",
                "state_domain": "condition",
                "current_state": "Burned beyond use.",
                "persistence": "permanent",
                "last_transition": "destroyed",
                "evidence_episode_number": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.issues[0].issue_type.value == "irreversible_state_conflict"


def test_destroyed_item_usage_and_restricted_capability_are_warnings() -> None:
    draft = build_draft(actions=[
        "Nina uses the Evidence phone to call for help.",
        "Nina runs up the stairs before the guard arrives.",
    ])
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.nina",
                "aliases": ["Nina"],
                "life_status": "alive",
                "action_capabilities": ["Cannot walk or run without assistance."],
                "active_constraints": [],
                "last_updated_episode": 2,
            }],
            "world_states": [{
                "entity_key": "item.phone",
                "entity_type": "item",
                "entity_name": "Evidence phone",
                "state_domain": "condition",
                "current_state": "Burned beyond use.",
                "persistence": "permanent",
                "last_transition": "destroyed",
                "evidence_episode_number": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.warnings
    assert report.blocking_issue_count == 0
    assert {issue.issue_type.value for issue in report.issues} == {
        "capability_conflict",
        "unavailable_entity_usage",
    }


def test_structured_lost_item_reappearance_without_recovery_is_blocking() -> None:
    draft = build_draft(
        actions=[],
        continuity_updates=[{
            "entity_key": "item.phone",
            "entity_type": "item",
            "entity_name": "Evidence phone",
            "state_domain": "possession",
            "transition": "changed",
            "current_state": "Nina is using the phone again.",
            "persistence": "ongoing",
            "change_cause": "It appears in her pocket.",
            "evidence_scene_numbers": [1],
        }],
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "world_states": [{
                "entity_key": "item.phone",
                "entity_type": "item",
                "entity_name": "Evidence phone",
                "state_domain": "possession",
                "current_state": "The phone is missing.",
                "persistence": "ongoing",
                "last_transition": "lost",
                "evidence_episode_number": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.issues[0].issue_type.value == "unavailable_entity_usage"


def test_knowledge_jump_without_visible_relearning_is_blocking() -> None:
    draft = build_draft(
        actions=[],
        character_updates=[{
            "character_name": "Nina",
            "current_goal": "Find the missing witness.",
            "emotional_state": "Focused",
            "knowledge_changes": [],
            "knowledge_states": [{
                "knowledge_key": "fact.hidden_witness",
                "statement": "The witness is in the archive.",
                "status": "known",
            }],
            "change_summary": "Nina continues the search.",
            "change_cause": "She checks the archive map.",
            "evidence_scene_numbers": [1],
        }],
    )
    report = evaluate_episode_continuity(
        draft,
        context({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.nina",
                "aliases": ["Nina"],
                "life_status": "alive",
                "knowledge_states": [{
                    "knowledge_key": "fact.hidden_witness",
                    "statement": "The witness location was erased from memory.",
                    "status": "forgotten",
                }],
                "last_updated_episode": 2,
            }],
        }),
    )

    assert report.status == ContinuityQCStatus.blocked
    assert report.issues[0].issue_type.value == "knowledge_conflict"


def test_missing_checkpoint_is_not_applicable() -> None:
    draft = build_draft(actions=[])

    report = evaluate_episode_continuity(draft, None)

    assert report.status == ContinuityQCStatus.not_applicable


def test_newer_provisional_checkpoint_takes_precedence_within_active_batch() -> None:
    draft = build_draft(actions=["Mara opens the archive door."], speaker="Mara")
    generation_context = context({
        "through_episode_number": 1,
        "character_states": [{
            "character_ref": "character.mara",
            "aliases": ["Mara"],
            "life_status": "alive",
            "last_updated_episode": 1,
        }],
    }).model_copy(update={
        "provisional_continuity_checkpoint": json.dumps({
            "through_episode_number": 2,
            "character_states": [{
                "character_ref": "character.mara",
                "aliases": ["Mara"],
                "life_status": "dead",
                "last_updated_episode": 2,
            }],
        })
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.blocked
    assert report.checked_through_episode_number == 2


def test_story_line_omission_and_overdue_hook_are_reported() -> None:
    draft = build_draft(actions=["Nina finds a new ledger page."])
    generation_context = context({
        "through_episode_number": 2,
        "story_line_states": [{
            "story_line_id": "storyline.truth",
            "status": "active",
            "current_state": "The first source has been found.",
            "last_progressed_episode": 2,
        }],
        "open_setup_payoffs": [{
            "setup_payoff_id": "hook.episode_0001",
            "description": "The witness named Nina's father.",
            "status": "setup",
            "setup_episode": 1,
            "target_payoff_episode": 3,
        }],
    }).model_copy(update={
        "previous_episode_question": "Why did the witness name Nina's father?",
        "planned_story_line_refs": ["storyline.truth"],
        "planned_story_beat": "Verify the witness's accusation.",
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.warnings
    assert {issue.issue_type.value for issue in report.issues} == {
        "missing_planned_story_line_progress",
        "missing_hook_response",
        "overdue_hook",
    }


def test_aligned_story_line_progress_and_exact_hook_response_pass() -> None:
    draft = build_draft(
        actions=["Nina compares the witness statement with the original ledger."],
        story_line_updates=[{
            "story_line_id": "storyline.truth",
            "status": "active",
            "progress_summary": "The original ledger disproves part of the accusation.",
            "contribution_type": "turning_point",
            "planned_beat_ref": "storyline.truth",
            "planned_alignment": "aligned",
            "next_required_step": "Find who altered the copied ledger.",
            "change_cause": "Nina compares the original and copied ledgers.",
            "evidence_scene_numbers": [1],
        }],
        continuation_hook={
            "responds_to_episode": 2,
            "previous_hook_response": "The original ledger proves the signature was copied.",
            "response_evidence_scene_numbers": [1],
            "ending_hook_type": "Evidence threat",
            "ending_hook_summary": "The copied ledger is scheduled for destruction.",
            "next_episode_obligation": "Secure the copied ledger before destruction.",
            "target_payoff_episode": 4,
        },
    )
    generation_context = context({
        "through_episode_number": 2,
        "story_line_states": [{
            "story_line_id": "storyline.truth",
            "status": "active",
            "current_state": "The witness accused Nina's father.",
            "last_progressed_episode": 2,
        }],
        "open_setup_payoffs": [{
            "setup_payoff_id": "hook.episode_0002",
            "description": "The witness accused Nina's father.",
            "status": "setup",
            "setup_episode": 2,
            "target_payoff_episode": 3,
        }],
    }).model_copy(update={
        "previous_episode_question": "Did Nina's father sign the ledger?",
        "planned_story_line_refs": ["storyline.truth"],
        "planned_story_beat": "Verify the signature.",
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.passed
    assert report.issues == []


def test_planned_setup_and_payoff_require_evidence_backed_updates() -> None:
    draft = build_draft(actions=["Nina finds an altered letter."])
    generation_context = context({
        "through_episode_number": 2,
        "open_setup_payoffs": [{
            "setup_payoff_id": "setup.old_letter",
            "description": "The letter date was altered.",
            "status": "setup",
            "setup_episode": 1,
            "target_payoff_episode": 3,
        }],
    }).model_copy(update={
        "planned_setup_refs": ["setup.new_witness"],
        "planned_payoff_refs": ["setup.old_letter"],
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.warnings
    assert {issue.issue_type.value for issue in report.issues} == {
        "missing_planned_setup",
        "missing_planned_payoff",
    }


def test_planned_setup_and_payoff_updates_pass_when_actions_match() -> None:
    payload = build_draft_payload()
    payload["setup_payoff_updates"] = [{
        "setup_payoff_ref": "setup.old_letter",
        "action": "payoff",
        "status": "paid_off",
        "progress_summary": "The ink test identifies the alteration year.",
        "change_cause": "Nina compares the laboratory report with the archive date.",
        "evidence_scene_numbers": [1],
    }, {
        "setup_payoff_ref": "setup.new_witness",
        "action": "setup",
        "status": "setup",
        "progress_summary": "A witness receipt appears in the archive.",
        "next_required_step": "Locate the witness.",
        "target_payoff_episode": 6,
        "change_cause": "Nina opens the sealed archive box.",
        "evidence_scene_numbers": [1],
    }]
    draft = DraftMasterScript.model_validate(payload)
    generation_context = context({
        "through_episode_number": 2,
        "open_setup_payoffs": [{
            "setup_payoff_id": "setup.old_letter",
            "description": "The letter date was altered.",
            "status": "setup",
            "setup_episode": 1,
            "target_payoff_episode": 3,
        }],
    }).model_copy(update={
        "planned_setup_refs": ["setup.new_witness"],
        "planned_payoff_refs": ["setup.old_letter"],
    })

    report = evaluate_episode_continuity(draft, generation_context)

    assert report.status == ContinuityQCStatus.passed
