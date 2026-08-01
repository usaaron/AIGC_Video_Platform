from datetime import datetime, timezone

import pytest
from sqlmodel import SQLModel

from app.database import (
    DatabaseConfigurationError,
    create_database_runtime,
    database_url_from_env,
)
from app.modules.script_engine.long_story_models import (
    ContinuityLedger,
    EpisodePlan,
    GenerationBatchPlan,
    GenerationJobCheckpoint,
    GenerationJobStatus,
    StoryBible,
    StoryProject,
    StoryStagePlan,
)
from app.modules.script_engine.long_story_repository import (
    LongStoryPersistenceConflictError,
    LongStoryRepository,
)


NOW = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)


@pytest.fixture
def database_runtime():
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    try:
        yield runtime
    finally:
        runtime.engine.dispose()


def build_project(
    *,
    title: str = "The Price of Truth",
    revision: int = 1,
) -> StoryProject:
    return StoryProject(
        project_id="story_project.mainland_demo",
        revision=revision,
        title=title,
        content_spec_id="content_spec.mainland_demo",
        planned_episode_count=100,
        created_at=NOW,
        updated_at=NOW,
    )


def build_story_bible(*, version: int = 1, theme: str = "Truth has a cost.") -> StoryBible:
    return StoryBible(
        story_bible_id="story_bible.mainland_demo",
        story_project_id="story_project.mainland_demo",
        content_spec_id="content_spec.mainland_demo",
        version=version,
        core_premise="A forensic accountant exposes the empire that destroyed her family.",
        series_goal="Follow her pursuit of proof without sacrificing innocent people.",
        theme=theme,
        central_conflict="Every piece of evidence threatens both the empire and someone she loves.",
        ending_direction="She reveals the conspiracy and chooses an independent future.",
        character_refs=["character.mara", "character.adrian"],
        story_lines=[
            {
                "story_line_id": "storyline.hidden_ledger",
                "title": "The Hidden Ledger",
                "story_line_type": "main",
                "premise": "Mara traces a falsified payment into a protected network.",
                "planned_resolution": "The hidden ledger becomes admissible evidence.",
                "character_refs": ["character.mara", "character.adrian"],
            }
        ],
        created_at=NOW,
    )


def build_stage() -> StoryStagePlan:
    return StoryStagePlan(
        stage_id="stage.evidence_returns",
        story_project_id="story_project.mainland_demo",
        story_bible_id="story_bible.mainland_demo",
        story_bible_version=1,
        stage_number=1,
        title="The Evidence Returns",
        start_episode=1,
        end_episode=5,
        stage_goal="Force Mara to choose reliable proof over immediate revenge.",
        entry_state="Mara trusts one suspicious payment record.",
        central_conflict="Adrian claims that the evidence was planted for her.",
        key_turns=["The payment timestamp predates Adrian's authority."],
        exit_state="Mara and Adrian possess complementary evidence but remain adversaries.",
    )


def build_episode_plan(episode_number: int) -> EpisodePlan:
    return EpisodePlan(
        episode_plan_id=f"episode_plan.mainland_demo.{episode_number:03d}",
        story_project_id="story_project.mainland_demo",
        story_bible_id="story_bible.mainland_demo",
        story_bible_version=1,
        stage_id="stage.evidence_returns",
        episode_number=episode_number,
        episode_goal=f"Advance the evidence conflict in episode {episode_number}.",
        entry_state="Mara begins with incomplete evidence.",
        central_conflict="The source of the evidence cannot be trusted.",
        protagonist_decision="Mara verifies the source before making a public accusation.",
        emotional_movement="Certainty to controlled doubt.",
        exit_state="Mara gains one verified fact and one more dangerous question.",
        cliffhanger="A hidden record identifies someone Mara trusted.",
        character_refs=["character.mara", "character.adrian"],
    )


def test_database_url_is_explicit_for_durable_runtime(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)

    assert database_url_from_env(required=False) is None
    with pytest.raises(DatabaseConfigurationError, match="DATABASE_URL"):
        database_url_from_env()


def test_repository_persists_and_updates_project(database_runtime) -> None:
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())

    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        saved = repository.get_project("story_project.mainland_demo")
        assert saved is not None
        assert saved.title == "The Price of Truth"
        repository.save_project(
            build_project(title="The Cost of Truth", revision=2)
        )

    with database_runtime.session() as session:
        saved = LongStoryRepository(session).get_project("story_project.mainland_demo")
        assert saved is not None
        assert saved.title == "The Cost of Truth"


def test_story_bible_versions_are_immutable_and_query_latest(database_runtime) -> None:
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_story_bible(build_story_bible(version=1))
        repository.save_story_bible(
            build_story_bible(version=2, theme="Truth requires accountable trust.")
        )

    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        latest = repository.get_story_bible("story_bible.mainland_demo")
        assert latest is not None
        assert latest.version == 2
        assert latest.theme == "Truth requires accountable trust."

        with pytest.raises(LongStoryPersistenceConflictError, match="cannot be overwritten"):
            repository.save_story_bible(
                build_story_bible(version=1, theme="An illegal in-place change.")
            )


def test_project_rejects_stale_revision(database_runtime) -> None:
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())

    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        with pytest.raises(LongStoryPersistenceConflictError, match="revision"):
            repository.save_project(build_project(title="Stale overwrite"))


def test_repository_lists_stage_and_episode_plans_in_order(database_runtime) -> None:
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_story_stage(build_stage())
        repository.save_episode_plan(build_episode_plan(2))
        repository.save_episode_plan(build_episode_plan(1))

    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        stages = repository.list_story_stages("story_project.mainland_demo")
        episodes = repository.list_episode_plans(
            "story_project.mainland_demo",
            start_episode=1,
            end_episode=2,
        )
        assert [stage.stage_number for stage in stages] == [1]
        assert [episode.episode_number for episode in episodes] == [1, 2]


def test_repository_returns_latest_continuity_snapshot(database_runtime) -> None:
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_continuity_ledger(
            ContinuityLedger(
                ledger_id="continuity.mainland_demo",
                version=1,
                story_project_id="story_project.mainland_demo",
                story_bible_id="story_bible.mainland_demo",
                story_bible_version=1,
                through_episode_number=1,
                updated_at=NOW,
            )
        )
        repository.save_continuity_ledger(
            ContinuityLedger(
                ledger_id="continuity.mainland_demo",
                version=2,
                story_project_id="story_project.mainland_demo",
                story_bible_id="story_bible.mainland_demo",
                story_bible_version=1,
                through_episode_number=5,
                updated_at=NOW,
            )
        )

    with database_runtime.session() as session:
        latest = LongStoryRepository(session).get_latest_continuity_ledger(
            "story_project.mainland_demo"
        )
        assert latest is not None
        assert latest.version == 2
        assert latest.through_episode_number == 5


def test_batch_and_job_checkpoint_support_state_progression(database_runtime) -> None:
    batch = GenerationBatchPlan(
        batch_id="batch.mainland_demo.001",
        story_project_id="story_project.mainland_demo",
        batch_number=1,
        start_episode=1,
        end_episode=2,
        episode_plan_ids=[
            "episode_plan.mainland_demo.001",
            "episode_plan.mainland_demo.002",
        ],
        created_at=NOW,
    )
    checkpoint = GenerationJobCheckpoint(
        job_id="job.mainland_demo.001",
        batch_id=batch.batch_id,
        status="running",
        attempt_count=1,
        completed_episode_numbers=[1],
        checkpointed_at=NOW,
    )

    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_batch(batch)
        repository.save_job_checkpoint(checkpoint)

    progressed = checkpoint.model_copy(
        update={
            "revision": 2,
            "status": GenerationJobStatus.completed,
            "completed_episode_numbers": [1, 2],
        }
    )
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_job_checkpoint(progressed)

    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        saved_batch = repository.get_batch(batch.batch_id)
        saved_checkpoint = repository.get_job_checkpoint(checkpoint.job_id)
        assert saved_batch is not None
        assert saved_batch.start_episode == 1
        assert saved_checkpoint is not None
        assert saved_checkpoint.status.value == "completed"
        assert saved_checkpoint.completed_episode_numbers == [1, 2]

    invalid_regression = progressed.model_copy(
        update={
            "revision": 3,
            "status": GenerationJobStatus.running,
        }
    )
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        with pytest.raises(LongStoryPersistenceConflictError, match="transition"):
            repository.save_job_checkpoint(invalid_regression)
