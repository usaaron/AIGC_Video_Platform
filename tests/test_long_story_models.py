from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.modules.script_engine.long_story_models import (
    ContinuityLedger,
    EpisodePlan,
    GenerationBatchPlan,
    GenerationJobCheckpoint,
    SetupPayoffRecord,
    StoryBible,
    StoryProject,
    StoryProjectWorkspaceSave,
    StoryStagePlan,
)


APPROVED_AT = datetime(2026, 8, 1, 8, 0, tzinfo=timezone.utc)


def build_story_bible() -> dict:
    return {
        "story_bible_id": "story_bible.mainland_demo.v1",
        "story_project_id": "story_project.mainland_demo",
        "content_spec_id": "content_spec.mainland_demo",
        "core_premise": "A dismissed forensic accountant rebuilds her life by exposing a family empire.",
        "series_goal": "Follow her pursuit of proof without sacrificing the innocent people around her.",
        "theme": "Truth has a cost.",
        "central_conflict": "Every piece of evidence can destroy both the empire and someone she still loves.",
        "ending_direction": "She reveals the financial conspiracy and chooses an independent future.",
        "world_rules": ["Evidence must have a traceable source."],
        "character_refs": ["character.mara", "character.adrian"],
        "character_arc_targets": [
            {
                "character_ref": "character.mara",
                "external_goal": "Expose the hidden financial network.",
                "internal_need": "Learn that trust can be evidence-based rather than blind.",
                "starting_state": "She works alone and treats vulnerability as a liability.",
                "target_state": "She accepts bounded cooperation without surrendering judgment.",
                "protected_traits": ["Will not knowingly harm innocent people."],
            }
        ],
        "relationships": [
            {
                "relationship_id": "relationship.mara_adrian",
                "source_character_ref": "character.mara",
                "target_character_ref": "character.adrian",
                "relationship_type": "adversarial_alliance",
                "initial_state": "They distrust each other but need the same evidence.",
                "target_direction": "They develop conditional trust while retaining conflicting goals.",
            }
        ],
        "story_lines": [
            {
                "story_line_id": "storyline.financial_conspiracy",
                "title": "The Hidden Ledger",
                "story_line_type": "main",
                "premise": "Mara follows a falsified payment into a protected financial network.",
                "planned_resolution": "The ledger becomes admissible evidence against the family empire.",
                "character_refs": ["character.mara", "character.adrian"],
            }
        ],
        "major_setup_payoff_refs": ["setup_payoff.black_ledger"],
        "locked_facts": ["Mara will not knowingly frame an innocent person."],
    }


def test_story_project_uses_long_form_defaults_and_serializes() -> None:
    project = StoryProject(
        project_id="story_project.mainland_demo",
        title="The Price of Truth",
        content_spec_id="content_spec.mainland_demo",
        planned_episode_count=334,
    )

    serialized = project.model_dump(mode="json")
    assert serialized["schema_version"] == "v1"
    assert serialized["target_total_characters"] == 600_000
    assert serialized["default_batch_size"] == 5
    assert serialized["status"] == "planning"


def test_story_project_can_exist_before_content_spec_resolution() -> None:
    project = StoryProject(
        project_id="story_project.pre_content_spec",
        title="Unresolved Story Project",
        planned_episode_count=60,
    )

    assert project.content_spec_id is None


def test_workspace_snapshot_input_requires_matching_project_identity() -> None:
    with pytest.raises(ValidationError, match="workspace_payload.id"):
        StoryProjectWorkspaceSave(
            project_id="story_project.workspace",
            client_instance_id="client.browser_one",
            workspace_payload={"id": "story_project.other"},
        )


def test_story_project_rejects_batch_larger_than_series() -> None:
    with pytest.raises(ValidationError, match="default_batch_size"):
        StoryProject(
            project_id="story_project.short",
            title="Short Story",
            content_spec_id="content_spec.short",
            planned_episode_count=3,
            default_batch_size=5,
        )


def test_story_bible_preserves_character_relationship_and_story_line_refs() -> None:
    story_bible = StoryBible.model_validate(build_story_bible())

    serialized = story_bible.model_dump(mode="json")
    assert serialized["version"] == 1
    assert serialized["character_arc_targets"][0]["character_ref"] == "character.mara"
    assert serialized["relationships"][0]["relationship_id"] == "relationship.mara_adrian"
    assert serialized["story_lines"][0]["story_line_type"] == "main"


def test_story_bible_rejects_unknown_character_reference() -> None:
    payload = build_story_bible()
    payload["relationships"][0]["target_character_ref"] = "character.unknown"

    with pytest.raises(ValidationError, match="Story Bible characters"):
        StoryBible.model_validate(payload)


def test_approved_story_bible_requires_approval_timestamp() -> None:
    payload = build_story_bible()
    payload["status"] = "approved"

    with pytest.raises(ValidationError, match="requires approved_at"):
        StoryBible.model_validate(payload)


def test_story_stage_and_episode_plan_support_reviewable_hierarchy() -> None:
    stage = StoryStagePlan(
        stage_id="stage.truth_returns",
        story_project_id="story_project.mainland_demo",
        story_bible_id="story_bible.mainland_demo.v1",
        story_bible_version=1,
        stage_number=1,
        title="The Evidence Returns",
        start_episode=1,
        end_episode=20,
        stage_goal="Force Mara to choose between immediate revenge and reliable proof.",
        entry_state="Mara has one suspicious payment record and no trustworthy ally.",
        central_conflict="The family can discredit every source Mara approaches.",
        key_turns=["Adrian proves that one payment record was planted."],
        character_arc_movements={"character.mara": "From isolation to conditional cooperation."},
        setup_refs=["setup_payoff.black_ledger"],
        exit_state="Mara and Adrian possess complementary evidence but remain adversaries.",
        status="approved",
        approved_at=APPROVED_AT,
    )
    episode = EpisodePlan(
        episode_plan_id="episode_plan.mainland_demo.001",
        story_project_id="story_project.mainland_demo",
        story_bible_id="story_bible.mainland_demo.v1",
        story_bible_version=1,
        stage_id=stage.stage_id,
        episode_number=1,
        episode_goal="Make Mara test the evidence before publicly accusing Adrian.",
        entry_state="Mara arrives ready to expose Adrian with one payment record.",
        central_conflict="Adrian claims that the record was planted specifically for Mara.",
        protagonist_decision="Mara delays the accusation and demands independently verifiable proof.",
        reveal="The payment timestamp predates Adrian's authority to approve it.",
        emotional_movement="Certainty to destabilizing doubt.",
        setup_refs=["setup_payoff.black_ledger"],
        exit_state="Mara keeps control of the event but no longer trusts her original evidence.",
        cliffhanger="A second ledger entry names the ally who supplied Mara's evidence.",
        character_refs=["character.mara", "character.adrian"],
    )

    assert stage.start_episode == 1
    assert episode.stage_id == stage.stage_id
    assert episode.model_dump(mode="json")["status"] == "draft"


def test_story_stage_rejects_reversed_episode_range() -> None:
    with pytest.raises(ValidationError, match="end_episode"):
        StoryStagePlan(
            stage_id="stage.invalid",
            story_project_id="story_project.mainland_demo",
            story_bible_id="story_bible.mainland_demo.v1",
            story_bible_version=1,
            stage_number=2,
            title="Invalid Range",
            start_episode=21,
            end_episode=20,
            stage_goal="Demonstrate range validation for long-form planning.",
            entry_state="The previous stage has already ended.",
            central_conflict="The configured episode range is internally inconsistent.",
            key_turns=["The invalid range is rejected."],
            exit_state="No stage is created from invalid bounds.",
        )


def test_setup_payoff_requires_setup_before_payoff() -> None:
    with pytest.raises(ValidationError, match="must not precede setup_episode"):
        SetupPayoffRecord(
            setup_payoff_id="setup_payoff.invalid",
            description="A ledger is introduced and later decoded.",
            status="paid_off",
            setup_episode=10,
            payoff_episode=8,
        )


def test_continuity_ledger_tracks_compact_state_and_serializes() -> None:
    ledger = ContinuityLedger(
        ledger_id="continuity.mainland_demo.v1",
        story_project_id="story_project.mainland_demo",
        story_bible_id="story_bible.mainland_demo.v1",
        story_bible_version=1,
        through_episode_number=1,
        character_states=[
            {
                "character_ref": "character.mara",
                "current_goal": "Verify who planted the payment record.",
                "emotional_state": "Controlled doubt",
                "current_knowledge": ["The payment predates Adrian's authority."],
                "active_constraints": ["Do not expose the source without corroboration."],
                "last_updated_episode": 1,
            }
        ],
        relationship_states=[
            {
                "relationship_id": "relationship.mara_adrian",
                "source_character_ref": "character.mara",
                "target_character_ref": "character.adrian",
                "current_state": "Adversaries sharing one verifiable discrepancy.",
                "last_changed_episode": 1,
            }
        ],
        story_line_states=[
            {
                "story_line_id": "storyline.financial_conspiracy",
                "status": "active",
                "current_state": "The first evidence source is compromised.",
                "last_progressed_episode": 1,
            }
        ],
        canonical_facts=[
            {
                "fact_id": "fact.adrian_authority_date",
                "statement": "Adrian lacked payment authority on the recorded date.",
                "established_episode": 1,
                "source": "generated",
                "locked": True,
            }
        ],
        setup_payoffs=[
            {
                "setup_payoff_id": "setup_payoff.black_ledger",
                "description": "A second hidden ledger identifies Mara's source.",
                "status": "setup",
                "setup_episode": 1,
                "target_payoff_episode": 8,
            }
        ],
        timeline=[
            {
                "event_id": "event.gala_accusation_paused",
                "episode_number": 1,
                "sequence_order": 1,
                "summary": "Mara pauses her accusation after detecting a timestamp conflict.",
            }
        ],
        recent_episode_summaries=[
            {
                "episode_number": 1,
                "entry_state": "Mara trusts the payment record.",
                "exit_state": "Mara knows the record may have been planted.",
                "consequences": ["The public accusation is delayed."],
                "new_fact_ids": ["fact.adrian_authority_date"],
            }
        ],
    )

    serialized = ledger.model_dump(mode="json")
    assert serialized["through_episode_number"] == 1
    assert serialized["setup_payoffs"][0]["status"] == "setup"
    assert serialized["recent_episode_summaries"][0]["episode_number"] == 1


def test_continuity_ledger_rejects_future_observed_state() -> None:
    with pytest.raises(ValidationError, match="cannot exceed"):
        ContinuityLedger(
            ledger_id="continuity.invalid.v1",
            story_project_id="story_project.mainland_demo",
            story_bible_id="story_bible.mainland_demo.v1",
            story_bible_version=1,
            through_episode_number=3,
            canonical_facts=[
                {
                    "fact_id": "fact.from_future",
                    "statement": "This fact has not occurred yet.",
                    "established_episode": 4,
                    "source": "generated",
                }
            ],
        )


def test_generation_batch_requires_one_plan_per_episode() -> None:
    with pytest.raises(ValidationError, match="one Episode Plan ID per episode"):
        GenerationBatchPlan(
            batch_id="batch.mainland_demo.001",
            story_project_id="story_project.mainland_demo",
            batch_number=1,
            start_episode=1,
            end_episode=5,
            episode_plan_ids=["episode_plan.mainland_demo.001"],
        )


def test_generation_job_checkpoint_rejects_conflicting_episode_status() -> None:
    with pytest.raises(ValidationError, match="both completed and failed"):
        GenerationJobCheckpoint(
            job_id="job.mainland_demo.001",
            batch_id="batch.mainland_demo.001",
            status="partial",
            completed_episode_numbers=[1, 2],
            failed_episode_numbers=[2],
        )
