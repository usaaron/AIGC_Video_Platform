import hashlib
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel, Session

from app.database import (
    DatabaseConfigurationError,
    create_database_runtime,
    database_url_from_env,
)
from app.modules.script_engine.long_story_models import (
    ContinuityLedger,
    EpisodeArtifact,
    EpisodePlan,
    GenerationBatchPlan,
    GenerationJobCheckpoint,
    GenerationJobStatus,
    StoryBible,
    StoryPlanNode,
    StoryProject,
    StoryProjectStatus,
    StoryProjectWorkspaceSnapshot,
    StoryStagePlan,
)
from app.modules.script_engine.long_story_persistence import StoryProjectRecord
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


def build_story_plan_node(
    *,
    node_id: str = "story_plan.mainland_demo.root",
    parent_node_id: str | None = None,
    predecessor_node_id: str | None = None,
    sequence_order: int = 1,
) -> StoryPlanNode:
    return StoryPlanNode(
        node_id=node_id,
        story_project_id="story_project.mainland_demo",
        story_bible_id="story_bible.mainland_demo",
        story_bible_version=1,
        parent_node_id=parent_node_id,
        parent_node_version=1 if parent_node_id else None,
        predecessor_node_id=predecessor_node_id,
        predecessor_node_version=1 if predecessor_node_id else None,
        sequence_order=sequence_order,
        title="The Evidence Returns",
        narrative_purpose="Move the investigation from accusation to verified proof.",
        synopsis="Mara discovers that her strongest evidence was altered and traces its source.",
        entry_state="Mara trusts one suspicious payment record.",
        central_conflict="Public revenge would destroy her access to reliable evidence.",
        turning_points=["The timestamp predates Adrian's authority."],
        emotional_direction="Certainty becomes controlled doubt.",
        exit_state="Mara obtains one verified fact and a more dangerous lead.",
        character_refs=["character.mara", "character.adrian"],
        story_line_refs=["storyline.hidden_ledger"],
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


def build_episode_artifact(
    *,
    artifact_id: str = "artifact.mainland_demo.episode_001.draft.initial",
    version: int = 1,
    title: str = "Episode 1",
) -> EpisodeArtifact:
    content = {"title": title, "scenes": []}
    encoded = json.dumps(
        content,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return EpisodeArtifact(
        artifact_id=artifact_id,
        story_project_id="story_project.mainland_demo",
        episode_number=1,
        artifact_kind="draft",
        artifact_version=version,
        content_schema_version="draft_master_script.v1",
        content_payload=content,
        payload_checksum=hashlib.sha256(encoded).hexdigest(),
        payload_size_bytes=len(encoded),
        created_at=NOW,
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


def test_project_rejects_invalid_status_transition(database_runtime) -> None:
    with database_runtime.session() as session:
        LongStoryRepository(session).save_project(build_project())

    completed = build_project(revision=2).model_copy(
        update={"status": StoryProjectStatus.completed}
    )
    with database_runtime.session() as session:
        LongStoryRepository(session).save_project(completed)

    invalid = build_project(revision=3).model_copy(
        update={"status": StoryProjectStatus.generating}
    )
    with database_runtime.session() as session:
        with pytest.raises(LongStoryPersistenceConflictError, match="transition"):
            LongStoryRepository(session).save_project(invalid)


def test_archived_projects_are_excluded_from_default_listing(database_runtime) -> None:
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_project(
            build_project(revision=2).model_copy(
                update={"status": StoryProjectStatus.archived}
            )
        )

    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        assert repository.list_projects() == []
        assert repository.count_projects() == 0
        assert len(repository.list_projects(include_archived=True)) == 1
        assert repository.count_projects(include_archived=True) == 1


def test_project_atomic_revision_prevents_concurrent_lost_update(tmp_path) -> None:
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'concurrency.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    with runtime.session() as session:
        LongStoryRepository(session).save_project(build_project())

    first_session = Session(runtime.engine)
    stale_session = Session(runtime.engine)
    try:
        assert LongStoryRepository(first_session).get_project(
            "story_project.mainland_demo"
        ) is not None
        stale_record = stale_session.get(
            StoryProjectRecord,
            "story_project.mainland_demo",
        )
        assert stale_record is not None

        LongStoryRepository(first_session).save_project(
            build_project(title="First committed update", revision=2)
        )
        first_session.commit()

        with pytest.raises(LongStoryPersistenceConflictError, match="concurrently"):
            LongStoryRepository(stale_session).save_project(
                build_project(title="Concurrent stale update", revision=2)
            )
    finally:
        first_session.close()
        stale_session.close()
        runtime.engine.dispose()


def test_workspace_snapshot_is_durable_and_revision_controlled(database_runtime) -> None:
    initial = StoryProjectWorkspaceSnapshot(
        project_id="story_project.mainland_demo",
        revision=1,
        client_instance_id="client.browser_one",
        workspace_payload={
            "id": "story_project.mainland_demo",
            "title": "The Price of Truth",
            "characters": [],
            "episodes": [],
        },
        updated_at=NOW,
        payload_checksum="a" * 64,
        payload_size_bytes=100,
    )
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_workspace_snapshot(initial)

    updated = initial.model_copy(
        update={
            "revision": 2,
            "workspace_payload": {
                **initial.workspace_payload,
                "title": "The Cost of Truth",
            },
            "payload_checksum": "b" * 64,
        }
    )
    with database_runtime.session() as session:
        LongStoryRepository(session).save_workspace_snapshot(updated)

    with database_runtime.session() as session:
        saved = LongStoryRepository(session).get_workspace_snapshot(
            "story_project.mainland_demo"
        )
        assert saved is not None
        assert saved.revision == 2
        assert saved.workspace_payload["title"] == "The Cost of Truth"

        with pytest.raises(LongStoryPersistenceConflictError, match="revision"):
            LongStoryRepository(session).save_workspace_snapshot(
                initial.model_copy(
                    update={
                        "workspace_payload": {
                            **initial.workspace_payload,
                            "title": "Stale overwrite",
                        }
                    }
                )
            )


def test_repository_lists_stage_and_episode_plans_in_order(database_runtime) -> None:
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_story_bible(build_story_bible())
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


def test_repository_persists_recursive_story_plan_nodes_in_sibling_order(
    database_runtime,
) -> None:
    root = build_story_plan_node()
    first = build_story_plan_node(
        node_id="story_plan.mainland_demo.first",
        parent_node_id=root.node_id,
        sequence_order=1,
    )
    second = build_story_plan_node(
        node_id="story_plan.mainland_demo.second",
        parent_node_id=root.node_id,
        predecessor_node_id=first.node_id,
        sequence_order=2,
    )
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_story_bible(build_story_bible())
        repository.save_story_plan_node(root)
        repository.save_story_plan_node(first)
        repository.save_story_plan_node(second)

    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        roots = repository.list_story_plan_nodes(
            "story_project.mainland_demo",
            roots_only=True,
        )
        children = repository.list_story_plan_nodes(
            "story_project.mainland_demo",
            parent_node_id=root.node_id,
        )
        assert [node.node_id for node in roots] == [root.node_id]
        assert [node.node_id for node in children] == [first.node_id, second.node_id]
        assert repository.get_story_plan_node(second.node_id) == second


def test_episode_artifact_versions_are_immutable_and_ordered(database_runtime) -> None:
    first = build_episode_artifact()
    second = build_episode_artifact(
        artifact_id="artifact.mainland_demo.episode_001.draft.confirmed",
        version=2,
        title="Episode 1 Confirmed",
    )
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_episode_artifact(first)
        repository.save_episode_artifact(second)

    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        artifacts = repository.list_episode_artifacts(
            "story_project.mainland_demo",
            episode_number=1,
        )
        assert [artifact.artifact_version for artifact in artifacts] == [1, 2]
        assert repository.next_episode_artifact_version(
            "story_project.mainland_demo",
            1,
            first.artifact_kind,
        ) == 3
        with pytest.raises(LongStoryPersistenceConflictError, match="cannot be overwritten"):
            repository.save_episode_artifact(
                first.model_copy(update={"content_payload": {"title": "Overwrite"}})
            )


def test_repository_returns_latest_continuity_snapshot(database_runtime) -> None:
    with database_runtime.session() as session:
        repository = LongStoryRepository(session)
        repository.save_project(build_project())
        repository.save_story_bible(build_story_bible())
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


def test_sqlite_tests_enforce_production_foreign_key_semantics(database_runtime) -> None:
    with pytest.raises(IntegrityError, match="FOREIGN KEY constraint failed"):
        with database_runtime.session() as session:
            LongStoryRepository(session).save_story_stage(build_stage())


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
