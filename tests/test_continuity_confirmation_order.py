from datetime import datetime, timezone

import pytest
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.script_engine.long_story_models import (
    EpisodeArtifactCreate,
    EpisodeArtifactKind,
    PlanningApprovalStatus,
    StoryBible,
    StoryProject,
)
from app.modules.script_engine.long_story_service import LongStoryService


NOW = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)
PROJECT_ID = "story_project.confirmation_order"


@pytest.fixture
def database_runtime():
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    try:
        yield runtime
    finally:
        runtime.engine.dispose()


def build_project() -> StoryProject:
    return StoryProject(
        project_id=PROJECT_ID,
        title="Confirmation Order",
        content_spec_id="content_spec.confirmation_order",
        planned_episode_count=2,
        default_batch_size=2,
        created_at=NOW,
        updated_at=NOW,
    )


def build_story_bible() -> StoryBible:
    return StoryBible(
        story_bible_id="story_bible.confirmation_order",
        story_project_id=PROJECT_ID,
        content_spec_id="content_spec.confirmation_order",
        status=PlanningApprovalStatus.approved,
        core_premise="A witness must preserve evidence before the archive closes.",
        series_goal="Show how each verified clue changes the investigation.",
        theme="Proof must survive pressure.",
        central_conflict="Every verified clue exposes the witness to greater danger.",
        ending_direction="The complete record reaches an independent investigator.",
        character_refs=["character.witness"],
        character_registry=[{
            "character_ref": "character.witness",
            "name": "Witness",
            "role": "protagonist",
        }],
        story_lines=[{
            "story_line_id": "storyline.archive",
            "title": "The Archive",
            "story_line_type": "main",
            "premise": "The witness traces a missing archive record.",
            "planned_resolution": "The complete archive becomes public evidence.",
            "character_refs": ["character.witness"],
        }],
        created_at=NOW,
        approved_at=NOW,
    )


def build_confirmed_artifact(episode_number: int) -> EpisodeArtifactCreate:
    synopsis = {
        1: "Episode one establishes the witness's verified archive copy.",
        2: "Episode two delivers the verified copy to the investigator.",
    }[episode_number]
    return EpisodeArtifactCreate(
        artifact_id=f"artifact.confirmation_order.episode_{episode_number:04d}.final",
        story_project_id=PROJECT_ID,
        episode_number=episode_number,
        artifact_kind="final",
        memory_layer="canonical",
        content_schema_version="draft_master_script.v1",
        content_payload={"synopsis": synopsis},
        created_at=NOW,
    )


def test_out_of_order_confirmation_replays_missing_earlier_episode(
    database_runtime,
) -> None:
    service = LongStoryService(database_runtime)
    service.save_project(build_project())
    service.save_story_bible(build_story_bible())

    second = build_confirmed_artifact(2)
    service.save_episode_artifact(second)
    incomplete = service.get_latest_continuity_ledger(PROJECT_ID)

    assert incomplete is not None
    assert incomplete.version == 1
    assert [item.episode_number for item in incomplete.timeline] == [2]

    first = build_confirmed_artifact(1)
    service.save_episode_artifact(first)
    repaired = service.get_latest_continuity_ledger(PROJECT_ID)

    assert repaired is not None
    assert repaired.version == 3
    assert repaired.through_episode_number == 2
    assert repaired.source_artifact_id == second.artifact_id
    assert [item.episode_number for item in repaired.timeline] == [1, 2]
    assert [
        item.episode_number for item in repaired.recent_episode_summaries
    ] == [1, 2]
    assert repaired.recent_episode_summaries[-1].entry_state == (
        first.content_payload["synopsis"]
    )
    assert service.audit_continuity_ledger(PROJECT_ID).status.value == "consistent"

    service.save_episode_artifact(first)
    retry = service.get_latest_continuity_ledger(PROJECT_ID)
    assert retry is not None
    assert retry.version == repaired.version


def test_explicit_confirmation_replaces_legacy_canonical_draft_in_replay(
    database_runtime,
) -> None:
    service = LongStoryService(database_runtime)
    service.save_project(build_project())
    service.save_story_bible(build_story_bible())

    legacy_first = build_confirmed_artifact(1).model_copy(
        update={
            "artifact_id": "artifact.confirmation_order.episode_0001.legacy_draft",
            "artifact_kind": EpisodeArtifactKind.draft,
            "content_payload": {
                "synopsis": "The legacy automatic draft contains an obsolete first ending."
            },
        }
    )
    service.save_episode_artifact(legacy_first)
    second = build_confirmed_artifact(2)
    service.save_episode_artifact(second)

    confirmed_first = build_confirmed_artifact(1)
    service.save_episode_artifact(confirmed_first)
    repaired = service.get_latest_continuity_ledger(PROJECT_ID)

    assert repaired is not None
    summaries = {
        item.episode_number: item for item in repaired.recent_episode_summaries
    }
    assert summaries[1].exit_state == confirmed_first.content_payload["synopsis"]
    assert summaries[2].entry_state == confirmed_first.content_payload["synopsis"]
    assert (
        legacy_first.content_payload["synopsis"]
        not in {summaries[1].exit_state, summaries[2].entry_state}
    )
    assert service.audit_continuity_ledger(PROJECT_ID).status.value == "consistent"

    version = repaired.version
    service.save_episode_artifact(confirmed_first)
    retry = service.get_latest_continuity_ledger(PROJECT_ID)
    assert retry is not None
    assert retry.version == version
